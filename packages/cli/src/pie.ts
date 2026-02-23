import os from "node:os";
import path from "node:path";
import { createPie, listPies, removePie } from "@bakery/shared";

export interface CliGlobalOptions {
  daemonUrl?: string;
}

export interface PieRow {
  id: string;
  name: string;
  slug: string;
  repoPath?: string | null;
  createdAt: string;
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

export function formatPieList(pies: PieRow[]): string {
  if (pies.length === 0) {
    return "No pies found.";
  }

  const lines = ["Pies:", "Name                 Slug                 Repo", "---------------------------------------------------------------"];
  for (const pie of pies) {
    lines.push(`${pie.name.padEnd(20)} ${pie.slug.padEnd(20)} ${(pie.repoPath ?? "-").slice(0, 40)}`);
  }
  return lines.join("\n");
}

export async function runPieCreate(
  options: {
    name: string;
    repo?: string;
  },
  globals: CliGlobalOptions
): Promise<{ id: string; slug: string }> {
  const payload: {
    name: string;
    repoPath?: string;
  } = {
    name: options.name
  };

  if (options.repo !== undefined && options.repo.trim().length > 0) {
    payload.repoPath = resolveUserPath(options.repo);
  }

  const clientOptions: CliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }

  const created = await createPie(payload, clientOptions);
  return { id: created.pie.id, slug: created.pie.slug };
}

export async function runPieList(globals: CliGlobalOptions): Promise<PieRow[]> {
  const clientOptions: CliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }
  const response = await listPies(clientOptions);
  return response.pies.map((pie) => ({
    id: pie.id,
    name: pie.name,
    slug: pie.slug,
    createdAt: pie.createdAt,
    ...(pie.repoPath !== undefined ? { repoPath: pie.repoPath } : {})
  }));
}

export async function runPieRemove(
  options: {
    id: string;
  },
  globals: CliGlobalOptions
): Promise<void> {
  const clientOptions: CliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }
  await removePie(options.id, clientOptions);
}
