# Bakery

Bakery is a local multi-pie, multi-slice daemon for host routing and port allocation.

## Install Modes

### 1) Global CLI install

```bash
pnpm add -g bakery
```

Then use from anywhere:

```bash
bakery up
bakery status
bakery pie create --name myapp --repo ~/code/myapp
bakery slice create --pie myapp --numresources 3 --worktree .
bakery pie rm --id myapp --force
bakery down
```

### 2) Per-repo install (recommended for project scripts)

In your project repo:

```bash
pnpm add -D bakery @bakery/slice
```

Then:

```bash
pnpm exec bakery up
pnpm exec bakery pie create --name myapp
pnpm exec bakery slice create --pie myapp --numresources 3 --worktree "$PWD"
pnpm exec bakery pie rm --id myapp --force
pnpm exec slice create --pie myapp --numresources 3 --worktree "$PWD"
```

## Local Workspace Testing (this repo)

From this workspace, you can install globally from local path:

```bash
pnpm --global add /Users/andresharisaduvvuri/Documents/GitHub/bakery/packages/bakery
```

Or in another repo, install from local path:

```bash
pnpm add -D /Users/andresharisaduvvuri/Documents/GitHub/bakery/packages/bakery
pnpm add -D /Users/andresharisaduvvuri/Documents/GitHub/bakery/packages/slice
```

## Runtime Model

- No compose/manifest required for pie/slice creation.
- `slice create` allocates free ports and returns JSON resource bindings.
- You run your own runtime scripts using those ports.
- Daemon provides host routing only.
- `bakery` (no subcommand) launches the interactive dashboard TUI.

## Startup Script (workspace)

`./bakery` delegates to the CLI entrypoint in this workspace.
Examples:

```bash
./bakery up
./bakery status --watch
./bakery
```

## API Notes

- No headers are required for local daemon APIs.
- Env vars prefix: `BAKERY_`

## Architecture Explainer

Open:
- `docs/bakery-explainer.html`
