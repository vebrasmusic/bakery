import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import type { TuiCommandApi } from "./commands.js";
import { BakeryApp } from "./app.js";

async function typeAndSubmit(stdin: { write: (data: string) => void }, command: string): Promise<void> {
  for (const character of command) {
    stdin.write(character);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForFrameContains(lastFrame: () => string | undefined, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const frame = lastFrame() ?? "";
    if (frame.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for frame to contain: ${expected}`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function createMockApi(): TuiCommandApi {
  return {
    fetchStatus: vi.fn().mockResolvedValue({
      daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
      pies: { total: 1 },
      slices: {
        total: 1,
        byStatus: { creating: 0, running: 1, stopped: 0, error: 0 },
        byPie: [{ pieId: "p1", pieName: "My App", pieSlug: "my-app", total: 1, running: 1 }]
      },
      generatedAt: "2026-02-20T00:00:00.000Z"
    }),
    listPies: vi.fn().mockResolvedValue({
      pies: [{ id: "p1", name: "My App", slug: "my-app", repoPath: null, createdAt: "2026-02-20T00:00:00.000Z" }]
    }),
    listSlices: vi.fn().mockResolvedValue({
      slices: [
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
          resources: [{ key: "r1", protocol: "http", expose: "primary", allocatedPort: 30001, routeUrl: "http://app-s1.localtest.me:4080" }]
        }
      ]
    }),
    createPie: vi.fn().mockResolvedValue({ pie: { id: "p2", slug: "new-pie" } }),
    removePie: vi.fn().mockResolvedValue(undefined),
    createSlice: vi.fn().mockResolvedValue({
      slice: {
        id: "s2",
        pieId: "p1",
        ordinal: 2,
        host: "new-s1.localtest.me",
        worktreePath: "/tmp/new",
        branch: "main",
        status: "running",
        createdAt: "2026-02-20T00:10:00.000Z",
        stoppedAt: null,
        pieSlug: "my-app",
        routerPort: 4080,
        resources: [
          {
            key: "r1",
            protocol: "http",
            expose: "primary",
            allocatedPort: 30010,
            routeHost: "new-s1.localtest.me",
            routeUrl: "http://new-s1.localtest.me:4080"
          }
        ]
      }
    }),
    stopSlice: vi.fn().mockResolvedValue(undefined),
    removeSlice: vi.fn().mockResolvedValue(undefined)
  };
}

describe("BakeryApp", () => {
  it("keeps frame height bounded as output grows", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    const initialLines = (lastFrame() ?? "").split("\n").length;

    for (let index = 0; index < 12; index++) {
      await typeAndSubmit(stdin, `unknown-${index}`);
    }

    const finalLines = (lastFrame() ?? "").split("\n").length;
    expect(finalLines).toBeLessThanOrEqual(initialLines + 2);
  });

  it("cycles focus with tab and vim pane navigation", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    expect(lastFrame()).toContain("bakery> (focused)");

    stdin.write("\t");
    await waitForFrameContains(lastFrame, "Pies / Slices (focused)");

    stdin.write("l");
    await waitForFrameContains(lastFrame, "Output (focused)");

    stdin.write("h");
    await waitForFrameContains(lastFrame, "Pies / Slices (focused)");
  });

  it("supports output scrolling in focused output pane", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    for (let index = 0; index < 14; index++) {
      await typeAndSubmit(stdin, `unknown-${index}`);
    }

    await waitForFrameContains(lastFrame, "unknown-12");

    stdin.write("\t");
    stdin.write("\t");
    await waitForFrameContains(lastFrame, "Output (focused)");

    stdin.write("g");
    await waitForFrameContains(lastFrame, "unknown-0");
  });

  it("opens row action modal and executes selected action", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      stdin.write("\t");
      await waitForFrameContains(lastFrame, "Pies / Slices (focused)");

      stdin.write("\r");
      await waitForFrameContains(lastFrame, "Actions: pie p1");

      stdin.write("\r");
      await waitForFrameContains(lastFrame, "Copied pie id: p1");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("prints canonical JSON after prompt-based slice create", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    await typeAndSubmit(stdin, "slice create");
    await waitForFrameContains(lastFrame, "Pie (id or slug):");
    await typeAndSubmit(stdin, "app");
    await waitForFrameContains(lastFrame, "Worktree path:");
    await typeAndSubmit(stdin, "");
    await waitForFrameContains(lastFrame, "Branch:");
    await typeAndSubmit(stdin, "");
    await waitForFrameContains(lastFrame, "Num resources:");
    await typeAndSubmit(stdin, "1");

    await waitForCondition(
      () => (mockApi.createSlice as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1
    );
    expect(mockApi.createSlice).toHaveBeenCalledWith({
      pieId: "app",
      worktreePath: ".",
      branch: "main",
      resources: [{ key: "r1", protocol: "http", expose: "primary" }]
    });
  });
});
