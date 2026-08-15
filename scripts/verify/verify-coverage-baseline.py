#!/usr/bin/env python3
"""Frontend coverage baseline gate (baseline must not regress) — ps1 迁移。

Runs vitest --coverage for the four frontend packages (@agenthub/shared,
agenthub-web, agenthub-desktop, agenthub-mobile-rn), parses the json-summary
coverage report and the json test-results report, then asserts:
  1. Every coverage metric (lines/branches/functions/statements) is >= the
     value recorded in scripts/verify/coverage-baseline.json (no regression).
  2. Every coverage.include file with statements but 0% lines is an
     imported-by-nobody production module; their count must not grow past
     the baseline's uncoveredFiles (0% ratchet — new untested code or a
     deleted test both trip it). production_files == 0 (include glob broken)
     is a failure.
  3. Skipped test count == 0 for every package (defeats .skip / .todo as a
     way to silently mask a coverage drop).
Exit 0 on pass, exit 1 on any regression, uncovered growth, or skipped test.

Reproducible: v8 coverage is execution-path based, so the numbers are
cross-platform deterministic (Windows measure == ubuntu CI).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
DEFAULT_BASELINE_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "coverage-baseline.json")
DEFAULT_APP_DIR = os.path.join(REPO_ROOT, "app")

METRICS = ("lines", "statements", "functions", "branches")


def dotnet_double(value) -> str:
    """Format a number the way .NET double.ToString() does (shortest round-trip)."""
    if value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return repr(number)


def fmt_pct(package_total, metric) -> str:
    return dotnet_double((package_total.get(metric) or {}).get("pct"))


def invoke_vitest_coverage(app_dir: str, pkg_filter: str, config: str) -> int:
    """Run vitest coverage for one package; mirrors the ps1 arg array exactly."""
    args = ["exec", "vitest", "run"]
    if config:
        args += ["--config", config]
    args += [
        "--coverage",
        "--coverage.reporter=json-summary",
        "--coverage.reporter=text",
        "--reporter=default",
        "--reporter=json",
        "--outputFile=test-results.json",
        "--hookTimeout=120000",
    ]
    pnpm = shutil.which("pnpm") or "pnpm"
    run = subprocess.run([pnpm, "--filter", pkg_filter, *args], cwd=app_dir, capture_output=True, text=True)
    if run.stdout:
        sys.stdout.write(run.stdout)
    if run.stderr:
        sys.stdout.write(run.stderr)
    return run.returncode


def read_json(path: str):
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--BaselinePath", default=DEFAULT_BASELINE_PATH, help="path to coverage-baseline.json")
    parser.add_argument("--AppDir", default=DEFAULT_APP_DIR, help="workspace root (the app dir)")
    parser.add_argument("--KeepReports", action="store_true", help="do not delete generated coverage/ and test-results.json after parsing")
    # --OnlyPackages: comma-separated baseline package keys to run (CI 4-package
    # matrix splits the 10min gate into per-package parallel jobs). Default: all.
    parser.add_argument("--OnlyPackages", default="", help="comma-separated package keys to run; empty = all")
    args = parser.parse_args()

    baseline_path = args.BaselinePath
    app_dir = args.AppDir

    if not os.path.isfile(baseline_path):
        raise RuntimeError(f"baseline file not found: {baseline_path}")
    if not os.path.isdir(app_dir):
        raise RuntimeError(f"app dir not found: {app_dir}")

    baseline = read_json(baseline_path)

    only_packages = None
    if args.OnlyPackages.strip():
        only_packages = {name.strip() for name in args.OnlyPackages.split(",") if name.strip()}
        unknown = only_packages - set(baseline["packages"].keys())
        if unknown:
            raise RuntimeError(f"--OnlyPackages contains unknown package keys: {sorted(unknown)}")

    # v8 coverage has a small run-to-run variance (a few async setup/teardown
    # paths execute non-deterministically). The baseline JSON declares a
    # tolerance field (default 0.08pp) tuned to absorb this noise while still
    # catching any deleted test that covers more than a handful of unique
    # statements. See the baseline file's toleranceNote for the measurement basis.
    epsilon = float(baseline.get("tolerance", 0.08))

    failures = []
    package_summaries = []

    # Iterate packages in baseline order (JSON object order == ps1 property order).
    for pkg_filter, pkg in baseline["packages"].items():
        if only_packages is not None and pkg_filter not in only_packages:
            continue
        pkg_dir = pkg["dir"]
        config = pkg.get("config")
        abs_pkg_dir = os.path.join(REPO_ROOT, pkg_dir)

        print("")
        print("================================================================")
        print(f"  coverage gate: {pkg_filter}")
        if config:
            print(f"  config: {config}")
        print("================================================================")

        exit_code = invoke_vitest_coverage(app_dir, pkg_filter, config)

        test_results_path = os.path.join(abs_pkg_dir, "test-results.json")
        coverage_summary_path = os.path.join(abs_pkg_dir, "coverage", "coverage-summary.json")

        parsed_tests = False
        parsed_coverage = False
        skipped_count = -1
        num_total = num_passed = num_failed = 0
        totals = None

        if os.path.isfile(test_results_path):
            try:
                test_results = read_json(test_results_path)
                num_total = int(test_results["numTotalTests"])
                num_passed = int(test_results["numPassedTests"])
                num_failed = int(test_results["numFailedTests"])
                # vitest's json reporter has no numSkippedTests key; skipped/todo/
                # pending tests are the ones that are neither passed nor failed.
                skipped_count = num_total - num_passed - num_failed
                parsed_tests = True
            except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 解析失败语义
                failures.append(f"[{pkg_filter}] failed to parse {test_results_path} : {exc}")
        else:
            failures.append(f"[{pkg_filter}] vitest did not produce test-results.json (vitest exit={exit_code}); the run likely failed to start")

        if os.path.isfile(coverage_summary_path):
            try:
                coverage_summary = read_json(coverage_summary_path)
                totals = coverage_summary["total"]
                parsed_coverage = True
            except Exception as exc:  # noqa: BLE001
                failures.append(f"[{pkg_filter}] failed to parse {coverage_summary_path} : {exc}")
        else:
            # vitest skips writing coverage when tests fail; that is itself a gate
            # failure (tests cannot fail on the baseline).
            failures.append(f"[{pkg_filter}] vitest did not produce coverage-summary.json (vitest exit={exit_code}); tests likely failed or coverage instrumentation aborted")

        # --- skipped assertion (defeats .skip / .todo) -------------------------
        if parsed_tests:
            if skipped_count != 0:
                failures.append(
                    f"[{pkg_filter}] skipped tests must be 0 (anti-.skip gate); got skipped={skipped_count} "
                    f"(total={num_total} passed={num_passed} failed={num_failed})"
                )

        # --- baseline comparison ------------------------------------------------
        if parsed_coverage and totals:
            for metric in METRICS:
                current = float(totals[metric]["pct"])
                base = float(pkg["coverage"][metric])
                if current < base - epsilon:
                    failures.append(f"[{pkg_filter}] {metric} coverage regressed: current {dotnet_double(current)}% < baseline {dotnet_double(base)}%")

        # --- uncovered production modules (include contract, #1535) -------------
        # coverage-summary.json lists every file matched by coverage.include.
        # Files with statements but 0% lines are production modules no test
        # imports. The baseline records uncoveredFiles; it must not grow (new
        # untested code or a deleted test both trip it). production_files == 0
        # means the include glob matched nothing — broken config, fail-closed.
        if parsed_coverage and totals:
            production_files = 0
            uncovered_files = 0
            for name, entry in coverage_summary.items():
                if name == "total":
                    continue
                production_files += 1
                lines_info = entry.get("lines")
                if lines_info is not None and int(lines_info.get("total", 0)) > 0 and float(lines_info.get("pct", 0)) == 0.0:
                    uncovered_files += 1
            if production_files == 0:
                failures.append(f"[{pkg_filter}] coverage include matched 0 production files — include glob broken (fail-closed)")
            if pkg.get("uncoveredFiles") is not None:
                base_uncovered = int(pkg["uncoveredFiles"])
                if uncovered_files > base_uncovered:
                    failures.append(
                        f"[{pkg_filter}] uncovered (0%) production modules grew: {uncovered_files} > baseline {base_uncovered} "
                        f"(new untested code or deleted test)"
                    )
            uncovered_line = f"{pkg_filter} coverage: production_files={production_files} uncovered_files={uncovered_files}"
            package_summaries.append(uncovered_line)
            print(uncovered_line)

        # --- console summary line ----------------------------------------------
        if parsed_tests and parsed_coverage:
            line = (
                f"{pkg_filter:<22} tests={num_total} skipped={skipped_count} | "
                f"lines={fmt_pct(totals, 'lines')}% stmt={fmt_pct(totals, 'statements')}% "
                f"fn={fmt_pct(totals, 'functions')}% br={fmt_pct(totals, 'branches')}% "
                f"(base lines={dotnet_double(pkg['coverage'].get('lines'))}% "
                f"stmt={dotnet_double(pkg['coverage'].get('statements'))}% "
                f"fn={dotnet_double(pkg['coverage'].get('functions'))}% "
                f"br={dotnet_double(pkg['coverage'].get('branches'))}%)"
            )
            package_summaries.append(line)
            print(line)
        else:
            print(f"[{pkg_filter}] FAILED to produce complete reports (see errors above)")

        # --- cleanup ------------------------------------------------------------
        if not args.KeepReports:
            if os.path.isfile(test_results_path):
                try:
                    os.remove(test_results_path)
                except OSError:
                    pass
            coverage_dir = os.path.join(abs_pkg_dir, "coverage")
            if os.path.isdir(coverage_dir):
                shutil.rmtree(coverage_dir, ignore_errors=True)

    print("")
    print("================ Coverage baseline gate summary ================")
    for line in package_summaries:
        print(line)
    print("================================================================")

    if failures:
        print("")
        print("Coverage baseline gate FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        print("")
        raise RuntimeError(f"coverage baseline gate failed with {len(failures)} issue(s)")

    print("")
    print("coverage baseline gate ok — no regression, zero skipped")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
