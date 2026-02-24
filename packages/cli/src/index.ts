#!/usr/bin/env node
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { resolveDaemonUrl } from "@bakery/shared";
import { formatDaemonDown, formatStatus } from "./format.js";
import { formatPieList, runPieCreate, runPieList, runPieRemove } from "./pie.js";
import { formatSliceList, runSliceCreate, runSliceList, runSliceRemove, runSliceStop } from "./slice.js";
import { downDaemon, probeStatus, resolveTuiEntrypoint, upDaemon } from "./runtime.js";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

async function confirmPieRemoval(pieIdentifier: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Refusing to delete pie without confirmation in non-interactive mode. Re-run with --force.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `Delete pie ${pieIdentifier} and all associated slices/resources? Type "yes" to confirm: `
    );
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function resolveGlobals(): { daemonUrl?: string } {
  const opts = program.opts<{ daemonUrl?: string }>();
  return {
    ...(opts.daemonUrl !== undefined ? { daemonUrl: opts.daemonUrl } : {})
  };
}

async function launchDashboard(): Promise<void> {
  const globals = resolveGlobals();
  const daemonUrl = resolveDaemonUrl(globals.daemonUrl);
  await upDaemon({ daemonUrl });

  const entry = resolveTuiEntrypoint();
  const args = entry.useTsx ? ["--import", "tsx", entry.entry] : [entry.entry];
  args.push("--daemon-url", daemonUrl);

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      BAKERY_DAEMON_URL: daemonUrl
    }
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        resolve();
        return;
      }

      if (code && code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}

const program = new Command();

program
  .name("bakery")
  .description("Bakery CLI")
  .showHelpAfterError()
  .option("-u, --daemon-url <url>", "Bakery daemon base URL");

