#!/usr/bin/env python3
"""Deployment shape SSOT verifier.

Enforces that `deployments/production/docker-compose.yml` is the single
in-repo production compose shape:

1. The authoritative template must exist and declare the expected services
   (hub-server + redis) in the shape the indentation parser below reads.
2. The hub-server image must stay on the product image SSOT
   (`ghcr.io/tokendancelab/agenthub-hub-server`); `agenthub-hub` is a
   rejected second image name.
3. No second hand-maintained production compose may appear under
   `deployments/production/`.
4. Any compose file under `hub-server/deployments/**` must FAIL; that
   directory holds build inputs only (Dockerfile, docker-entrypoint.sh,
   README.md).

This verifier never reads secrets; it only inspects file shapes. Stdlib only:
services/image/build shapes are extracted with a small indentation parser
covering the production compose and its fixtures.

CLI: --RepoRootPath defaults to two levels above the script; exit 0=PASS / 1=FAIL.
"""

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

AUTHORITATIVE_RELATIVE = "deployments/production/docker-compose.yml"
COMPOSE_NAME = re.compile(r"(?:docker-)?compose(?:\.[\w-]+)*\.ya?ml", re.IGNORECASE)
EXPECTED_SERVICES = ["hub-server", "redis"]
IMAGE_SSOT_PREFIX = "ghcr.io/tokendancelab/agenthub-hub-server"

failed = 0


