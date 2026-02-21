// Manifest-based orchestration was removed in Bakery vNext.
export function loadPieManifest(_manifestPath: string): never {
  throw new Error("Manifest loading is no longer supported in Bakery vNext");
}

export function resolveComposeFile(_composeFile: string, _worktreePath: string): never {
  throw new Error("Compose resolution is no longer supported in Bakery vNext");
}
