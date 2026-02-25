#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./setup.sh --pie <pie-id-or-slug> [--new-slice|--reuse-slice] [--numresources <n>] [--with-migrate] [--with-seed]

Options:
  --pie <id-or-slug>   Required Bakery pie identifier
  --new-slice          Force creating a new slice
  --reuse-slice        Force reusing existing .bakery-slice.json when valid
  --numresources <n>   Override detected default resource count
  --with-migrate       Run configured migrate command
  --with-seed          Run configured seed command
  -h, --help           Show this help
USAGE
}

log() { printf '[setup.sh] %s\n' "$*"; }
warn() { printf '[setup.sh] WARN: %s\n' "$*" >&2; }
fail() { printf '[setup.sh] ERROR: %s\n' "$*" >&2; exit 1; }

PIE_ID=""
FORCE_NEW="false"
FORCE_REUSE="false"
NUM_RESOURCES_OVERRIDE=""
RUN_MIGRATE="false"
RUN_SEED="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pie)
      [ "$#" -ge 2 ] || fail "--pie requires a value"
      PIE_ID="$2"
      shift 2
      ;;
    --new-slice)
      FORCE_NEW="true"
      shift
      ;;
    --reuse-slice)
      FORCE_REUSE="true"
      shift
      ;;
    --numresources)
      [ "$#" -ge 2 ] || fail "--numresources requires a value"
      NUM_RESOURCES_OVERRIDE="$2"
      shift 2
      ;;
    --with-migrate)
      RUN_MIGRATE="true"
      shift
      ;;
    --with-seed)
      RUN_SEED="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
done

[ -n "$PIE_ID" ] || { usage >&2; fail "--pie is required"; }

if [ "$FORCE_NEW" = "true" ] && [ "$FORCE_REUSE" = "true" ]; then
  fail "--new-slice and --reuse-slice are mutually exclusive"
fi

if ! git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  fail "setup.sh must run inside a git repository"
fi
cd "$git_root"

MANIFEST_FILE=".bakery-runtime.json"
STATE_FILE=".bakery-slice.json"
ENV_FILE=".env"

[ -f "$MANIFEST_FILE" ] || fail "Missing $MANIFEST_FILE. Run the Bakery runtime patcher first."

command -v node >/dev/null 2>&1 || fail "Node.js is required"
if ! command -v bakery >/dev/null 2>&1; then
  cat >&2 <<'ERR'
[setup.sh] ERROR: bakery was not found on PATH.

Install Bakery globally first, then retry:
  pnpm --global install /path-to-bakery-repo/packages/bakery
ERR
  exit 1
fi

