import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";

function createLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE pies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      repo_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE slices (
      id TEXT PRIMARY KEY,
      pie_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      host TEXT NOT NULL UNIQUE,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stopped_at TEXT,
      UNIQUE(pie_id, ordinal),
      FOREIGN KEY (pie_id) REFERENCES pies(id) ON DELETE CASCADE
    );

    CREATE TABLE slice_resources (
      id TEXT PRIMARY KEY,
      slice_id TEXT NOT NULL,
      key TEXT NOT NULL,
      port INTEGER NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      expose TEXT NOT NULL,
      route_host TEXT UNIQUE,
      is_primary_http INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(slice_id, key),
      FOREIGN KEY (slice_id) REFERENCES slices(id) ON DELETE CASCADE
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      pie_id TEXT,
      slice_id TEXT,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (pie_id) REFERENCES pies(id) ON DELETE SET NULL,
      FOREIGN KEY (slice_id) REFERENCES slices(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    INSERT INTO pies (id, name, slug, repo_path, created_at)
    VALUES ('p1', 'Legacy Pie', 'legacy-pie', '/tmp/repo', '2026-02-20T00:00:00.000Z');

    INSERT INTO slices (id, pie_id, ordinal, host, worktree_path, branch, status, created_at, stopped_at)
    VALUES (
      's1',
      'p1',
      1,
      'legacy-pie-s1.localtest.me',
      '/tmp/worktree',
      'main',
      'running',
      '2026-02-20T00:01:00.000Z',
      NULL
    );

    INSERT INTO slice_resources (id, slice_id, key, port, protocol, expose, route_host, is_primary_http, created_at)
    VALUES (
      'sr1',
      's1',
      'r1',
      30001,
      'http',
      'primary',
      'legacy-pie-s1.localtest.me',
      1,
      '2026-02-20T00:01:00.000Z'
    );

    INSERT INTO audit_log (id, pie_id, slice_id, kind, payload_json, created_at)
    VALUES (
      'a1',
      'p1',
      's1',
      'slice.created',
      '{}',
      '2026-02-20T00:01:05.000Z'
    );
  `);

  db.close();
}

describe("createDatabase", () => {
  it("migrates legacy schema and preserves rows", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "bakery-db-"));
    const dbPath = path.join(tempDir, "bakery.sqlite");

    try {
      createLegacyDatabase(dbPath);

      const db = createDatabase(dbPath);

      const pieColumns = db.prepare("PRAGMA table_info(pies)").all() as Array<{ name: string }>;
      const sliceColumns = db.prepare("PRAGMA table_info(slices)").all() as Array<{ name: string }>;
      expect(pieColumns.map((column) => column.name)).toEqual(["id", "name", "slug", "created_at"]);
      expect(sliceColumns.map((column) => column.name)).toEqual([
        "id",
        "pie_id",
        "ordinal",
        "host",
        "status",
        "created_at",
        "stopped_at"
      ]);

      const pieCount = db.prepare("SELECT COUNT(*) as count FROM pies").get() as { count: number };
      const sliceCount = db.prepare("SELECT COUNT(*) as count FROM slices").get() as { count: number };
      const resourceCount = db.prepare("SELECT COUNT(*) as count FROM slice_resources").get() as { count: number };
      const auditCount = db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as { count: number };
      expect(pieCount.count).toBe(1);
      expect(sliceCount.count).toBe(1);
      expect(resourceCount.count).toBe(1);
      expect(auditCount.count).toBe(1);

      const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
      expect(fkViolations).toHaveLength(0);

      const userVersion = db.pragma("user_version", { simple: true }) as number;
      expect(userVersion).toBe(2);
      db.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