program.action(async () => {
  try {
    await launchDashboard();
  } catch (error) {
    process.stderr.write(`Failed to launch dashboard: ${toErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
});

program
  .command("up")
  .description("Start Bakery daemon/router (idempotent)")
  .option("--json", "Emit JSON output")
  .action(async (options: { json?: boolean }) => {
    const globals = resolveGlobals();
    const daemonUrl = resolveDaemonUrl(globals.daemonUrl);
    const before = await probeStatus({ daemonUrl });

    try {
      const state = await upDaemon({ daemonUrl });
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ status: before.running ? "already-running" : "started", daemon: state }, null, 2)}\n`
        );
        return;
      }

      process.stdout.write(
        [
          `Daemon ${before.running ? "already running" : "started"}: ${state.daemonUrl}`,
          `Router port: ${state.routerPort}`,
          `Data dir: ${state.dataDir}`
        ].join("\n") + "\n"
      );
    } catch (error) {
      process.stderr.write(`Bakery up failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("down")
  .description("Stop owned Bakery daemon/router")
  .option("--json", "Emit JSON output")
  .action(async (options: { json?: boolean }) => {
    const globals = resolveGlobals();
    const daemonUrl = resolveDaemonUrl(globals.daemonUrl);

    try {
      const result = await downDaemon(daemonUrl);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (result.stopped) {
        process.stdout.write("Bakery daemon stopped.\n");
        return;
      }
      if (result.reason) {
        process.stdout.write(`Bakery daemon not stopped: ${result.reason}\n`);
        return;
      }
      process.stdout.write("Bakery daemon already stopped.\n");
    } catch (error) {
      process.stderr.write(`Bakery down failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show daemon health and slice inventory")
  .option("--json", "Emit JSON output")
  .option("--watch", "Poll continuously")
  .option("--interval-ms <ms>", "Watch interval in milliseconds", parsePositiveInteger, 2000)
  .action(async (options: { json?: boolean; watch?: boolean; intervalMs: number }) => {
    const daemonUrl = resolveDaemonUrl(resolveGlobals().daemonUrl);

    const renderOnce = async (): Promise<void> => {
      const result = await probeStatus({ daemonUrl });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result.running ? result.status : { running: false, daemonUrl }, null, 2)}\n`);
        return;
      }
      if (!result.running) {
        process.stdout.write(`${formatDaemonDown(daemonUrl)}\n`);
        return;
      }
      process.stdout.write(`${formatStatus(result.status)}\n`);
    };

    try {
      await renderOnce();
      if (!options.watch) {
        return;
      }

      let stopping = false;
      const onSignal = () => {
        stopping = true;
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);

      while (!stopping) {
        await sleep(options.intervalMs);
        if (stopping) {
          break;
        }
        process.stdout.write("\n");
        await renderOnce();
      }
      process.stdout.write("Status watch stopped.\n");
    } catch (error) {
      process.stderr.write(`Failed to fetch status from ${daemonUrl}: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

const pie = program.command("pie").description("Manage pies");

pie
  .command("create")
  .description("Create a pie")
  .requiredOption("--name <name>", "Pie name")
  .option("--repo <path>", "Repository path (optional metadata)")
  .action(async (options: { name: string; repo?: string }) => {
    const globals = resolveGlobals();
    try {
      const result = await runPieCreate(options, globals);
      process.stdout.write(`Created pie ${result.slug} (${result.id})\n`);
    } catch (error) {
      process.stderr.write(`Pie create failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

pie
  .command("ls")
  .description("List pies")
  .option("--json", "Emit JSON output")
  .action(async (options: { json?: boolean }) => {
    const globals = resolveGlobals();
    try {
      const pies = await runPieList(globals);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ pies }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatPieList(pies)}\n`);
    } catch (error) {
      process.stderr.write(`Pie list failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

pie
  .command("rm")
  .description("Delete a pie and all associated slices/resources")
  .requiredOption("--id <id-or-slug>", "Pie identifier")
  .option("--force", "Delete without confirmation")
  .action(async (options: { id: string; force?: boolean }) => {
    const globals = resolveGlobals();
    try {
      if (!options.force) {
        const confirmed = await confirmPieRemoval(options.id);
        if (!confirmed) {
          process.stdout.write("Pie rm cancelled.\n");
          return;
        }
      }

      await runPieRemove({ id: options.id }, globals);
      process.stdout.write(`Removed pie ${options.id}\n`);
    } catch (error) {
      process.stderr.write(`Pie rm failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

const slice = program.command("slice").description("Manage slices");

slice
  .command("create")
  .description("Create a slice and allocate resource ports")
  .requiredOption("--pie <id-or-slug>", "Pie identifier")
  .requiredOption("--numresources <count>", "Number of resources to allocate", parsePositiveInteger)
  .option("--slice <name>", "Optional slice label for caller-side usage")
  .option("--worktree <path>", "Worktree path", ".")
  .option("--branch <name>", "Git branch name", "main")
  .option("--text", "Emit human-readable output instead of JSON")
  .action(
    async (options: {
      pie: string;
      numresources: number;
      slice?: string;
      worktree?: string;
      branch?: string;
      text?: boolean;
    }) => {
      const globals = resolveGlobals();
      try {
        const result = await runSliceCreate(
          {
            pie: options.pie,
            numResources: options.numresources,
            ...(options.slice ? { sliceName: options.slice } : {}),
            ...(options.worktree ? { worktree: options.worktree } : {}),
            ...(options.branch ? { branch: options.branch } : {})
          },
          globals
        );

        if (options.text) {
          process.stdout.write(`Created slice ${result.id} (${result.host})\n`);
        } else {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } catch (error) {
        process.stderr.write(`Slice create failed: ${toErrorMessage(error)}\n`);
        process.exitCode = 1;
      }
    }
  );

slice
  .command("ls")
  .description("List slices")
  .option("--pie <id-or-slug>", "Filter by pie")
  .option("--all", "List all slices across pies")
  .option("--json", "Emit JSON output")
  .action(async (options: { pie?: string; all?: boolean; json?: boolean }) => {
    const globals = resolveGlobals();
    try {
      const slices = await runSliceList(options, globals);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ slices }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatSliceList(slices)}\n`);
    } catch (error) {
      process.stderr.write(`Slice list failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

slice
  .command("stop")
  .description("Stop a slice (disable routing)")
  .requiredOption("--id <slice-id>", "Slice id")
  .action(async (options: { id: string }) => {
    const globals = resolveGlobals();
    try {
      await runSliceStop(options, globals);
      process.stdout.write(`Stopped slice ${options.id}\n`);
    } catch (error) {
      process.stderr.write(`Slice stop failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

slice
  .command("rm")
  .description("Remove a slice registration")
  .requiredOption("--id <slice-id>", "Slice id")
  .action(async (options: { id: string }) => {
    const globals = resolveGlobals();
    try {
      await runSliceRemove(options, globals);
      process.stdout.write(`Removed slice ${options.id}\n`);
    } catch (error) {
      process.stderr.write(`Slice rm failed: ${toErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
