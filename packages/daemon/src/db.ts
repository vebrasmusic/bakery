import Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 2;

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) {
    return false;
  }
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureLatestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slices (
      id TEXT PRIMARY KEY,
      pie_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      host TEXT NOT NULL UNIQUE,
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
}

function migrateLegacyPathColumns(db: Database.Database): void {
  const piesHasLegacyRepoPath = hasColumn(db, "pies", "repo_path");
  const slicesHasLegacyColumns = hasColumn(db, "slices", "worktree_path") || hasColumn(db, "slices", "branch");

  if (!piesHasLegacyRepoPath && !slicesHasLegacyColumns) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  const migrate = db.transaction(() => {
    if (piesHasLegacyRepoPath && tableExists(db, "pies")) {
      db.exec(`
        CREATE TABLE pies_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        INSERT INTO pies_new (id, name, slug, created_at)
        SELECT id, name, slug, created_at FROM pies;
        DROP TABLE pies;
        ALTER TABLE pies_new RENAME TO pies;
      `);
    }

    if (slicesHasLegacyColumns && tableExists(db, "slices")) {
      db.exec(`
        CREATE TABLE slices_new (
          id TEXT PRIMARY KEY,
          pie_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          host TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          stopped_at TEXT,
          UNIQUE(pie_id, ordinal),
          FOREIGN KEY (pie_id) REFERENCES pies(id) ON DELETE CASCADE
        );
        INSERT INTO slices_new (id, pie_id, ordinal, host, status, created_at, stopped_at)
        SELECT id, pie_id, ordinal, host, status, created_at, stopped_at FROM slices;
        DROP TABLE slices;
        ALTER TABLE slices_new RENAME TO slices;
      `);
    }

    ensureLatestSchema(db);
  });

  try {
    migrate();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  const fkViolations = db.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
  if (fkViolations.length > 0) {
    throw new Error(`Foreign key check failed after schema migration: ${JSON.stringify(fkViolations)}`);
  }
}

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const userVersion = db.pragma("user_version", { simple: true }) as number;
  if (userVersion < CURRENT_SCHEMA_VERSION) {
    migrateLegacyPathColumns(db);
  }

  ensureLatestSchema(db);
  db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);

  return db;
}
