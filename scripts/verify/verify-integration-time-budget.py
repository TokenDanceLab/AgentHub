#!/usr/bin/env python3
"""Integration/test lane time budget verifier (#1565) — ps1 迁移。

Asserts lane wall-clock budgets recorded in scripts/verify/integration-time-budget.json:

- default (validate job): structure + contract checks — every lane has a
  budget_seconds strictly below its hard_cap_seconds, has owner/review/rationale,
  and budget covers observed evidence (budget >= max observed duration);
- measured mode (CI lane step): `--Lane <name> --MeasuredSeconds <n>` fails
  closed when the measured lane exceeds the lane budget, with a stable error
  code so growth requires an explicit baseline update (tracked approval).

Usage:
  python scripts/verify/verify-integration-time-budget.py                        # check baseline contract
  python scripts/verify/verify-integration-time-budget.py --Lane hub-integration --MeasuredSeconds 41
  python scripts/verify/verify-integration-time-budget.py --BaselinePath <path>  # fixture mode (self-tests)
"""

import argparse
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def pass_line(text: str) -> None:
    print(f"  PASS  {text}")


def fail_line(text: str) -> None:
    print(f"  FAIL  {text}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--Lane", default="", help="lane name for measured mode")
    parser.add_argument("--MeasuredSeconds", type=int, default=-1, help="measured lane duration in seconds")
    parser.add_argument("--BaselinePath", default="", help="path to integration-time-budget.json")
    args = parser.parse_args()

    baseline_path = args.BaselinePath or os.path.join(SCRIPT_DIR, "integration-time-budget.json")
    if not os.path.isfile(baseline_path):
        fail_line(f"lane budget baseline missing: {baseline_path}")
        return 1

    with open(baseline_path, encoding="utf-8") as handle:
        baseline = json.load(handle)
    lane_names = sorted(name for name in baseline if name != "_comment")

    # ── Measured mode ─────────────────────────────────────────────────────
    if args.MeasuredSeconds >= 0:
        if not args.Lane:
            fail_line("-Lane is required with -MeasuredSeconds")
            return 1
        if args.Lane not in baseline:
            fail_line(f"[lane-time-budget] lane '{args.Lane}' has no budget entry in integration-time-budget.json")
            return 1
        lane_entry = baseline[args.Lane]
        budget = int(lane_entry["budget_seconds"])
        if args.MeasuredSeconds > budget:
            fail_line(
                f"[lane-time-budget] lane '{args.Lane}' took {args.MeasuredSeconds}s, "
                f"budget {budget}s — lane growth needs an explicit baseline update"
            )
            return 1
        pass_line(f"lane '{args.Lane}' measured {args.MeasuredSeconds}s within budget {budget}s")
        return 0

    # ── Baseline contract check (validate job) ────────────────────────────
    violations = []
    for lane_name in lane_names:
        lane_entry = baseline[lane_name]

        for field in ("budget_seconds", "hard_cap_seconds", "owner", "review", "rationale"):
            if field not in lane_entry or lane_entry[field] == "" or lane_entry[field] == "TODO":
                violations.append(f"lane '{lane_name}' missing {field}")

        budget = float(lane_entry["budget_seconds"])
        cap = float(lane_entry["hard_cap_seconds"])
        if budget >= cap:
            violations.append(f"lane '{lane_name}' budget {budget} s must be strictly below hard cap {cap} s")

        for evidence in lane_entry.get("evidence", []):
            if int(evidence["seconds"]) > budget:
                violations.append(
                    f"lane '{lane_name}' observed {evidence['seconds']}s (run {evidence['run']}) exceeds budget {budget} s"
                )

    if not violations:
        pass_line(f"lane time budget contract holds for {len(lane_names)} lanes")
        for lane_name in lane_names:
            lane_entry = baseline[lane_name]
            observed = [entry["seconds"] for entry in lane_entry.get("evidence", [])]
            max_observed = max(observed) if observed else "n/a"
            print(
                f"    {lane_name:<16} budget {lane_entry['budget_seconds']:>4}s  "
                f"cap {lane_entry['hard_cap_seconds']:>4}s  observed max {max_observed}"
            )
        return 0

    for violation in sorted(set(violations)):
        fail_line(violation)
    print("  #1565: lane budget changes need owner/review/rationale + before/after evidence.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
