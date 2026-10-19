#!/usr/bin/env python3
"""Fail-closed checks for the real E2E evidence contract.

A fixture, stub, or preview run must not claim real login, API, deployment, or
process-recovery coverage. The smoke matrix declares its evidence levels in a
machine-readable constant for every scenario; this script rejects unknown
levels and missing manifest fields.
"""

import argparse
import importlib.util
import os
import sys

SMOKE_MATRIX_PATH = "scripts/smoke/verify-e2e-smoke-matrix.py"

EVIDENCE_LEVELS = {
    "fixture-unit",
    "playwright-ui",
    "visual-qa",
    "stubbed-hub",
    "observed-local",
    "approved-real",
    "backend-api",
    "performance-leak",
    "packaged-release",
}

REQUIRED_ROW_FIELDS = [
    "evidence_level",
    "real_tested",
    "claim",
    "status",
]

REQUIRED_MANIFEST_FIELDS = [
    "skipped_evidence_levels",
    "planned_evidence_levels",
]


def load_smoke_matrix(path):
    """Import the smoke matrix module to read its declared contract values."""
    spec = importlib.util.spec_from_file_location("verify_e2e_smoke_matrix", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_contract(module):
    """Return a list of contract violations for an imported smoke-matrix module."""
    errors = []

    row_fields = tuple(getattr(module, "ROW_SCHEMA_FIELDS", ()))
    manifest_fields = tuple(getattr(module, "MANIFEST_SCHEMA_FIELDS", ()))
    missing = [field for field in REQUIRED_ROW_FIELDS if field not in row_fields]
    missing += [field for field in REQUIRED_MANIFEST_FIELDS if field not in manifest_fields]
    if missing:
        errors.append(f"smoke matrix schema is missing manifest fields: {', '.join(missing)}")

    declared = set(getattr(module, "SCENARIO_EVIDENCE_LEVELS", ()))
    if not declared:
        errors.append("smoke matrix declares no scenario evidence levels")
    unknown = sorted(declared - EVIDENCE_LEVELS)
    if unknown:
        errors.append(f"smoke matrix declares unknown evidence levels: {', '.join(unknown)}")

    high = set(getattr(module, "HIGH_EVIDENCE_LEVELS", ()))
    canonical_high = {"approved-real", "packaged-release"}
    if high != canonical_high:
        errors.append(
            "smoke matrix HIGH_EVIDENCE_LEVELS must be exactly "
            + ", ".join(sorted(canonical_high))
        )
    unknown_high = sorted(high - EVIDENCE_LEVELS)
    if unknown_high:
        errors.append(f"smoke matrix declares unknown high evidence levels: {', '.join(unknown_high)}")
    contract = getattr(module, "SCENARIO_CONTRACT", None)
    if not isinstance(contract, dict) or not contract:
        errors.append("smoke matrix declares no SCENARIO_CONTRACT mapping")
    else:
        contract_levels = set()
        for name, entry in contract.items():
            if not isinstance(entry, (tuple, list)) or len(entry) != 2:
                errors.append(f"scenario '{name}' contract entry must be (level, real_tested)")
                continue
            level, real = entry
            contract_levels.add(level)
            if level not in EVIDENCE_LEVELS:
                errors.append(f"scenario '{name}' declares unknown level '{level}'")
            if level in high and real is not True:
                errors.append(f"scenario '{name}' claims {level} without real_tested=True")
        if contract_levels != declared:
            errors.append(
                "SCENARIO_CONTRACT levels and SCENARIO_EVIDENCE_LEVELS disagree: "
                f"{sorted(contract_levels)} != {sorted(declared)}"
            )

    return errors


def run_self_test():
    """Negative self-test: a non-canonical level such as 'integration' must fail."""

    class FakeModule:
        ROW_SCHEMA_FIELDS = tuple(REQUIRED_ROW_FIELDS)
        MANIFEST_SCHEMA_FIELDS = tuple(REQUIRED_MANIFEST_FIELDS)

    good = FakeModule()
    good.SCENARIO_EVIDENCE_LEVELS = ("fixture-unit",)
    good.HIGH_EVIDENCE_LEVELS = ("approved-real", "packaged-release")
    good.SCENARIO_CONTRACT = {"scenario": ("fixture-unit", False)}
    if validate_contract(good):
        print("self-test failed: canonical module was rejected", file=sys.stderr)
        return 1

    bad = FakeModule()
    bad.SCENARIO_EVIDENCE_LEVELS = ("integration",)
    if not validate_contract(bad):
        print("self-test failed: non-canonical level 'integration' was accepted", file=sys.stderr)
        return 1

    incomplete = FakeModule()
    incomplete.SCENARIO_EVIDENCE_LEVELS = ("fixture-unit",)
    incomplete.HIGH_EVIDENCE_LEVELS = ("approved-real", "packaged-release")
    incomplete.SCENARIO_CONTRACT = {"scenario": ("fixture-unit", False)}
    incomplete.ROW_SCHEMA_FIELDS = tuple(field for field in REQUIRED_ROW_FIELDS if field != "status")
    if not validate_contract(incomplete):
        print("self-test failed: schema missing 'status' was accepted", file=sys.stderr)
        return 1

    empty_high = FakeModule()
    empty_high.SCENARIO_EVIDENCE_LEVELS = ("fixture-unit",)
    empty_high.HIGH_EVIDENCE_LEVELS = ()
    empty_high.SCENARIO_CONTRACT = {"scenario": ("fixture-unit", False)}
    if not validate_contract(empty_high):
        print("self-test failed: empty HIGH_EVIDENCE_LEVELS was accepted", file=sys.stderr)
        return 1

    high_not_real = FakeModule()
    high_not_real.SCENARIO_EVIDENCE_LEVELS = ("approved-real",)
    high_not_real.HIGH_EVIDENCE_LEVELS = ("approved-real", "packaged-release")
    high_not_real.SCENARIO_CONTRACT = {"scenario": ("approved-real", False)}
    if not validate_contract(high_not_real):
        print("self-test failed: high level without real_tested=True was accepted", file=sys.stderr)
        return 1

    print("real E2E contract self-test ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Real E2E evidence contract gate")
    parser.add_argument("--self-test", action="store_true", help="run negative self-tests and exit")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()

    if not os.path.exists(SMOKE_MATRIX_PATH):
        print(f"missing required file: {SMOKE_MATRIX_PATH}", file=sys.stderr)
        return 1

    errors = validate_contract(load_smoke_matrix(SMOKE_MATRIX_PATH))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print("real E2E contract ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
