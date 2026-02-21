import { describe, expect, it } from "vitest";
import { buildDefaultResources, parseResourceSpec } from "./slice.js";

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
});
