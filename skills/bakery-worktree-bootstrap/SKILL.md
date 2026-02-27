---
name: bakery-worktree-bootstrap
description: Patch an existing Node.js repository with a minimal Bakery bootstrap-bakery.sh that allocates slice ports and writes deterministic Bakery env keys to a separate env file (default .env.bakery). Use when you want bootstrap-only scaffolding with frozen resource-role mapping and repo-owned setup/dev scripts.
---

# Bakery Worktree Bootstrap

Patch-only skill for Node repositories that need deterministic Bakery port allocation with a removable env boundary.

## Workflow

1. Run `scripts/patch_bakery_runtime.sh --target .`.
2. Confirm the frozen resource-role plan in the patch output.
3. Run generated bootstrap script:
   - `./bootstrap-bakery.sh --pie <pie-id-or-slug> --numresources <n>`
4. Run your repo-owned setup/dev script (for secrets, DB lifecycle, migrations, app runtime, etc.).

## Required User Handoff

After patching a repo, explicitly tell the user:

- which file was created (`bootstrap-bakery.sh`)
- that the file is executable and can be called from their own `setup.sh`/`dev.sh`
- that Bakery-managed keys are written to `.env.bakery` by default
- that they can source or merge `.env.bakery` however they prefer

Include at least one concrete integration example, such as:

```bash
./bootstrap-bakery.sh --pie <pie-id-or-slug> --numresources <n>
set -a; source ./.env.bakery; set +a
./setup.sh
```

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

- `bootstrap-bakery.sh`: one-shot Bakery bootstrap that validates Bakery, validates pie, allocates a slice, and writes Bakery-managed keys

## Bootstrap Behavior

`bootstrap-bakery.sh` requires both:

- `--pie <id-or-slug>`
- `--numresources <n>`

- Bootstrap always creates a new slice.
- Bootstrap writes deterministic env keys from the frozen resource-role mapping embedded at patch time.
- Bootstrap fails if `--numresources` does not match the frozen expected count.
- Bootstrap writes only `BAKERY_ENV_FILE` (default `.env.bakery`).
- Bootstrap never mutates app-owned `.env` unless explicitly overridden with `BAKERY_ENV_FILE=.env`.
- If `BAKERY_ENV_TEMPLATE` is provided, it is copied only when `BAKERY_ENV_FILE` is missing.
- Bootstrap prints a sync example:
  - `set -a; source ./.env.bakery; set +a`
- Bootstrap prints this handoff line:
  - `Run your repo setup script now (e.g. ./setup.sh or ./dev.sh).`

## Notes

- This skill targets Node repos in v1 (requires `package.json`).
- Bakery must be available on `PATH` for generated bootstrap.
- Re-run patcher any time DB detection inputs change; `bootstrap-bakery.sh` is regenerated and frozen role mapping may update.
