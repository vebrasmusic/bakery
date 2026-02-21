import { describe, expect, it } from "vitest";
import { formatPieList } from "./pie.js";

describe("pie helpers", () => {
  it("formats pie list", () => {
    const output = formatPieList([{ id: "p1", name: "App", slug: "app", repoPath: "/tmp/app", createdAt: "2026-02-20T00:00:00.000Z" }]);
    expect(output).toContain("app");
  });
});
