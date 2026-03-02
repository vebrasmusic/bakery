#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

SKILL_NAME = "bakery-worktree-bootstrap"
COMPOSE_CANDIDATES = (
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.worktree.yml",
)

RESOURCE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")
COMPOSE_KEY_PATTERN = re.compile(r"^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(?:#.*)?$")


def fail(message: str) -> None:
    raise SystemExit(f"[{SKILL_NAME}] ERROR: {message}")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


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


def extract_compose_services(compose_content: str) -> list[str]:
    lines = compose_content.splitlines()
    services_indent: int | None = None
    service_item_indent: int | None = None
    services: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if services_indent is None:
            match = COMPOSE_KEY_PATTERN.match(line)
            if not match:
                continue
            key = match.group(2)
            if key != "services":
                continue
            services_indent = len(match.group(1))
            continue

        indent = len(line) - len(line.lstrip(" "))
        if indent <= services_indent:
            break

        match = COMPOSE_KEY_PATTERN.match(line)
        if not match:
            continue

        key_indent = len(match.group(1))
        key = match.group(2)
        if service_item_indent is None:
            service_item_indent = key_indent

        if key_indent == service_item_indent and key not in services:
            services.append(key)

    return services


def parse_resources_csv(raw_value: str) -> list[str]:
    resources: list[str] = []
    seen: set[str] = set()

    for token in raw_value.split(","):
        resource = token.strip()
        if not resource:
            continue
        if not RESOURCE_NAME_PATTERN.match(resource):
            fail(
                "Invalid resource name "
                f"'{resource}'. Use only letters, numbers, '.', '_' or '-'."
            )
        if resource in seen:
            fail(f"Duplicate resource name: {resource}")
        resources.append(resource)
        seen.add(resource)

    if not resources:
        fail("--resources must include at least one resource name")

    return resources


def parse_package_json_dependencies(path: Path) -> set[str]:
    if not path.exists():
        return set()

    try:
        payload = json.loads(read_text(path))
    except json.JSONDecodeError:
        return set()

    if not isinstance(payload, dict):
        return set()

    deps: set[str] = set()
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        maybe_obj = payload.get(key)
        if isinstance(maybe_obj, dict):
            for dep in maybe_obj.keys():
                deps.add(str(dep).lower())

    return deps


def file_contains_any(path: Path, needles: tuple[str, ...]) -> bool:
    if not path.exists() or not path.is_file():
        return False
    haystack = read_text(path).lower()
    return any(needle in haystack for needle in needles)


def detect_resources_from_repo(project_dir: Path) -> tuple[list[str], list[str]]:
    evidence: list[str] = []

    frontend = False
    backend = False
    db = False

    next_configs = (
        "next.config.js",
        "next.config.ts",
        "next.config.mjs",
        "next.config.cjs",
    )
    if any((project_dir / name).exists() for name in next_configs):
        frontend = True
        evidence.append("Found Next.js config file.")

    deps = parse_package_json_dependencies(project_dir / "package.json")
    if "next" in deps:
        frontend = True
        evidence.append("Detected 'next' dependency in package.json.")
    if "react" in deps and "next" not in deps and "vite" in deps:
        frontend = True
        evidence.append("Detected frontend stack indicators ('react' + 'vite') in package.json.")

    frontend_dirs = (
        "frontend",
        "client",
        "web",
        "apps/web",
        "packages/web",
    )
    if any((project_dir / rel).exists() for rel in frontend_dirs):
        frontend = True
        evidence.append("Found frontend-oriented directory (frontend/client/web/apps-web).")

    backend_dirs = (
        "backend",
        "api",
        "server",
        "apps/api",
        "packages/api",
    )
    if any((project_dir / rel).exists() for rel in backend_dirs):
        backend = True
        evidence.append("Found backend-oriented directory (backend/api/server/apps-api).")

    if (project_dir / "go.mod").exists() or (project_dir / "manage.py").exists():
        backend = True
        evidence.append("Found backend runtime marker (go.mod or manage.py).")

    fastapi_files = (
        project_dir / "pyproject.toml",
        project_dir / "requirements.txt",
        project_dir / "requirements-dev.txt",
        project_dir / "main.py",
        project_dir / "app.py",
        project_dir / "backend/main.py",
        project_dir / "backend/app.py",
    )
    if any(file_contains_any(path, ("fastapi",)) for path in fastapi_files):
        backend = True
        evidence.append("Detected FastAPI marker in Python project files.")

    db_marker_files = (
        "alembic.ini",
        "prisma/schema.prisma",
        "drizzle.config.ts",
        "drizzle.config.js",
        "drizzle.config.mts",
        "drizzle.config.cts",
    )
    if any((project_dir / rel).exists() for rel in db_marker_files):
        db = True
        evidence.append("Found DB tooling file (alembic/prisma/drizzle).")

    if (project_dir / "migrations").exists() or (project_dir / "prisma").exists():
        db = True
        evidence.append("Found migrations/prisma directory.")

    env_candidates = (
        project_dir / ".env",
        project_dir / ".env.example",
        project_dir / ".env.local",
    )
    if any(file_contains_any(path, ("database_url", "postgres", "mysql", "mariadb")) for path in env_candidates):
        db = True
        evidence.append("Detected DB connection marker in env file.")

    resources: list[str] = []
    if frontend:
        resources.append("frontend")
    if backend:
        resources.append("backend")
    if not resources:
        resources.append("app")
        evidence.append("No strong frontend/backend indicators found; defaulting to 'app'.")
    if db:
        resources.append("db")

    return resources, evidence


