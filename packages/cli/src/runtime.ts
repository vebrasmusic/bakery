import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchDaemonStatus, resolveDaemonUrl } from "@bakery/shared";

export interface DaemonStateFile {
  pid: number;
  daemonUrl: string;
  routerPort: number;
  startedAt: string;
  dataDir: string;
  host: string;
  port: number;
}

export function getBakeryDataDir(): string {
  return process.env.BAKERY_DATA_DIR ?? path.join(os.homedir(), ".bakery");
}

export function getBakeryFiles(dataDir = getBakeryDataDir()): {
  dataDir: string;
  pidPath: string;
  statePath: string;
  logPath: string;
} {
  return {
    dataDir,
    pidPath: path.join(dataDir, "daemon.pid"),
    statePath: path.join(dataDir, "daemon.json"),
    logPath: path.join(dataDir, "daemon.log")
  };
}

export function ensureDataDir(dataDir = getBakeryDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
}

export function readDaemonState(dataDir = getBakeryDataDir()): DaemonStateFile | null {
  const files = getBakeryFiles(dataDir);
  if (!existsSync(files.statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(files.statePath, "utf8")) as Partial<DaemonStateFile>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.daemonUrl === "string" &&
      typeof parsed.routerPort === "number" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.dataDir === "string" &&
      typeof parsed.host === "string" &&
      typeof parsed.port === "number"
    ) {
      return parsed as DaemonStateFile;
    }
  } catch {
    return null;
  }

  return null;
}

export function writeDaemonState(state: DaemonStateFile): void {
  const files = getBakeryFiles(state.dataDir);
  ensureDataDir(state.dataDir);
  writeFileSync(files.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(files.pidPath, `${state.pid}\n`, "utf8");
}

export function clearDaemonState(dataDir = getBakeryDataDir()): void {
  const files = getBakeryFiles(dataDir);
  rmSync(files.statePath, { force: true });
  rmSync(files.pidPath, { force: true });
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }
  const raw = readFileSync(pidPath, "utf8").trim();
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function getProcessCommand(pid: number): string | null {
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function isBakeryOwnedCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  if (normalized.includes("bakery-daemon")) {
    return true;
  }
  if (normalized.includes("packages/daemon")) {
    return true;
  }
  if (normalized.includes("bakery") && normalized.includes("daemon")) {
    return true;
  }
  return false;
}

async function terminatePid(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isPidAlive(pid);
  }

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(120);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isPidAlive(pid);
  }

  return !isPidAlive(pid);
}

