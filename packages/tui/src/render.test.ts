import { describe, expect, it } from "vitest";
import { renderPieList, renderSliceList, renderStatusDashboard } from "./render.js";

describe("render", () => {
  it("renders status with router", () => {
    const output = renderStatusDashboard({
      daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
      pies: { total: 1 },
      slices: {
        total: 1,
        byStatus: { creating: 0, running: 1, stopped: 0, error: 0 },
        byPie: [{ pieId: "p1", pieName: "App", pieSlug: "app", total: 1, running: 1 }]
      },
      generatedAt: "2026-02-20T00:00:00.000Z"
    });

    expect(output).toContain("Bakery Status");
    expect(output).toContain("Router");
  });

  it("renders pie and slice lists", () => {
    expect(renderPieList([{ id: "p1", name: "App", slug: "app", repoPath: null, createdAt: "2026-02-20T00:00:00.000Z" }])).toContain(
      "app"
    );

    expect(
      renderSliceList([
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
          resources: [{ key: "web", protocol: "http", expose: "primary", allocatedPort: 30001, routeHost: "app-s1.localtest.me", routeUrl: "http://app-s1.localtest.me:4080" }]
        }
      ])
    ).toContain("web:30001");
  });
});
