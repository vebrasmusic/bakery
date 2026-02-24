#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink";
import {
  createPie,
  createSlice,
  fetchDaemonStatus,
  listPies,
  listSlices,
  removePie,
  removeSlice,
  resolveDaemonUrl,
  stopSlice,
} from "@bakery/shared";
import type { TuiCommandApi } from "./commands.js";
import { renderPieList, renderSliceList, renderStatusDashboard } from "./render.js";
import { BakeryApp } from "./app.js";

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildApi(daemonUrl: string): TuiCommandApi {
  return {
    fetchStatus: () => fetchDaemonStatus({ daemonUrl }),
    listPies: () => listPies({ daemonUrl }),
    createPie: (input) => createPie(input, { daemonUrl }),
    removePie: async (pieId) => {
      await removePie(pieId, { daemonUrl });
    },
    listSlices: (query) => listSlices(query, { daemonUrl }),
    createSlice: (input) => createSlice(input, { daemonUrl }),
    stopSlice: async (sliceId) => {
      await stopSlice(sliceId, { daemonUrl });
    },
    removeSlice: async (sliceId) => {
      await removeSlice(sliceId, { daemonUrl });
    },
  };
}

async function runPlainText(api: TuiCommandApi): Promise<void> {
  const [status, piesResult, slicesResult] = await Promise.all([
    api.fetchStatus(),
    api.listPies(),
    api.listSlices({ all: true }),
  ]);
  process.stdout.write(`${renderStatusDashboard(status)}\n\n`);
  process.stdout.write(`${renderPieList(piesResult.pies)}\n\n`);
  process.stdout.write(`${renderSliceList(slicesResult.slices)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const daemonUrl = resolveDaemonUrl(args.daemonUrl);
  const api = buildApi(daemonUrl);

  try {
    if (!process.stdout.isTTY) {
      await runPlainText(api);
      return;
    }

    const { waitUntilExit } = render(
      <BakeryApp api={api} daemonUrl={daemonUrl} />
    );
    await waitUntilExit();
  } catch (error) {
    process.stderr.write(
      `Failed to start TUI against ${daemonUrl}: ${toErrorMessage(error)}\n`
    );
    process.exitCode = 1;
  }
}

main();
