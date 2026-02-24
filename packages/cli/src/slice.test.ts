import { describe, expect, it, vi } from "vitest";
import { createSlice } from "@bakery/shared";
import { buildDefaultResources, parseResourceSpec, runSliceCreate } from "./slice.js";

vi.mock("@bakery/shared", async () => {
  const actual = await vi.importActual<typeof import("@bakery/shared")>("@bakery/shared");
  return {
    ...actual,
    createSlice: vi.fn()
  };
});

describe("slice helpers", () => {
  it("parses resource spec", () => {
    expect(parseResourceSpec("web:http:primary")).toEqual({ key: "web", protocol: "http", expose: "primary" });
  });

  it("rejects malformed resource spec", () => {
    expect(() => parseResourceSpec("bad")).toThrow();
  });

  it("builds default resources from --numresources", () => {
    expect(buildDefaultResources(4)).toEqual([
      { key: "r1", protocol: "http", expose: "primary" },
      { key: "r2", protocol: "tcp", expose: "none" },
      { key: "r3", protocol: "tcp", expose: "none" },
      { key: "r4", protocol: "tcp", expose: "none" }
    ]);
  });

  it("rejects invalid resource counts", () => {
    expect(() => buildDefaultResources(0)).toThrow("--numresources must be a positive integer");
  });

  it("returns canonical slice create output for JSON serialization", async () => {
    vi.mocked(createSlice).mockResolvedValueOnce({
      slice: {
        id: "s1",
        pieId: "p1",
        ordinal: 1,
        host: "my-pie-s1.localtest.me",
        status: "running",
        createdAt: "2026-02-20T00:00:00.000Z",
        stoppedAt: null,
        pieSlug: "my-pie",
        routerPort: 4080,
        resources: [
          {
            key: "r1",
            protocol: "http",
            expose: "primary",
            allocatedPort: 30001,
            routeHost: "my-pie-s1.localtest.me",
            routeUrl: "http://my-pie-s1.localtest.me:4080"
          },
          {
            key: "r2",
            protocol: "tcp",
            expose: "none",
            allocatedPort: 30002
          }
        ]
      }
    });

    const output = await runSliceCreate(
      { pie: "my-pie", numResources: 2 },
      {}
    );

    expect(output.id).toBe("s1");
    expect(output.allocatedPorts).toEqual([30001, 30002]);
    expect(output.url).toBe("http://my-pie-s1.localtest.me:4080");
  });
});
