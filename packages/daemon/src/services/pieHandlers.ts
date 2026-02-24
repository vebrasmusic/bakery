import type { CreatePieRequest, Pie, Slice } from "@bakery/shared";
import { CreatePieRequestSchema } from "@bakery/shared";

export interface PieRepository {
  createPie(input: { name: string; slug: string }): Pie;
  listPies(): Pie[];
  findPieByIdOrSlug(identifier: string): Pie | null;
  listSlices(input: { pieId?: string; all?: boolean }): Slice[];
  deletePie(pieId: string): void;
  appendAuditLog(input: { kind: string; pieId?: string; sliceId?: string; payload: unknown }): void;
}

export interface PieOrchestratorLike {
  stopSlice(slice: Slice): Promise<void>;
  removeSlice(slice: Slice): Promise<void>;
}

export interface PieCreateDependencies {
  repo: PieRepository;
}

export function slugifyPieName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function handleCreatePie(input: unknown, deps: PieCreateDependencies): Pie {
  const payload: CreatePieRequest = CreatePieRequestSchema.parse(input);
  const slug = slugifyPieName(payload.name);

  if (!slug) {
    throw new Error("Pie name must include at least one alphanumeric character");
  }

  const pie = deps.repo.createPie({
    name: payload.name,
    slug
  });

  deps.repo.appendAuditLog({
    kind: "pie.created",
    pieId: pie.id,
    payload: {}
  });

  return pie;
}

export function handleListPies(repo: PieRepository): { pies: Pie[] } {
  return { pies: repo.listPies() };
}

export async function handleRemovePie(
  input: { pieIdentifier: string },
  deps: { repo: PieRepository; orchestrator: PieOrchestratorLike }
): Promise<void> {
  const pieIdentifier = input.pieIdentifier.trim();
  if (!pieIdentifier) {
    throw new Error("Pie identifier is required");
  }

  const pie = deps.repo.findPieByIdOrSlug(pieIdentifier);
  if (!pie) {
    throw new Error("Pie not found");
  }

  const slices = deps.repo.listSlices({ pieId: pie.id });
  for (const slice of slices) {
    if (slice.status !== "stopped") {
      await deps.orchestrator.stopSlice(slice);
    }
    await deps.orchestrator.removeSlice(slice);
    deps.repo.appendAuditLog({
      kind: "slice.deleted",
      pieId: pie.id,
      payload: {
        reason: "pie.deleted",
        deletedSliceId: slice.id
      }
    });
  }

  deps.repo.deletePie(pie.id);
  deps.repo.appendAuditLog({
    kind: "pie.deleted",
    payload: {
      pieId: pie.id,
      slug: pie.slug,
      deletedSlices: slices.length
    }
  });
}