function resolveDaemonEntrypoint(): { entry: string; useTsx: boolean } {
  const require = createRequire(import.meta.url);

  try {
    return {
      entry: require.resolve("@bakery/daemon/dist/index.js"),
      useTsx: false
    };
  } catch {
    return {
      entry: require.resolve("@bakery/daemon/src/index.ts"),
      useTsx: true
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupPidFile(
  pidPath: string,
  options: { removeIfNotOwned: boolean }
): Promise<{ removed: boolean; stoppedPid?: number }> {
  const pid = readPidFile(pidPath);
  if (!pid) {
    rmSync(pidPath, { force: true });
    return { removed: false };
  }

  if (!isPidAlive(pid)) {
    rmSync(pidPath, { force: true });
    return { removed: true, stoppedPid: pid };
  }

  const command = getProcessCommand(pid);
  if (!command || !isBakeryOwnedCommand(command)) {
    if (options.removeIfNotOwned) {
      rmSync(pidPath, { force: true });
      return { removed: true };
    }
    return { removed: false };
  }

  await terminatePid(pid);
  rmSync(pidPath, { force: true });
  return { removed: true, stoppedPid: pid };
}

async function cleanupLegacyPidFiles(dataDir = getBakeryDataDir()): Promise<void> {
  const candidates = [path.join(dataDir, "daemon.pid")];

  const seen = new Set<string>();
  for (const pidPath of candidates) {
    if (seen.has(pidPath)) {
      continue;
    }
    seen.add(pidPath);
    await cleanupPidFile(pidPath, { removeIfNotOwned: false });
  }
}

export async function waitForDaemon(daemonUrl: string, timeoutMs = 8000): Promise<{ routerPort: number } | null> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    try {
      const response = await fetch(`${daemonUrl}/v1/health`);
      if (response.ok) {
        const payload = (await response.json()) as { routerPort?: number };
        return { routerPort: Number(payload.routerPort ?? 0) };
      }
    } catch {
      // keep waiting
    }

    await sleep(150);
  }

  return null;
}

export async function upDaemon(input?: { daemonUrl?: string }): Promise<DaemonStateFile> {
  const daemonUrl = resolveDaemonUrl(input?.daemonUrl);
  const url = new URL(daemonUrl);
  const dataDir = getBakeryDataDir();
  ensureDataDir(dataDir);
  const files = getBakeryFiles(dataDir);

  const existing = await waitForDaemon(daemonUrl, 350);
  if (existing) {
    const current = readDaemonState(dataDir);
    if (current) {
      return current;
    }

    const existingPid = readPidFile(files.pidPath) ?? 0;
    const fallback: DaemonStateFile = {
      pid: existingPid,
      daemonUrl,
      routerPort: existing.routerPort,
      startedAt: new Date().toISOString(),
      dataDir,
      host: url.hostname,
      port: Number(url.port || "47123")
    };
    writeDaemonState(fallback);
    return fallback;
  }

  await cleanupLegacyPidFiles(dataDir);

  const daemonEntry = resolveDaemonEntrypoint();
  const args = daemonEntry.useTsx ? ["--import", "tsx", daemonEntry.entry] : [daemonEntry.entry];
  const logFd = openSync(files.logPath, "a");

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        BAKERY_HOST: url.hostname,
        BAKERY_PORT: url.port || "47123",
        BAKERY_DATA_DIR: dataDir
      }
    });
  } finally {
    closeSync(logFd);
  }

  child.unref();

  const started = await waitForDaemon(daemonUrl, 10000);
  if (!started) {
    throw new Error(`Daemon failed to start at ${daemonUrl} (see ${files.logPath})`);
  }

  const state: DaemonStateFile = {
    pid: child.pid ?? 0,
    daemonUrl,
    routerPort: started.routerPort,
    startedAt: new Date().toISOString(),
    dataDir,
    host: url.hostname,
    port: Number(url.port || "47123")
  };

  writeDaemonState(state);
  return state;
}

export async function downDaemon(daemonUrl?: string): Promise<{ stopped: boolean; reason?: string }> {
  const dataDir = getBakeryDataDir();
  const state = readDaemonState(dataDir);
  const files = getBakeryFiles(dataDir);

  if (state && state.pid > 0) {
    if (!isPidAlive(state.pid)) {
      clearDaemonState(dataDir);
      return { stopped: false };
    }

    const command = getProcessCommand(state.pid);
    if (command && !isBakeryOwnedCommand(command)) {
      return { stopped: false, reason: "PID in state file is not a Bakery-owned daemon process." };
    }

    const stopped = await terminatePid(state.pid);
    clearDaemonState(dataDir);
    return { stopped };
  }

  await cleanupPidFile(files.pidPath, { removeIfNotOwned: true });
  await cleanupLegacyPidFiles(dataDir);

  const alive = await waitForDaemon(resolveDaemonUrl(daemonUrl), 350);
  if (alive) {
    return { stopped: false, reason: "Daemon is running but not owned by current state file." };
  }

  return { stopped: false };
}

export async function probeStatus(input?: { daemonUrl?: string }): Promise<
  | { running: false; daemonUrl: string; state: DaemonStateFile | null }
  | {
      running: true;
      daemonUrl: string;
      state: DaemonStateFile | null;
      status: Awaited<ReturnType<typeof fetchDaemonStatus>>;
    }
> {
  const daemonUrl = resolveDaemonUrl(input?.daemonUrl);
  const state = readDaemonState();

  try {
    const status = await fetchDaemonStatus({ daemonUrl });
    return {
      running: true,
      daemonUrl,
      state,
      status
    };
  } catch {
    return {
      running: false,
      daemonUrl,
      state
    };
  }
}

export function resolveTuiEntrypoint(): { entry: string; useTsx: boolean } {
  const require = createRequire(import.meta.url);

  try {
    return {
      entry: require.resolve("@bakery/tui/dist/index.js"),
      useTsx: false
    };
  } catch {
    return {
      entry: require.resolve("@bakery/tui/src/index.ts"),
      useTsx: true
    };
  }
}
