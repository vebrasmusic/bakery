import { describe, expect, it } from "vitest";
import { PortAllocator } from "./portAllocator.js";

describe("PortAllocator", () => {
  it("allocates requested count while respecting reserved/runtime ports", async () => {
    const unavailableAtRuntime = new Set([3003]);
    const allocator = new PortAllocator(3000, 3007, async (port) => !unavailableAtRuntime.has(port));

    const allocation = await allocator.allocateMany(3, new Set([3000, 3001, 3002, 3004]));
    expect(allocation).toEqual([3005, 3006, 3007]);
  });

  it("maintains global namespace on sequential allocations", async () => {
    const allocator = new PortAllocator(3100, 3110, async () => true);

    const first = await allocator.allocateMany(2, new Set());
    const second = await allocator.allocateMany(2, new Set(first));

    expect(first.some((port) => second.includes(port))).toBe(false);
  });

  it("throws when range cannot satisfy requested count", async () => {
    const allocator = new PortAllocator(3200, 3202, async () => false);
    await expect(allocator.allocateMany(2, new Set())).rejects.toThrow("Unable to allocate 2 free ports");
  });
});
