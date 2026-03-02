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
JSON_PARSER=""

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

if ! command -v bakery >/dev/null 2>&1; then
  cat >&2 <<'ERR'
[bootstrap-bakery.sh] ERROR: bakery was not found on PATH.

Install the Bakery CLI first, then retry.
ERR
  exit 1
fi

select_json_parser() {
  if command -v python3 >/dev/null 2>&1; then
    JSON_PARSER="python3"
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    JSON_PARSER="jq"
    return
  fi
  fail "Either python3 or jq is required to parse Bakery JSON output"
}

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

read_json_value() {
  local file="$1"
  local key="$2"

  if [ "$JSON_PARSER" = "python3" ]; then
    python3 - "$file" "$key" <<'PY'
import json
import sys

file_path, key_path = sys.argv[1], sys.argv[2]
try:
    with open(file_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    sys.exit(2)

current = data
for part in key_path.split("."):
    if isinstance(current, dict) and part in current:
        current = current[part]
    else:
        current = None
        break

if current is None:
    sys.stdout.write("")
elif isinstance(current, list):
    sys.stdout.write(",".join(str(item) for item in current))
elif isinstance(current, bool):
    sys.stdout.write("true" if current else "false")
else:
    sys.stdout.write(str(current))
PY
    return
  fi

  jq -r --arg path "$key" '
    def read_path($parts):
      reduce $parts[] as $part (
        .;
        if type == "object" and has($part) then .[$part] else null end
      );

    (read_path($path | split("."))) as $value
    | if $value == null then ""
      elif ($value | type) == "array" then ($value | map(tostring) | join(","))
      elif ($value | type) == "boolean" then (if $value then "true" else "false" end)
      else ($value | tostring)
      end
  ' "$file"
}

validate_pie_exists() {
  local pie_id="$1"
  local pies_json
  pies_json="$(bakery pie ls --json)"

  if [ "$JSON_PARSER" = "python3" ]; then
    if ! PIES_JSON="$pies_json" python3 - "$pie_id" <<'PY'
import json
import os
import sys

pie_id = sys.argv[1]
raw = os.environ.get("PIES_JSON", "")
try:
    payload = json.loads(raw)
except Exception:
    sys.exit(1)

pies = payload.get("pies") if isinstance(payload, dict) else []
if not isinstance(pies, list):
    sys.exit(1)

exists = any(
    isinstance(pie, dict)
    and (pie.get("id") == pie_id or pie.get("slug") == pie_id or pie.get("name") == pie_id)
    for pie in pies
)
sys.exit(0 if exists else 1)
PY
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
    return
  fi

  if ! printf '%s' "$pies_json" | jq -e --arg pie_id "$pie_id" '
    (.pies // []) | any(.id == $pie_id or .slug == $pie_id or .name == $pie_id)
  ' >/dev/null; then
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

select_json_parser

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
upsert_env BAKERY_RESOURCE_PLAN "$RESOURCE_PLAN_CSV"
upsert_env BAKERY_RESOURCE_COUNT "$EXPECTED_NUM_RESOURCES"

written_keys=(
  "BAKERY_PIE"
  "BAKERY_SLICE_ID"
  "BAKERY_URL"
  "BAKERY_ROUTER_PORT"
  "BAKERY_RESOURCE_PLAN"
  "BAKERY_RESOURCE_COUNT"
)
written_values=(
  "$PIE_ID"
  "$slice_id"
  "$slice_url"
  "$router_port"
  "$RESOURCE_PLAN_CSV"
  "$EXPECTED_NUM_RESOURCES"
)

for idx in "${!resource_plan[@]}"; do
  role="${resource_plan[$idx]}"
  port="${allocated_ports[$idx]}"
  [ -n "$port" ] || fail "Missing allocated port for resource ${role}"
  is_positive_int "$port" || fail "Allocated port for resource ${role} is not a positive integer: $port"
  env_key="RESOURCE_$((idx + 1))_PORT"
  upsert_env "$env_key" "$port"
  written_keys+=("$env_key")
  written_values+=("$port")
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
log "resource plan: $RESOURCE_PLAN_CSV"
log "env file: $ENV_FILE"
log "Updated $ENV_FILE with:"
for idx in "${!written_keys[@]}"; do
  printf '[bootstrap-bakery.sh]   %s=%s\n' "${written_keys[$idx]}" "${written_values[$idx]}"
done
log "Sync example: $sync_example"
printf '%s\n' "Run your repo setup script now (e.g. ./setup.sh or ./dev.sh)."
