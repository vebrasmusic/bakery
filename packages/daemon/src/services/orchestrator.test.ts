import { describe, expect, it, vi } from "vitest";
import type { Pie, Slice } from "@bakery/shared";
import type { BakeryRepository } from "../repos/repository.js";
import type { PortAllocator } from "./portAllocator.js";
import { SliceOrchestrator } from "./orchestrator.js";

const pie: Pie = {
  id: "p1",
  name: "My Pie",
  slug: "my-pie",
  createdAt: "2026-02-20T00:00:00.000Z"
};

const baseSlice: Slice = {
  id: "s1",
  pieId: "p1",
  ordinal: 1,
  host: "my-pie-s1.localtest.me",
  status: "running",
  createdAt: "2026-02-20T00:00:00.000Z",
  stoppedAt: null
};

function createTestDependencies(routerPort: number): {
  repo: BakeryRepository;
  allocator: PortAllocator;
  addSliceResources: ReturnType<typeof vi.fn>;
} {
  const addSliceResources = vi.fn();
  const repo = {
    getNextSliceOrdinal: vi.fn().mockReturnValue(1),
    getAllocatedPorts: vi.fn().mockReturnValue([]),
    createSlice: vi.fn().mockReturnValue(baseSlice),
    addSliceResources
  } as unknown as BakeryRepository;

  const allocator = {
    allocateMany: vi.fn().mockResolvedValue([30001])
  } as unknown as PortAllocator;

  return { repo, allocator, addSliceResources };
}

describe("SliceOrchestrator", () => {
  it("includes :80 in routeUrl when router port is 80", async () => {
    const deps = createTestDependencies(80);
    const orchestrator = new SliceOrchestrator(deps.repo, deps.allocator, {
      hostSuffix: "localtest.me",
      routerPortProvider: () => 80
    });

    const created = await orchestrator.createSlice({
      pie,
      resources: [{ key: "r1", protocol: "http", expose: "primary" }]
    });

    expect(created.resources[0]?.routeUrl).toBe("http://my-pie-s1.localtest.me:80");
  });

  it("includes :443 in routeUrl when router port is 443", async () => {
    const deps = createTestDependencies(443);
    const orchestrator = new SliceOrchestrator(deps.repo, deps.allocator, {
      hostSuffix: "localtest.me",
      routerPortProvider: () => 443
    });

    const created = await orchestrator.createSlice({
      pie,
      resources: [{ key: "r1", protocol: "http", expose: "primary" }]
    });

    expect(created.resources[0]?.routeUrl).toBe("http://my-pie-s1.localtest.me:443");
  });
});
