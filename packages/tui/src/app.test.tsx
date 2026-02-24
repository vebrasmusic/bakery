import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import type { ListPiesResponse, ListSlicesResponse } from "@bakery/shared";
import type { TuiCommandApi } from "./commands.js";
import { BakeryApp } from "./app.js";

async function typeAndSubmit(stdin: { write: (data: string) => void }, command: string): Promise<void> {
  for (const character of command) {
    stdin.write(character);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function waitForTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function waitForFrameContains(lastFrame: () => string | undefined, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const frame = lastFrame() ?? "";
    if (frame.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for frame to contain: ${expected}`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function createMockApi(input: {
  pies?: ListPiesResponse["pies"];
  slices?: ListSlicesResponse["slices"];
} = {}): TuiCommandApi {
  const pies: ListPiesResponse["pies"] =
    input.pies ??
    [{ id: "p1", name: "My App", slug: "my-app", createdAt: "2026-02-20T00:00:00.000Z" }];

  const slices: ListSlicesResponse["slices"] =
    input.slices ??
    [
      {
        id: "s1",
        pieId: "p1",
        ordinal: 1,
        host: "app-s1.localtest.me",
        status: "running",
        createdAt: "2026-02-20T00:00:00.000Z",
        stoppedAt: null,
        resources: [
          {
            key: "r1",
            protocol: "http",
            expose: "primary",
            allocatedPort: 30001,
            routeUrl: "http://app-s1.localtest.me:4080"
          }
        ]
      }
    ];

  return {
    fetchStatus: vi.fn().mockResolvedValue({
      daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
      pies: { total: pies.length },
      slices: {
        total: slices.length,
        byStatus: {
          creating: slices.filter((slice) => slice.status === "creating").length,
          running: slices.filter((slice) => slice.status === "running").length,
          stopped: slices.filter((slice) => slice.status === "stopped").length,
          error: slices.filter((slice) => slice.status === "error").length
        },
        byPie: pies.map((pie) => {
          const pieSlices = slices.filter((slice) => slice.pieId === pie.id);
          return {
            pieId: pie.id,
            pieName: pie.name,
            pieSlug: pie.slug,
            total: pieSlices.length,
            running: pieSlices.filter((slice) => slice.status === "running").length
          };
        })
      },
      generatedAt: "2026-02-20T00:00:00.000Z"
    }),
    listPies: vi.fn().mockResolvedValue({ pies }),
    listSlices: vi.fn().mockResolvedValue({ slices }),
    createPie: vi.fn().mockResolvedValue({ pie: { id: "p2", slug: "new-pie" } }),
    removePie: vi.fn().mockResolvedValue(undefined),
    createSlice: vi.fn().mockImplementation(async (request: { pieId: string; resources: unknown[] }) => ({
      slice: {
        id: "s2",
        pieId: request.pieId,
        ordinal: 2,
        host: `${request.pieId}-s2.localtest.me`,
        status: "running",
        createdAt: "2026-02-20T00:10:00.000Z",
        stoppedAt: null,
        pieSlug: request.pieId,
        routerPort: 4080,
        resources:
          request.resources.length > 0
            ? [
                {
                  key: "r1",
                  protocol: "http",
                  expose: "primary",
                  allocatedPort: 30010,
                  routeHost: `${request.pieId}-s2.localtest.me`,
                  routeUrl: `http://${request.pieId}-s2.localtest.me:4080`
                }
              ]
            : []
      }
    })),
    stopSlice: vi.fn().mockResolvedValue(undefined),
    removeSlice: vi.fn().mockResolvedValue(undefined)
  };
}

