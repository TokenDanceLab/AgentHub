#!/usr/bin/env python3
"""Deployment shape SSOT verifier.

`deployments/production/docker-compose.yml` is the single production compose
shape. It must declare hub-server + redis, and hub-server must use the product
image (`ghcr.io/tokendancelab/agenthub-hub-server`). No other compose file may
exist under `deployments/production/` or `hub-server/deployments/`.
"""

import argparse
import os
import re
import sys

import yaml

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
AUTHORITATIVE = "deployments/production/docker-compose.yml"
COMPOSE_NAME = re.compile(r"(?:docker-)?compose(?:\.[\w-]+)*\.ya?ml$", re.IGNORECASE)
EXPECTED_SERVICES = ("hub-server", "redis")
IMAGE_SSOT_PREFIX = "ghcr.io/tokendancelab/agenthub-hub-server"


def compose_files(directory: str) -> list:
    found = []
    for dirpath, _dirnames, filenames in os.walk(directory):
        found.extend(os.path.join(dirpath, name) for name in filenames if COMPOSE_NAME.fullmatch(name))
    return sorted(found)


def load_services(repo_root: str, errors: list) -> dict:
    target = os.path.join(repo_root, AUTHORITATIVE.replace("/", os.sep))
    try:
        with open(target, encoding="utf-8") as handle:
            compose = yaml.safe_load(handle)
    except (OSError, yaml.YAMLError) as exc:
        errors.append(f"authoritative template could not be read: {AUTHORITATIVE} ({exc})")
        return {}
    services = compose.get("services") if isinstance(compose, dict) else None
    if not isinstance(services, dict) or not services:
        errors.append(f"authoritative template has no services mapping: {AUTHORITATIVE}")
        return {}
    return services


def main() -> int:
    parser = argparse.ArgumentParser(description="Deployment shape SSOT verifier")
    parser.add_argument("--RepoRootPath", default=os.path.join(SCRIPT_DIR, "..", ".."))
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRootPath)
    errors = []
    print(f"Deployment shape SSOT verifier (repo: {repo_root})")

    services = load_services(repo_root, errors)
    for expected in EXPECTED_SERVICES:
        if expected not in services:
            errors.append(f"authoritative template missing service '{expected}'")
    if not errors:
        print(f"  PASS  authoritative template declares {', '.join(EXPECTED_SERVICES)}")

    image = str((services.get("hub-server") or {}).get("image") or "").strip()
    if not image:
        errors.append("hub-server service must declare an image from the product SSOT")
    elif not image.startswith(IMAGE_SSOT_PREFIX):
        errors.append(f"hub-server image is off SSOT: '{image}' (want prefix '{IMAGE_SSOT_PREFIX}')")
    else:
        print(f"  PASS  hub-server image on SSOT: {image}")

    production_dir = os.path.dirname(os.path.join(repo_root, AUTHORITATIVE.replace("/", os.sep)))
    authoritative = os.path.join(production_dir, "docker-compose.yml")
    extras = [
        path
        for path in compose_files(production_dir)
        if os.path.normcase(path) != os.path.normcase(authoritative)
    ] if os.path.isdir(production_dir) else []
    if extras:
        found = ", ".join(os.path.relpath(path, repo_root).replace("\\", "/") for path in extras)
        errors.append(f"second hand-maintained production compose detected: {found}")
    else:
        print("  PASS  no second production compose under deployments/production/")

    legacy = compose_files(os.path.join(repo_root, "hub-server", "deployments"))
    if legacy:
        found = ", ".join(os.path.relpath(path, repo_root).replace("\\", "/") for path in legacy)
        errors.append(f"legacy compose inventory closed: compose files must not appear under hub-server/deployments/ (found: {found})")
    else:
        print("  PASS  legacy compose inventory closed (no compose files under hub-server/deployments/)")

    if errors:
        for error in errors:
            print(f"  FAIL  {error}")
        print(f"Deployment shape verifier FAILED ({len(errors)} issue(s)).")
        return 1
    print("Deployment shape verifier PASS.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - fail closed
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