def fail_verifier(message: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {message}")


def pass_verifier(message: str) -> None:
    print(f"  PASS  {message}")


def strip_comment(line: str) -> str:
    # 只去掉引号外的 # 注释
    in_single = False
    in_double = False
    for index, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            return line[:index]
    return line


def tokenize(text: str) -> list:
    """返回 [(indent, content)]，去掉空行/注释，折叠 block scalar。"""
    tokens = []
    raw_lines = text.splitlines()
    index = 0
    while index < len(raw_lines):
        raw = strip_comment(raw_lines[index])
        if not raw.strip():
            index += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        content = raw.strip()
        if content.endswith((">", "|", ">-", ">+", "|-", "|+")):
            # block scalar：后续缩进行折叠进占位值，本解析只关心键结构
            index += 1
            while index < len(raw_lines) and raw_lines[index].strip() and len(raw_lines[index]) - len(raw_lines[index].lstrip(" ")) > indent:
                index += 1
            tokens.append((indent, "block-scalar-placeholder"))
            continue
        tokens.append((indent, content))
        index += 1
    return tokens


def strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def extract_compose_shape(text: str) -> dict:
    """只抽取本 verifier 消费的形状：services -> {name: {image, build}}。"""
    tokens = tokenize(text)
    services = {}
    for index, (indent, content) in enumerate(tokens):
        if indent != 0 or not content.endswith(":"):
            continue
        key = content.rstrip(":").strip()
        if key != "services":
            continue
        cursor = index + 1
        while cursor < len(tokens) and tokens[cursor][0] == 2:
            svc_indent, svc_line = tokens[cursor]
            svc_name, sep, rest = svc_line.partition(":")
            if not sep or rest.strip():
                cursor += 1
                continue
            svc_name = svc_name.strip()
            info = {"image": "", "build": False}
            inner = cursor + 1
            while inner < len(tokens):
                inner_indent = tokens[inner][0]
                if inner_indent < 4:
                    break
                if inner_indent > 4:
                    # 服务体嵌套内容（ports/healthcheck/environment 等）不消费
                    inner += 1
                    continue
                key_name, _, key_value = tokens[inner][1].partition(":")
                key_name = key_name.strip()
                if key_name == "image":
                    info["image"] = strip_quotes(key_value.strip())
                elif key_name == "build":
                    info["build"] = True
                inner += 1
            services[svc_name] = info
            cursor = inner
        break
    return services


def extract_compose_shape_or_fail(repo_root: str, relative: str, fail_verifier_fn) -> dict | None:
    authoritative_path = os.path.join(repo_root, relative.replace("/", os.sep))
    try:
        with open(authoritative_path, encoding="utf-8", errors="replace") as handle:
            shape = extract_compose_shape(handle.read())
    except Exception:
        fail_verifier_fn(f"authoritative template could not be read or shape-extracted: {relative}")
        return None
    return shape


def main() -> int:
    parser = argparse.ArgumentParser(description="Deployment shape SSOT verifier")
    parser.add_argument("--RepoRootPath", default=os.path.join(SCRIPT_DIR, "..", ".."))
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRootPath)
    print(f"Deployment shape SSOT verifier (repo: {repo_root})")

    authoritative_path = os.path.join(repo_root, AUTHORITATIVE_RELATIVE.replace("/", os.sep))
    production_dir = os.path.dirname(authoritative_path)
    legacy_deploy_dir = os.path.join(repo_root, "hub-server", "deployments")

    shape = extract_compose_shape_or_fail(repo_root, AUTHORITATIVE_RELATIVE, fail_verifier)
    if shape is None:
        return 1

    # ── 1. Expected services ───────────────────────────────────────────────
    for expected in EXPECTED_SERVICES:
        if expected not in shape:
            fail_verifier(f"authoritative template missing service '{expected}'")
    if failed == 0:
        pass_verifier(f"authoritative template declares expected services ({', '.join(EXPECTED_SERVICES)})")

    # ── 2. hub-server image SSOT ───────────────────────────────────────────
    image = shape.get("hub-server", {}).get("image", "")
    if not image:
        fail_verifier("hub-server service must declare an image from the product SSOT")
    if re.search(r"agenthub-hub\b", image) and "agenthub-hub-server" not in image:
        fail_verifier(f"hub-server image reintroduces rejected name 'agenthub-hub': {image}")
    if image and not image.startswith(IMAGE_SSOT_PREFIX):
        fail_verifier(f"hub-server image is off SSOT: '{image}' (want prefix '{IMAGE_SSOT_PREFIX}')")
    if failed == 0:
        pass_verifier(f"hub-server image on SSOT: {image}")

    # ── 3. No second hand-maintained production compose ────────────────────
    production_composes = []
    if os.path.isdir(production_dir):
        for dirpath, _, filenames in os.walk(production_dir):
            for name in sorted(filenames):
                if COMPOSE_NAME.fullmatch(name):
                    production_composes.append(os.path.join(dirpath, name))
    authoritative = os.path.join(production_dir, "docker-compose.yml")
    extras = [path for path in production_composes if os.path.normcase(path) != os.path.normcase(authoritative)]
    if extras:
        found = ", ".join(os.path.relpath(path, repo_root).replace("\\", "/") for path in sorted(extras))
        fail_verifier(f"second hand-maintained production compose detected under deployments/production/: {found} (adding one must FAIL)")
    else:
        pass_verifier("no second production compose under deployments/production/")

    # ── 4. Legacy compose inventory closed ───────────────────────────────
    legacy_composes = []
    if os.path.isdir(legacy_deploy_dir):
        for dirpath, _, filenames in os.walk(legacy_deploy_dir):
            for name in sorted(filenames):
                if COMPOSE_NAME.fullmatch(name):
                    legacy_composes.append(os.path.join(dirpath, name))
    if legacy_composes:
        found = ", ".join(os.path.relpath(path, repo_root).replace("\\", "/") for path in sorted(legacy_composes))
        fail_verifier(f"legacy compose inventory closed: compose files must not appear under hub-server/deployments/ (found: {found})")
    else:
        pass_verifier("legacy compose inventory closed (no compose files under hub-server/deployments/)")

    if failed > 0:
        print(f"Deployment shape verifier FAILED ({failed} issue(s)).")
        return 1
    print("Deployment shape verifier PASS.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— fail closed：未捕获异常返回非零
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
