import { createPie, listPies, removePie } from "@bakery/shared";

export interface CliGlobalOptions {
  daemonUrl?: string;
}

export interface PieRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export function formatPieList(pies: PieRow[]): string {
  if (pies.length === 0) {
    return "No pies found.";
  }

  const lines = ["Pies:", "Name                 Slug", "--------------------------------------------"];
  for (const pie of pies) {
    lines.push(`${pie.name.padEnd(20)} ${pie.slug.padEnd(20)}`);
  }
  return lines.join("\n");
}

export async function runPieCreate(
  options: {
    name: string;
  },
  globals: CliGlobalOptions
): Promise<{ id: string; slug: string }> {
  const clientOptions: CliGlobalOptions = {};
  if (globals.daemonUrl !== undefined) {
    clientOptions.daemonUrl = globals.daemonUrl;
  }

  const created = await createPie({ name: options.name }, clientOptions);
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
    createdAt: pie.createdAt
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
