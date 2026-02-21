import type { StatusResponse } from "@bakery/shared";

export function formatStatus(status: StatusResponse): string {
  const lines: string[] = [];
  lines.push(`Daemon: ${status.daemon.status} (${status.daemon.host}:${status.daemon.port})`);
  lines.push(`Router: ${status.daemon.host}:${status.daemon.routerPort}`);
  lines.push(`Generated: ${status.generatedAt}`);
  lines.push("");
  lines.push(`Pies: ${status.pies.total}`);
  lines.push(
    `Slices: ${status.slices.total} total (${status.slices.byStatus.running} running, ${status.slices.byStatus.creating} creating, ${status.slices.byStatus.stopped} stopped, ${status.slices.byStatus.error} error)`
  );

  if (status.slices.byPie.length > 0) {
    lines.push("");
    lines.push("Per pie:");
    for (const pie of status.slices.byPie) {
      lines.push(`- ${pie.pieName} (${pie.pieSlug}): ${pie.running}/${pie.total} running`);
    }
  }

  return lines.join("\n");
}

export function formatDaemonDown(daemonUrl: string): string {
  return [
    `Daemon: down (${daemonUrl})`,
    "Hint: run `bakery up` to start the system."
  ].join("\n");
}
