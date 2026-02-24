import { describe, expect, it } from "vitest";
import { buildSliceSnapshots, detectSliceLifecycleEvents, filterSuppressedSliceEvents, toSliceEventKey } from "./slice-events.js";

describe("slice-events", () => {
  it("detects created slices", () => {
    const events = detectSliceLifecycleEvents([], [
      { id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }
    ]);
    expect(events).toEqual([
      {
        event: "created",
        sliceId: "s1",
        pieId: "p1",
        host: "app-s1.localtest.me",
        status: "running"
      }
    ]);
  });

  it("detects removed slices", () => {
    const events = detectSliceLifecycleEvents(
      [{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }],
      []
    );
    expect(events).toEqual([
      {
        event: "removed",
        sliceId: "s1",
        pieId: "p1",
        host: "app-s1.localtest.me",
        status: "running"
      }
    ]);
  });

  it("detects status changes", () => {
    const events = detectSliceLifecycleEvents(
      [{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }],
      [{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "stopped" }]
    );
    expect(events).toEqual([
      {
        event: "status-changed",
        sliceId: "s1",
        pieId: "p1",
        host: "app-s1.localtest.me",
        status: "stopped",
        previousStatus: "running"
      }
    ]);
  });

  it("returns no events when snapshots match", () => {
    const events = detectSliceLifecycleEvents(
      [{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }],
      [{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }]
    );
    expect(events).toEqual([]);
  });

  it("builds snapshots from list response slices", () => {
    const snapshots = buildSliceSnapshots([
      {
        id: "s1",
        pieId: "p1",
        ordinal: 1,
        host: "app-s1.localtest.me",
        worktreePath: "/tmp/app",
        branch: "main",
        status: "running",
        createdAt: "2026-02-20T00:00:00.000Z",
        stoppedAt: null,
        resources: []
      }
    ]);
    expect(snapshots).toEqual([{ id: "s1", pieId: "p1", host: "app-s1.localtest.me", status: "running" }]);
  });

  it("filters suppressed lifecycle events", () => {
    const event = {
      event: "created" as const,
      sliceId: "s1",
      pieId: "p1",
      host: "app-s1.localtest.me",
      status: "running" as const
    };
    const suppressions = new Map<string, number>([[toSliceEventKey(event), 2_000]]);
    const visible = filterSuppressedSliceEvents([event], suppressions, 1_000);
    expect(visible).toEqual([]);
    expect(suppressions.has(toSliceEventKey(event))).toBe(false);
  });
});