read_json_value() {
  local file="$1"
  local key="$2"
  node --input-type=module - "$file" "$key" <<'NODE'
import fs from "node:fs";

const [file, keyPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
let current = data;
for (const part of keyPath.split(".")) {
  if (current && Object.prototype.hasOwnProperty.call(current, part)) {
    current = current[part];
  } else {
    current = undefined;
    break;
  }
}

if (current === undefined || current === null) {
  process.stdout.write("");
} else if (Array.isArray(current)) {
  process.stdout.write(current.map((value) => String(value)).join(","));
} else if (typeof current === "boolean") {
  process.stdout.write(current ? "true" : "false");
} else {
  process.stdout.write(String(current));
}
NODE
}

read_manifest() {
  read_json_value "$MANIFEST_FILE" "$1"
}

upsert_env() {
  local key="$1"
  local value="$2"
  touch "$ENV_FILE"
  if grep -Eq "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      $0 ~ ("^" k "=") { print k "=\"" v "\""; done = 1; next }
      { print }
      END { if (!done) print k "=\"" v "\"" }
    ' "$ENV_FILE" >"${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s="%s"\n' "$key" "$value" >>"$ENV_FILE"
  fi
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

slice_exists() {
  local slice_id="$1"
  local output
  output="$(bakery slice ls --all --json)"
  printf '%s' "$output" | node --input-type=module - "$slice_id" <<'NODE'
import fs from "node:fs";

const [sliceId] = process.argv.slice(2);
const raw = fs.readFileSync(0, "utf8");
const payload = JSON.parse(raw);
const slices = Array.isArray(payload?.slices) ? payload.slices : [];
const exists = slices.some((slice) => slice && slice.id === sliceId);
process.exit(exists ? 0 : 1);
NODE
}

validate_pie_exists() {
  local pie_id="$1"
  local pies_json
  pies_json="$(bakery pie ls --json)"
  if ! printf '%s' "$pies_json" | node --input-type=module - "$pie_id" <<'NODE'
import fs from "node:fs";

const [pieId] = process.argv.slice(2);
const raw = fs.readFileSync(0, "utf8");
const payload = JSON.parse(raw);
const pies = Array.isArray(payload?.pies) ? payload.pies : [];
const exists = pies.some((pie) => {
  if (!pie || typeof pie !== "object") return false;
  return pie.id === pieId || pie.slug === pieId || pie.name === pieId;
});
process.exit(exists ? 0 : 1);
NODE
  then
    cat >&2 <<ERR
[setup.sh] ERROR: pie '${pie_id}' does not exist.

Create a pie first, then rerun setup:
  bakery pie create --name <name>

Or list available pies:
  bakery pie ls
ERR
    exit 1
  fi
}

is_positive_int() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

INSTALL_CMD="$(read_manifest commands.install)"
MIGRATE_CMD="$(read_manifest commands.migrate)"
SEED_CMD="$(read_manifest commands.seed)"
DB_DOCKERIZED="$(read_manifest database.dockerized)"
COMPOSE_FILE="$(read_manifest database.composeFile)"
DB_SERVICE="$(read_manifest database.serviceName)"
RESOURCE_PLAN_CSV="$(read_manifest bakery.resourcePlan)"
DEFAULT_NUM_RESOURCES="$(read_manifest bakery.defaultNumResources)"
PORT_KEYS_CSV="$(read_manifest env.portKeys)"

[ -n "$DB_SERVICE" ] || DB_SERVICE="db"
[ -n "$DEFAULT_NUM_RESOURCES" ] || DEFAULT_NUM_RESOURCES="1"

if [ -n "$NUM_RESOURCES_OVERRIDE" ]; then
  is_positive_int "$NUM_RESOURCES_OVERRIDE" || fail "--numresources must be a positive integer"
  NUM_RESOURCES="$NUM_RESOURCES_OVERRIDE"
else
  is_positive_int "$DEFAULT_NUM_RESOURCES" || fail "Invalid defaultNumResources in $MANIFEST_FILE"
  NUM_RESOURCES="$DEFAULT_NUM_RESOURCES"
fi

run_cmd_if_set "$INSTALL_CMD" "dependency install"
bakery up >/dev/null
validate_pie_exists "$PIE_ID"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
reuse_existing="false"
create_new="false"

existing_slice_id=""
existing_slice_pie=""
existing_slice_worktree=""
existing_allocated_ports=""
existing_url=""
existing_router_port=""
existing_created_at=""

if [ -f "$STATE_FILE" ]; then
  existing_slice_id="$(read_json_value "$STATE_FILE" sliceId)"
  existing_slice_pie="$(read_json_value "$STATE_FILE" pie)"
  existing_slice_worktree="$(read_json_value "$STATE_FILE" worktree)"
  existing_allocated_ports="$(read_json_value "$STATE_FILE" allocatedPorts)"
  existing_url="$(read_json_value "$STATE_FILE" url)"
  existing_router_port="$(read_json_value "$STATE_FILE" routerPort)"
  existing_created_at="$(read_json_value "$STATE_FILE" createdAt)"
fi

state_valid="false"
if [ -n "$existing_slice_id" ] && [ -n "$existing_allocated_ports" ] && [ "$existing_slice_pie" = "$PIE_ID" ] && [ "$existing_slice_worktree" = "$git_root" ]; then
  if slice_exists "$existing_slice_id"; then
    state_valid="true"
  fi
fi

if [ "$FORCE_NEW" = "true" ]; then
  create_new="true"
elif [ "$FORCE_REUSE" = "true" ]; then
  if [ "$state_valid" = "true" ]; then
    reuse_existing="true"
  else
    warn "--reuse-slice requested but existing state is invalid; creating a new slice"
    create_new="true"
  fi
else
  if [ "$state_valid" = "true" ]; then
    if [ -t 0 ] && [ -t 1 ]; then
      read -r -p "[setup.sh] Reuse existing slice ${existing_slice_id}? [Y/n] " answer
      case "$answer" in
        n|N|no|NO) create_new="true" ;;
        *) reuse_existing="true" ;;
      esac
    else
      reuse_existing="true"
    fi
  else
    create_new="true"
  fi
fi

slice_id=""
slice_url=""
router_port=""
allocated_ports_csv=""
created_at=""

if [ "$reuse_existing" = "true" ]; then
  slice_id="$existing_slice_id"
  slice_url="$existing_url"
  router_port="$existing_router_port"
  allocated_ports_csv="$existing_allocated_ports"
  created_at="$existing_created_at"
