import { describe, expect, it } from "vitest";
import type { CreateSliceResponse } from "./schemas.js";
import { toSliceCreateOutput } from "./schemas.js";

function buildSlice(resources: CreateSliceResponse["slice"]["resources"]): CreateSliceResponse["slice"] {
  return {
    id: "s1",
    pieId: "p1",
    ordinal: 1,
    host: "my-pie-s1.localtest.me",
    status: "running",
    createdAt: "2026-02-20T00:00:00.000Z",
    stoppedAt: null,
    pieSlug: "my-pie",
    routerPort: 4080,
    resources
  };
}

describe("toSliceCreateOutput", () => {
  it("maps primary route URL and allocated ports", () => {
    const output = toSliceCreateOutput(
      buildSlice([
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
      ])
    );

    expect(output).toMatchObject({
      id: "s1",
      pieId: "p1",
      host: "my-pie-s1.localtest.me",
      routerPort: 4080,
      url: "http://my-pie-s1.localtest.me:4080",
      allocatedPorts: [30001, 30002]
    });
  });

  it("sets url to null when no primary HTTP route exists", () => {
    const output = toSliceCreateOutput(
      buildSlice([
        {
          key: "r1",
          protocol: "tcp",
          expose: "none",
          allocatedPort: 30001
        }
      ])
    );

    expect(output.url).toBeNull();
    expect(output.allocatedPorts).toEqual([30001]);
  });
});
