#!/usr/bin/env python3
"""Negative self-tests for verify-hub-lint-ratchet.py (#1573) — ps1 迁移。

Cases (each builds a temp fixture with hub-server/ + scripts/verify/ + a
baseline + a pre-generated golangci-lint JSON report, then runs the verifier
with --LintJsonPath so the heavy linter run is bypassed):
1. positive: live findings exactly match baseline -> 0
2. new finding (not in baseline) -> 1
3. replace old finding with a different new finding (same total count) -> 1
   (proves fingerprint identity, not a count ratchet)
4. same finding, different line number -> 0 (fingerprint excludes line)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VERIFIER = os.path.join(SCRIPT_DIR, "..", "verify-hub-lint-ratchet.py")

passed = 0


def fail(message: str) -> None:
    raise RuntimeError(f"hub-lint-ratchet self-test failed: {message}")


def pass_case(message: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {message}")


def new_fixture() -> str:
    fixture = tempfile.mkdtemp(prefix="agenthub-hub-lint-")
    os.makedirs(os.path.join(fixture, "scripts", "verify"))
    os.makedirs(os.path.join(fixture, "hub-server"))
    return fixture


def write_json_file(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def new_issue(linter: str, file: str, text: str, line: int = 1) -> dict:
    return {"FromLinter": linter, "Pos": {"Filename": file, "Line": line}, "Text": text}


def invoke_verifier(fixture_root: str, lint_json_path: str, expect_fail: bool) -> str:
    run = subprocess.run(
        [sys.executable, os.path.abspath(VERIFIER), "--RepoRootPath", fixture_root, "--LintJsonPath", lint_json_path],
        capture_output=True,
        text=True,
    )
    output = run.stdout + "\n" + run.stderr
    if expect_fail:
        if run.returncode == 0:
            fail(f"verifier must FAIL for this fixture, exited 0: {output}")
    elif run.returncode != 0:
        fail(f"verifier must PASS for this fixture, exited {run.returncode}: {output}")
    return output


def run_case(fixture_work: callable) -> None:
    fixture = new_fixture()
    try:
        fixture_work(fixture)
    finally:
        shutil.rmtree(fixture, ignore_errors=True)


# ── Positive case ──────────────────────────────────────────────────────────
def case_positive(fixture: str) -> None:
    issue = new_issue("gocognit", "internal/service/agent_dispatch.go", "cognitive complexity 98 of func is high (> 30)", 42)
    baseline = {
        "_comment": "fixture baseline",
        "linter_version": "v2.12.2",
        "findings": [
            {"linter": "gocognit", "file": "internal/service/agent_dispatch.go", "message": "cognitive complexity 98 of func is high (> 30)"}
        ],
    }
    write_json_file(os.path.join(fixture, "scripts/verify/hub-lint-baseline.json"), baseline)
    write_json_file(os.path.join(fixture, "lint-report.json"), {"Issues": [issue]})
    invoke_verifier(fixture, os.path.join(fixture, "lint-report.json"), expect_fail=False)
    pass_case("positive fixture (live == baseline)")


# ── Negative 1: new finding not in baseline ────────────────────────────────
def case_new_finding(fixture: str) -> None:
    old_issue = new_issue("gocognit", "internal/service/agent_dispatch.go", "cognitive complexity 98 of func is high (> 30)", 42)
    new_finding = new_issue("staticcheck", "internal/service/agent_profile.go", "new SA1xxx finding", 7)
    baseline = {
        "findings": [
            {"linter": "gocognit", "file": "internal/service/agent_dispatch.go", "message": "cognitive complexity 98 of func is high (> 30)"}
        ]
    }
    write_json_file(os.path.join(fixture, "scripts/verify/hub-lint-baseline.json"), baseline)
    write_json_file(os.path.join(fixture, "lint-report.json"), {"Issues": [old_issue, new_finding]})
    output = invoke_verifier(fixture, os.path.join(fixture, "lint-report.json"), expect_fail=True)
    if "staticcheck" not in output:
        fail("new finding must be named in failure output")
    pass_case("new finding (not in baseline) fails closed")


# ── Negative 2: replace old finding with different new finding, same count ──
def case_replaced_finding(fixture: str) -> None:
    replacement = new_issue("gocognit", "internal/service/agent_dispatch.go", "cognitive complexity 97 of func is high (> 30)", 42)
    baseline = {
        "findings": [
            {"linter": "gocognit", "file": "internal/service/agent_dispatch.go", "message": "cognitive complexity 98 of func is high (> 30)"}
        ]
    }
    write_json_file(os.path.join(fixture, "scripts/verify/hub-lint-baseline.json"), baseline)
    write_json_file(os.path.join(fixture, "lint-report.json"), {"Issues": [replacement]})
    output = invoke_verifier(fixture, os.path.join(fixture, "lint-report.json"), expect_fail=True)
    if "97" not in output:
        fail("replacement finding must be named in failure output")
    pass_case("replaced finding (same total count) fails — fingerprint identity, not count ratchet")


# ── Positive 2: same finding moved to a different line ─────────────────────
def case_line_move(fixture: str) -> None:
    moved = new_issue("gocognit", "internal/service/agent_dispatch.go", "cognitive complexity 98 of func is high (> 30)", 999)
    baseline = {
        "findings": [
            {"linter": "gocognit", "file": "internal/service/agent_dispatch.go", "message": "cognitive complexity 98 of func is high (> 30)"}
        ]
    }
    write_json_file(os.path.join(fixture, "scripts/verify/hub-lint-baseline.json"), baseline)
    write_json_file(os.path.join(fixture, "lint-report.json"), {"Issues": [moved]})
    invoke_verifier(fixture, os.path.join(fixture, "lint-report.json"), expect_fail=False)
    pass_case("line-number move does not reset debt (fingerprint excludes line)")


def main() -> int:
    run_case(case_positive)
    run_case(case_new_finding)
    run_case(case_replaced_finding)
    run_case(case_line_move)
    print(f"Hub lint ratchet self-tests PASSED ({passed} cases).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
