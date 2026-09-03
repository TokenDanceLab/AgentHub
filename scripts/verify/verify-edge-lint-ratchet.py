#!/usr/bin/env python3
"""Edge golangci-lint finding fingerprint ratchet (#1840) — 照抄 hub 棘轮 (#1573)。

Prevents Edge lint findings from growing or silently changing identity:
- every current finding is fingerprinted as (linter, relative file, message);
  the fingerprint EXCLUDES line/column so moves within a file do not reset debt;
- the baseline lives in scripts/verify/edge-lint-baseline.json;
- any finding NOT in the baseline FAILS closed (new finding, new linter rule,
  escalated severity all produce a new fingerprint);
- findings may only disappear from the live output (repayment); the baseline
  is then regenerated explicitly via --UpdateBaseline as the recorded approval
  step. Removing an entry without the linter no longer emitting it is a policy
  violation. --UpdateBaseline carries over the per-entry `reason` of surviving
  fingerprints so debt justifications are not silently dropped.

This is NOT a count ratchet: replacing one old finding with a different new
finding fails even when the total is unchanged.

Test seam: pass --LintJsonPath to compare against a pre-generated golangci-lint
JSON report instead of shelling out to the linter (used by the self-tests).
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LINT_VERSION = "v2.12.2"


def fail_verifier(message: str) -> None:
    raise RuntimeError(f"edge lint ratchet check failed: {message}")


def resolve_repo_root(script_dir: str, explicit: str) -> str:
    if explicit:
        return explicit
    github_workspace = os.environ.get("GITHUB_WORKSPACE")
    if github_workspace:
        return github_workspace
    if os.path.isdir(os.path.join(os.getcwd(), "edge-server")):
        return os.getcwd()
    return os.path.dirname(os.path.dirname(script_dir))


def get_live_fingerprints(report, module_dir: str) -> tuple:
    """Return (live fingerprints, stale-cache phantoms).

    module_dir is the absolute path of the linted module (…/edge-server); the
    phantom guard below needs it to tell a real finding from a cache artifact.
    """
    live = {}
    phantoms = []
    for issue in report.get("Issues", []):
        # gofmt is a formatter whose verdict drifts with the Go toolchain
        # version (CI go1.25 vs local go1.26 disagree on file sets); it is not
        # a stable lint fingerprint. Formatter compliance stays visible in the
        # Lint step output (which this job keeps advisory while debt remains).
        if issue.get("FromLinter") == "gofmt":
            continue
        # Normalize absolute runner paths to repo-relative (golangci-lint-action
        # runs with --path-mode=abs, so Filename is /home/runner/work/.../edge-server/...)
        raw = (issue.get("Pos") or {}).get("Filename", "").replace("\\", "/")
        # Phantom guard (#2270). golangci-lint keys its cache by file content, so
        # two worktrees holding identical files share cache entries — and a hit
        # replays the *other* tree's path. Once that tree is deleted the finding
        # is still reported, as a path that escapes this module directory.
        # Observed on clean master: gosec G101 findings under
        # ../.worktrees/int-round-66-go/edge-server/internal/jwtutil/, a directory that
        # existed nowhere on disk, with the finding set drifting between runs as
        # cache state changed. CI never saw it (every runner starts cold), so the
        # same gate was red locally and green in CI — and two round-67 lanes each
        # spent time concluding "pre-existing debt on base, unrelated to us".
        #
        # Reporting a phantom as new debt is worse than a red gate: the remedy
        # this script offers is --UpdateBaseline, which would register the
        # phantom fingerprint permanently and then mask the real finding it
        # shadows. So phantoms are refused outright, with the one-line remedy.
        #
        # Relative paths that stay inside module_dir are NOT existence-checked:
        # the self-tests drive this verifier with --LintJsonPath fixtures whose
        # files deliberately do not exist. CI's --path-mode=abs paths are checked
        # by the absolute branch.
        resolved = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(module_dir, raw))
        if os.path.commonpath([resolved, module_dir]) != module_dir or (
            os.path.isabs(raw) and not os.path.isfile(resolved)
        ):
            phantoms.append(raw)
            continue
        file = raw
        marker = "/edge-server/"
        idx = file.find(marker)
        if idx >= 0:
            file = file[idx + len(marker):]
        live[f"{issue.get('FromLinter')}|{file}|{issue.get('Text')}"] = True
    return live, phantoms


def get_baseline_entries(baseline_path: str) -> list:
    with open(baseline_path, encoding="utf-8-sig") as handle:
        baseline = json.load(handle)
    return baseline.get("findings", [])


def get_baseline_fingerprints(entries: list) -> dict:
    fingerprints = {}
    for entry in entries:
        file = (entry.get("file") or "").replace("\\", "/")
        fingerprints[f"{entry.get('linter')}|{file}|{entry.get('message')}"] = True
    return fingerprints


def find_unexpected_fingerprints(live: dict, baseline: dict) -> list:
    return sorted(fp for fp in live if fp not in baseline)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRootPath", default="", help="repository root (env GITHUB_WORKSPACE or cwd with edge-server/ used otherwise)")
    parser.add_argument("--LintJsonPath", default="", help="pre-generated golangci-lint JSON report (test seam; skips the linter run)")
    parser.add_argument("--UpdateBaseline", action="store_true", help="regenerate edge-lint-baseline.json from the live report and exit")
    args = parser.parse_args()

    repo_root = resolve_repo_root(SCRIPT_DIR, args.RepoRootPath)
    edge_dir = os.path.join(repo_root, "edge-server")
    baseline_path = os.path.join(repo_root, "scripts", "verify", "edge-lint-baseline.json")

    if not os.path.isdir(edge_dir):
        fail_verifier(f"edge-server directory not found at {edge_dir}")

    json_path = args.LintJsonPath
    if not json_path:
        json_path = os.path.join(tempfile.gettempdir(), "edge-lint-ratchet.json")
        lint_args = [
            "go", "run", f"github.com/golangci/golangci-lint/v2/cmd/golangci-lint@{LINT_VERSION}",
            "run", "./...", f"--output.json.path={json_path}",
        ]
        # Per-tree cache isolation (#2270): keying the cache directory by this
        # module's path makes cross-worktree cache hits — and therefore phantom
        # findings — impossible, while keeping repeat runs in the same tree warm.
        # An operator-set GOLANGCI_LINT_CACHE is honoured as the parent directory.
        cache_root = os.environ.get("GOLANGCI_LINT_CACHE") or os.path.expanduser("~/.cache")
        cache_dir = os.path.join(
            cache_root, f"golangci-lint-{hashlib.sha1(edge_dir.encode()).hexdigest()[:12]}"
        )
        lint_env = dict(os.environ, GOLANGCI_LINT_CACHE=cache_dir)
        lint_run = subprocess.run(lint_args, cwd=edge_dir, capture_output=True, text=True, env=lint_env)
        # exit code 1 means findings were reported (expected); anything else is a real failure
        if lint_run.returncode > 1:
            output = lint_run.stdout + "\n" + lint_run.stderr
            fail_verifier(f"golangci-lint crashed: {output}")

    if not os.path.isfile(json_path):
        fail_verifier(f"golangci-lint JSON report not found at {json_path}")

    with open(json_path, encoding="utf-8-sig") as handle:
        report = json.load(handle)
    live, phantoms = get_live_fingerprints(report, os.path.abspath(edge_dir))
    if phantoms:
        print("Lint finding(s) whose source file is not in this tree (stale cache, not debt):")
        for phantom in sorted(set(phantoms)):
            print(f"  {phantom}")
        fail_verifier(
            f"{len(set(phantoms))} stale-cache finding(s) — golangci-lint's cache holds entries "
            "from another worktree whose files have identical content (typically one that has "
            "since been deleted). Remedy: `golangci-lint cache clean`, then re-run. These are "
            "refused rather than counted, and this check runs before --UpdateBaseline so a "
            "phantom can never be registered as debt (#2270)."
        )

    baseline_entries = []
    if os.path.isfile(baseline_path):
        baseline_entries = get_baseline_entries(baseline_path)
    baseline_set = get_baseline_fingerprints(baseline_entries)

    if args.UpdateBaseline:
        prior_reasons = {}
        for entry in baseline_entries:
            file = (entry.get("file") or "").replace("\\", "/")
            prior_reasons[f"{entry.get('linter')}|{file}|{entry.get('message')}"] = entry.get("reason", "")
        entries = []
        for fp in sorted(live):
            linter, file, message = fp.split("|", 2)
            entry = {"linter": linter, "file": file, "message": message}
            if prior_reasons.get(fp):
                entry["reason"] = prior_reasons[fp]
            entries.append(entry)
        payload = {
            "_comment": (
                f"Edge golangci-lint finding fingerprint baseline (#1840). "
                f"Regenerated {datetime.now(timezone.utc).strftime('%Y-%m-%d')} with golangci-lint {LINT_VERSION}."
            ),
            "linter_version": LINT_VERSION,
            "findings": entries,
        }
        with open(baseline_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        print(f"Edge lint baseline updated ({len(entries)} fingerprints).")
        return 0

    if not os.path.isfile(baseline_path):
        fail_verifier(f"baseline not found at {baseline_path} (run with --UpdateBaseline to create)")

    unexpected = find_unexpected_fingerprints(live, baseline_set)
    if unexpected:
        print("New Edge lint finding(s) not in the fingerprint baseline:")
        for fp in unexpected:
            print(f"  {fp}")
        fail_verifier(
            f"{len(unexpected)} new finding(s) — repay or explicitly regenerate baseline with --UpdateBaseline"
        )

    print(f"Edge lint fingerprint ratchet PASS ({len(live)} findings, all baseline-registered).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