describe("BakeryApp", () => {
  it("renders nested compact slice rows with slice emoji", async () => {
    const mockApi = createMockApi();
    const { lastFrame, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "🥧 my-app");
      await waitForFrameContains(lastFrame, "🍰 s1 running");
      expect(lastFrame()).not.toContain("app-s1.localtest.me");
    } finally {
      unmount();
    }
  });

  it("collapses and expands pie children with h/l", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "🍰 s1 running");
      stdin.write("\u001B[D");
      await waitForTick();
      stdin.write("j");
      await waitForTick();
      stdin.write("d");
      await waitForFrameContains(lastFrame, "Confirm delete");
      stdin.write("y");
      await waitForCondition(() => (mockApi.removePie as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1);
      expect(mockApi.removeSlice).not.toHaveBeenCalled();
      await waitForCondition(() => !(lastFrame() ?? "").includes("Confirm delete"));

      stdin.write("\u001B[C");
      await waitForTick();
      stdin.write("j");
      await waitForTick();
      stdin.write("d");
      await waitForFrameContains(lastFrame, "Confirm delete");
      stdin.write("y");
      await waitForCondition(() => (mockApi.removeSlice as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1);
    } finally {
      unmount();
    }
  });

  it("opens delete confirmation with d for slice and pie", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "🍰 s1 running");

      stdin.write("j");
      await waitForTick();
      stdin.write("d");
      await waitForFrameContains(lastFrame, "Confirm delete");
      stdin.write("y");
      await waitForCondition(() => (mockApi.removeSlice as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1);
      expect(mockApi.removeSlice).toHaveBeenCalledWith("s1");
      await waitForCondition(() => !(lastFrame() ?? "").includes("Confirm delete"));

      stdin.write("g");
      await waitForTick();
      stdin.write("d");
      await waitForFrameContains(lastFrame, "Confirm delete");
      await waitForTick();
      stdin.write("y");
      await waitForCondition(() => (mockApi.removePie as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1);
      expect(mockApi.removePie).toHaveBeenCalledWith("p1");
    } finally {
      unmount();
    }
  });

  it("opens create options with c for pie and slice rows", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "🥧 my-app");

      stdin.write("c");
      await waitForFrameContains(lastFrame, "Create options");
      await waitForFrameContains(lastFrame, "Create slice");
      await waitForFrameContains(lastFrame, "Create pie");
      stdin.write("\u001B");

      stdin.write("j");
      stdin.write("c");
      await waitForFrameContains(lastFrame, "Create options");
      await waitForFrameContains(lastFrame, "Create slice");
      await waitForFrameContains(lastFrame, "Create pie");
    } finally {
      unmount();
    }
  });

  it("goes straight to create pie when no pies exist and c is pressed", async () => {
    const mockApi = createMockApi({ pies: [], slices: [] });
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "No pies yet!");
      stdin.write("c");
      await waitForFrameContains(lastFrame, "Create pie");
    } finally {
      unmount();
    }
  });

  it("expands output to full width with Enter and exits with Esc/Tab", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      stdin.write("\t");
      await waitForFrameContains(lastFrame, "Output (focused)");

      stdin.write("\r");
      await waitForCondition(() => !(lastFrame() ?? "").includes("Pies / Slices"));

      stdin.write("\u001B");
      await waitForFrameContains(lastFrame, "Pies / Slices");

      stdin.write("\r");
      await waitForCondition(() => !(lastFrame() ?? "").includes("Pies / Slices"));
      stdin.write("\t");
      await waitForFrameContains(lastFrame, "Pies / Slices (focused)");
    } finally {
      unmount();
    }
  });

  it("supports / command palette prompt flow", async () => {
    const mockApi = createMockApi();
    const { lastFrame, stdin, unmount } = render(<BakeryApp api={mockApi} daemonUrl="http://127.0.0.1:47123" />);

    try {
      await waitForFrameContains(lastFrame, "Pies / Slices");
      stdin.write("?");
      await waitForTick();
      await typeAndSubmit(stdin, "slice create");
      await typeAndSubmit(stdin, "app");
      await typeAndSubmit(stdin, "");

      await waitForCondition(
        () => (mockApi.createSlice as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0
      );
      expect(mockApi.createSlice).toHaveBeenCalledWith({
        pieId: "app",
        resources: [
          { key: "r1", protocol: "http", expose: "primary" },
          { key: "r2", protocol: "tcp", expose: "none" },
          { key: "r3", protocol: "tcp", expose: "none" }
        ]
      });
    } finally {
      unmount();
    }
  });
});
