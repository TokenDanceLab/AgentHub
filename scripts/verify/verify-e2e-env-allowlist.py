#!/usr/bin/env python3
"""verify-e2e-env-allowlist — real-e2e-stack ID 环境不透明化合同门禁（#1873 Slice B）。

守护公私分离（AGENTS §4 / §9）：public Actions 的 real-e2e-stack lane 不接受
任意 URL / 镜像。Fail-closed 文本合同检查 .github/workflows/checks.yml：

  - 禁止 workflow_dispatch 的任意 URL/镜像输入（id_base_url / id_image 的
    type: string 输入，以及 inputs.id_base_url / inputs.id_image 插值）。
  - ID 取得方式只允许预登记 opaque ID（choice 选项 source/image/local），
    不接受自由字符串，也不再接受 legacy id_mode。
  - real-e2e-stack 的 ID issuer / base url 必须 loopback-only（127.0.0.1 /
    localhost / ::1），且不允许从 workflow_dispatch 输入插值。
  - image 模式只允许固定 allowlist 镜像（ghcr.io/tokendancelab/tokendance-id），
    禁止把任意 registry/repo/tag 当作输入插值进 docker run。

失败语义：任何违反 → 非零退出 + stderr（对齐 ps1 throw）。

用法：
  python3 scripts/verify/verify-e2e-env-allowlist.py
  python3 scripts/verify/verify-e2e-env-allowlist.py --workflow <path>
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_WORKFLOW = os.path.join(ROOT, ".github", "workflows", "checks.yml")

# 只允许 loopback ID endpoint；真实 dev 服务器等私有环境不得以明文 URL 进公开 workflow。
LOOPBACK_BASE_URLS = {
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://[::1]:3000",
}

JOB_RE = re.compile(r"^  [A-Za-z0-9_-]+:$")


class ContractError(Exception):
    pass


def fail(message: str) -> None:
    raise ContractError(f"e2e env allowlist contract check failed: {message}")


def job_block(workflow: str, job_name: str) -> str:
    """Extract one top-level job's YAML block (from its 2-space key to the next job)."""
    lines = workflow.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line == "  " + job_name + ":":
            start = i
            break
    if start is None:
        fail(f"missing job '{job_name}'")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if JOB_RE.match(lines[i]):
            end = i
            break
    return "\n".join(lines[start:end])


def check(workflow: str) -> list:
    """Return the list of violations; empty means the workflow is compliant."""
    violations: list = []

    def require(fragment: str, message: str) -> None:
        if fragment not in workflow:
            violations.append(message)

    def forbid(fragment: str, message: str) -> None:
        if fragment in workflow:
            violations.append(message)

    # 不接受任意 URL / 镜像（input key + 插值 + legacy id_mode 一并封杀）。
    forbid("id_base_url:", "workflow_dispatch must not accept an arbitrary URL input (id_base_url)")
    forbid("id_image:", "workflow_dispatch must not accept an arbitrary image input (id_image)")
    forbid("id_mode:", "workflow_dispatch must use the opaque id_env choice, not the legacy id_mode input")
    forbid("inputs.id_base_url", "real-e2e-stack must not interpolate an arbitrary id_base_url")
    forbid("inputs.id_image", "real-e2e-stack must not interpolate an arbitrary id_image")
    forbid("inputs.id_mode", "real-e2e-stack must not interpolate the legacy id_mode")
    forbid("ID_BASE_URL: ${{ inputs.", "real-e2e-stack must not bind a base URL from a dispatch input")
    forbid("ID_IMAGE: ${{ inputs.", "real-e2e-stack must not bind an image from a dispatch input")
    forbid("$ID_BASE_URL", "real-e2e-stack must not consume a variable base URL")
    forbid("$ID_IMAGE", "real-e2e-stack must not consume a variable image")

    # 只接受预登记 opaque ID（choice），不接受自由字符串。
    require("id_env:", "workflow_dispatch must expose the opaque id_env input")
    require("options: [source, image, local]", "id_env must be a pre-registered choice (source/image/local)")
    require("ghcr.io/tokendancelab/tokendance-id:main", "image mode must use the fixed allowlist image")

    # real-e2e-stack 的 ID issuer / base url 必须 loopback-only，且不得从输入插值。
    lane = job_block(workflow, "real-e2e-stack")
    for line in lane.splitlines():
        stripped = line.strip()
        if stripped.startswith("AGENTHUB_TOKENDANCE_ID_ISSUER_URL:") or stripped.startswith("AGENTHUB_E2E_ID_BASE_URL:"):
            value = stripped.split(":", 1)[1].split("#", 1)[0].strip()
            if value not in LOOPBACK_BASE_URLS:
                violations.append(f"ID endpoint must resolve to loopback only, got {value!r}")

    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the real-e2e-stack ID environment allowlist contract.")
    parser.add_argument("--workflow", default=DEFAULT_WORKFLOW, help="path to .github/workflows/checks.yml")
    args = parser.parse_args()

    if not os.path.isfile(args.workflow):
        fail(f"workflow file not found: {args.workflow}")
    with open(args.workflow, encoding="utf-8-sig", errors="replace") as handle:
        workflow = handle.read()

    violations = check(workflow)
    if violations:
        for item in violations:
            print(item, file=sys.stderr)
        fail(f"{len(violations)} allowlist violation(s)")

    print("e2e env allowlist ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 throw
        print(str(exc), file=sys.stderr)
        sys.exit(1)
