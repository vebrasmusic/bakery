import { describe, expect, it, vi } from "vitest";
import { handleRemovePie } from "./pieHandlers.js";

describe("pieHandlers", () => {
  it("removes pie by stopping/removing associated slices first", async () => {
    const pie = {
      id: "pie-1",
      name: "My Pie",
      slug: "my-pie",
      repoPath: null,
      createdAt: "2026-02-20T00:00:00.000Z"
    };
    const slices = [
      {
        id: "slice-running",
        pieId: "pie-1",
        ordinal: 1,
        host: "my-pie-s1.localtest.me",
        worktreePath: "/tmp/one",
        branch: "main",
        status: "running" as const,
        createdAt: "2026-02-20T00:00:00.000Z",
        stoppedAt: null
      },
      {
        id: "slice-stopped",
        pieId: "pie-1",
        ordinal: 2,
        host: "my-pie-s2.localtest.me",
        worktreePath: "/tmp/two",
        branch: "main",
        status: "stopped" as const,
        createdAt: "2026-02-20T00:00:00.000Z",
        stoppedAt: "2026-02-20T00:05:00.000Z"
      }
    ];

    const repo = {
      createPie: vi.fn(),
      listPies: vi.fn(),
      findPieByIdOrSlug: vi.fn().mockReturnValue(pie),
      listSlices: vi.fn().mockReturnValue(slices),
      deletePie: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const orchestrator = {
      stopSlice: vi.fn().mockResolvedValue(undefined),
      removeSlice: vi.fn().mockResolvedValue(undefined)
    };

    await handleRemovePie({ pieIdentifier: "my-pie" }, { repo, orchestrator });

    expect(repo.findPieByIdOrSlug).toHaveBeenCalledWith("my-pie");
    expect(repo.listSlices).toHaveBeenCalledWith({ pieId: "pie-1" });
    expect(orchestrator.stopSlice).toHaveBeenCalledTimes(1);
    expect(orchestrator.stopSlice).toHaveBeenCalledWith(slices[0]);
    expect(orchestrator.removeSlice).toHaveBeenCalledTimes(2);
    expect(orchestrator.removeSlice).toHaveBeenNthCalledWith(1, slices[0]);
    expect(orchestrator.removeSlice).toHaveBeenNthCalledWith(2, slices[1]);
    expect(repo.deletePie).toHaveBeenCalledWith("pie-1");
    expect(repo.appendAuditLog).toHaveBeenCalledTimes(3);
    const firstAuditLog = repo.appendAuditLog.mock.calls[0]?.[0];
    const secondAuditLog = repo.appendAuditLog.mock.calls[1]?.[0];
    expect(firstAuditLog).toMatchObject({
      kind: "slice.deleted",
      pieId: "pie-1",
      payload: { reason: "pie.deleted", deletedSliceId: "slice-running" }
    });
    expect(firstAuditLog?.sliceId).toBeUndefined();
    expect(secondAuditLog).toMatchObject({
      kind: "slice.deleted",
      pieId: "pie-1",
      payload: { reason: "pie.deleted", deletedSliceId: "slice-stopped" }
    });
    expect(secondAuditLog?.sliceId).toBeUndefined();
  });

  it("throws when pie is missing", async () => {
    const repo = {
      createPie: vi.fn(),
      listPies: vi.fn(),
      findPieByIdOrSlug: vi.fn().mockReturnValue(null),
      listSlices: vi.fn(),
      deletePie: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const orchestrator = {
      stopSlice: vi.fn().mockResolvedValue(undefined),
      removeSlice: vi.fn().mockResolvedValue(undefined)
    };

    await expect(handleRemovePie({ pieIdentifier: "unknown" }, { repo, orchestrator })).rejects.toThrow("Pie not found");
    expect(orchestrator.stopSlice).not.toHaveBeenCalled();
    expect(orchestrator.removeSlice).not.toHaveBeenCalled();
    expect(repo.deletePie).not.toHaveBeenCalled();
  });
});
