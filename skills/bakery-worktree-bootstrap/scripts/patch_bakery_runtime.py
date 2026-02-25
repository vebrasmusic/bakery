#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

SKILL_NAME = "bakery-worktree-bootstrap"
MANIFEST_FILE = ".bakery-runtime.json"

PACKAGE_MANAGERS = ("pnpm", "npm", "yarn", "bun")
DB_PROVIDERS = ("auto", "postgres", "mysql", "sqlite", "none")
DOCKER_DB_PROVIDERS = {"postgres", "mysql"}

DEV_CANDIDATES = ("dev", "start:dev", "web:dev", "app:dev", "start")
MIGRATE_CANDIDATES = ("db:push", "db:migrate", "migrate", "prisma:migrate")
SEED_CANDIDATES = ("db:seed", "seed", "prisma:seed")
DB_TOOL_CANDIDATES = ("db:studio", "studio", "prisma:studio", "drizzle:studio")

COMPOSE_CANDIDATES = (
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.worktree.yml",
)

PORT_KEY_PRIORITY = (
    "PORT",
    "APP_PORT",
    "SERVER_PORT",
    "VITE_PORT",
    "NEXT_PUBLIC_PORT",
)

TEXT_FILE_SUFFIXES = {
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
    ".ts",
    ".tsx",
    ".json",
    ".yaml",
    ".yml",
    ".env",
}

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".next",
    ".turbo",
    "dist",
    "build",
    "coverage",
    "out",
    ".cache",
}

MAX_SCAN_FILE_BYTES = 512_000

USER_BLOCK_RE = re.compile(
    r"(# >>> BAKERY USER:(?P<name>[A-Z_]+) START\\n)(?P<body>.*?)(# <<< BAKERY USER:(?P=name) END)",
    re.DOTALL,
)


def fail(message: str) -> None:
    raise SystemExit(f"[{SKILL_NAME}] ERROR: {message}")


def slugify(value: str) -> str:
    normalized = value.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized or "app"


def load_package_json(project_dir: Path) -> dict[str, Any]:
    package_json_path = project_dir / "package.json"
    if not package_json_path.exists():
        fail("Missing package.json. Node.js repositories only in v1.")

    try:
        data = json.loads(package_json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"Invalid package.json: {exc}")

    if not isinstance(data, dict):
        fail("package.json root must be a JSON object.")

    return data


