#!/usr/bin/env python3
"""Negative self-tests for verify-shared-trio-ratchet.py (#1951).

Each case builds a temporary repository-shaped fixture and executes the real
verifier. The suite covers the issue acceptance case plus false-green guards:
exact `__tests__/<Component>.test.tsx` matching, non-component TSX exclusion,
missing/empty scan roots, stale baselines, and malformed baseline data.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VERIFIER = os.path.join(SCRIPT_DIR, "..", "verify-shared-trio-ratchet.py")
STUB = "export function Stub() { return null }\n"
passed = 0


def fail(message: str) -> None:
    raise RuntimeError(f"shared-trio-ratchet self-test failed: {message}")


def pass_case(message: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {message}")


def new_fixture(with_scan_root: bool = True) -> str:
    fixture = tempfile.mkdtemp(prefix="agenthub-shared-trio-")
    if with_scan_root:
        os.makedirs(os.path.join(fixture, "app", "shared", "src", "ui"))
    return fixture


def write_component(fixture: str, rel_path: str, content: str = STUB) -> str:
    full = os.path.join(fixture, *rel_path.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(content)
    return full


def write_trio(fixture: str, rel_dir: str, name: str, split_test: bool = False) -> None:
    write_component(fixture, f"{rel_dir}/{name}.tsx")
    test_dir = f"{rel_dir}/__tests__" if split_test else rel_dir
    write_component(fixture, f"{test_dir}/{name}.test.tsx")
    write_component(fixture, f"{rel_dir}/{name}.stories.tsx")


def write_baseline(fixture: str, exemptions: list, rel_path: str = "shared-trio-baseline.json") -> str:
    path = os.path.join(fixture, *rel_path.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"exemptions": exemptions}, handle, indent=2, ensure_ascii=False)
    return path


def exemption(component: str, missing: list, issue: int = 1951) -> dict:
    return {"component": component, "missing": missing, "issue": issue, "reason": "fixture"}


def invoke_verifier(fixture: str, baseline_path: str, expect_fail: bool, baseline_is_relative: bool = False) -> str:
    baseline_arg = os.path.relpath(baseline_path, fixture).replace(os.sep, "/") if baseline_is_relative else baseline_path
    run = subprocess.run(
        [sys.executable, os.path.abspath(VERIFIER), "--RepoRootPath", fixture, "--BaselinePath", baseline_arg],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=SCRIPT_DIR,
    )
    output = run.stdout + "\n" + run.stderr
    if expect_fail and run.returncode == 0:
        fail(f"verifier must FAIL for this fixture, exited 0: {output}")
    if not expect_fail and run.returncode != 0:
        fail(f"verifier must PASS for this fixture, exited {run.returncode}: {output}")
    return output


def run_case(fixture_work, with_scan_root: bool = True) -> None:
    fixture = new_fixture(with_scan_root=with_scan_root)
    try:
        fixture_work(fixture)
    finally:
        shutil.rmtree(fixture, ignore_errors=True)


def case_positive(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    write_trio(fixture, "app/shared/src/ui/sub", "Nested", split_test=True)
    write_component(fixture, "app/shared/src/ui/useHelper.tsx")  # hook/utility, not a PascalCase component
    write_component(fixture, "app/shared/src/ui/Legacy.tsx")
    write_component(fixture, "app/shared/src/ui/Legacy.test.tsx")
    baseline = write_baseline(
        fixture,
        [exemption("app/shared/src/ui/Legacy.tsx", ["stories"])],
        "scripts/verify/shared-trio-baseline.json",
    )
    invoke_verifier(fixture, baseline, expect_fail=False, baseline_is_relative=True)
    pass_case("complete trios, exact split test, relative baseline, and legacy exemption pass")


def case_deleted_stories(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    baseline = write_baseline(fixture, [])
    invoke_verifier(fixture, baseline, expect_fail=False)
    os.remove(os.path.join(fixture, "app/shared/src/ui/Button.stories.tsx"))
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "Button.tsx" not in output or "stories" not in output:
        fail("deleted stories file must be named in failure output")
    pass_case("deleting one .stories.tsx fails closed (issue acceptance case)")


def case_unrelated_split_test(fixture: str) -> None:
    write_component(fixture, "app/shared/src/ui/Card.tsx")
    write_component(fixture, "app/shared/src/ui/Card.stories.tsx")
    write_component(fixture, "app/shared/src/ui/__tests__/Other.test.tsx")
    baseline = write_baseline(fixture, [])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "Card.tsx" not in output or "test" not in output or "STR-NEW-DEBT" not in output:
        fail("an unrelated __tests__ file must not satisfy Card.test.tsx")
    pass_case("unrelated __tests__ file cannot make another component false-green")


def case_new_debt(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    write_component(fixture, "app/shared/src/ui/Fresh.tsx")
    baseline = write_baseline(fixture, [])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "Fresh.tsx" not in output or "STR-NEW-DEBT" not in output:
        fail("new unregistered debt must be named with STR-NEW-DEBT")
    pass_case("new component missing trio fails closed")


def case_stale_exemption(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    baseline = write_baseline(fixture, [exemption("app/shared/src/ui/Button.tsx", ["stories"])])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "STR-BASELINE-STALE" not in output:
        fail("repaired component with stale exemption must fail with STR-BASELINE-STALE")
    pass_case("stale exemption fails until baseline shrinks")


def case_zombie_component(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    baseline = write_baseline(fixture, [exemption("app/shared/src/ui/Gone.tsx", ["test"])])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "Gone.tsx" not in output or "STR-BASELINE-STALE" not in output:
        fail("zombie baseline component must be named with STR-BASELINE-STALE")
    pass_case("zombie baseline entry fails closed")


def case_baseline_missing(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    output = invoke_verifier(fixture, os.path.join(fixture, "no-such-baseline.json"), expect_fail=True)
    if "STR-BASELINE-MISSING" not in output:
        fail("missing baseline file must fail with STR-BASELINE-MISSING")
    pass_case("missing baseline file fails closed")


def case_schema_violation(fixture: str) -> None:
    write_trio(fixture, "app/shared/src/ui", "Button")
    baseline = write_baseline(fixture, [exemption("app/shared/src/ui/Button.tsx", ["screenshot"])])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "STR-SCHEMA" not in output:
        fail("illegal missing value must fail with STR-SCHEMA")
    pass_case("baseline schema violation fails closed")


def case_scan_root_missing(fixture: str) -> None:
    baseline = write_baseline(fixture, [])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "STR-SCAN-ROOT" not in output:
        fail("missing scan root must fail with STR-SCAN-ROOT")
    pass_case("missing scan root cannot produce an empty-scan false green")


def case_scan_empty(fixture: str) -> None:
    write_component(fixture, "app/shared/src/ui/useHelper.tsx")
    baseline = write_baseline(fixture, [])
    output = invoke_verifier(fixture, baseline, expect_fail=True)
    if "STR-SCAN-EMPTY" not in output:
        fail("empty component scan must fail with STR-SCAN-EMPTY")
    pass_case("empty PascalCase component scan fails closed")


def main() -> int:
    run_case(case_positive)
    run_case(case_deleted_stories)
    run_case(case_unrelated_split_test)
    run_case(case_new_debt)
    run_case(case_stale_exemption)
    run_case(case_zombie_component)
    run_case(case_baseline_missing)
    run_case(case_schema_violation)
    run_case(case_scan_root_missing, with_scan_root=False)
    run_case(case_scan_empty)
    print(f"Shared trio ratchet self-tests PASSED ({passed} cases).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