def discover_resources(project_dir: Path, explicit_compose_file: str | None) -> dict[str, object]:
    compose_path = detect_compose_file(project_dir, explicit_compose_file)
    evidence: list[str] = []

    if compose_path is not None:
        compose_content = read_text(compose_path)
        services = extract_compose_services(compose_content)
        if services:
            evidence.append(f"Detected compose file: {compose_path}")
            evidence.append(f"Compose services (in file order): {', '.join(services)}")
            return {
                "source": "compose",
                "compose_file": str(compose_path),
                "resources": services,
                "evidence": evidence,
            }

        evidence.append(
            f"Compose file was found ({compose_path}) but services could not be parsed; falling back to repo heuristics."
        )

    fallback_resources, fallback_evidence = detect_resources_from_repo(project_dir)
    evidence.extend(fallback_evidence)
    return {
        "source": "heuristic",
        "compose_file": str(compose_path) if compose_path else None,
        "resources": fallback_resources,
        "evidence": evidence,
    }


def render_bootstrap_script(template: str, resource_plan: list[str]) -> str:
    resource_plan_csv = ",".join(resource_plan)
    expected_num_resources = str(len(resource_plan))
    rendered = template.replace("__BAKERY_RESOURCE_PLAN_CSV__", resource_plan_csv)
    rendered = rendered.replace("__BAKERY_EXPECTED_NUM_RESOURCES__", expected_num_resources)
    return rendered


def write_bootstrap_script(project_dir: Path, template_path: Path, resource_plan: list[str]) -> Path:
    destination = project_dir / "bootstrap-bakery.sh"
    template = template_path.read_text(encoding="utf-8")
    rendered = render_bootstrap_script(template, resource_plan)
    destination.write_text(rendered, encoding="utf-8")
    os.chmod(destination, 0o755)
    return destination


def print_deprecation_warnings(args: argparse.Namespace) -> None:
    deprecated_fields = (
        "db_provider",
        "db_tool_cmd",
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
    print(f"[{SKILL_NAME}] WARN: Ignoring deprecated options for stack-agnostic bootstrap scaffolding: {joined}")


def print_detect_output(output_format: str, payload: dict[str, object]) -> None:
    if output_format == "json":
        print(json.dumps(payload, indent=2))
        return

    resources = payload["resources"]
    evidence = payload["evidence"]
    source = payload["source"]
    compose_file = payload.get("compose_file")

    print(f"[{SKILL_NAME}] Resource detection")
    print(f"- source: {source}")
    if compose_file:
        print(f"- compose file: {compose_file}")
    print(f"- proposed resources ({len(resources)}): {', '.join(resources)}")
    if evidence:
        print("- evidence:")
        for line in evidence:
            print(f"  - {line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Patch a repository for Bakery bootstrap-only worktree scaffolding with "
            "stack-agnostic resource discovery."
        )
    )
    parser.add_argument("--target", default=".", help="Target repository path")
    parser.add_argument("--compose-file", help="Compose file path override for detection")
    parser.add_argument("--resources", help="Comma-separated resource list to freeze")
    parser.add_argument("--detect-only", action="store_true", help="Only detect and print proposed resources")
    parser.add_argument("--output-format", choices=("text", "json"), default="text", help="Detection output format")

    parser.add_argument("--db-provider", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--db-tool-cmd", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--package-manager", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--dev-cmd", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--db-service", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--migrate-cmd", help="(deprecated) Ignored in stack-agnostic mode")
    parser.add_argument("--seed-cmd", help="(deprecated) Ignored in stack-agnostic mode")
    args = parser.parse_args(argv)

    print_deprecation_warnings(args)

    project_dir = Path(args.target).resolve()
    if not project_dir.exists() or not project_dir.is_dir():
        fail(f"Target directory does not exist: {project_dir}")

    detection = discover_resources(project_dir, args.compose_file)
    detected_resources = list(detection["resources"])

    if args.resources:
        confirmed_resources = parse_resources_csv(args.resources)
        detection["resources"] = confirmed_resources
        detection["source"] = "user"
        detection_evidence = list(detection["evidence"])
        detection_evidence.append("Resources overridden via --resources.")
        detection["evidence"] = detection_evidence

    if args.detect_only:
        print_detect_output(args.output_format, detection)
        return 0

    resource_plan = list(detection["resources"])
    if not resource_plan:
        fail("No resources were detected. Pass --resources explicitly.")

    templates_dir = Path(__file__).resolve().parent.parent / "assets" / "templates"
    bootstrap_script_path = write_bootstrap_script(project_dir, templates_dir / "bootstrap-bakery.sh", resource_plan)

    print(f"[{SKILL_NAME}] Patch complete")
    print("- mode: bootstrap-only scaffolding")
    print(f"- detection source: {detection['source']}")
    if detection.get("compose_file"):
        print(f"- compose file: {detection['compose_file']}")
    print(f"- detected resources: {','.join(detected_resources)}")
    print(f"- frozen resources: {','.join(resource_plan)}")
    print(f"- expected --numresources: {len(resource_plan)}")
    print(f"- bootstrap-bakery.sh: {bootstrap_script_path}")
    print("- managed outputs: bootstrap-bakery.sh only")
    print("- handoff: run ./bootstrap-bakery.sh, then run your repo-owned setup/dev script")
    if (project_dir / "setup.sh").exists():
        print("- note: setup.sh is repo-owned and not managed by this skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
