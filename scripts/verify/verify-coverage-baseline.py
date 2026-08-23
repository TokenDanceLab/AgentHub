#!/usr/bin/env python3
"""Frontend coverage baseline gate (baseline must not regress) — ps1 迁移。

Runs vitest --coverage for the five frontend packages (@agenthub/shared,
@agenthub/workbench, agenthub-web, agenthub-desktop, agenthub-mobile-rn),
parses the json-summary coverage report and the json test-results report,
then asserts:
  1. Every coverage metric (lines/branches/functions/statements) is >= the
     value recorded in scripts/verify/coverage-baseline.json (no regression).
  2. Every coverage.include file with statements but 0% lines is an
     imported-by-nobody production module; their count must not grow past
     the baseline's uncoveredFiles (0% ratchet — new untested code or a
     deleted test both trip it). *.stories.ts(x) Storybook render fixtures
     are excluded from the production/uncovered counts (vitest never
     executes them, so they would ratchet on every new component story;
     #1535 include contract: stories are non-production fixtures).
     production_files == 0 (include glob broken) is a failure.
  3. Skipped test count == 0 for every package (defeats .skip / .todo as a
     way to silently mask a coverage drop).
Exit 0 on pass, exit 1 on any regression, uncovered growth, or skipped test.

Reproducible: v8 coverage is execution-path based, so the numbers are
cross-platform deterministic (Windows measure == ubuntu CI).
"""

import argparse
import datetime
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


def write_console(text: str) -> None:
    """Write captured UTF-8 tool output without crashing locale-bound consoles."""
    if not text:
        return
    encoding = sys.stdout.encoding or "utf-8"
    safe = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
    sys.stdout.write(safe)


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
    # Vitest writes UTF-8 (including ANSI/color diagnostics) even when Windows
    # Python's locale encoding is GBK. Pin decoding explicitly so reader threads
    # cannot crash and silently drop stdout/stderr on Windows test machines.
    run = subprocess.run(
        [pnpm, "--filter", pkg_filter, *args],
        cwd=app_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    write_console(run.stdout)
    write_console(run.stderr)
    return run.returncode


def read_json(path: str):
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)


STORY_SUFFIXES = (".stories.ts", ".stories.tsx")


def is_story_file(name: str) -> bool:
    """True for Storybook render fixtures (*.stories.ts/x).

    Vitest never executes stories (they are a Storybook-only surface), so
    they always report 0% lines and are not production modules — counting
    them would ratchet uncovered on every new component story alone.
    """
    return os.path.basename(name.replace("\\", "/")).endswith(STORY_SUFFIXES)


def count_production_coverage(coverage_summary: dict) -> tuple[int, int]:
    """Return (production_files, uncovered_files) from coverage-summary.json.

    coverage-summary.json lists every file matched by coverage.include.
    Files with statements but 0% lines are production modules no test
    imports. *.stories.ts(x) Storybook render fixtures are excluded from
    both counts (non-production fixtures, like the __e2e__ specs that the
    include glob already ignores via the coverage factory defaults).
    """
    production_files = 0
    uncovered_files = 0
    for name, entry in coverage_summary.items():
        if name == "total" or is_story_file(name):
            continue
        production_files += 1
        lines_info = entry.get("lines")
        if lines_info is not None and int(lines_info.get("total", 0)) > 0 and float(lines_info.get("pct", 0)) == 0.0:
            uncovered_files += 1
    return production_files, uncovered_files


def git_text(*args: str) -> str:
    run = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True)
    if run.returncode != 0:
        detail = (run.stderr or run.stdout).strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail or f'exit {run.returncode}'}")
    return run.stdout.strip()


def validate_baseline_source(baseline: dict) -> None:
    """Require masterSha to name a real commit that is an ancestor of HEAD."""
    sha = str(baseline.get("masterSha") or "").strip()
    short = str(baseline.get("masterShaShort") or "").strip()
    if len(sha) != 40 or any(ch not in "0123456789abcdefABCDEF" for ch in sha):
        raise RuntimeError("baseline masterSha must be a full 40-character git commit SHA")
    git_text("cat-file", "-e", f"{sha}^{{commit}}")
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], cwd=REPO_ROOT)
    if ancestor.returncode != 0:
        raise RuntimeError(f"baseline masterSha {sha} is not an ancestor of HEAD")
    if short and not sha.startswith(short):
        raise RuntimeError(f"baseline masterShaShort {short!r} does not match masterSha")


