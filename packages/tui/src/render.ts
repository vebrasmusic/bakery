import type { ListPiesResponse, ListSlicesResponse, StatusResponse } from "@bakery/shared";

function padRight(value: string, length: number): string {
  if (value.length >= length) {
    return value;
  }
  return value + " ".repeat(length - value.length);
}

export function renderStatusDashboard(status: StatusResponse): string {
  const pieRows = status.slices.byPie.map(
    (pie: StatusResponse["slices"]["byPie"][number]) =>
      ` ${padRight(pie.pieName, 20)} ${padRight(pie.pieSlug, 14)} ${String(pie.running).padStart(2)}/${String(pie.total).padEnd(2)} `
  );

  const lines = [
    "Bakery Status",
    "============",
    "",
    `Daemon    : ${status.daemon.status} (${status.daemon.host}:${status.daemon.port})`,
    `Router    : ${status.daemon.host}:${status.daemon.routerPort}`,
    `Generated : ${status.generatedAt}`,
    `Pies      : ${status.pies.total}`,
    `Slices    : ${status.slices.total} total`,
    `            running=${status.slices.byStatus.running} creating=${status.slices.byStatus.creating} stopped=${status.slices.byStatus.stopped} error=${status.slices.byStatus.error}`,
    ""
  ];

  if (pieRows.length > 0) {
    lines.push("Per Pie");
    lines.push("----------------------------------------------");
    lines.push(" Name                 Slug           Running  ");
    lines.push("----------------------------------------------");
    lines.push(...pieRows);
    lines.push("----------------------------------------------");
  } else {
    lines.push("No pies found.");
  }

  return lines.join("\n");
}

export function renderPieList(pies: ListPiesResponse["pies"]): string {
  if (pies.length === 0) {
    return "No pies found.";
  }

  const lines = ["Pies", "-------------------------------"];
  for (const pie of pies) {
    lines.push(`${pie.slug.padEnd(16)} ${pie.id}`);
  }
  return lines.join("\n");
}

export function renderSliceList(slices: ListSlicesResponse["slices"]): string {
  if (slices.length === 0) {
    return "No slices found.";
  }

  const lines = ["Slices", "-------------------------------------------------------------------------------------"];
  for (const slice of slices) {
    const resources = slice.resources
      .map((resource: ListSlicesResponse["slices"][number]["resources"][number]) => `${resource.key}:${resource.allocatedPort}`)
      .join(",");
    lines.push(`${slice.id.padEnd(18)} ${slice.status.padEnd(8)} ${slice.host.padEnd(38)} ${resources}`);
  }
  return lines.join("\n");
}
