import type { Pie, StatusResponse } from "@bakery/shared";
import type { SliceWithResources } from "../repos/repository.js";

interface StatusInput {
  host: string;
  port: number;
  routerPort: number;
  pies: Pie[];
  slices: SliceWithResources[];
}

export function buildStatusResponse(input: StatusInput): StatusResponse {
  const byStatus = {
    creating: 0,
    running: 0,
    stopped: 0,
    error: 0
  };

  const pieById = new Map(input.pies.map((pie) => [pie.id, pie]));
  const slicesByPie = new Map<
    string,
    {
      pieId: string;
      pieName: string;
      pieSlug: string;
      total: number;
      running: number;
    }
  >();

  for (const slice of input.slices) {
    byStatus[slice.status] += 1;

    const pie = pieById.get(slice.pieId);
    if (!pie) {
      continue;
    }

    const entry = slicesByPie.get(slice.pieId);
    if (!entry) {
      slicesByPie.set(slice.pieId, {
        pieId: pie.id,
        pieName: pie.name,
        pieSlug: pie.slug,
        total: 1,
        running: slice.status === "running" ? 1 : 0
      });
      continue;
    }

    entry.total += 1;
    if (slice.status === "running") {
      entry.running += 1;
    }
  }

  return {
    daemon: {
      status: "ok",
      host: input.host,
      port: input.port,
      routerPort: input.routerPort
    },
    pies: {
      total: input.pies.length
    },
    slices: {
      total: input.slices.length,
      byStatus,
      byPie: [...slicesByPie.values()].sort((a, b) => a.pieName.localeCompare(b.pieName))
    },
    generatedAt: new Date().toISOString()
  };
}