def validate_write_context(only_packages: set[str] | None) -> str:
    """Return published master HEAD, refusing ambiguous or ephemeral baselines."""
    if only_packages is not None:
        raise RuntimeError("--WriteBaseline cannot be combined with --OnlyPackages; re-baseline must measure all packages")
    if git_text("branch", "--show-current") != "master":
        raise RuntimeError("--WriteBaseline must run from branch master so masterSha remains permanently reachable")
    dirty = git_text("status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise RuntimeError("--WriteBaseline requires a clean tracked working tree; commit/stash code changes first")
    head = git_text("rev-parse", "HEAD")
    origin_master = git_text("rev-parse", "origin/master")
    if head != origin_master:
        raise RuntimeError("--WriteBaseline requires local master == origin/master; sync the published master first")
    return head


def write_baseline(path: str, baseline: dict, measurements: dict[str, dict], source_sha: str) -> None:
    """Persist fresh non-regressing measurements while preserving human notes/policy."""
    for pkg_filter, measured in measurements.items():
        pkg = baseline["packages"][pkg_filter]
        for metric in METRICS:
            old = float(pkg["coverage"][metric])
            current = float(measured["coverage"][metric])
            if current < old:
                raise RuntimeError(
                    f"--WriteBaseline refuses to lower {pkg_filter} {metric}: {current}% < {old}%; "
                    "use an explicit reviewed baseline edit for intentional relaxations"
                )
        if int(measured["uncoveredFiles"]) > int(pkg.get("uncoveredFiles", measured["uncoveredFiles"])):
            raise RuntimeError(
                f"--WriteBaseline refuses to increase {pkg_filter} uncoveredFiles: "
                f"{measured['uncoveredFiles']} > {pkg.get('uncoveredFiles')}"
            )

    for pkg_filter, measured in measurements.items():
        pkg = baseline["packages"][pkg_filter]
        pkg["coverage"] = measured["coverage"]
        pkg["uncoveredFiles"] = measured["uncoveredFiles"]
        pkg["tests"] = measured["tests"]

    baseline["measuredAt"] = datetime.date.today().isoformat()
    baseline["masterSha"] = source_sha
    baseline["masterShaShort"] = source_sha[:9]
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(baseline, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--BaselinePath", default=DEFAULT_BASELINE_PATH, help="path to coverage-baseline.json")
    parser.add_argument("--AppDir", default=DEFAULT_APP_DIR, help="workspace root (the app dir)")
    parser.add_argument("--KeepReports", action="store_true", help="do not delete generated coverage/ and test-results.json after parsing")
    # --OnlyPackages: comma-separated baseline package keys to run (CI 5-package
    # matrix splits the 10min gate into per-package parallel jobs). Default: all.
    parser.add_argument("--OnlyPackages", default="", help="comma-separated package keys to run; empty = all")
    # Re-baseline is deliberately stricter than the ordinary gate: it must run
    # all packages from a clean, published master so masterSha stays reachable
    # after GitHub squash-merges feature branches. It never lowers a metric.
    parser.add_argument(
        "--WriteBaseline",
        action="store_true",
        help="re-measure all packages and write non-regressing measurements + published master HEAD to the baseline JSON",
    )
    args = parser.parse_args()

    baseline_path = args.BaselinePath
    app_dir = args.AppDir

    if not os.path.isfile(baseline_path):
        raise RuntimeError(f"baseline file not found: {baseline_path}")
    if not os.path.isdir(app_dir):
        raise RuntimeError(f"app dir not found: {app_dir}")

    baseline = read_json(baseline_path)
    validate_baseline_source(baseline)

    only_packages = None
    if args.OnlyPackages.strip():
        only_packages = {name.strip() for name in args.OnlyPackages.split(",") if name.strip()}
        unknown = only_packages - set(baseline["packages"].keys())
        if unknown:
            raise RuntimeError(f"--OnlyPackages contains unknown package keys: {sorted(unknown)}")

    write_source_sha = validate_write_context(only_packages) if args.WriteBaseline else ""

    # v8 coverage has a small run-to-run variance (a few async setup/teardown
    # paths execute non-deterministically). The baseline JSON declares a
    # tolerance field (default 0.08pp) tuned to absorb this noise while still
    # catching any deleted test that covers more than a handful of unique
    # statements. See the baseline file's toleranceNote for the measurement basis.
    epsilon = float(baseline.get("tolerance", 0.08))

    failures = []
    package_summaries = []
    measurements: dict[str, dict] = {}

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
        # imports. *.stories.ts(x) Storybook render fixtures are excluded
        # from the counts (vitest never executes them — otherwise every new
        # story would ratchet uncovered). The baseline records
        # uncoveredFiles; it must not grow (new untested code or a deleted
        # test both trip it). production_files == 0 means the include glob
        # matched nothing — broken config, fail-closed.
        if parsed_coverage and totals:
            production_files, uncovered_files = count_production_coverage(coverage_summary)
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
            measurements[pkg_filter] = {
                "coverage": {metric: float(totals[metric]["pct"]) for metric in METRICS},
                "uncoveredFiles": uncovered_files,
                "tests": {
                    "total": num_total,
                    "passed": num_passed,
                    "failed": num_failed,
                    "skipped": skipped_count,
                },
            }
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

    if args.WriteBaseline:
        if len(measurements) != len(baseline["packages"]):
            raise RuntimeError(
                f"--WriteBaseline measured {len(measurements)} packages, expected {len(baseline['packages'])}; refusing partial write"
            )
        write_baseline(baseline_path, baseline, measurements, write_source_sha)
        print(f"coverage baseline updated from published master {write_source_sha[:9]} ({baseline_path})")

    print("")
    print("coverage baseline gate ok — no regression, zero skipped")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
