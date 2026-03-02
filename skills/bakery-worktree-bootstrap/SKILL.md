---
name: bakery-worktree-bootstrap
description: Patch an existing repository with a minimal Bakery bootstrap-bakery.sh that allocates slice ports and writes deterministic Bakery env keys to a separate env file (default .env.bakery). Use when you want bootstrap-only scaffolding with frozen resource mapping and repo-owned setup/dev scripts.
---

# Bakery Worktree Bootstrap

Patch-only skill for repositories that need deterministic Bakery port allocation with a removable env boundary.

## Workflow

1. Run resource detection first:
   - `./scripts/patch_bakery_runtime.sh --target . --detect-only`
2. List the detected resources and detection evidence for the user.
3. Ask the user to confirm or edit the resource list.
4. Run patching with an explicit confirmed list:
   - `./scripts/patch_bakery_runtime.sh --target . --resources <comma-separated-resources>`
5. Run generated bootstrap script:
   - `./bootstrap-bakery.sh --pie <pie-id-or-slug> --numresources <n>`
6. Run the repo-owned setup/dev/runtime script.

## Required User Handoff

After patching a repo, explicitly tell the user:

- which file was created (`bootstrap-bakery.sh`)
- that the file is executable and can be called from their own setup/dev flow
- that Bakery-managed keys are written to `.env.bakery` by default
- that they can source or merge `.env.bakery` however they prefer
- which confirmed resources were frozen into the generated script

Include at least one concrete integration example, such as:

```bash
./scripts/patch_bakery_runtime.sh --target . --detect-only
./scripts/patch_bakery_runtime.sh --target . --resources frontend,backend,db
./bootstrap-bakery.sh --pie <pie-id-or-slug> --numresources 3
set -a; source ./.env.bakery; set +a
./setup.sh
```

## Patcher CLI

```bash
# Detect candidate resources and evidence
./scripts/patch_bakery_runtime.sh --target . --detect-only

# Detect with JSON output
./scripts/patch_bakery_runtime.sh --target . --detect-only --output-format json

# Patch with explicit confirmed resources
./scripts/patch_bakery_runtime.sh --target . --resources frontend,backend,db

# Optional compose override for compose-first detection
./scripts/patch_bakery_runtime.sh --target . --compose-file docker-compose.yml --detect-only
```

## Generated Files

- `bootstrap-bakery.sh`: one-shot Bakery bootstrap that validates Bakery, validates pie, allocates a slice, and writes Bakery-managed keys

## Bootstrap Behavior

`bootstrap-bakery.sh` requires both:

- `--pie <id-or-slug>`
- `--numresources <n>`

- Bootstrap always creates a new slice.
- Bootstrap writes deterministic env keys from the frozen resource mapping embedded at patch time.
- Bootstrap fails if `--numresources` does not match the frozen expected count.
- Bootstrap writes only `BAKERY_ENV_FILE` (default `.env.bakery`).
- Bootstrap never mutates app-owned `.env` unless explicitly overridden with `BAKERY_ENV_FILE=.env`.
- If `BAKERY_ENV_TEMPLATE` is provided, it is copied only when `BAKERY_ENV_FILE` is missing.
- Bootstrap writes metadata keys and generic resource keys:
  - `BAKERY_PIE`, `BAKERY_SLICE_ID`, `BAKERY_URL`, `BAKERY_ROUTER_PORT`, `BAKERY_RESOURCE_PLAN`, `BAKERY_RESOURCE_COUNT`
  - `RESOURCE_1_PORT`, `RESOURCE_2_PORT`, ...
- Bootstrap prints a sync example:
  - `set -a; source ./.env.bakery; set +a`
- Bootstrap prints this handoff line:
  - `Run your repo setup script now (e.g. ./setup.sh or ./dev.sh).`

## Notes

- Compose-first detection is best-effort; fallback heuristics inspect repo signals (frontend/backend/db).
- User confirmation is the source of truth for the final resource list.
- Bakery must be available on `PATH` for generated bootstrap.
- Re-run patcher any time resource expectations change; `bootstrap-bakery.sh` is regenerated and frozen mapping may update.
