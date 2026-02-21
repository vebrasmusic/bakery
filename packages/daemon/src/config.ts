import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RuntimeConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  hostSuffix: string;
  portRangeStart: number;
  portRangeEnd: number;
  routerPortCandidates: number[];
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function parsePortCandidates(raw: string | undefined): number[] {
  const input = raw ?? "80,443,4080";
  const values = input
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);

  if (values.length === 0) {
    return [80, 443, 4080];
  }

  return [...new Set(values)];
}

export function loadRuntimeConfig(): RuntimeConfig {
  const host = process.env.BAKERY_HOST ?? "127.0.0.1";
  const port = Number(process.env.BAKERY_PORT ?? "47123");
  const dataDir = process.env.BAKERY_DATA_DIR ?? path.join(os.homedir(), ".bakery");
  ensureDir(dataDir);

  const hostSuffix = process.env.BAKERY_HOST_SUFFIX ?? "localtest.me";

  const portRangeStart = Number(process.env.BAKERY_PORT_RANGE_START ?? "30000");
  const portRangeEnd = Number(process.env.BAKERY_PORT_RANGE_END ?? "45000");

  if (Number.isNaN(port) || Number.isNaN(portRangeStart) || Number.isNaN(portRangeEnd)) {
    throw new Error("Invalid numeric runtime configuration values");
  }

  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, "bakery.db"),
    hostSuffix,
    portRangeStart,
    portRangeEnd,
    routerPortCandidates: parsePortCandidates(process.env.BAKERY_ROUTER_PORTS)
  };
}
