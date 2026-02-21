import os from "node:os";
import path from "node:path";

export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveUserPath(input: string): string {
  return path.resolve(expandUserPath(input));
}
