#!/usr/bin/env python3
r"""Action runtime deprecation gate (#1580) — ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）。

Prevents re-introducing JavaScript action majors that run on the deprecated
Node.js 20 runtime into any live workflow under `.github/workflows/`.

Policy: every `uses: owner/name@ref` in a workflow is matched against an
allow-list of (action, permitted version prefixes). A reference outside the
permitted set FAILS closed. The gate is intentionally conservative; unknown
third-party actions must be audited and registered before use.

CLI 兼容：--WorkflowsRoot 默认指向脚本同级的 `..\..\.github\workflows`，
输出行格式与 ps1 一致，退出码 0=PASS / 1=FAIL。
"""

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# action -> allowed version prefixes (exact string match on the @ref)
ALLOWED_ACTIONS = {
    "actions/cache": ["v5", "v6", "v7"],
    "actions/checkout": ["v5", "v6", "v7"],
    "actions/setup-node": ["v5", "v6", "v7"],
    "actions/setup-go": ["v6", "v7"],
    "actions/upload-artifact": ["v5", "v6", "v7"],
    "actions/download-artifact": ["v5", "v6", "v7", "v8"],
    "dorny/paths-filter": ["v4"],
    "pnpm/action-setup": ["v5", "v6"],
    "golangci/golangci-lint-action": ["v9"],
    "docker/build-push-action": ["v7"],
    "docker/login-action": ["v4"],
    "docker/metadata-action": ["v6"],
    "docker/setup-buildx-action": ["v4"],
    "softprops/action-gh-release": ["v3"],
    # composite actions have no JS runtime; @stable is a moving tag
    "dtolnay/rust-toolchain": ["stable"],
}

USES_REFERENCE = re.compile(r"uses:\s*([^\s]+)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Action runtime deprecation gate (#1580)")
    parser.add_argument(
        "--WorkflowsRoot",
        default=os.path.join(SCRIPT_DIR, "..", "..", ".github", "workflows"),
        help="directory containing workflow *.yml files",
    )
    args = parser.parse_args()
    workflows_root = args.WorkflowsRoot

    allowed_flat = [
        f"{action}@{prefix}"
        for action in ALLOWED_ACTIONS
        for prefix in ALLOWED_ACTIONS[action]
    ]

    failed = 0

    def fail_verifier(message: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {message}")

    print(f"Action runtime deprecation gate (workflows: {workflows_root})")

    if not os.path.isdir(workflows_root):
        workflow_files = []
    else:
        workflow_files = sorted(
            name for name in os.listdir(workflows_root)
            if name.endswith(".yml") and os.path.isfile(os.path.join(workflows_root, name))
        )
    if not workflow_files:
        fail_verifier(f"no workflow files found under {workflows_root}")
        return 1

    seen = set()
    for wf_name in workflow_files:
        with open(os.path.join(workflows_root, wf_name), encoding="utf-8", errors="replace") as handle:
            content = handle.read()
        for match in USES_REFERENCE.finditer(content):
            ref = match.group(1).strip()
            if ref in seen:
                continue
            seen.add(ref)

            at = ref.find("@")
            if at <= 0:
                fail_verifier(f"{wf_name}: unversioned action reference '{ref}' (must pin a registered major)")
                continue
            action = ref[:at]
            version = ref[at + 1:]
            candidate = f"{action}@{version}"
            if candidate not in allowed_flat:
                fail_verifier(f"{wf_name}: action '{ref}' is not on the node24 allow-list (register after confirming runtime)")

    for wf_name in workflow_files:
        print(f"  checked  {wf_name}")

    if failed > 0:
        print(f"Action runtime gate FAILED ({failed} issue(s)).")
        return 1
    print("Action runtime gate PASS — all action references are on the node24 allow-list.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