def detect_package_manager(project_dir: Path, pkg: dict[str, Any], explicit: str | None) -> str:
    if explicit:
        if explicit not in PACKAGE_MANAGERS:
            fail(f"Unsupported package manager: {explicit}")
        return explicit

    if (project_dir / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (project_dir / "bun.lockb").exists() or (project_dir / "bun.lock").exists():
        return "bun"
    if (project_dir / "yarn.lock").exists():
        return "yarn"
    if (project_dir / "package-lock.json").exists():
        return "npm"

    raw = pkg.get("packageManager")
    if isinstance(raw, str) and raw.strip():
        candidate = raw.split("@", 1)[0].strip()
        if candidate in PACKAGE_MANAGERS:
            return candidate

    return "npm"


def install_command(package_manager: str) -> str:
    mapping = {
        "pnpm": "pnpm install",
        "npm": "npm install",
        "yarn": "yarn install",
        "bun": "bun install",
    }
    return mapping[package_manager]


def command_for_script(package_manager: str, script_name: str) -> str:
    if package_manager == "pnpm":
        return f"pnpm run {script_name}"
    if package_manager == "npm":
        return f"npm run {script_name}"
    if package_manager == "yarn":
        return f"yarn {script_name}"
    if package_manager == "bun":
        return f"bun run {script_name}"
    fail(f"Unsupported package manager: {package_manager}")


def detect_script_name(pkg: dict[str, Any], candidates: tuple[str, ...]) -> str:
    scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
    for candidate in candidates:
        if candidate in scripts:
            return candidate
    return ""


def normalize_optional_command(value: str | None, detected: str) -> str:
    if value is None:
        return detected
    stripped = value.strip()
    if stripped.lower() == "none":
        return ""
    return stripped


def detect_compose_file(project_dir: Path, explicit: str | None) -> Path | None:
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = project_dir / candidate
        candidate = candidate.resolve()
        if not candidate.exists():
            fail(f"Compose file not found: {candidate}")
        if not candidate.is_file():
            fail(f"Compose path is not a file: {candidate}")
        return candidate

    for relative in COMPOSE_CANDIDATES:
        candidate = project_dir / relative
        if candidate.exists() and candidate.is_file():
            return candidate

    return None


def infer_db_provider(pkg: dict[str, Any], compose_content: str, explicit_provider: str) -> str:
    if explicit_provider != "auto":
        return explicit_provider

    lower_compose = compose_content.lower()
    if "postgres" in lower_compose:
        return "postgres"
    if "mysql" in lower_compose or "mariadb" in lower_compose:
        return "mysql"

    deps: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = pkg.get(key)
        if isinstance(value, dict):
            deps.update({str(dep): str(version) for dep, version in value.items()})

    dep_keys = set(deps.keys())
    if {"better-sqlite3", "sqlite3", "@libsql/client"} & dep_keys:
        return "sqlite"

    return "none"


def detect_db_service_name(compose_content: str, explicit_service: str | None) -> str:
    if explicit_service and explicit_service.strip():
        return explicit_service.strip()

    if not compose_content:
        return ""

    if re.search(r"^\s*db\s*:\s*$", compose_content, flags=re.MULTILINE):
        return "db"

    in_services = False
    for line in compose_content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        if not in_services:
            if stripped == "services:":
                in_services = True
            continue

        if not line.startswith(" ") and not line.startswith("\t"):
            break

        service_match = re.match(r"^\s{2}([A-Za-z0-9_-]+):\s*$", line)
        if service_match:
            return service_match.group(1)

    return "db"


def detect_port_keys(project_dir: Path) -> list[str]:
    discovered: list[str] = []
    seen: set[str] = set()

    def add_key(key: str) -> None:
        normalized = key.strip().upper()
        if not normalized or "PORT" not in normalized:
            return
        if not re.match(r"^[A-Z][A-Z0-9_]*$", normalized):
            return
        if normalized not in seen:
            seen.add(normalized)
            discovered.append(normalized)

    for key in PORT_KEY_PRIORITY:
        add_key(key)

    pattern = re.compile(r"\b([A-Z][A-Z0-9_]*PORT[A-Z0-9_]*)\b")

    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [entry for entry in dirs if entry not in EXCLUDED_DIRS and not entry.startswith(".")]
        for filename in files:
            path = Path(root) / filename
            suffix = path.suffix.lower()
            include = filename.startswith(".env") or suffix in TEXT_FILE_SUFFIXES
            if not include:
                continue
            try:
                if path.stat().st_size > MAX_SCAN_FILE_BYTES:
                    continue
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for match in pattern.finditer(content):
                add_key(match.group(1))

    return discovered


def detect_dev_with_port_command(package_manager: str, dev_command: str, script_body: str) -> str:
    body = script_body.lower()
    if not body or "--port" in body or " -p " in body:
        return ""

    supports_explicit_port = any(token in body for token in ("next dev", "vite", "nuxt dev", "nuxt", "webpack serve"))
    if not supports_explicit_port:
        return ""

    if package_manager in {"pnpm", "npm", "bun"}:
        return f"{dev_command} -- --port \"$APP_PORT\""
    if package_manager == "yarn":
        return f"{dev_command} --port \"$APP_PORT\""
    return ""


def extract_user_blocks(content: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    for match in USER_BLOCK_RE.finditer(content):
        blocks[match.group("name")] = match.group("body")
    return blocks


def merge_user_blocks(template: str, existing: str | None) -> str:
    if not existing:
        return template

    previous = extract_user_blocks(existing)

    def replace(match: re.Match[str]) -> str:
        name = match.group("name")
        body = previous.get(name, match.group("body"))
        return f"{match.group(1)}{body}{match.group(4)}"

    return USER_BLOCK_RE.sub(replace, template)


def write_script_from_template(project_dir: Path, script_name: str, template_path: Path) -> None:
    destination = project_dir / script_name
    template = template_path.read_text(encoding="utf-8")
    existing = destination.read_text(encoding="utf-8") if destination.exists() else None
    merged = merge_user_blocks(template, existing)
    destination.write_text(merged, encoding="utf-8")
    os.chmod(destination, 0o755)


def write_manifest(project_dir: Path, manifest: dict[str, Any]) -> None:
    (project_dir / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Patch a Node repo for Bakery-managed worktree runtime.")
    parser.add_argument("--target", default=".", help="Target repository path")
    parser.add_argument("--package-manager", choices=PACKAGE_MANAGERS)
    parser.add_argument("--dev-cmd", help="Explicit dev command")
    parser.add_argument("--db-provider", choices=DB_PROVIDERS, default="auto")
    parser.add_argument("--compose-file", help="Compose file path")
    parser.add_argument("--db-service", help="Compose DB service name")
    parser.add_argument("--migrate-cmd", help="Explicit migrate command or 'none'")
    parser.add_argument("--seed-cmd", help="Explicit seed command or 'none'")
    parser.add_argument("--db-tool-cmd", help="Explicit DB tool command or 'none'")
    args = parser.parse_args(argv)

    project_dir = Path(args.target).resolve()
    if not project_dir.exists() or not project_dir.is_dir():
        fail(f"Target directory does not exist: {project_dir}")

    pkg = load_package_json(project_dir)
    scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}

    package_manager = detect_package_manager(project_dir, pkg, args.package_manager)

    detected_dev_script = detect_script_name(pkg, DEV_CANDIDATES)
    detected_migrate_script = detect_script_name(pkg, MIGRATE_CANDIDATES)
    detected_seed_script = detect_script_name(pkg, SEED_CANDIDATES)
    detected_db_tool_script = detect_script_name(pkg, DB_TOOL_CANDIDATES)

    detected_dev_cmd = command_for_script(package_manager, detected_dev_script) if detected_dev_script else ""
    dev_cmd = args.dev_cmd.strip() if args.dev_cmd else detected_dev_cmd
    if not dev_cmd:
        fail("Unable to detect dev command. Pass --dev-cmd explicitly.")

    dev_script_body = ""
    if detected_dev_script and isinstance(scripts, dict):
        raw_body = scripts.get(detected_dev_script)
        if isinstance(raw_body, str):
            dev_script_body = raw_body

    dev_with_port_cmd = detect_dev_with_port_command(package_manager, dev_cmd, dev_script_body)
    detected_migrate_cmd = command_for_script(package_manager, detected_migrate_script) if detected_migrate_script else ""
    detected_seed_cmd = command_for_script(package_manager, detected_seed_script) if detected_seed_script else ""
    detected_db_tool_cmd = command_for_script(package_manager, detected_db_tool_script) if detected_db_tool_script else ""

    migrate_cmd = normalize_optional_command(args.migrate_cmd, detected_migrate_cmd)
    seed_cmd = normalize_optional_command(args.seed_cmd, detected_seed_cmd)
    db_tool_cmd = normalize_optional_command(args.db_tool_cmd, detected_db_tool_cmd)

    compose_path = detect_compose_file(project_dir, args.compose_file)
    compose_content = compose_path.read_text(encoding="utf-8", errors="ignore") if compose_path else ""

    db_provider = infer_db_provider(pkg, compose_content, args.db_provider)
    dockerized = db_provider in DOCKER_DB_PROVIDERS
    if dockerized and not compose_path:
        fail("Dockerized DB provider detected but no compose file found. Provide --compose-file or set --db-provider sqlite/none.")

    db_service = detect_db_service_name(compose_content, args.db_service) if dockerized else ""

    resource_plan = ["app"]
    if dockerized:
        resource_plan.append("db")
    if db_tool_cmd:
        resource_plan.append("dbTool")

    port_keys = detect_port_keys(project_dir)

    compose_file_value = ""
    if compose_path:
        try:
            compose_file_value = str(compose_path.relative_to(project_dir))
        except ValueError:
            compose_file_value = str(compose_path)

    manifest: dict[str, Any] = {
        "version": 1,
        "packageManager": package_manager,
        "commands": {
            "install": install_command(package_manager),
            "dev": dev_cmd,
            "devWithPort": dev_with_port_cmd,
            "migrate": migrate_cmd,
            "seed": seed_cmd,
            "dbTool": db_tool_cmd,
        },
        "database": {
            "provider": db_provider,
            "dockerized": dockerized,
            "composeFile": compose_file_value,
            "serviceName": db_service,
        },
        "bakery": {
            "resourcePlan": resource_plan,
            "defaultNumResources": len(resource_plan),
        },
        "env": {
            "portKeys": port_keys,
        },
        "meta": {
            "repoSlug": slugify(project_dir.name),
        },
    }

    templates_dir = Path(__file__).resolve().parent.parent / "assets" / "templates"
    write_manifest(project_dir, manifest)
    write_script_from_template(project_dir, "setup.sh", templates_dir / "setup.sh")
    write_script_from_template(project_dir, "dev.sh", templates_dir / "dev.sh")

    print(f"[{SKILL_NAME}] Patch complete")
    print(f"- manifest: {project_dir / MANIFEST_FILE}")
    print(f"- setup.sh: {project_dir / 'setup.sh'}")
    print(f"- dev.sh: {project_dir / 'dev.sh'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
