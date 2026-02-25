#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

SKILL_NAME = "bakery-worktree-bootstrap"
DB_PROVIDERS = ("auto", "postgres", "mysql", "sqlite", "none")
DOCKER_DB_PROVIDERS = {"postgres", "mysql"}

DB_TOOL_CANDIDATES = ("db:studio", "studio", "prisma:studio", "drizzle:studio")

COMPOSE_CANDIDATES = (
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.worktree.yml",
)

USER_BLOCK_RE = re.compile(
    r"(# >>> BAKERY USER:(?P<name>[A-Z_]+) START\\n)(?P<body>.*?)(# <<< BAKERY USER:(?P=name) END)",
    re.DOTALL,
)


def fail(message: str) -> None:
    raise SystemExit(f"[{SKILL_NAME}] ERROR: {message}")


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


def detect_script_name(pkg: dict[str, Any], candidates: tuple[str, ...]) -> str:
    scripts = pkg.get("scripts") if isinstance(pkg.get("scripts"), dict) else {}
    for candidate in candidates:
        if candidate in scripts:
            return candidate
    return ""


def determine_db_tool_enabled(value: str | None, detected: bool) -> bool:
    if value is None:
        return detected
    stripped = value.strip()
    if not stripped or stripped.lower() == "none":
        return False
    return True


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


def compute_resource_plan(db_provider: str, db_tool_enabled: bool) -> list[str]:
    plan = ["app"]
    if db_provider in DOCKER_DB_PROVIDERS:
        plan.append("db")
    if db_tool_enabled:
        plan.append("dbTool")
    return plan


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


def render_setup_script(template: str, resource_plan: list[str]) -> str:
    resource_plan_csv = ",".join(resource_plan)
    expected_num_resources = str(len(resource_plan))
    rendered = template.replace("__BAKERY_RESOURCE_PLAN_CSV__", resource_plan_csv)
    rendered = rendered.replace("__BAKERY_EXPECTED_NUM_RESOURCES__", expected_num_resources)
    return rendered


def write_setup_script(project_dir: Path, template_path: Path, resource_plan: list[str]) -> None:
    destination = project_dir / "setup.sh"
    template = template_path.read_text(encoding="utf-8")
    rendered = render_setup_script(template, resource_plan)
    existing = destination.read_text(encoding="utf-8") if destination.exists() else None
    merged = merge_user_blocks(rendered, existing)
    destination.write_text(merged, encoding="utf-8")
    os.chmod(destination, 0o755)


def print_deprecation_warnings(args: argparse.Namespace) -> None:
    deprecated_fields = (
        "package_manager",
        "dev_cmd",
        "db_service",
        "migrate_cmd",
        "seed_cmd",
    )
    provided: list[str] = []
    for field in deprecated_fields:
        value = getattr(args, field, None)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        provided.append(f"--{field.replace('_', '-')}")
    if not provided:
        return

    joined = ", ".join(provided)
    print(f"[{SKILL_NAME}] WARN: Ignoring deprecated options for setup-only scaffolding: {joined}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Patch a Node repo for Bakery setup-only worktree scaffolding.")
    parser.add_argument("--target", default=".", help="Target repository path")
    parser.add_argument("--db-provider", choices=DB_PROVIDERS, default="auto")
    parser.add_argument("--compose-file", help="Compose file path")
    parser.add_argument("--db-tool-cmd", help="Explicit DB tool command; pass 'none' to disable")
    parser.add_argument("--package-manager", help="(deprecated) Ignored in setup-only mode")
    parser.add_argument("--dev-cmd", help="(deprecated) Ignored in setup-only mode")
    parser.add_argument("--db-service", help="(deprecated) Ignored in setup-only mode")
    parser.add_argument("--migrate-cmd", help="(deprecated) Ignored in setup-only mode")
    parser.add_argument("--seed-cmd", help="(deprecated) Ignored in setup-only mode")
    args = parser.parse_args(argv)

    print_deprecation_warnings(args)

    project_dir = Path(args.target).resolve()
    if not project_dir.exists() or not project_dir.is_dir():
        fail(f"Target directory does not exist: {project_dir}")

    pkg = load_package_json(project_dir)
    detected_db_tool_script = detect_script_name(pkg, DB_TOOL_CANDIDATES)
    db_tool_enabled = determine_db_tool_enabled(args.db_tool_cmd, bool(detected_db_tool_script))

    compose_path = detect_compose_file(project_dir, args.compose_file)
    compose_content = compose_path.read_text(encoding="utf-8", errors="ignore") if compose_path else ""

    db_provider = infer_db_provider(pkg, compose_content, args.db_provider)
    resource_plan = compute_resource_plan(db_provider, db_tool_enabled)

    templates_dir = Path(__file__).resolve().parent.parent / "assets" / "templates"
    write_setup_script(project_dir, templates_dir / "setup.sh", resource_plan)

    print(f"[{SKILL_NAME}] Patch complete")
    print("- mode: setup-only scaffolding")
    print(f"- db provider: {db_provider}")
    print(f"- frozen resource roles: {','.join(resource_plan)}")
    print(f"- setup.sh: {project_dir / 'setup.sh'}")
    print("- managed outputs: setup.sh only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
