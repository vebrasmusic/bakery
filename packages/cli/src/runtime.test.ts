import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBakeryDataDir, getBakeryFiles } from "./runtime.js";

const originalDataDir = process.env.BAKERY_DATA_DIR;

afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.BAKERY_DATA_DIR;
  } else {
    process.env.BAKERY_DATA_DIR = originalDataDir;
  }
});

describe("runtime helpers", () => {
  it("resolves data dir from environment", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "bakery-runtime-test-"));
    process.env.BAKERY_DATA_DIR = dataDir;
    expect(getBakeryDataDir()).toBe(dataDir);
  });

  it("builds bakery runtime file paths", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "bakery-runtime-precedence-"));
    const files = getBakeryFiles(dataDir);
    expect(files).toEqual({
      dataDir,
      pidPath: path.join(dataDir, "daemon.pid"),
      statePath: path.join(dataDir, "daemon.json"),
      logPath: path.join(dataDir, "daemon.log")
    });
  });
});
