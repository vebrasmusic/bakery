import { describe, expect, it } from "vitest";
import type { Pie, SliceWithResources, StatusResponse } from "@bakery/shared";
import { buildDashboardViewModel, buildSlicePaneRows, buildStatusSummary } from "./view-model.js";

const mockPie: Pie = {
  id: "p1",
  name: "My App",
  slug: "my-app",
  repoPath: null,
  createdAt: "2026-02-20T00:00:00.000Z",
};

const mockSlice: SliceWithResources = {
  id: "s1",
  pieId: "p1",
  ordinal: 1,
  host: "app-s1.localtest.me",
  worktreePath: "/tmp/app",
  branch: "main",
  status: "running",
  createdAt: "2026-02-20T00:00:00.000Z",
  stoppedAt: null,
  resources: [
    { key: "r1", protocol: "http", expose: "primary", allocatedPort: 30001, routeHost: "app-s1.localtest.me" },
  ],
};

const mockStatus: StatusResponse = {
  daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
  pies: { total: 1 },
  slices: {
    total: 2,
    byStatus: { creating: 0, running: 1, stopped: 1, error: 0 },
    byPie: [{ pieId: "p1", pieName: "My App", pieSlug: "my-app", total: 2, running: 1 }],
  },
  generatedAt: "2026-02-20T00:00:00.000Z",
};

describe("buildDashboardViewModel", () => {
  it("groups slices under their pie", () => {
    const viewModel = buildDashboardViewModel({ pies: [mockPie], slices: [mockSlice] });
    expect(viewModel.pieCards).toHaveLength(1);
    expect(viewModel.pieCards[0]!.pieName).toBe("My App");
    expect(viewModel.pieCards[0]!.slices).toHaveLength(1);
    expect(viewModel.pieCards[0]!.slices[0]!.sliceId).toBe("s1");
    expect(viewModel.pieCards[0]!.slices[0]!.resources).toBe("r1:30001");
    expect(viewModel.orphanSlices).toHaveLength(0);
  });

  it("returns empty arrays when no data", () => {
    const viewModel = buildDashboardViewModel({ pies: [], slices: [] });
    expect(viewModel.pieCards).toHaveLength(0);
    expect(viewModel.orphanSlices).toHaveLength(0);
  });

  it("places slices with unknown pieId in orphans", () => {
    const orphanSlice: SliceWithResources = { ...mockSlice, pieId: "unknown" };
    const viewModel = buildDashboardViewModel({ pies: [mockPie], slices: [orphanSlice] });
    expect(viewModel.pieCards[0]!.slices).toHaveLength(0);
    expect(viewModel.orphanSlices).toHaveLength(1);
    expect(viewModel.orphanSlices[0]!.sliceId).toBe("s1");
  });

  it("counts running slices correctly", () => {
    const stoppedSlice: SliceWithResources = {
      ...mockSlice,
      id: "s2",
      status: "stopped",
      stoppedAt: "2026-02-20T01:00:00.000Z",
    };
    const viewModel = buildDashboardViewModel({ pies: [mockPie], slices: [mockSlice, stoppedSlice] });
    expect(viewModel.pieCards[0]!.runningCount).toBe(1);
    expect(viewModel.pieCards[0]!.sliceCount).toBe(2);
  });
});

describe("buildStatusSummary", () => {
  it("returns null for null input", () => {
    expect(buildStatusSummary(null)).toBeNull();
  });

  it("extracts summary from status response", () => {
    const summary = buildStatusSummary(mockStatus);
    expect(summary).toEqual({
      daemonHost: "127.0.0.1",
      daemonPort: 47123,
      routerPort: 4080,
      totalPies: 1,
      totalSlices: 2,
      creating: 0,
      running: 1,
      stopped: 1,
      error: 0,
    });
  });
});

describe("buildSlicePaneRows", () => {
  it("builds pie and slice rows", () => {
    const rows = buildSlicePaneRows({ pies: [mockPie], slices: [mockSlice] });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.rowType).toBe("pie");
    expect(rows[0]!.label).toContain("my-app");
    expect(rows[1]!.rowType).toBe("slice");
    expect(rows[1]!.label).toContain("s1");
  });

  it("adds orphan group rows when pie is missing", () => {
    const rows = buildSlicePaneRows({
      pies: [],
      slices: [{ ...mockSlice, pieId: "unknown" }]
    });
    expect(rows[0]!.label).toContain("orphan slices");
    expect(rows[1]!.rowType).toBe("slice");
  });
});
