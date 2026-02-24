import { describe, expect, it, vi } from "vitest";
import { handleRemoveSlice } from "./sliceHandlers.js";

describe("sliceHandlers", () => {
  it("removes slice and writes deletion audit without stale slice FK", async () => {
    const slice = {
      id: "slice-1",
      pieId: "pie-1",
      ordinal: 1,
      host: "my-pie-s1.localtest.me",
      status: "running" as const,
      createdAt: "2026-02-20T00:00:00.000Z",
      stoppedAt: null
    };
    const pie = {
      id: "pie-1",
      name: "My Pie",
      slug: "my-pie",
      createdAt: "2026-02-20T00:00:00.000Z"
    };

    const repo = {
      findPieByIdOrSlug: vi.fn().mockReturnValue(pie),
      getSliceById: vi.fn().mockReturnValue(slice),
      listSlices: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const orchestrator = {
      createSlice: vi.fn(),
      stopSlice: vi.fn().mockResolvedValue(undefined),
      removeSlice: vi.fn().mockResolvedValue(undefined)
    };

    await handleRemoveSlice({ sliceId: "slice-1" }, { repo, orchestrator });

    expect(repo.getSliceById).toHaveBeenCalledWith("slice-1");
    expect(repo.findPieByIdOrSlug).toHaveBeenCalledWith("pie-1");
    expect(orchestrator.removeSlice).toHaveBeenCalledWith(slice);
    expect(repo.appendAuditLog).toHaveBeenCalledTimes(1);
    const auditLog = repo.appendAuditLog.mock.calls[0]?.[0];
    expect(auditLog).toMatchObject({
      kind: "slice.deleted",
      pieId: "pie-1",
      payload: { deletedSliceId: "slice-1" }
    });
    expect(auditLog?.sliceId).toBeUndefined();
  });

  it("throws when slice is missing", async () => {
    const repo = {
      findPieByIdOrSlug: vi.fn(),
      getSliceById: vi.fn().mockReturnValue(null),
      listSlices: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const orchestrator = {
      createSlice: vi.fn(),
      stopSlice: vi.fn().mockResolvedValue(undefined),
      removeSlice: vi.fn().mockResolvedValue(undefined)
    };

    await expect(handleRemoveSlice({ sliceId: "missing" }, { repo, orchestrator })).rejects.toThrow("Slice not found");
    expect(orchestrator.removeSlice).not.toHaveBeenCalled();
    expect(repo.appendAuditLog).not.toHaveBeenCalled();
  });
});
