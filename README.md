# Bakery

Bakery is a local daemon + CLI for pie/slice routing and port allocation.

## Quickstart

1. Clone the repo and enter it:

```bash
git clone <repo-url>
cd bakery
```

2. Install the global CLI from this repo:

```bash
pnpm add -g ./packages/bakery
```

3. Verify Bakery starts:

```bash
bakery up
```

4. Open the interactive console/dashboard:

```bash
bakery
```

## CLI Output for Worktree Setup Scripts

`slice create` is useful for setup automation because it returns JSON with allocated ports and routing metadata.

Create a pie once, then create a slice:

```bash
bakery pie create --name mypie
bakery slice create --pie mypie --numresources 3
```

Example output:

```json
{
  "id": "s1",
  "pieId": "mypie",
  "host": "mypie-s1.localtest.me",
  "routerPort": 4080,
  "url": "http://mypie-s1.localtest.me:4080",
  "allocatedPorts": [30001, 30002, 30003],
  "resources": [
    {
      "key": "r1",
      "protocol": "http",
      "expose": "primary",
      "allocatedPort": 30001,
      "routeHost": "mypie-s1.localtest.me",
      "routeUrl": "http://mypie-s1.localtest.me:4080"
    },
    {
      "key": "r2",
      "protocol": "tcp",
      "expose": "none",
      "allocatedPort": 30002
    },
    {
      "key": "r3",
      "protocol": "tcp",
      "expose": "none",
      "allocatedPort": 30003
    }
  ]
}
```

Common fields scripts use:
- `id`
- `pieId`
- `host`
- `routerPort`
- `url`
- `allocatedPorts`
- `resources`

## Example setup.sh snippet (env generation)

```bash
#!/usr/bin/env bash
set -euo pipefail

PIE_NAME="${PIE_NAME:-mypie}"
NUM_RESOURCES="${NUM_RESOURCES:-3}"

bakery up >/dev/null
bakery pie create --name "$PIE_NAME" >/dev/null 2>&1 || true

SLICE_JSON="$(bakery slice create --pie "$PIE_NAME" --numresources "$NUM_RESOURCES")"

cat > .env.worktree <<EOF
BAKERY_SLICE_ID=$(echo "$SLICE_JSON" | jq -r '.id')
BAKERY_PIE_ID=$(echo "$SLICE_JSON" | jq -r '.pieId')
BAKERY_HOST=$(echo "$SLICE_JSON" | jq -r '.host')
BAKERY_ROUTER_PORT=$(echo "$SLICE_JSON" | jq -r '.routerPort')
BAKERY_URL=$(echo "$SLICE_JSON" | jq -r '.url // ""')
BAKERY_PORT_1=$(echo "$SLICE_JSON" | jq -r '.allocatedPorts[0]')
BAKERY_PORT_2=$(echo "$SLICE_JSON" | jq -r '.allocatedPorts[1]')
BAKERY_PORT_3=$(echo "$SLICE_JSON" | jq -r '.allocatedPorts[2]')
EOF
```

This pattern lets agent/worktree bootstrap scripts create deterministic env files from Bakery CLI output.

## Limitations

- Bakery forwards slice hostnames to upstream apps, but OAuth providers still require explicit redirect URI allowlisting. For flows like Google OAuth, add the generated Bakery URL to your provider console.
- Only tested with Better Auth so far.

## Optional next commands

```bash
bakery status
bakery down
```
