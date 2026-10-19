#!/usr/bin/env python3
"""Fail-closed contract checks for the public remote-dev test runner."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = (ROOT / "scripts" / "dev" / "devserver.sh").read_text(encoding="utf-8")


def require(fragment: str, message: str) -> None:
    if fragment not in SCRIPT:
        raise SystemExit(message)


def forbid(fragment: str, message: str) -> None:
    if fragment in SCRIPT:
        raise SystemExit(message)


require('REMOTE="${AGENTHUB_DEVSERVER_SSH:-}"', "devserver SSH target must be explicit private configuration")
require("AGENTHUB_DEVSERVER_SSH_BIN", "devserver must keep SSH executable injectable")
require('REPO_ROOT="${AGENTHUB_DEVSERVER_ROOT:-}"', "devserver must require an explicit repo root")
forbid("ssh -o ConnectTimeout", "devserver contains a raw ssh invocation that bypasses SSH_BIN")
forbid('"server":', "public devserver reports must not expose remote host identity")
forbid("$(hostname)", "public devserver reports must not expose remote hostname")

print("devserver contract ok")
