#!/usr/bin/env python3
"""verify-real-e2e-contract — 真实 E2E 合同门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

守护演示诚实：stub/fixture 不得冒充真实登录/API。检查：
  - real-e2e-acceptance skill 必须含全部 9 个证据等级（label + machine label）
  - AGENTS.md 必须指向 skill，不得另持一份证据等级矩阵
  - architecture.md 的 Visual QA 视口必须是 1440x810（禁陈旧 1440x920）
  - smoke matrix 必须含 6 个 manifest 字段且 evidence_level 均在规范集合内

失败语义与 ps1 对齐：异常 → 非零退出 + stderr 信息。
"""

import argparse
import os
import re
import sys

SKILL_PATH = ".agents/skills/real-e2e-acceptance/SKILL.md"
RULES_PATH = "AGENTS.md"
ARCHITECTURE_PATH = "docs/architecture.md"
SMOKE_MATRIX_PATH = "scripts/smoke/verify-e2e-smoke-matrix.py"

# 与 ps1 的 [ordered] 字典一致（顺序即检查顺序）。
CANONICAL_LEVELS = [
    ("Fixture/unit", "fixture-unit"),
    ("Playwright UI E2E", "playwright-ui"),
    ("Visual QA", "visual-qa"),
    ("Stubbed Hub", "stubbed-hub"),
    ("Observed local", "observed-local"),
    ("Approved real", "approved-real"),
    ("Backend/API", "backend-api"),
    ("Performance/leak", "performance-leak"),
    ("Packaged release", "packaged-release"),
]

REQUIRED_SMOKE_FIELDS = [
    "evidence_level",
    "real_tested",
    "claim",
    "status",
    "skipped_evidence_levels",
    "planned_evidence_levels",
]

EVIDENCE_LEVEL_RE = re.compile(r'-EvidenceLevel\s+"([^"]+)"')


class ContractError(Exception):
    pass


def fail(message):
    raise ContractError(f"real E2E contract check failed: {message}")


def read_text(path):
    # 与 ps1 一致：相对路径基于当前工作目录解析。
    if not os.path.exists(path):
        fail(f"missing required file: {path}")
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return handle.read()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the real E2E acceptance contract across skill, AGENTS, architecture, roadmap, and smoke matrix.")
    parser.parse_args()

    skill_present = os.path.exists(SKILL_PATH)
    rules = read_text(RULES_PATH)
    architecture = read_text(ARCHITECTURE_PATH)
    smoke_matrix = read_text(SMOKE_MATRIX_PATH)

    if skill_present:
        skill = read_text(SKILL_PATH)
        for label, machine_label in CANONICAL_LEVELS:
            if not re.search(r"\|\s*" + re.escape(label) + r"\s*\|", skill, re.IGNORECASE):
                fail(f"canonical real-e2e skill is missing evidence level '{label}'")
            if not re.search(re.escape(f"`{machine_label}`"), skill, re.IGNORECASE):
                fail(f"canonical real-e2e skill is missing machine label '{machine_label}'")

        if not re.search(re.escape(SKILL_PATH), rules, re.IGNORECASE):
            fail("AGENTS.md must point to the real-e2e-acceptance skill instead of owning another matrix")
        if re.search(r"\|\s*Fixture/unit\s*\|", rules, re.IGNORECASE) or re.search(r"\|\s*Playwright UI\s*\|", rules, re.IGNORECASE):
            fail(f"AGENTS.md duplicates the evidence-level matrix; keep the table only in {SKILL_PATH}")
    else:
        print("real-e2e-acceptance skill absent (.agents removed) — skill matrix checks skipped")

    if re.search(r"1440x920", architecture, re.IGNORECASE):
        fail("architecture Visual QA still references stale 1440x920 viewport")
    if not re.search(r"1440x810", architecture, re.IGNORECASE):
        fail("architecture Visual QA must name the 16:9 1440x810 desktop viewport")

    for required in REQUIRED_SMOKE_FIELDS:
        if not re.search(re.escape(required), smoke_matrix, re.IGNORECASE):
            fail(f"smoke matrix is missing manifest field '{required}'")

    declared_evidence_levels = sorted({level for level in EVIDENCE_LEVEL_RE.findall(smoke_matrix)})
    allowed_evidence_levels = {machine_label for _, machine_label in CANONICAL_LEVELS}
    for level in declared_evidence_levels:
        if level not in allowed_evidence_levels:
            fail(f"smoke matrix declares non-canonical evidence_level '{level}'")

    print("real E2E contract ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 $ErrorActionPreference='Stop' 的 throw 语义
        print(str(exc), file=sys.stderr)
        sys.exit(1)
