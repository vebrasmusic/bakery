import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Pie,
  Slice,
  SliceResource,
  SliceResourceExpose,
  SliceResourceProtocol,
  SliceStatus
} from "@bakery/shared";

function nowIso(): string {
  return new Date().toISOString();
}

function toPie(row: any): Pie {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repo_path ?? null,
    createdAt: row.created_at
  };
}

function toSlice(row: any): Slice {
  return {
    id: row.id,
    pieId: row.pie_id,
    ordinal: row.ordinal,
    host: row.host,
    worktreePath: row.worktree_path,
    branch: row.branch,
    status: row.status,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at ?? null
  };
}

function toSliceResource(row: any, routerPort: number): SliceResource {
  const routeHost = row.route_host ?? undefined;
  const showPort = routerPort !== 80 && routerPort !== 443;

  return {
    key: row.key,
    protocol: row.protocol,
    expose: row.expose,
    allocatedPort: row.port,
    ...(routeHost ? { routeHost, routeUrl: `http://${routeHost}${showPort ? `:${routerPort}` : ""}` } : {})
  };
}

export interface SliceResourceInput {
  key: string;
  port: number;
  protocol: SliceResourceProtocol;
  expose: SliceResourceExpose;
  routeHost?: string;
  isPrimaryHttp: boolean;
}

export interface SliceWithResources extends Slice {
  resources: SliceResource[];
}

export interface HostRoute {
  host: string;
  port: number;
  sliceId: string;
  pieId: string;
  sliceStatus: SliceStatus;
}

export class BakeryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly routerPortProvider: () => number
  ) {}

  createPie(input: { name: string; slug: string; repoPath?: string | null }): Pie {
    const id = randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO pies (id, name, slug, repo_path, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.slug, input.repoPath ?? null, createdAt);

    return {
      id,
      name: input.name,
      slug: input.slug,
      repoPath: input.repoPath ?? null,
      createdAt
    };
  }

  listPies(): Pie[] {
    const rows = this.db.prepare(`SELECT * FROM pies ORDER BY created_at DESC`).all();
    return rows.map(toPie);
  }

  findPieByIdOrSlug(identifier: string): Pie | null {
    const row = this.db
      .prepare(`SELECT * FROM pies WHERE id = ? OR slug = ? LIMIT 1`)
      .get(identifier, identifier);
    return row ? toPie(row) : null;
  }

  getNextSliceOrdinal(pieId: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(ordinal), 0) AS max_ordinal FROM slices WHERE pie_id = ?`)
      .get(pieId) as { max_ordinal: number } | undefined;
    return Number(row?.max_ordinal ?? 0) + 1;
  }

  createSlice(input: {
    pieId: string;
    ordinal: number;
    host: string;
    worktreePath: string;
    branch: string;
    status: SliceStatus;
  }): Slice {
    const id = randomUUID();
    const createdAt = nowIso();

    this.db
      .prepare(
        `INSERT INTO slices
          (id, pie_id, ordinal, host, worktree_path, branch, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.pieId, input.ordinal, input.host, input.worktreePath, input.branch, input.status, createdAt);

    return {
      id,
      pieId: input.pieId,
      ordinal: input.ordinal,
      host: input.host,
      worktreePath: input.worktreePath,
      branch: input.branch,
      status: input.status,
      createdAt,
      stoppedAt: null
    };
  }

  updateSliceStatus(sliceId: string, status: SliceStatus): void {
    const stoppedAt = status === "stopped" ? nowIso() : null;
    this.db
      .prepare(`UPDATE slices SET status = ?, stopped_at = ? WHERE id = ?`)
      .run(status, stoppedAt, sliceId);
  }

  deleteSlice(sliceId: string): void {
    this.db.prepare(`DELETE FROM slices WHERE id = ?`).run(sliceId);
  }

  getSliceById(sliceId: string): Slice | null {
    const row = this.db.prepare(`SELECT * FROM slices WHERE id = ? LIMIT 1`).get(sliceId);
    return row ? toSlice(row) : null;
  }

  getSliceByHost(host: string): Slice | null {
    const row = this.db.prepare(`SELECT * FROM slices WHERE host = ? LIMIT 1`).get(host);
    return row ? toSlice(row) : null;
  }

  listSlices(input: { pieId?: string; all?: boolean }): SliceWithResources[] {
    const rows = input.pieId
      ? this.db.prepare(`SELECT * FROM slices WHERE pie_id = ? ORDER BY created_at DESC`).all(input.pieId)
      : this.db.prepare(`SELECT * FROM slices ORDER BY created_at DESC`).all();

    const getResources = this.db.prepare(`SELECT * FROM slice_resources WHERE slice_id = ? ORDER BY key ASC`);

    const routerPort = this.routerPortProvider();

    return rows.map((row) => ({
      ...toSlice(row),
      resources: getResources.all((row as { id: string }).id).map((resourceRow: any) => toSliceResource(resourceRow, routerPort))
    }));
  }

  addSliceResources(sliceId: string, resources: SliceResourceInput[]): void {
    const insert = this.db.prepare(
      `INSERT INTO slice_resources (id, slice_id, key, port, protocol, expose, route_host, is_primary_http, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const createdAt = nowIso();
    const transaction = this.db.transaction((records: SliceResourceInput[]) => {
      for (const record of records) {
        insert.run(
          randomUUID(),
          sliceId,
          record.key,
          record.port,
          record.protocol,
          record.expose,
          record.routeHost ?? null,
          record.isPrimaryHttp ? 1 : 0,
          createdAt
        );
      }
    });
    transaction(resources);
  }

  getAllocatedPorts(): number[] {
    const rows = this.db.prepare(`SELECT port FROM slice_resources`).all() as Array<{ port: number }>;
    return rows.map((row) => row.port);
  }

  getHostRoute(host: string): HostRoute | null {
    const row = this.db
      .prepare(
        `SELECT sr.route_host, sr.port, sr.slice_id, s.pie_id, s.status AS slice_status
         FROM slice_resources sr
         INNER JOIN slices s ON s.id = sr.slice_id
         WHERE sr.route_host = ?
         LIMIT 1`
      )
      .get(host) as
      | { route_host: string; port: number; slice_id: string; pie_id: string; slice_status: SliceStatus }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      host: row.route_host,
      port: row.port,
      sliceId: row.slice_id,
      pieId: row.pie_id,
      sliceStatus: row.slice_status
    };
  }

  appendAuditLog(input: {
    kind: string;
    pieId?: string;
    sliceId?: string;
    payload: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, pie_id, slice_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), input.pieId ?? null, input.sliceId ?? null, input.kind, JSON.stringify(input.payload), nowIso());
  }
}
