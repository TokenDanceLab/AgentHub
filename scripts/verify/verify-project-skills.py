#!/usr/bin/env python3
r"""Project skill whitelist gate — ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）。

`.agents/skills/` 下只允许提交 active 白名单 skill；每个 active skill 必须
带 SKILL.md 且在 .gitignore 中显式 unignore；归档 skill（ui-screenshot /
dev-team / dev-team-codex）不得复活为 active 目录，也不得被 unignore。
docs/history.md 必须指向外部归档路径 `archive/agenthub/repo/docs/archives/project-skills/`。

CLI 兼容：--SkillsRoot / --HistoryPath / --GitignorePath 参数与 ps1 同名同默认值
（相对 cwd），异常 → 非零退出 + stderr（对齐 $ErrorActionPreference='Stop'）。
"""

import argparse
import os
import re
import sys

ALLOWLIST = [
    "adapter-dev",
    "dev-loop",
    "env-sandbox",
    "integration-test",
    "pre-push",
    "real-e2e-acceptance",
    "test-coverage",
]

ARCHIVED_ONLY = [
    "ui-screenshot",
    "dev-team",
    "dev-team-codex",
]

HISTORY_ARCHIVE_MARKER = "archive/agenthub/repo/docs/archives/project-skills/"


def fail(message: str) -> None:
    raise RuntimeError(f"project skill whitelist check failed: {message}")


def normalize_set(items) -> list:
    return sorted({item for item in items if item})


def main() -> int:
    parser = argparse.ArgumentParser(description="Project skill whitelist gate")
    parser.add_argument("--SkillsRoot", default=".agents/skills")
    parser.add_argument("--HistoryPath", default="docs/history.md")
    parser.add_argument("--GitignorePath", default=".gitignore")
    args = parser.parse_args()

    skills_root = args.SkillsRoot
    if not os.path.isdir(skills_root):
        if not os.path.isdir(os.path.dirname(skills_root)):
            print("skills root absent (.agents removed) — whitelist gate trivially passes")
            return 0
        fail(f"skills root not found: {skills_root}")

    actual = normalize_set(name for name in os.listdir(skills_root) if os.path.isdir(os.path.join(skills_root, name)))
    expected = normalize_set(ALLOWLIST)

    unexpected = [skill for skill in actual if skill not in expected]
    missing = [skill for skill in expected if skill not in actual]

    if unexpected:
        fail("unexpected active skill(s): " + ", ".join(unexpected))

    if missing:
        fail("missing allowlisted skill(s): " + ", ".join(missing))

    for skill in ALLOWLIST:
        skill_file = os.path.join(skills_root, skill, "SKILL.md")
        if not os.path.isfile(skill_file):
            fail(f"allowlisted skill is missing SKILL.md: {skill}")

    for skill in ARCHIVED_ONLY:
        active_path = os.path.join(skills_root, skill)
        if os.path.exists(active_path):
            fail(f"archived skill is active again: {skill}")

    if not os.path.isfile(args.HistoryPath):
        fail(f"history index not found: {args.HistoryPath}")

    with open(args.HistoryPath, encoding="utf-8", errors="replace") as handle:
        history = handle.read()
    if HISTORY_ARCHIVE_MARKER not in history:
        fail("history index is missing external archived project-skills path")

    if not os.path.isfile(args.GitignorePath):
        fail(f"gitignore not found: {args.GitignorePath}")

    with open(args.GitignorePath, encoding="utf-8", errors="replace") as handle:
        gitignore = handle.read()

    for skill in ALLOWLIST:
        dir_pattern = re.escape(f"!.agents/skills/{skill}/")
        all_pattern = re.escape(f"!.agents/skills/{skill}/**")
        if not re.search(dir_pattern, gitignore, re.IGNORECASE) or not re.search(all_pattern, gitignore, re.IGNORECASE):
            fail(f"allowlisted skill is not explicitly unignored in .gitignore: {skill}")

    for skill in ARCHIVED_ONLY:
        dir_pattern = re.escape(f"!.agents/skills/{skill}/")
        all_pattern = re.escape(f"!.agents/skills/{skill}/**")
        if re.search(dir_pattern, gitignore, re.IGNORECASE) or re.search(all_pattern, gitignore, re.IGNORECASE):
            fail(f"archived skill is still unignored in .gitignore: {skill}")

    print("project skill whitelist ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
