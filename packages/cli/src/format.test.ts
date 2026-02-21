import { describe, expect, it } from "vitest";
import { formatDaemonDown, formatStatus } from "./format.js";

describe("formatStatus", () => {
  it("includes daemon and router lines", () => {
    const output = formatStatus({
      daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
      pies: { total: 1 },
      slices: {
        total: 1,
        byStatus: { creating: 0, running: 1, stopped: 0, error: 0 },
        byPie: [{ pieId: "p1", pieName: "App", pieSlug: "app", total: 1, running: 1 }]
      },
      generatedAt: "2026-02-20T00:00:00.000Z"
    });

    expect(output).toContain("Daemon");
    expect(output).toContain("Router");
  });

  it("renders daemon down hint", () => {
    const output = formatDaemonDown("http://127.0.0.1:47123");
    expect(output).toContain("Daemon: down");
    expect(output).toContain("bakery up");
  });
});
