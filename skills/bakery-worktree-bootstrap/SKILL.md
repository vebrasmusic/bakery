---
name: bakery-worktree-bootstrap
description: Patch an existing Node.js repository with a minimal Bakery setup.sh that allocates slice ports and writes deterministic .env variables. Use when you want setup-only scaffolding with frozen resource-role mapping and no runtime/dev script generation.
---

# Bakery Worktree Bootstrap

Patch-only skill for Node repositories that need deterministic Bakery port/env setup with minimal scaffolding.

## Workflow

1. Run `scripts/patch_bakery_runtime.sh --target .`.
2. Confirm the frozen resource-role plan in the patch output.
3. Run generated setup:
   - `./setup.sh --pie <pie-id-or-slug> --numresources <n>`
4. Start your app with your own preferred dev command/script.

## Patcher CLI

```bash
# Auto-detect and freeze Bakery resource-role mapping
./scripts/patch_bakery_runtime.sh --target .

# Optional override examples
./scripts/patch_bakery_runtime.sh \
  --target . \
  --db-provider postgres \
  --compose-file docker-compose.yml \
  --db-tool-cmd "pnpm run db:studio"
```

## Generated Files

- `setup.sh`: one-shot setup that validates Bakery, validates pie, allocates a slice, and writes `.env`

## Setup Behavior

`setup.sh` requires both:

- `--pie <id-or-slug>`
- `--numresources <n>`

- Setup always creates a new slice.
- Setup writes deterministic env keys from the frozen resource-role mapping embedded at patch time.
- Setup fails if `--numresources` does not match the frozen expected count.
- Setup writes `.env` (or creates from `.env.example` first if present).

## Notes

- This skill targets Node repos in v1 (requires `package.json`).
- Bakery must be available on `PATH` for generated setup.
- Re-run patcher any time DB detection inputs change; `setup.sh` is regenerated and frozen role mapping may update.
