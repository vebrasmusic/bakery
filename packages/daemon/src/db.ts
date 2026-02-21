import Database from "better-sqlite3";

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      repo_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slices (
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

    CREATE TABLE IF NOT EXISTS slice_resources (
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

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      pie_id TEXT,
      slice_id TEXT,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (pie_id) REFERENCES pies(id) ON DELETE SET NULL,
      FOREIGN KEY (slice_id) REFERENCES slices(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_slices_pie_id ON slices(pie_id);
    CREATE INDEX IF NOT EXISTS idx_slice_resources_slice_id ON slice_resources(slice_id);
  `);

  return db;
}
