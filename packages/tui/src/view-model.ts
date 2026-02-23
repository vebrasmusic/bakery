import type { ListPiesResponse, ListSlicesResponse, SliceStatus, StatusResponse } from "@bakery/shared";

export interface SliceLineView {
  sliceId: string;
  status: SliceStatus;
  host: string;
  resources: string;
}

export interface PieCardView {
  pieId: string;
  pieName: string;
  pieSlug: string;
  sliceCount: number;
  runningCount: number;
  slices: SliceLineView[];
}

export interface DashboardViewModel {
  pieCards: PieCardView[];
  orphanSlices: SliceLineView[];
}

export interface StatusSummary {
  daemonHost: string;
  daemonPort: number;
  routerPort: number;
  totalPies: number;
  totalSlices: number;
  creating: number;
  running: number;
  stopped: number;
  error: number;
}

type PieItem = ListPiesResponse["pies"][number];
type SliceItem = ListSlicesResponse["slices"][number];

function buildSliceLine(slice: SliceItem): SliceLineView {
  const resourceParts = slice.resources.map(
    (resource) => `${resource.key}:${resource.allocatedPort}`
  );
  return {
    sliceId: slice.id,
    status: slice.status,
    host: slice.host,
    resources: resourceParts.join(","),
  };
}

export function buildDashboardViewModel(data: {
  pies: PieItem[];
  slices: SliceItem[];
}): DashboardViewModel {
  const slicesByPie = new Map<string, SliceItem[]>();
  const orphanSliceList: SliceItem[] = [];
  const pieIdSet = new Set(data.pies.map((pie) => pie.id));

  for (const slice of data.slices) {
    if (pieIdSet.has(slice.pieId)) {
      const existing = slicesByPie.get(slice.pieId);
      if (existing) {
        existing.push(slice);
      } else {
        slicesByPie.set(slice.pieId, [slice]);
      }
    } else {
      orphanSliceList.push(slice);
    }
  }

  const pieCards: PieCardView[] = data.pies.map((pie) => {
    const pieSlices = slicesByPie.get(pie.id) ?? [];
    const runningCount = pieSlices.filter((slice) => slice.status === "running").length;
    return {
      pieId: pie.id,
      pieName: pie.name,
      pieSlug: pie.slug,
      sliceCount: pieSlices.length,
      runningCount,
      slices: pieSlices.map(buildSliceLine),
    };
  });

  return {
    pieCards,
    orphanSlices: orphanSliceList.map(buildSliceLine),
  };
}

export function buildStatusSummary(
  status: StatusResponse | null
): StatusSummary | null {
  if (status === null) {
    return null;
  }
  return {
    daemonHost: status.daemon.host,
    daemonPort: status.daemon.port,
    routerPort: status.daemon.routerPort,
    totalPies: status.pies.total,
    totalSlices: status.slices.total,
    creating: status.slices.byStatus.creating,
    running: status.slices.byStatus.running,
    stopped: status.slices.byStatus.stopped,
    error: status.slices.byStatus.error,
  };
}
