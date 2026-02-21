import path from "node:path";
import type { CreatePieRequest, Pie } from "@bakery/shared";
import { CreatePieRequestSchema } from "@bakery/shared";
import { resolveUserPath } from "./pathing.js";

export interface PieRepository {
  createPie(input: { name: string; slug: string; repoPath?: string | null }): Pie;
  listPies(): Pie[];
  appendAuditLog(input: { kind: string; pieId?: string; sliceId?: string; payload: unknown }): void;
}

export interface PieCreateDependencies {
  repo: PieRepository;
  assertPathExists: (filePath: string, expectedType: "file" | "directory") => void;
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
  const repoPath = payload.repoPath ? resolveUserPath(payload.repoPath) : null;
  const slug = slugifyPieName(payload.name);

  if (!slug) {
    throw new Error("Pie name must include at least one alphanumeric character");
  }

  if (repoPath) {
    deps.assertPathExists(repoPath, "directory");
  }

  const pie = deps.repo.createPie({
    name: payload.name,
    slug,
    repoPath
  });

  deps.repo.appendAuditLog({
    kind: "pie.created",
    pieId: pie.id,
    payload: {
      repoPath: repoPath ?? path.resolve(".")
    }
  });

  return pie;
}

export function handleListPies(repo: PieRepository): { pies: Pie[] } {
  return { pies: repo.listPies() };
}
