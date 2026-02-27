#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./bootstrap-bakery.sh --pie <pie-id-or-slug> --numresources <n>

Options:
  --pie <id-or-slug>   Required Bakery pie identifier
  --numresources <n>   Required number of resources to allocate
  -h, --help           Show this help

Environment:
  BAKERY_ENV_FILE      Target env file for Bakery-managed keys (default: .env.bakery)
  BAKERY_ENV_TEMPLATE  Optional template to copy only when BAKERY_ENV_FILE is missing

Sync example:
  set -a; source ./.env.bakery; set +a
USAGE
}

log() { printf '[bootstrap-bakery.sh] %s\n' "$*"; }
fail() { printf '[bootstrap-bakery.sh] ERROR: %s\n' "$*" >&2; exit 1; }

PIE_ID=""
NUM_RESOURCES=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pie)
      [ "$#" -ge 2 ] || fail "--pie requires a value"
      PIE_ID="$2"
      shift 2
      ;;
    --numresources)
      [ "$#" -ge 2 ] || fail "--numresources requires a value"
      NUM_RESOURCES="$2"
      shift 2
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
[ -n "$NUM_RESOURCES" ] || { usage >&2; fail "--numresources is required"; }

if ! git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  fail "bootstrap-bakery.sh must run inside a git repository"
fi
cd "$git_root"

ENV_FILE="${BAKERY_ENV_FILE:-.env.bakery}"
ENV_TEMPLATE="${BAKERY_ENV_TEMPLATE:-}"
RESOURCE_PLAN_CSV="__BAKERY_RESOURCE_PLAN_CSV__"
EXPECTED_NUM_RESOURCES="__BAKERY_EXPECTED_NUM_RESOURCES__"

[ -n "$ENV_FILE" ] || fail "BAKERY_ENV_FILE must not be empty"

command -v node >/dev/null 2>&1 || fail "Node.js is required"
if ! command -v bakery >/dev/null 2>&1; then
  cat >&2 <<'ERR'
[bootstrap-bakery.sh] ERROR: bakery was not found on PATH.

Install Bakery globally first, then retry:
  pnpm --global install /path-to-bakery-repo/packages/bakery
ERR
  exit 1
fi

upsert_env() {
  local key="$1"
  local value="$2"
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

validate_pie_exists() {
  local pie_id="$1"
  local pies_json
  pies_json="$(bakery pie ls --json)"
  if ! PIES_JSON="$pies_json" node --input-type=module - "$pie_id" <<'NODE'

const [pieId] = process.argv.slice(2);
const raw = process.env.PIES_JSON ?? "";
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(1);
}
const pies = Array.isArray(payload?.pies) ? payload.pies : [];
const exists = pies.some((pie) => {
  if (!pie || typeof pie !== "object") return false;
  return pie.id === pieId || pie.slug === pieId || pie.name === pieId;
});
process.exit(exists ? 0 : 1);
NODE
  then
    cat >&2 <<ERR
[bootstrap-bakery.sh] ERROR: pie '${pie_id}' does not exist.

Create a pie first, then rerun bootstrap:
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

is_positive_int "$EXPECTED_NUM_RESOURCES" || fail "Embedded expected resource count is invalid"
is_positive_int "$NUM_RESOURCES" || fail "--numresources must be a positive integer"
[ "$NUM_RESOURCES" = "$EXPECTED_NUM_RESOURCES" ] || fail "--numresources must be $EXPECTED_NUM_RESOURCES for this bootstrap script"

IFS=',' read -r -a resource_plan <<<"$RESOURCE_PLAN_CSV"
[ "${#resource_plan[@]}" -eq "$EXPECTED_NUM_RESOURCES" ] || fail "Embedded resource plan does not match expected count"

if ! bakery up >/dev/null; then
  fail "Failed to start or connect to Bakery daemon. Run 'bakery up' and retry."
fi
validate_pie_exists "$PIE_ID"

slice_output="$(bakery slice create --pie "$PIE_ID" --numresources "$NUM_RESOURCES")"
tmp_json="$(mktemp)"
printf '%s\n' "$slice_output" >"$tmp_json"

read_json_value() {
  local file="$1"
  local key="$2"
  node --input-type=module - "$file" "$key" <<'NODE'
import fs from "node:fs";

const [file, keyPath] = process.argv.slice(2);
let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(2);
}
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

if ! slice_id="$(read_json_value "$tmp_json" id)"; then
  rm -f "$tmp_json"
  fail "Malformed slice JSON from bakery output"
fi
if ! slice_url="$(read_json_value "$tmp_json" url)"; then
  rm -f "$tmp_json"
  fail "Malformed slice JSON from bakery output"
fi
if ! router_port="$(read_json_value "$tmp_json" routerPort)"; then
  rm -f "$tmp_json"
  fail "Malformed slice JSON from bakery output"
fi
if ! allocated_ports_csv="$(read_json_value "$tmp_json" allocatedPorts)"; then
  rm -f "$tmp_json"
  fail "Malformed slice JSON from bakery output"
fi
rm -f "$tmp_json"

[ -n "$slice_id" ] || fail "Failed to parse slice id from bakery output"
[ -n "$slice_url" ] || fail "Failed to parse slice url from bakery output"
[ -n "$router_port" ] || fail "Failed to parse router port from bakery output"
[ -n "$allocated_ports_csv" ] || fail "Failed to parse allocated ports from bakery output"

IFS=',' read -r -a allocated_ports <<<"$allocated_ports_csv"
[ "${#allocated_ports[@]}" -eq "$EXPECTED_NUM_RESOURCES" ] || fail "Expected $EXPECTED_NUM_RESOURCES allocated ports, got ${#allocated_ports[@]}"
is_positive_int "$router_port" || fail "Router port is not a positive integer: $router_port"

role_to_env_key() {
  local role="$1"
  case "$role" in
    app) echo "APP_PORT" ;;
    db) echo "DB_PORT" ;;
    dbTool) echo "DB_TOOL_PORT" ;;
    *)
      local normalized="$role"
      normalized="$(printf '%s' "$normalized" | sed -E 's/([a-z0-9])([A-Z])/\1_\2/g')"
      normalized="$(printf '%s' "$normalized" | tr '[:lower:]- ' '[:upper:]__')"
      normalized="$(printf '%s' "$normalized" | sed -E 's/[^A-Z0-9_]/_/g; s/_+/_/g; s/^_+|_+$//g')"
      [ -n "$normalized" ] || normalized="RESOURCE"
      printf '%s_PORT\n' "$normalized"
      ;;
  esac
}

