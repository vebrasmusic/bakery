import { CreateSliceRequestSchema, type Pie, type Slice } from "@bakery/shared";
import type { SliceWithResources } from "../repos/repository.js";
import type { OrchestratedSlice } from "./orchestrator.js";
import { resolveUserPath } from "./pathing.js";

export interface SliceRepository {
  findPieByIdOrSlug(identifier: string): Pie | null;
  getSliceById(sliceId: string): Slice | null;
  listSlices(input: { pieId?: string; all?: boolean }): SliceWithResources[];
  appendAuditLog(input: { kind: string; pieId?: string; sliceId?: string; payload: unknown }): void;
}

export interface SliceOrchestratorLike {
  createSlice(input: {
    pie: Pie;
    worktreePath: string;
    branch: string;
    resources: Array<{ key: string; protocol: "http" | "tcp" | "udp"; expose: "primary" | "subdomain" | "none" }>;
  }): Promise<OrchestratedSlice>;
  stopSlice(slice: Slice): Promise<void>;
  removeSlice(slice: Slice): Promise<void>;
}

export interface SliceCreateDependencies {
  repo: SliceRepository;
  orchestrator: SliceOrchestratorLike;
}

export async function handleCreateSlice(input: unknown, deps: SliceCreateDependencies): Promise<OrchestratedSlice> {
  const payload = CreateSliceRequestSchema.parse(input);
  const pie = deps.repo.findPieByIdOrSlug(payload.pieId);
  if (!pie) {
    throw new Error("Pie not found");
  }

  const worktreePath = resolveUserPath(payload.worktreePath);

  const created = await deps.orchestrator.createSlice({
    pie,
    worktreePath,
    branch: payload.branch,
    resources: payload.resources
  });

  deps.repo.appendAuditLog({
    kind: "slice.created",
    pieId: pie.id,
    sliceId: created.id,
    payload: {
      branch: payload.branch,
      worktreePath,
      host: created.host,
      resources: created.resources
    }
  });

  return created;
}

export function handleListSlices(input: { pieIdentifier?: string; allFlag: boolean }, repo: SliceRepository): SliceWithResources[] {
  if (input.pieIdentifier && input.allFlag) {
    throw new Error("Cannot combine pieId filter with all=true");
  }

  let pieId: string | undefined;
  if (input.pieIdentifier) {
    const pie = repo.findPieByIdOrSlug(input.pieIdentifier);
    if (!pie) {
      throw new Error("Pie not found");
    }
    pieId = pie.id;
  }

  if (pieId !== undefined) {
    return repo.listSlices({ pieId, all: input.allFlag });
  }
  return repo.listSlices({ all: input.allFlag });
}

export async function handleStopSlice(
  input: { sliceId: string },
  deps: { repo: SliceRepository; orchestrator: SliceOrchestratorLike }
): Promise<void> {
  const slice = deps.repo.getSliceById(input.sliceId);
  if (!slice) {
    throw new Error("Slice not found");
  }

  const pie = deps.repo.findPieByIdOrSlug(slice.pieId);
  if (!pie) {
    throw new Error("Pie not found");
  }

  await deps.orchestrator.stopSlice(slice);
  deps.repo.appendAuditLog({ kind: "slice.stopped", pieId: pie.id, sliceId: slice.id, payload: {} });
}

export async function handleRemoveSlice(
  input: { sliceId: string },
  deps: { repo: SliceRepository; orchestrator: SliceOrchestratorLike }
): Promise<void> {
  const slice = deps.repo.getSliceById(input.sliceId);
  if (!slice) {
    throw new Error("Slice not found");
  }

  const pie = deps.repo.findPieByIdOrSlug(slice.pieId);
  if (!pie) {
    throw new Error("Pie not found");
  }

  await deps.orchestrator.removeSlice(slice);
  deps.repo.appendAuditLog({
    kind: "slice.deleted",
    pieId: pie.id,
    payload: { deletedSliceId: slice.id }
  });
}
