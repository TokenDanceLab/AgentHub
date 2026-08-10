#!/usr/bin/env python3
r"""Domain SSOT verifier — asserts the desktop CSP connect-src domains, the
desktop HUB_URL default, and the production compose OIDC callback domain all
resolve to the same root domain.

Prevents the three-way conflict (CI7, 2026-08-10) where:
  - tauri.conf.json CSP connect-src pointed at *.vectorcontrol.tech
  - desktop config.ts HUB_URL defaulted to api.hub.vectorcontrol.tech
  - production compose OIDC callback used hub.tokendancelab.com

The authoritative domain is the production compose OIDC redirect URI default
(hub.tokendancelab.com → root tokendancelab.com). The desktop CSP connect-src
wildcard domains and the desktop HUB_URL default must all resolve under the
same root. Loopback/localhost entries in CSP are dev-only and excluded.

CLI: no args (paths resolved relative to the repo root). Exit 0 = PASS.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".."))


def fail(message: str) -> None:
    raise RuntimeError(f"Domain SSOT check failed: {message}")


def root_domain(host: str) -> str:
    """Return the last two labels of a host (hub.tokendancelab.com → tokendancelab.com)."""
    if not host:
        return ""
    labels = host.split(".")
    if len(labels) < 2:
        return host
    return ".".join(labels[-2:])


def extract_compose_callback_root() -> str:
    """Extract the root domain from the compose OIDC redirect URI default."""
    compose_path = os.path.join(REPO_ROOT, "deployments", "production", "docker-compose.yml")
    if not os.path.isfile(compose_path):
        fail(f"docker-compose.yml not found: {compose_path}")
    with open(compose_path, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    # Match: AGENTHUB_TOKENDANCE_ID_REDIRECT_URI: ${...:-https://hub.tokendancelab.com/...}
    match = re.search(
        r"AGENTHUB_TOKENDANCE_ID_REDIRECT_URI:\s*\$\{[^}]*?:-(https?://[^}\s,]+)",
        content,
    )
    if not match:
        fail("could not find AGENTHUB_TOKENDANCE_ID_REDIRECT_URI default URL in docker-compose.yml")
    host = urlparse(match.group(1)).hostname or ""
    root = root_domain(host)
    if not root:
        fail(f"could not derive root domain from compose redirect URI host {host!r}")
    return root


def extract_desktop_hub_url_root() -> str:
    """Extract the HUB_URL default root domain from config.ts."""
    config_path = os.path.join(REPO_ROOT, "app", "desktop", "src", "config.ts")
    if not os.path.isfile(config_path):
        fail(f"config.ts not found: {config_path}")
    with open(config_path, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    match = re.search(
        r"HUB_URL\s*=\s*envOrDev\(\s*'VITE_HUB_URL',\s*'([^']+)'\s*\)",
        content,
    )
    if not match:
        fail("could not find HUB_URL default in config.ts")
    host = urlparse(match.group(1)).hostname or ""
    root = root_domain(host)
    if not root:
        fail(f"could not derive root domain from HUB_URL host {host!r}")
    return root


def extract_csp_connect_src_wildcard_roots() -> list:
    """Extract root domains from https://*.X and wss://*.X patterns in the
    tauri CSP connect-src directive. Loopback/localhost entries are excluded
    (they are dev-only and not subject to the production domain SSOT)."""
    tauri_path = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "tauri.conf.json")
    if not os.path.isfile(tauri_path):
        fail(f"tauri.conf.json not found: {tauri_path}")
    with open(tauri_path, encoding="utf-8", errors="replace") as handle:
        tauri = json.load(handle)
    try:
        csp = tauri["app"]["security"]["csp"]
    except (KeyError, TypeError):
        fail("could not find app.security.csp in tauri.conf.json")
    connect_match = re.search(r"connect-src\s+([^;]+)", csp)
    if not connect_match:
        fail("could not find connect-src directive in tauri CSP")
    connect_src = connect_match.group(1)
    # Extract wildcard host patterns: https://*.X or wss://*.X
    wildcard_hosts = re.findall(r"(?:https|wss)://\*\.([^\s;]+)", connect_src)
    if not wildcard_hosts:
        fail("no https://*.X or wss://*.X wildcard domains found in connect-src")
    roots = []
    for host in wildcard_hosts:
        root = root_domain(host)
        if not root:
            fail(f"could not derive root domain from CSP wildcard host {host!r}")
        roots.append(root)
    return roots


def main() -> int:
    print("Domain SSOT verifier (CSP connect-src subset of compose callback == desktop default)")

    compose_root = extract_compose_callback_root()
    desktop_root = extract_desktop_hub_url_root()
    csp_roots = extract_csp_connect_src_wildcard_roots()

    print(f"  compose OIDC callback root : {compose_root}")
    print(f"  desktop HUB_URL default    : {desktop_root}")
    print(f"  CSP connect-src wildcard   : {', '.join(csp_roots)}")

    # Assertion 1: compose callback root == desktop HUB_URL default root.
    if compose_root != desktop_root:
        fail(
            f"compose callback root {compose_root!r} != desktop HUB_URL root {desktop_root!r}; "
            "the desktop default must point at the same root as the production OIDC callback"
        )

    # Assertion 2: every CSP connect-src wildcard domain is under the same
    # root (CSP domains ⊆ documented domain == desktop default domain).
    stray = [r for r in csp_roots if r != compose_root]
    if stray:
        fail(
            f"CSP connect-src wildcard roots {stray!r} not under the authoritative "
            f"root {compose_root!r}; CSP must not point at a divergent production domain"
        )

    print(f"Domain SSOT PASS — all desktop-facing domains resolve under {compose_root!r}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 — top-level guard, ps1 parity
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