else
  slice_output="$(bakery slice create --pie "$PIE_ID" --numresources "$NUM_RESOURCES" --worktree "$git_root" --branch "$branch")"
  tmp_json="$(mktemp)"
  printf '%s\n' "$slice_output" >"$tmp_json"
  slice_id="$(read_json_value "$tmp_json" id)"
  slice_url="$(read_json_value "$tmp_json" url)"
  router_port="$(read_json_value "$tmp_json" routerPort)"
  allocated_ports_csv="$(read_json_value "$tmp_json" allocatedPorts)"
  rm -f "$tmp_json"
  [ -n "$slice_id" ] || fail "Failed to parse slice id from bakery output"
  [ -n "$allocated_ports_csv" ] || fail "Failed to parse allocated ports"
  created_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi

IFS=',' read -r -a resource_plan <<<"$RESOURCE_PLAN_CSV"
IFS=',' read -r -a allocated_ports <<<"$allocated_ports_csv"
[ "${#allocated_ports[@]}" -ge 1 ] || fail "No allocated ports returned"

APP_PORT="${allocated_ports[0]}"
DB_PORT=""
DB_TOOL_PORT=""

for idx in "${!resource_plan[@]}"; do
  role="${resource_plan[$idx]}"
  port=""
  if [ "$idx" -lt "${#allocated_ports[@]}" ]; then
    port="${allocated_ports[$idx]}"
  fi
  case "$role" in
    app) [ -n "$port" ] && APP_PORT="$port" ;;
    db) DB_PORT="$port" ;;
    dbTool) DB_TOOL_PORT="$port" ;;
  esac
done

if [ -f .env.example ] && [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
fi
touch "$ENV_FILE"

upsert_env BAKERY_PIE "$PIE_ID"
upsert_env BAKERY_SLICE_ID "$slice_id"
upsert_env BAKERY_URL "$slice_url"
upsert_env BAKERY_ROUTER_PORT "$router_port"
upsert_env APP_PORT "$APP_PORT"
upsert_env PORT "$APP_PORT"

if [ -n "$PORT_KEYS_CSV" ]; then
  IFS=',' read -r -a port_keys <<<"$PORT_KEYS_CSV"
  for key in "${port_keys[@]}"; do
    [ -n "$key" ] || continue
    upsert_env "$key" "$APP_PORT"
  done
fi

[ -n "$DB_PORT" ] && upsert_env DB_PORT "$DB_PORT"
[ -n "$DB_TOOL_PORT" ] && upsert_env DB_TOOL_PORT "$DB_TOOL_PORT"

node --input-type=module - "$STATE_FILE" "$slice_id" "$PIE_ID" "$git_root" "$allocated_ports_csv" "$slice_url" "$router_port" "$created_at" <<'NODE'
import fs from "node:fs";
const [stateFile, sliceId, pie, worktree, allocatedCsv, url, routerPortRaw, createdAt] = process.argv.slice(2);
const allocatedPorts = allocatedCsv.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
const routerPort = Number(routerPortRaw || "0");
fs.writeFileSync(stateFile, `${JSON.stringify({ sliceId, pie, worktree, allocatedPorts, url: url || "", routerPort, createdAt }, null, 2)}\n`, "utf8");
NODE

compose_started="false"
if [ "$DB_DOCKERIZED" = "true" ] && [ "$RUN_MIGRATE" = "true" -o "$RUN_SEED" = "true" ]; then
  [ -n "$COMPOSE_FILE" ] || fail "Manifest indicates dockerized DB but composeFile is empty"
  [ -f "$COMPOSE_FILE" ] || fail "Compose file not found: $COMPOSE_FILE"
  command -v docker >/dev/null 2>&1 || fail "docker is required"
  docker compose version >/dev/null 2>&1 || fail "docker compose is required"
  docker compose -f "$COMPOSE_FILE" up -d "$DB_SERVICE"
  compose_started="true"
fi

# >>> BAKERY USER:SETUP_PRE START
# Custom setup commands before managed logic.
# <<< BAKERY USER:SETUP_PRE END

# >>> BAKERY MANAGED:SETUP_CORE START
[ "$RUN_MIGRATE" = "true" ] && run_cmd_if_set "$MIGRATE_CMD" "migrate"
[ "$RUN_SEED" = "true" ] && run_cmd_if_set "$SEED_CMD" "seed"
# <<< BAKERY MANAGED:SETUP_CORE END

# >>> BAKERY USER:SETUP_POST START
# Custom setup commands after managed logic.
# <<< BAKERY USER:SETUP_POST END

if [ "$compose_started" = "true" ]; then
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
fi
