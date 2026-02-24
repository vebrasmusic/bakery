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
  await new Promise((resolve) => setTimeout(resolve, 0));
  stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createMockApi(): TuiCommandApi {
  return {
    fetchStatus: vi.fn().mockResolvedValue({
      daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
      pies: { total: 1 },
      slices: {
        total: 2,
        byStatus: { creating: 0, running: 1, stopped: 1, error: 0 },
        byPie: [{ pieId: "p1", pieName: "My App", pieSlug: "my-app", total: 2, running: 1 }],
      },
      generatedAt: "2026-02-20T00:00:00.000Z",
    }),
    listPies: vi.fn().mockResolvedValue({
      pies: [{ id: "p1", name: "My App", slug: "my-app", repoPath: null, createdAt: "2026-02-20T00:00:00.000Z" }],
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
          resources: [
            { key: "r1", protocol: "http", expose: "primary", allocatedPort: 30001 },
          ],
        },
      ],
    }),
    createPie: vi.fn().mockResolvedValue({ pie: { id: "p2", slug: "new-pie" } }),
    removePie: vi.fn().mockResolvedValue(undefined),
    createSlice: vi.fn().mockResolvedValue({
      slice: { id: "s2", host: "new-s1.localtest.me", status: "creating", resources: [] },
    }),
    stopSlice: vi.fn().mockResolvedValue(undefined),
    removeSlice: vi.fn().mockResolvedValue(undefined),
  };
}

describe("BakeryApp", () => {
  it("renders banner with BAKERY title", () => {
    const mockApi = createMockApi();
    const { lastFrame } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );
    const frame = lastFrame();
    expect(frame).toContain("B A K E R Y");
  });

  it("renders command input prompt", () => {
    const mockApi = createMockApi();
    const { lastFrame } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );
    const frame = lastFrame();
    expect(frame).toContain("bakery>");
  });

  it("renders footer help text", () => {
    const mockApi = createMockApi();
    const { lastFrame } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );
    const frame = lastFrame();
    expect(frame).toContain("Ctrl+C: exit");
  });

  it("shows help text on empty submit", () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );
    stdin.write("\r");
    const frame = lastFrame();
    expect(frame).toContain("Output");
  });

  it("cancels pie rm when confirmation is not yes", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );

    await typeAndSubmit(stdin, "pie rm my-app");
    expect(lastFrame()).toContain("Type yes to delete pie my-app:");

    await typeAndSubmit(stdin, "no");
    const frame = lastFrame();
    expect(frame).toContain("Pie rm cancelled.");
    expect(mockApi.removePie).not.toHaveBeenCalled();
  });

  it("removes pie when confirmation is yes", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin } = render(
      <BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />
    );

    await typeAndSubmit(stdin, "pie rm my-app");
    await typeAndSubmit(stdin, "yes");

    expect(mockApi.removePie).toHaveBeenCalledWith("my-app");
    expect(lastFrame()).toContain("Removed pie my-app");
  });
});
