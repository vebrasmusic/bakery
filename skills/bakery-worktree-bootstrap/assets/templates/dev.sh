#!/usr/bin/env bash
set -euo pipefail

log() { printf '[dev.sh] %s\n' "$*"; }
fail() { printf '[dev.sh] ERROR: %s\n' "$*" >&2; exit 1; }

if ! git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  fail "dev.sh must run inside a git repository"
fi
cd "$git_root"

MANIFEST_FILE=".bakery-runtime.json"
ENV_FILE=".env"

[ -f "$MANIFEST_FILE" ] || fail "Missing $MANIFEST_FILE. Run patcher + setup first."
[ -f "$ENV_FILE" ] || fail "Missing .env. Run ./setup.sh --pie <pie-id-or-slug> first."
command -v node >/dev/null 2>&1 || fail "Node.js is required"

read_json_value() {
  local file="$1"
  local key="$2"
  node --input-type=module - "$file" "$key" <<'NODE'
import fs from "node:fs";
const [file, keyPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
let current = data;
for (const part of keyPath.split(".")) {
  if (current && Object.prototype.hasOwnProperty.call(current, part)) current = current[part];
  else { current = undefined; break; }
}
if (current === undefined || current === null) process.stdout.write("");
else if (Array.isArray(current)) process.stdout.write(current.map((v) => String(v)).join(","));
else if (typeof current === "boolean") process.stdout.write(current ? "true" : "false");
else process.stdout.write(String(current));
NODE
}

run_cmd_if_set() {
  local cmd="$1"
  local label="$2"
  if [ -z "$cmd" ] || [ "$cmd" = "none" ]; then
    return 0
  fi
  log "Running ${label}: ${cmd}"
  bash -lc "$cmd"
}

INSTALL_CMD="$(read_json_value "$MANIFEST_FILE" commands.install)"
DEV_CMD="$(read_json_value "$MANIFEST_FILE" commands.dev)"
DEV_WITH_PORT_CMD="$(read_json_value "$MANIFEST_FILE" commands.devWithPort)"
DB_TOOL_CMD="$(read_json_value "$MANIFEST_FILE" commands.dbTool)"
DB_DOCKERIZED="$(read_json_value "$MANIFEST_FILE" database.dockerized)"
DB_PROVIDER="$(read_json_value "$MANIFEST_FILE" database.provider)"
COMPOSE_FILE="$(read_json_value "$MANIFEST_FILE" database.composeFile)"
DB_SERVICE="$(read_json_value "$MANIFEST_FILE" database.serviceName)"

[ -n "$DB_SERVICE" ] || DB_SERVICE="db"
[ -n "$DEV_CMD" ] || fail "Missing commands.dev in $MANIFEST_FILE"

set -a
source "$ENV_FILE"
set +a

: "${APP_PORT:=3000}"

# >>> BAKERY USER:DEV_PRE START
# Custom dev commands before managed logic.
# <<< BAKERY USER:DEV_PRE END

# >>> BAKERY MANAGED:DEV_CORE START
run_cmd_if_set "$INSTALL_CMD" "dependency install"

compose_started="false"
if [ "$DB_DOCKERIZED" = "true" ]; then
  [ -n "$COMPOSE_FILE" ] || fail "Manifest indicates dockerized DB but composeFile is empty"
  [ -f "$COMPOSE_FILE" ] || fail "Compose file not found: $COMPOSE_FILE"
  command -v docker >/dev/null 2>&1 || fail "docker is required for ${DB_PROVIDER}"
  docker compose version >/dev/null 2>&1 || fail "docker compose is required"
  docker compose -f "$COMPOSE_FILE" up -d "$DB_SERVICE"
  compose_started="true"
fi

db_tool_pid=""
app_pid=""
cleanup_done="false"

cleanup() {
  if [ "$cleanup_done" = "true" ]; then
    return
  fi
  cleanup_done="true"
  set +e
  [ -n "$db_tool_pid" ] && kill "$db_tool_pid" >/dev/null 2>&1 || true
  [ -n "$db_tool_pid" ] && wait "$db_tool_pid" >/dev/null 2>&1 || true
  [ -n "$app_pid" ] && kill "$app_pid" >/dev/null 2>&1 || true
  [ -n "$app_pid" ] && wait "$app_pid" >/dev/null 2>&1 || true
  if [ "$compose_started" = "true" ] && [ -n "$COMPOSE_FILE" ] && [ -f "$COMPOSE_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
}
trap cleanup INT TERM EXIT

if [ -n "$DB_TOOL_CMD" ] && [ "$DB_TOOL_CMD" != "none" ]; then
  PORT="${DB_TOOL_PORT:-$APP_PORT}" DB_TOOL_PORT="${DB_TOOL_PORT:-$APP_PORT}" bash -lc "$DB_TOOL_CMD" &
  db_tool_pid="$!"
fi

run_app_cmd="$DEV_CMD"
[ -n "$DEV_WITH_PORT_CMD" ] && run_app_cmd="$DEV_WITH_PORT_CMD"
PORT="$APP_PORT" APP_PORT="$APP_PORT" bash -lc "$run_app_cmd" &
app_pid="$!"
wait "$app_pid"
# <<< BAKERY MANAGED:DEV_CORE END

# >>> BAKERY USER:DEV_POST START
# Custom dev commands after managed logic.
# <<< BAKERY USER:DEV_POST END
