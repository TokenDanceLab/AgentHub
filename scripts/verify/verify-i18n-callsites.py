#!/usr/bin/env python3
"""Ratchet CJK string-literal debt per shared/workbench production file.

Only each file's allowed line count is persisted. Sample lines and totals are
re-derived on every scan. New violating files start with a zero budget.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCAN_ROOTS = (
    ("shared", REPO_ROOT / "app/shared/src"),
    ("workbench", REPO_ROOT / "app/workbench/src"),
)
BASELINE_FILE = REPO_ROOT / "scripts/verify/i18n-callsite-baseline.json"
POLICY_CODE = "I18N-CALLSITE-RATCHET"
CJK = re.compile(
    r"[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf"
    r"\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]"
)
DICTIONARIES = {
    "shared/chatview/i18n/resources.ts",
    "shared/i18n/workbench.ts",
    "shared/i18n/index.ts",
}
NON_PRODUCTION_SUFFIXES = (
    ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx",
    ".stories.ts", ".stories.tsx",
)
TEST_SUPPORT_FILES = {
    "workbench/workbenchTestFixtures.ts",
    "workbench/workbenchTestMocks.ts",
}


def excluded(path: str) -> bool:
    return (
        path in DICTIONARIES
        or path in TEST_SUPPORT_FILES
        or "/__tests__/" in f"/{path}"
        or path.endswith(NON_PRODUCTION_SUFFIXES)
    )


def cjk_literal_lines(text: str) -> list[int]:
    """Ignore comments and return lines with CJK inside TS string literals."""
    hits: set[int] = set()
    state, quote, line, i = "code", "", 1, 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                state, i = "line_comment", i + 2
                continue
            if ch == "/" and nxt == "*":
                state, i = "block_comment", i + 2
                continue
            if ch in "'\"`":
                state, quote, i = "string", ch, i + 1
                continue
        elif state == "line_comment":
            if ch == "\n":
                state = "code"
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                state, i = "code", i + 2
                continue
        else:
            if ch == "\\":
                if nxt == "\n":
                    line += 1
                elif nxt and CJK.match(nxt):
                    hits.add(line)
                i += 2
                continue
            if ch == quote:
                state, quote, i = "code", "", i + 1
                continue
            if CJK.match(ch):
                hits.add(line)
        if ch == "\n":
            line += 1
        i += 1
    return sorted(hits)


def scan() -> dict[str, list[int]]:
    found: dict[str, list[int]] = {}
    for package, root in SCAN_ROOTS:
        if not root.is_dir():
            continue
        for source in sorted(root.rglob("*")):
            if not source.is_file() or source.suffix not in {".ts", ".tsx"}:
                continue
            rel = f"{package}/{source.relative_to(root).as_posix()}"
            if excluded(rel):
                continue
            lines = cjk_literal_lines(source.read_text(encoding="utf-8", errors="replace"))
            if lines:
                found[rel] = lines
    return found


def load_budgets() -> dict[str, int] | None:
    try:
        payload = json.loads(BASELINE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    raw = payload.get("budgets") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        return None
    if any(not isinstance(path, str) or not isinstance(count, int) or count < 0 for path, count in raw.items()):
        return None
    return dict(raw)


def write_budgets(found: dict[str, list[int]]) -> None:
    payload = {
        "_comment": "Per-file production CJK literal budget; each value may only stay or decrease. New files start at zero.",
        "budgets": {path: len(lines) for path, lines in sorted(found.items())},
    }
    BASELINE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="Replace budgets with the current scan intentionally.")
    args = parser.parse_args(argv)
    found = scan()
    current_lines = sum(map(len, found.values()))
    if args.update:
        write_budgets(found)
        print(f"[i18n-callsites] baseline rewritten: {len(found)} files / {current_lines} CJK literal lines")
        return 0

    budgets = load_budgets()
    if budgets is None:
        print(f"[{POLICY_CODE}] FAIL: baseline missing or invalid; run --update intentionally first", file=sys.stderr)
        return 2
    print(f"[i18n-callsites] baseline  : {len(budgets)} files / {sum(budgets.values())} CJK literal lines")
    print(f"[i18n-callsites] current   : {len(found)} files / {current_lines} CJK literal lines")
    regressions = [(path, lines, budgets.get(path, 0)) for path, lines in found.items() if len(lines) > budgets.get(path, 0)]
    if regressions:
        print(f"[{POLICY_CODE}] FAIL: per-file CJK literal debt increased:", file=sys.stderr)
        for path, lines, allowed in regressions:
            print(f"  {path}: {len(lines)} > {allowed} (sample lines: {','.join(map(str, lines[:5]))})", file=sys.stderr)
        return 1
    print("[i18n-callsites] PASS: every file is at or below its baseline debt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
