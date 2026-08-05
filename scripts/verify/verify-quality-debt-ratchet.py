#!/usr/bin/env python3
r"""Quality-debt ratchet verifier — bidirectional (#1536 Phase 1) — ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）。

Every soft gate and golangci exclusion in the repo must be registered in
quality-debt-baseline.json with accurate metadata, and the registered
complexity budgets must not be exceeded.

Checks (QDR-* behavior codes are stable identifiers for self-tests):
  1. every `continue-on-error: true` in checks.yml is registered in the
     baseline (matched by job: step name);
  2. every golangci `path:` exclusion rule (non-test) in hub-server and
     edge-server .golangci.yml is registered (matched by file+path);
  3. every baseline soft_gate entry has a matching continue-on-error in
     checks.yml (zombie check);
  4. every baseline exclusion entry has a matching rule in the .golangci.yml
     (zombie check);
  5. baseline linter list matches the .golangci.yml linter list for each path;
  6. actual complexity (gocognit, gocyclo) is ≤ baseline budget;
  7. schema completeness: reason, issue, owner, introduced_at, review_by all present;
  8. date format: introduced_at and review_by are ISO-8601 dates, and
     introduced_at <= review_by;
  9. no runtime dependency mutation in checks.yml;
 10. exclusion patterns resolve to exactly one existing Go source file;
 11. existing complexity budgets cannot increase and review deadlines cannot
     be extended without an explicit extension_reason;
 12. failures expose stable QDR-* identifiers.

CLI 兼容：--SkipComplexity / --SkipZombieCheck / --SkipHistoricalRatchet 开关、
--RepoRootPath / --BaselinePath / --BaseBaselinePath / --BaseRef 参数与 ps1 同名；
退出码 0=通过，1=失败。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

GOCONGNIT_MODULE = "github.com/uudashr/gocognit/cmd/gocognit@v1.2.0"
GOCYCLO_MODULE = "github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0"

ISODATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FAIL_CODE = re.compile(r"^QDR-[A-Z0-9-]+$")
JOB_KEY_LINE = re.compile(r"^  ([a-zA-Z0-9_-]+):\s*$")
STEP_NAME_LINE = re.compile(r"^\s+- name:\s*(.+)$")
CONTINUE_ON_ERROR_LINE = re.compile(r"^\s+continue-on-error:\s*true\s*(?:#.*)?$")
COMMENT_LINE = re.compile(r"^\s*#")
RULES_LINE = re.compile(r"^\s*rules:\s*$")
CONFIG_PATH_LINE = re.compile(r"^\s*path:\s*(.+)$")
LINTER_ITEM_LINE = re.compile(r"^\s*-\s+(\w+)$")
GO_FILE_PATTERN = re.compile(r"^(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\\.go$")
MUTATION_PATTERNS = [
    re.compile(r"\bpnpm\s+(?:add|remove|update|up)\b", re.IGNORECASE),
    re.compile(r"\bgo\s+get\b", re.IGNORECASE),
    re.compile(r"\bnpm\s+(?:add|install|uninstall|update)\b", re.IGNORECASE),
]

passed = 0
failed = 0


def pass_line(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_line(code: str, text: str) -> None:
    global failed
    if not FAIL_CODE.match(code):
        raise RuntimeError(f"invalid quality-debt failure code: {code}")
    failed += 1
    print(f"  FAIL  [{code}] {text}")


def is_iso_date(date_str: str) -> bool:
    if not ISODATE.match(date_str):
        return False
    try:
        parsed = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return False
    # 对齐 .NET ParseExact：年 0 不在 DateTime 范围内
    return 1 <= parsed.year <= 9999


def is_positive_integer(value) -> bool:
    # 对齐 ps1 的整数类型白名单：bool 不算整数
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def convert_exact_go_pattern_to_path(pattern: str):
    # Only literal relative Go-file paths are permitted. Regex wildcards,
    # directory patterns, anchors, groups and character classes are rejected.
    if not GO_FILE_PATTERN.match(pattern):
        return None
    segments = pattern.split("/")
    if "." in segments or ".." in segments:
        return None
    return pattern.replace(r"\.", ".")


def read_json(path: str):
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return json.load(handle)


def read_lines(path: str) -> list:
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return handle.read().splitlines()


def get_linters_for_path(repo_root: str, config_file: str, target_path: str) -> list:
    config_path = os.path.join(repo_root, config_file)
    in_rules = False
    current_linters = []
    current_path = None
    for line in read_lines(config_path):
        if RULES_LINE.match(line):
            in_rules = True
            continue
        if not in_rules:
            continue
        path_match = CONFIG_PATH_LINE.match(line)
        if path_match:
            current_path = path_match.group(1).strip().strip('"')
            # Store linters for previous path
            if current_path == target_path and len(current_linters) > 0:
                return current_linters
            current_linters = []
            continue
        linter_match = LINTER_ITEM_LINE.match(line)
        if linter_match:
            current_linters.append(linter_match.group(1))
    # Check last entry
    if current_path == target_path and len(current_linters) > 0:
        return current_linters
    return []


def format_native_output(lines) -> str:
    return " | ".join(line for line in lines)


def read_base_baseline(repo_root: str, base_baseline_path: str, base_ref: str) -> dict | None:
    if base_baseline_path:
        if not os.path.exists(base_baseline_path):
            fail_line("QDR-BASELINE-REF", f"base baseline path not found: {base_baseline_path}")
            return None
        return read_json(base_baseline_path)

    candidate_ref = base_ref
    if not candidate_ref and os.environ.get("GITHUB_BASE_REF"):
        candidate_ref = f"origin/{os.environ['GITHUB_BASE_REF']}"
    # Pull requests compare with the actual base branch. Push runs compare
    # with the previous main commit. Local multi-commit PR work must pass
    # -BaseRef explicitly; HEAD^ may be an earlier bootstrap commit and is not
    # a trustworthy policy baseline.
    if not candidate_ref and os.environ.get("GITHUB_EVENT_NAME") == "push":
        rev_check = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "--verify", "HEAD^"],
            capture_output=True,
        )
        if rev_check.returncode == 0:
            candidate_ref = "HEAD^"
    if not candidate_ref:
        return None

    repo_relative = "scripts/verify/quality-debt-baseline.json"
    show = subprocess.run(
        ["git", "-C", repo_root, "show", f"{candidate_ref}:{repo_relative}"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if show.returncode != 0 or not show.stdout:
        return None
    return json.loads(show.stdout)


def run_go_tool(repo_root: str, go_args: list, env_overrides: dict):
    env = dict(os.environ)
    env.update(env_overrides)
    return subprocess.run(
        ["go", *go_args],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def resolve_complexity_go_env() -> dict:
    env_overrides = {}

    def go_env(key: str) -> str:
        probe = subprocess.run(["go", "env", key], capture_output=True, text=True)
        if probe.returncode != 0:
            return ""
        first_line = probe.stdout.splitlines()
        return first_line[0].strip() if first_line else ""

    go_mod_cache = go_env("GOMODCACHE")
    if not go_mod_cache:
        isolated_go_path = os.path.join(tempfile.gettempdir(), "agenthub-quality-debt-go")
        env_overrides["GOPATH"] = isolated_go_path
        go_mod_cache = os.path.join(isolated_go_path, "pkg", "mod")
        env_overrides["GOMODCACHE"] = go_mod_cache
        os.makedirs(go_mod_cache, exist_ok=True)

    go_build_cache = go_env("GOCACHE")
    if not go_build_cache or go_build_cache == "off":
        go_build_cache = os.path.join(tempfile.gettempdir(), "agenthub-quality-debt-go-build")
        env_overrides["GOCACHE"] = go_build_cache
        os.makedirs(go_build_cache, exist_ok=True)

    return env_overrides


def check_schema(baseline: dict, repo_root: str) -> None:
    bad_entries = []

    for gate in baseline.get("soft_gates") or []:
        if not (gate.get("issue") and gate.get("owner") and gate.get("reason") and gate.get("introduced_at") and gate.get("review_by")):
            missing = [field for field in ("issue", "owner", "reason", "introduced_at", "review_by") if not gate.get(field)]
            bad_entries.append(f"soft_gate {gate.get('location')}: missing {', '.join(missing)}")
        if not is_positive_integer(gate.get("issue")):
            bad_entries.append(f"soft_gate {gate.get('location')}: issue '{gate.get('issue')}' must be a positive JSON integer")
        introduced_at = gate.get("introduced_at")
        review_by = gate.get("review_by")
        if introduced_at and not is_iso_date(introduced_at):
            bad_entries.append(f"soft_gate {gate.get('location')}: introduced_at '{introduced_at}' is not a valid ISO date (YYYY-MM-DD)")
        if review_by and not is_iso_date(review_by):
            bad_entries.append(f"soft_gate {gate.get('location')}: review_by '{review_by}' is not a valid ISO date (YYYY-MM-DD)")
        if introduced_at and review_by and is_iso_date(introduced_at) and is_iso_date(review_by):
            if introduced_at > review_by:
                bad_entries.append(f"soft_gate {gate.get('location')}: introduced_at ({introduced_at}) is after review_by ({review_by})")

    for exc in baseline.get("golangci_exclusions") or []:
        if not (exc.get("issue") and exc.get("owner") and exc.get("reason") and exc.get("introduced_at") and exc.get("review_by")):
            missing = [field for field in ("issue", "owner", "reason", "introduced_at", "review_by") if not exc.get(field)]
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: missing {', '.join(missing)}")
        if not is_positive_integer(exc.get("issue")):
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: issue '{exc.get('issue')}' must be a positive JSON integer")
        introduced_at = exc.get("introduced_at")
        review_by = exc.get("review_by")
        if introduced_at and not is_iso_date(introduced_at):
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: introduced_at '{introduced_at}' is not a valid ISO date (YYYY-MM-DD)")
        if review_by and not is_iso_date(review_by):
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: review_by '{review_by}' is not a valid ISO date (YYYY-MM-DD)")
        if introduced_at and review_by and is_iso_date(introduced_at) and is_iso_date(review_by):
            if introduced_at > review_by:
                bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: introduced_at ({introduced_at}) is after review_by ({review_by})")
        if exc.get("file") not in ("hub-server/.golangci.yml", "edge-server/.golangci.yml"):
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: file must be one supported golangci config")
        relative_go_path = convert_exact_go_pattern_to_path(exc.get("path") or "")
        if not relative_go_path:
            bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: path must be one exact escaped .go file, not a regex/directory pattern")
        else:
            module = "hub-server" if (exc.get("file") or "").startswith("hub-server") else "edge-server"
            source_path = os.path.join(repo_root, module, relative_go_path)
            if not os.path.isfile(source_path):
                bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: exact source file does not exist: {module}/{relative_go_path}")
        for required_metric in ("gocognit", "gocyclo"):
            if required_metric in (exc.get("linters") or []) and (not exc.get("complexity") or required_metric not in exc.get("complexity", {})):
                bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: enabled {required_metric} exclusion requires complexity.{required_metric} budget")
        if exc.get("complexity"):
            for key, value in exc["complexity"].items():
                if isinstance(value, str):
                    bad_entries.append(f"exclusion {exc.get('file')} {exc.get('path')}: complexity.{key} is a string ('{value}'), must be a number")

    if len(bad_entries) == 0:
        pass_line("baseline entries complete (reason/issue/owner/introduced_at/review_by)")
    else:
        for entry in bad_entries:
            fail_line("QDR-SCHEMA", entry)


def check_continue_on_error_registration(baseline: dict, workflow_lines: list) -> list:
    registered_locations = [gate.get("location") for gate in baseline.get("soft_gates") or []]
    found_continue_on_error = []

    job_name = ""
    step_name = ""
    for line in workflow_lines:
        job_match = JOB_KEY_LINE.match(line)
        if job_match:
            job_name = job_match.group(1).strip()
        step_match = STEP_NAME_LINE.match(line)
        if step_match:
            step_name = step_match.group(1).strip()
        if CONTINUE_ON_ERROR_LINE.match(line):
            location = f"{job_name}: {step_name}"
            found_continue_on_error.append(location)
            if location not in registered_locations:
                fail_line("QDR-SOFT-GATE-UNREGISTERED", f"unregistered continue-on-error: {location}")
    if len(registered_locations) > 0:
        pass_line("continue-on-error gates checked (forward)")
    return found_continue_on_error


def check_zombie_gates(baseline: dict, found_continue_on_error: list, skip_zombie_check: bool) -> None:
    if not skip_zombie_check:
        zombies = []
        for gate in baseline.get("soft_gates") or []:
            if gate.get("location") not in found_continue_on_error:
                zombies.append(f"baseline soft_gate '{gate.get('location')}' has no matching continue-on-error in checks.yml")
        if len(zombies) == 0:
            pass_line("no zombie soft_gates in baseline")
        else:
            for zombie in zombies:
                fail_line("QDR-SOFT-GATE-ZOMBIE", zombie)
    else:
        pass_line("zombie gate check skipped (--SkipZombieCheck)")


def check_runtime_dependency_mutation(workflow_lines: list) -> None:
    mutations = []
    for line in workflow_lines:
        if COMMENT_LINE.match(line):
            continue
        for pattern in MUTATION_PATTERNS:
            if pattern.search(line):
                mutations.append(line.strip())
                break
    if len(mutations) == 0:
        pass_line("no runtime dependency mutation in checks.yml")
    else:
        for mutation in mutations:
            fail_line("QDR-RUNTIME-MUTATION", f"runtime dependency mutation: {mutation}")


def check_exclusion_registration(baseline: dict, repo_root: str) -> dict:
    registered_exc = {}
    for exc in baseline.get("golangci_exclusions") or []:
        registered_exc[f"{exc.get('file')}|{exc.get('path')}"] = exc

    unregistered = []
    actual_exclusions = {}
    for gcfg in ("hub-server/.golangci.yml", "edge-server/.golangci.yml"):
        cfg_path = os.path.join(repo_root, gcfg)
        if not os.path.isfile(cfg_path):
            continue
        in_rules = False
        for line in read_lines(cfg_path):
            if RULES_LINE.match(line):
                in_rules = True
                continue
            if in_rules:
                path_match = CONFIG_PATH_LINE.match(line)
                if path_match:
                    path_value = path_match.group(1).strip().strip('"')
                    if path_value == "_test\\.go":
                        continue
                    key = f"{gcfg}|{path_value}"
                    actual_exclusions[key] = True
                    if key not in registered_exc:
                        unregistered.append(key)
    if len(unregistered) == 0:
        pass_line("all golangci exclusions registered (forward)")
    else:
        for key in unregistered:
            fail_line("QDR-EXCLUSION-UNREGISTERED", f"unregistered exclusion: {key}")
    return actual_exclusions


def check_zombie_exclusions(baseline: dict, actual_exclusions: dict, skip_zombie_check: bool) -> None:
    if not skip_zombie_check:
        zombie_exc = []
        for exc in baseline.get("golangci_exclusions") or []:
            key = f"{exc.get('file')}|{exc.get('path')}"
            if key not in actual_exclusions:
                zombie_exc.append(f"baseline exclusion '{key}' has no matching rule in {exc.get('file')}")
        if len(zombie_exc) == 0:
            pass_line("no zombie exclusions in baseline")
        else:
            for zombie in zombie_exc:
                fail_line("QDR-EXCLUSION-ZOMBIE", zombie)
    else:
        pass_line("zombie exclusion check skipped (--SkipZombieCheck)")


def check_linter_sets(baseline: dict, repo_root: str) -> None:
    linter_mismatches = []
    for exc in baseline.get("golangci_exclusions") or []:
        config_linters = get_linters_for_path(repo_root, exc.get("file"), exc.get("path"))
        baseline_linters = sorted(exc.get("linters") or [])
        config_sorted = sorted(config_linters)
        # Compare-Object 语义：<= 为 baseline 有而 config 无，=> 为 config 有而 baseline 无
        baseline_counter = {}
        config_counter = {}
        for linter in baseline_linters:
            baseline_counter[linter] = baseline_counter.get(linter, 0) + 1
        for linter in config_sorted:
            config_counter[linter] = config_counter.get(linter, 0) + 1
        missing = []
        extra = []
        for linter, count in baseline_counter.items():
            for _ in range(count - config_counter.get(linter, 0)):
                missing.append(linter)
        for linter, count in config_counter.items():
            for _ in range(count - baseline_counter.get(linter, 0)):
                extra.append(linter)
        parts = []
        if missing:
            parts.append("baseline has extra linters that config doesn't: " + ", ".join(missing))
        if extra:
            parts.append("config has linters not in baseline: " + ", ".join(extra))
        if parts:
            linter_mismatches.append(f"{exc.get('file')} {exc.get('path')}: {'; '.join(parts)}")
    if len(linter_mismatches) == 0:
        pass_line("all baseline linter sets match .golangci.yml")
    else:
        for mismatch in linter_mismatches:
            fail_line("QDR-LINTER-MISMATCH", mismatch)


def check_historical_ratchet(baseline: dict, repo_root: str, skip_historical_ratchet: bool, base_baseline_path: str, base_ref: str) -> None:
    if not skip_historical_ratchet:
        base_baseline = read_base_baseline(repo_root, base_baseline_path, base_ref)
        if base_baseline:
            history_fails = []
            base_gates = {gate.get("location"): gate for gate in base_baseline.get("soft_gates") or []}
            base_exclusions = {f"{exc.get('file')}|{exc.get('path')}": exc for exc in base_baseline.get("golangci_exclusions") or []}

            for gate in baseline.get("soft_gates") or []:
                if gate.get("location") not in base_gates:
                    continue
                old = base_gates[gate.get("location")]
                if gate.get("introduced_at") != old.get("introduced_at"):
                    history_fails.append(f"soft_gate {gate.get('location')}: introduced_at is immutable ({old.get('introduced_at')} -> {gate.get('introduced_at')})")
                if old.get("review_by") is None or gate.get("review_by") > old.get("review_by"):
                    if not gate.get("extension_reason"):
                        history_fails.append(f"soft_gate {gate.get('location')}: review_by extended ({old.get('review_by')} -> {gate.get('review_by')}) without extension_reason")

            for exc in baseline.get("golangci_exclusions") or []:
                key = f"{exc.get('file')}|{exc.get('path')}"
                if key not in base_exclusions:
                    continue
                old = base_exclusions[key]
                if exc.get("introduced_at") != old.get("introduced_at"):
                    history_fails.append(f"exclusion {key}: introduced_at is immutable ({old.get('introduced_at')} -> {exc.get('introduced_at')})")
                if old.get("review_by") is None or exc.get("review_by") > old.get("review_by"):
                    if not exc.get("extension_reason"):
                        history_fails.append(f"exclusion {key}: review_by extended ({old.get('review_by')} -> {exc.get('review_by')}) without extension_reason")
                old_complexity = old.get("complexity") or {}
                new_complexity = exc.get("complexity") or {}
                for old_metric in old_complexity:
                    if not new_complexity or old_metric not in new_complexity:
                        history_fails.append(f"exclusion {key}: existing {old_metric} budget was removed")
                for metric in new_complexity:
                    if metric not in old_complexity:
                        continue
                    if int(new_complexity[metric]) > int(old_complexity[metric]):
                        history_fails.append(f"exclusion {key}: {metric} budget increased ({old_complexity[metric]} -> {new_complexity[metric]})")

            if len(history_fails) == 0:
                pass_line("existing budgets and review deadlines did not regress versus base baseline")
            else:
                for history_fail in history_fails:
                    fail_line("QDR-HISTORY-REGRESSION", history_fail)
        else:
            pass_line("base baseline absent; bootstrap comparison skipped")
    else:
        pass_line("historical baseline comparison skipped (--SkipHistoricalRatchet)")


def check_complexity(baseline: dict, repo_root: str, skip_complexity: bool) -> None:
    if not skip_complexity:
        env_overrides = resolve_complexity_go_env()
        complexity_fails = []
        for exc in baseline.get("golangci_exclusions") or []:
            if not exc.get("complexity"):
                continue
            module = "hub-server" if (exc.get("file") or "").startswith("hub-server") else "edge-server"
            relative_go_path = convert_exact_go_pattern_to_path(exc.get("path") or "")
            if not relative_go_path:
                continue
            file_path = os.path.join(repo_root, module, relative_go_path)

            if "gocognit" in exc.get("complexity", {}):
                baseline_val = int(exc["complexity"]["gocognit"])
                result = run_go_tool(repo_root, ["run", GOCONGNIT_MODULE, "-over", "-1", file_path], env_overrides)
                if result.returncode != 0:
                    complexity_fails.append(f"{exc.get('file')} {exc.get('path')}: gocognit tool failed (pinned {GOCONGNIT_MODULE}): {format_native_output((result.stdout + result.stderr).splitlines())}")
                    continue
                actual_max = 0
                for line in (result.stdout + result.stderr).splitlines():
                    leading = re.match(r"^(\d+)", line)
                    if leading:
                        actual_max = max(actual_max, int(leading.group(1)))
                if actual_max > baseline_val:
                    complexity_fails.append(f"{exc.get('file')} {exc.get('path')}: gocognit actual={actual_max}, baseline={baseline_val} (budget exceeded)")

            if "gocyclo" in exc.get("complexity", {}):
                baseline_val = int(exc["complexity"]["gocyclo"])
                result = run_go_tool(repo_root, ["run", GOCYCLO_MODULE, "-over", "-1", file_path], env_overrides)
                if result.returncode != 0:
                    complexity_fails.append(f"{exc.get('file')} {exc.get('path')}: gocyclo tool failed (pinned {GOCYCLO_MODULE}): {format_native_output((result.stdout + result.stderr).splitlines())}")
                    continue
                actual_max = 0
                for line in (result.stdout + result.stderr).splitlines():
                    leading = re.match(r"^(\d+)", line)
                    if leading:
                        actual_max = max(actual_max, int(leading.group(1)))
                if actual_max > baseline_val:
                    complexity_fails.append(f"{exc.get('file')} {exc.get('path')}: gocyclo actual={actual_max}, baseline={baseline_val} (budget exceeded)")

        if len(complexity_fails) == 0:
            pass_line("all complexity budgets respected")
        else:
            for complexity_fail in complexity_fails:
                fail_line("QDR-COMPLEXITY", complexity_fail)
    else:
        pass_line("complexity check skipped (--SkipComplexity)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Quality-debt ratchet verifier (#1536)")
    parser.add_argument("--SkipComplexity", action="store_true", help="skip gocognit/gocyclo budget execution")
    parser.add_argument("--SkipZombieCheck", action="store_true", help="skip zombie baseline entry checks")
    parser.add_argument("--SkipHistoricalRatchet", action="store_true", help="skip base-baseline regression comparison")
    parser.add_argument("--RepoRootPath", default="", help="repository root (defaults to two levels above this script)")
    parser.add_argument("--BaselinePath", default="", help="quality-debt baseline JSON path")
    parser.add_argument("--BaseBaselinePath", default="", help="base baseline JSON path (overrides git lookups)")
    parser.add_argument("--BaseRef", default="", help="git ref whose baseline to compare against")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRootPath) if args.RepoRootPath else os.path.realpath(os.path.join(SCRIPT_DIR, "..", ".."))
    baseline_path = args.BaselinePath or os.path.join(repo_root, "scripts", "verify", "quality-debt-baseline.json")

    # ── Load baseline ─────────────────────────────────────────────────────
    if not os.path.exists(baseline_path):
        fail_line("QDR-BASELINE-MISSING", f"baseline missing: {baseline_path}")
        return 1
    baseline = read_json(baseline_path)

    # ── 7. Schema completeness ────────────────────────────────────────────
    check_schema(baseline, repo_root)

    # ── Load checks.yml ───────────────────────────────────────────────────
    workflow_path = os.path.join(repo_root, ".github", "workflows", "checks.yml")
    workflow_lines = read_lines(workflow_path)

    # ── 1. continue-on-error registration (forward) ──────────────────────
    found_continue_on_error = check_continue_on_error_registration(baseline, workflow_lines)

    # ── 3. Zombie check: baseline soft_gates with no matching gate ───────
    check_zombie_gates(baseline, found_continue_on_error, args.SkipZombieCheck)

    # ── 9. Runtime dependency mutation ───────────────────────────────────
    check_runtime_dependency_mutation(workflow_lines)

    # ── 2. exclusion registration (forward) ──────────────────────────────
    actual_exclusions = check_exclusion_registration(baseline, repo_root)

    # ── 4. Zombie check: baseline entries with no matching config rule ───
    check_zombie_exclusions(baseline, actual_exclusions, args.SkipZombieCheck)

    # ── 5. Linter set match ──────────────────────────────────────────────
    check_linter_sets(baseline, repo_root)

    # ── 10. Historical baseline ratchet ──────────────────────────────────
    check_historical_ratchet(baseline, repo_root, args.SkipHistoricalRatchet, args.BaseBaselinePath, args.BaseRef)

    # ── 6. Complexity ratchet ────────────────────────────────────────────
    check_complexity(baseline, repo_root, args.SkipComplexity)

    # ── Summary ──────────────────────────────────────────────────────────
    print()
    if failed > 0:
        print(f"Quality-debt ratchet: {failed} FAIL, {passed} pass")
        return 1
    print(f"Quality-debt ratchet: {passed} pass")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