APP_PORT=""
extra_env_keys=()
extra_env_values=()

for idx in "${!resource_plan[@]}"; do
  role="${resource_plan[$idx]}"
  port="${allocated_ports[$idx]}"
  [ -n "$port" ] || fail "Missing allocated port for role ${role}"
  is_positive_int "$port" || fail "Allocated port for role ${role} is not a positive integer: $port"
  env_key="$(role_to_env_key "$role")"
  if [ "$env_key" = "APP_PORT" ]; then
    APP_PORT="$port"
  else
    extra_env_keys+=("$env_key")
    extra_env_values+=("$port")
  fi
done

[ -n "$APP_PORT" ] || APP_PORT="${allocated_ports[0]}"

if [ ! -f "$ENV_FILE" ] && [ -n "$ENV_TEMPLATE" ]; then
  [ -f "$ENV_TEMPLATE" ] || fail "BAKERY_ENV_TEMPLATE does not exist: $ENV_TEMPLATE"
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$ENV_TEMPLATE" "$ENV_FILE"
fi

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

upsert_env BAKERY_PIE "$PIE_ID"
upsert_env BAKERY_SLICE_ID "$slice_id"
upsert_env BAKERY_URL "$slice_url"
upsert_env BAKERY_ROUTER_PORT "$router_port"
upsert_env APP_PORT "$APP_PORT"
upsert_env PORT "$APP_PORT"

written_keys=("BAKERY_PIE" "BAKERY_SLICE_ID" "BAKERY_URL" "BAKERY_ROUTER_PORT" "APP_PORT" "PORT")
written_values=("$PIE_ID" "$slice_id" "$slice_url" "$router_port" "$APP_PORT" "$APP_PORT")

for idx in "${!extra_env_keys[@]}"; do
  key="${extra_env_keys[$idx]}"
  value="${extra_env_values[$idx]}"
  upsert_env "$key" "$value"
  written_keys+=("$key")
  written_values+=("$value")
done

sync_env_path="$ENV_FILE"
case "$sync_env_path" in
  /*) sync_example="set -a; source \"$sync_env_path\"; set +a" ;;
  *) sync_example="set -a; source \"./$sync_env_path\"; set +a" ;;
esac

log "Bootstrap complete"
log "pie: $PIE_ID"
log "slice id: $slice_id"
log "bakery url: $slice_url"
log "env file: $ENV_FILE"
log "Updated $ENV_FILE with:"
for idx in "${!written_keys[@]}"; do
  printf '[bootstrap-bakery.sh]   %s=%s\n' "${written_keys[$idx]}" "${written_values[$idx]}"
done
log "Sync example: $sync_example"
printf '%s\n' "Run your repo setup script now (e.g. ./setup.sh or ./dev.sh)."
