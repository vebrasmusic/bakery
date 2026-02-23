#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import {
  createPie,
  createSlice,
  fetchDaemonStatus,
  listPies,
  listSlices,
  removeSlice,
  resolveDaemonUrl,
  stopSlice
} from "@bakery/shared";
import { buildDefaultResources, executeCommand, helpText, parseCommand } from "./commands.js";
import { renderPieList, renderSliceList, renderStatusDashboard } from "./render.js";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function parseArgs(argv: string[]): { daemonUrl?: string } {
  const parsed: { daemonUrl?: string } = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--daemon-url" && next !== undefined) {
      parsed.daemonUrl = next;
      index += 1;
      continue;
    }
  }
  return parsed;
}

function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function resolveUserPath(input: string): string {
  return path.resolve(expandUserPath(input));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const daemonUrl = resolveDaemonUrl(args.daemonUrl);

  try {
    const api = {
      fetchStatus: () => fetchDaemonStatus({ daemonUrl }),
      listPies: () => listPies({ daemonUrl }),
      createPie: (input: Parameters<typeof createPie>[0]) => createPie(input, { daemonUrl }),
      listSlices: (query: Parameters<typeof listSlices>[0]) => listSlices(query, { daemonUrl }),
      createSlice: (input: Parameters<typeof createSlice>[0]) => createSlice(input, { daemonUrl }),
      stopSlice: async (sliceId: string) => {
        await stopSlice(sliceId, { daemonUrl });
      },
      removeSlice: async (sliceId: string) => {
        await removeSlice(sliceId, { daemonUrl });
      }
    };

    const initial = await Promise.all([api.fetchStatus(), api.listPies(), api.listSlices({ all: true })]);
    process.stdout.write(`${renderStatusDashboard(initial[0])}\n\n`);
    process.stdout.write(`${renderPieList(initial[1].pies)}\n\n`);
    process.stdout.write(`${renderSliceList(initial[2].slices)}\n\n`);
    process.stdout.write(`${helpText()}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    async function promptValue(label: string, defaultValue?: string): Promise<string> {
      const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
      const value = await rl.question(`${label}${suffix}: `);
      const trimmed = value.trim();
      if (trimmed.length === 0 && defaultValue !== undefined) {
        return defaultValue;
      }
      return trimmed;
    }

    async function runInteractivePieCreate(): Promise<{ output: string; refresh?: boolean }> {
      const name = (await promptValue("Pie name")).trim();
      if (!name) {
        return { output: "Pie create cancelled: pie name is required." };
      }

      const repoPathInput = (await promptValue("Repo path (optional)", "")).trim();
      const repoPath = repoPathInput ? resolveUserPath(repoPathInput) : undefined;

      const created = await api.createPie({ name, repoPath });
      return { output: `Created pie ${created.pie.slug} (${created.pie.id})`, refresh: true };
    }

    async function runInteractiveSliceCreate(): Promise<{ output: string; refresh?: boolean }> {
      const pies = await api.listPies();
      if (pies.pies.length > 0) {
        process.stdout.write(
          `Available pies: ${pies.pies
            .map((pie: { id: string; slug: string }) => `${pie.slug} (${pie.id})`)
            .join(", ")}\n`
        );
      }

      const pieId = (await promptValue("Pie (id or slug)")).trim();
      const worktreePath = resolveUserPath(await promptValue("Worktree path", "."));
      const branch = (await promptValue("Branch", "main")).trim() || "main";
      const numResourcesInput = (await promptValue("Number of resources (--numresources)", "3")).trim();

      if (!pieId) {
        return { output: "Slice create cancelled: pie is required." };
      }

      const numResources = Number.parseInt(numResourcesInput, 10);
      if (!Number.isInteger(numResources) || numResources < 1) {
        return { output: "Slice create cancelled: --numresources must be a positive integer." };
      }

      const created = await api.createSlice({
        pieId,
        worktreePath,
        branch,
        resources: buildDefaultResources(numResources)
      });

      return {
        output: JSON.stringify(created.slice, null, 2),
        refresh: true
      };
    }

    while (true) {
      let line: string;
      try {
        line = await rl.question("bakery> ");
      } catch (error) {
        if (error instanceof Error && error.message === "readline was closed") {
          break;
        }
        throw error;
      }
      const parsed = parseCommand(line);
      let result: { output: string; quit?: boolean; refresh?: boolean };

      if (parsed.kind === "pie-create-prompt") {
        result = await runInteractivePieCreate();
      } else if (parsed.kind === "slice-create-prompt") {
        result = await runInteractiveSliceCreate();
      } else {
        result = await executeCommand(parsed, api);
      }
      process.stdout.write(`${result.output}\n`);

      if (result.quit) {
        rl.close();
        break;
      }

      if (result.refresh) {
        const [status, pies, slices] = await Promise.all([api.fetchStatus(), api.listPies(), api.listSlices({ all: true })]);
        process.stdout.write(`${renderStatusDashboard(status)}\n\n`);
        process.stdout.write(`${renderPieList(pies.pies)}\n\n`);
        process.stdout.write(`${renderSliceList(slices.slices)}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`Failed to start TUI against ${daemonUrl}: ${toErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

main();
