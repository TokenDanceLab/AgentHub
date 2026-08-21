#!/usr/bin/env python3
"""verify-i18n-callsites.py — guard against regressing hardcoded CJK literals.

Scans app/shared/src and app/workbench/src (#1759) for source files that
still embed CJK string literals (Zh/Hans) but do NOT import `useTranslation`.
Each such file is a "callsite
violation": a component/module that renders user-visible Chinese without
going through react-i18next, so it cannot be localized to English.

The script compares the current violation count against a checked-in
baseline (i18n-callsite-baseline.json). The gate is monotonic: the count
must never INCREASE. Wiring more callsites to useTranslation and then
lowering the baseline is the intended path to zero.

Exit codes:
  0 — current count <= baseline (gate passes)
  1 — current count > baseline (new violations appeared; gate fails)
  2 — baseline file missing or invalid (configuration error)

Usage:
  python scripts/verify/verify-i18n-callsites.py
  python scripts/verify/verify-i18n-callsites.py --update   # rewrite baseline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# ── Configuration ────────────────────────────────────────────────────────

# Repository root is two levels up from this script (scripts/verify -> repo).
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# #1759：workbench 独立成包后，CJK 字面量 ratchet 同时覆盖 shared 与
# workbench 两棵源码树（相对路径带包名前缀，避免重名文件互相遮蔽）。
SCAN_ROOTS = (
    ("shared", REPO_ROOT / "app" / "shared" / "src"),
    ("workbench", REPO_ROOT / "app" / "workbench" / "src"),
)
BASELINE_FILE = REPO_ROOT / "scripts" / "verify" / "i18n-callsite-baseline.json"

# A CJK Unified Ideograph range covers Zh/Hans/Hant, Hiragana, Katakana, and
# the CJK punctuation/halfwidth blocks. This is broad on purpose: any string
# literal carrying these is almost certainly a user-visible Asian-language
# literal that belongs in the i18n dictionary, not the source.
CJK_PATTERN = re.compile(
    r"[\u3000-\u303f"   # CJK symbols and punctuation
    r"\u3040-\u309f"    # Hiragana
    r"\u30a0-\u30ff"    # Katakana
    r"\u3400-\u4dbf"    # CJK Ext A
    r"\u4e00-\u9fff"    # CJK Unified Ideographs
    r"\uf900-\ufaff"    # CJK Compatibility Ideographs
    r"\uff00-\uffef]"   # Fullwidth / Halfwidth forms
)

# String-literal detectors: single/double/backtick/template quotes. We only
# need to know whether a *line* contains a CJK char inside a string-looking
# context; a perfect tokenizer is not required because the baseline absorbs
# the rare false positives (and the gate only fails on net-new growth).
STRING_LITERAL_PATTERN = re.compile(
    r"""(?:
        '([^'\\]|\\.)*'             |   # single-quoted
        "([^"\\]|\\.)*"             |   # double-quoted
        `([^`\\]|\\.)*`                 # template literal
    )""",
    re.VERBOSE,
)

# An import of react-i18next's useTranslation hook. Both default and named
# import spellings are accepted so the scan survives future style changes.
USE_TRANSLATION_IMPORT_PATTERN = re.compile(
    r"import\s+\{[^}]*\buseTranslation\b[^}]*\}\s*from\s*['\"][^'\"]*react-i18next['\"]"
    r"|from\s+['\"][^'\"]*react-i18next['\"]"
)

# Files that are the i18n dictionaries themselves, plus test/setup files.
# These are the legitimate homes for CJK literals and must never be flagged.
# Paths are prefixed with the scan-root package name (shared/workbench).
DICTIONARY_PATHS = {
    "shared/chatview/i18n/resources.ts",
    "shared/i18n/workbench.ts",
    "shared/i18n/index.ts",
}
TEST_SUFFIXES = (".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")
SETUP_FILES = {
    "shared/__tests__/setup.ts",
    "shared/__tests__/setup.tsx",
    "workbench/__tests__/setup.ts",
    # Test scaffolding: zh map fixtures + lobehub mock payloads. Not shipped
    # UI strings; safe to exclude from the i18n callsite gate.
    "workbench/workbenchTestMocks.ts",
}


@dataclass(frozen=True)
class Violation:
    """A source file with CJK string literals but no useTranslation import."""

    relative_path: str
    cjk_line_count: int
    sample_lines: tuple[int, ...]

    def to_dict(self) -> dict:
        return {
            "path": self.relative_path,
            "cjkLiteralLines": self.cjk_line_count,
            "samples": list(self.sample_lines),
        }


def is_dictionary_file(relative_path: str) -> bool:
    """True for i18n resource modules and test/setup scaffolding."""
    normalized = relative_path.replace("\\", "/")
    if normalized in DICTIONARY_PATHS or normalized in SETUP_FILES:
        return True
    return normalized.endswith(TEST_SUFFIXES)


def file_has_use_translation(text: str) -> bool:
    return bool(USE_TRANSLATION_IMPORT_PATTERN.search(text))


def scan_cjk_literal_lines(text: str) -> list[int]:
    """Return 1-based line numbers that carry a CJK char inside a string literal."""
    hits: list[int] = []
    for index, line in enumerate(text.splitlines(), start=1):
        if not CJK_PATTERN.search(line):
            continue
        if not STRING_LITERAL_PATTERN.search(line):
            continue
        hits.append(index)
    return hits


def collect_violations() -> list[Violation]:
    """Walk all scan roots and return callsite violations, sorted by path."""
    violations: list[Violation] = []

    for package_name, scan_root in SCAN_ROOTS:
        if not scan_root.is_dir():
            continue

        for source_path in sorted(scan_root.rglob("*")):
            if not source_path.is_file():
                continue
            if source_path.suffix not in {".ts", ".tsx"}:
                continue
            relative = f"{package_name}/{source_path.relative_to(scan_root).as_posix()}"
            if is_dictionary_file(relative):
                continue

            text = source_path.read_text(encoding="utf-8", errors="replace")
            cjk_lines = scan_cjk_literal_lines(text)
            if not cjk_lines:
                continue
            if file_has_use_translation(text):
                # The file imports useTranslation, so its CJK literals are
                # presumed to be t() keys/values or comments — not hardcoded
                # UI strings. This is a heuristic; the baseline absorbs edge
                # cases.
                continue

            sample = tuple(cjk_lines[:5])
            violations.append(
                Violation(
                    relative_path=relative,
                    cjk_line_count=len(cjk_lines),
                    sample_lines=sample,
                )
            )

    violations.sort(key=lambda violation: violation.relative_path)
    return violations


def load_baseline() -> dict | None:
    if not BASELINE_FILE.is_file():
        return None
    try:
        return json.loads(BASELINE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def write_baseline(violations: list[Violation]) -> None:
    BASELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_comment": (
            "Baseline of i18n callsite violations (source files with CJK "
            "string literals but no useTranslation import). The verify gate "
            "fails when the current count EXCEEDS this baseline; lower this "
            "number as more callsites are wired to useTranslation."
        ),
        "scanRoot": "app/shared/src + app/workbench/src",
        "totalViolations": len(violations),
        "totalCjkLiteralLines": sum(v.cjk_line_count for v in violations),
        "files": [v.to_dict() for v in violations],
    }
    BASELINE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update",
        action="store_true",
        help="Rewrite the baseline to the current violation set instead of gating.",
    )
    args = parser.parse_args(argv)

    violations = collect_violations()
    current_count = len(violations)
    current_lines = sum(v.cjk_line_count for v in violations)

    if args.update:
        write_baseline(violations)
        print(f"[i18n-callsites] baseline rewritten: {current_count} files, "
              f"{current_lines} CJK literal lines.")
        return 0

    baseline = load_baseline()
    if baseline is None:
        print("[i18n-callsites] FAIL: baseline file missing or invalid — "
              f"run `python {Path(__file__).name} --update` first.",
              file=sys.stderr)
        return 2

    baseline_count = int(baseline.get("totalViolations", -1))
    baseline_lines = int(baseline.get("totalCjkLiteralLines", -1))

    print("[i18n-callsites] scan roots: "
          + ", ".join(str(scan_root.relative_to(REPO_ROOT)) for _, scan_root in SCAN_ROOTS))
    print(f"[i18n-callsites] baseline  : {baseline_count} files / "
          f"{baseline_lines} CJK literal lines")
    print(f"[i18n-callsites] current   : {current_count} files / "
          f"{current_lines} CJK literal lines")

    if current_count > baseline_count:
        new_files = [v.relative_path for v in violations]
        baseline_files = {entry["path"] for entry in baseline.get("files", [])}
        added = [p for p in new_files if p not in baseline_files]
        print("[i18n-callsites] FAIL: violation count increased above baseline.",
              file=sys.stderr)
        if added:
            print("[i18n-callsites] new violating files:", file=sys.stderr)
            for path in added:
                print(f"  + {path}", file=sys.stderr)
        return 1

    print("[i18n-callsites] PASS: current <= baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
