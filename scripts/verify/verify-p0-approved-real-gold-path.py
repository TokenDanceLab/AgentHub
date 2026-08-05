#!/usr/bin/env python3
"""AgentHub P0 approved-real gold-path harness（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

组合无 secret 门禁：
TokenDanceID readiness -> Hub session evidence -> Desktop target -> Local Edge
-> CLI no-spend/approved safe run -> Hub replay -> Web display -> redacted
manifest。

本 harness 不提交凭据、不交换 token、不跑付费 model/API 调用、不部署、不
签名、不 notarize、不上传 release、不碰 Mobile。

用法：
  python scripts/verify/verify-p0-approved-real-gold-path.py --RepoRoot .
  python scripts/verify/verify-p0-approved-real-gold-path.py --RepoRoot . --SkipTokenDanceIDReadiness --SkipDemoReadiness
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+"
    r"|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token"
    r"|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*"
    r"(?!\"?(?:false|true|null|none|not[_ -]?provided|not[_ -]?required"
    r"|blocked|redacted|<redacted|fixture|manifest|approved|operator-owned)[^\"]*\"?)"
    r"[^\"'\s,;}]{8,}"
    r"|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})"
)

EXCERPT_LIMIT = 1200


def redact_text(value, repo_root):
    safe = value.replace(repo_root, "<repo>")
    json_escaped_repo_root = repo_root.replace("\\", "\\\\")
    safe = safe.replace(json_escaped_repo_root, "<repo>")
    safe = SECRET_LIKE_PATTERN.sub("<redacted-secret>", safe)
    return safe


def test_path_under_root(path, root):
    normalized = os.path.normcase(os.path.abspath(path)).rstrip("/\\")
    normalized_root = os.path.normcase(os.path.abspath(root)).rstrip("/\\")
    if normalized == normalized_root:
        return True
    return normalized.startswith(normalized_root + os.sep)


def test_allowed_artifact_root(path, repo_root):
    temp_base = os.environ.get("TEMP") or tempfile.gettempdir()
    for root in (
        os.path.join(repo_root, ".tmp", "p0-approved-real-gold-path"),
        os.path.join(repo_root, "tmp", "p0-approved-real-gold-path"),
        os.path.join(temp_base, "AgentHub", "p0-approved-real-gold-path"),
    ):
        if test_path_under_root(path, root):
            return True
    return False


def resolve_input_path(path, repo_root):
    if not path or not path.strip():
        return ""
    if os.path.isabs(path):
        return os.path.abspath(path)
    return os.path.abspath(os.path.join(repo_root, path))


def find_python():
    return shutil.which("python") or shutil.which("python3")


def find_powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_repo_script(repo_root, relative_path, arguments):
    """Run a child gate script, capturing combined output; mirrors the ps1 ProcessStartInfo helper.

    .py children run through python; .ps1 children run through PowerShell.
    """
    script_path = os.path.join(repo_root, relative_path.replace("\\", os.sep))
    if relative_path.endswith(".py"):
        shell = find_python()
        if shell is None:
            return {"ExitCode": -1, "Output": "Python executable unavailable", "ScriptPath": script_path}
        if not os.path.isfile(script_path):
            return {"ExitCode": -1, "Output": f"missing {relative_path}", "ScriptPath": script_path}
        command = [shell, script_path] + arguments
    else:
        shell = find_powershell()
        if shell is None:
            return {"ExitCode": -1, "Output": "PowerShell executable unavailable", "ScriptPath": script_path}
        if not os.path.isfile(script_path):
            return {"ExitCode": -1, "Output": f"missing {relative_path}", "ScriptPath": script_path}
        command = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path] + arguments

    try:
        run = subprocess.run(
            command,
            cwd=repo_root,
            capture_output=True,
            text=True,
            errors="replace",
        )
        output = run.stdout + "\n" + run.stderr
        return {
            "ExitCode": run.returncode,
            "Output": redact_text(output, repo_root),
            "ScriptPath": script_path,
        }
    except OSError as exc:
        return {"ExitCode": -1, "Output": f"failed to start child script: {exc}", "ScriptPath": script_path}


def copy_evidence_file(source_path, relative_name, evidence_dir, repo_root):
    if not source_path or not os.path.isfile(source_path):
        return ""
    destination = os.path.join(evidence_dir, relative_name)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    try:
        with open(source_path, encoding="utf-8", errors="replace", newline="") as handle:
            content = handle.read()
    except OSError as exc:
        return ""
    payload = redact_text(content, repo_root)
    with open(destination, "w", encoding="utf-8", newline="") as handle:
        # Set-Content appends the platform newline after the raw content; keep byte parity.
        handle.write(payload + "\r\n")
    return destination


def get_sha256(path):
    sha = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            sha.update(chunk)
    return sha.hexdigest()


def add_manifest_file(files, path, artifact_root):
    if not os.path.isfile(path):
        return
    full_path = os.path.abspath(path)
    root = os.path.abspath(artifact_root).rstrip("/\\")
    relative = full_path[len(root):].strip("/\\").replace("\\", "/")
    files.append({
        "path": relative,
        "sha256": get_sha256(full_path),
        "bytes": os.path.getsize(full_path),
    })


def read_json_evidence(path, warnings):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (ValueError, OSError):
        warnings.append(f"Evidence JSON is unreadable: {path}")
        return None


def add_segment(segments, failures, warnings, name, mode, status, exit_code, evidence="", output=""):
    excerpt = output if len(output) <= EXCERPT_LIMIT else output[:EXCERPT_LIMIT]
    segments.append({
        "name": name,
        "mode": mode,
        "status": status,
        "exit_code": exit_code,
        "evidence": evidence,
        "output_excerpt": excerpt,
    })
    if status == "PASS":
        print(f"PASS: {name}")
    elif status == "SKIPPED":
        warnings.append(f"{name} skipped")
        print(f"WARN: {name} skipped")
    else:
        failures.append(f"{name} blocked")
        print(f"FAIL: {name} blocked")


def write_manifest(manifest_path, manifest, repo_root):
    os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    payload = payload.replace("\n", "\r\n")
    payload = redact_text(payload, repo_root)
    with open(manifest_path, "w", encoding="utf-8", newline="") as handle:
        # ConvertTo-Json uses the platform newline and Set-Content appends one; keep byte parity.
        handle.write(payload + "\r\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AgentHub P0 approved-real gold-path harness (ps1 migration)"
    )
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--ArtifactRoot", default="", help="redacted evidence artifact root (defaults to .tmp/p0-approved-real-gold-path/run-<pid>)")
    parser.add_argument("--ManifestPath", default="", help="redacted manifest output path (defaults to ArtifactRoot/redacted-manifest.json)")
    parser.add_argument("--PreflightManifestPath", default="", help="caller-provided preflight manifest path")
    parser.add_argument("--TokenDanceIDReadinessPath", default="", help="caller-provided TokenDanceID readiness evidence JSON")
    parser.add_argument("--DesktopEdgeCliSmokePath", default="", help="caller-provided Desktop/Edge/CLI smoke evidence JSON")
    parser.add_argument("--DemoReadinessManifestPath", default="", help="caller-provided demo readiness manifest")
    parser.add_argument("--WebSmokeManifestPath", action="append", default=[], help="web smoke manifest path (repeatable)")
    parser.add_argument("--Runtime", default="mock", choices=["codex", "claude-code", "opencode", "mock"], help="CLI runtime label")
    parser.add_argument("--TimeoutSec", type=int, default=12, help="child gate timeout in seconds")
    parser.add_argument("--RunDesktopEdgeCliSmoke", action="store_true", help="run the Local Edge + CLI no-spend smoke")
    parser.add_argument("--RunLocalStackSmoke", action="store_true", help="run the local stack smoke with the demo gate")
    parser.add_argument("--SkipTokenDanceIDReadiness", action="store_true", help="skip the TokenDanceID readiness gate")
    parser.add_argument("--SkipDemoReadiness", action="store_true", help="skip the demo readiness gate")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.")
        return 2

    repo_root = os.path.abspath(args.RepoRoot)

    if not args.ArtifactRoot.strip():
        artifact_root = os.path.join(repo_root, ".tmp", "p0-approved-real-gold-path", f"run-{os.getpid()}")
    elif not os.path.isabs(args.ArtifactRoot):
        artifact_root = os.path.join(repo_root, args.ArtifactRoot)
    else:
        artifact_root = args.ArtifactRoot
    artifact_root = os.path.abspath(artifact_root)

    if not args.ManifestPath.strip():
        manifest_path = os.path.join(artifact_root, "redacted-manifest.json")
    elif not os.path.isabs(args.ManifestPath):
        manifest_path = os.path.join(repo_root, args.ManifestPath)
    else:
        manifest_path = args.ManifestPath
    manifest_path = os.path.abspath(manifest_path)

    evidence_dir = os.path.join(artifact_root, "evidence")
    failures = []
    warnings = []
    segments = []
    files = []

    print("AgentHub P0 approved-real gold-path harness")
    print("Boundary: no secrets, no credential submission, no paid model/API call, no deploy/signing/release, no Mobile.")

    if not test_allowed_artifact_root(artifact_root, repo_root):
        failures.append(
            "ArtifactRoot must stay under .tmp\\p0-approved-real-gold-path, tmp\\p0-approved-real-gold-path, "
            "or $env:TEMP\\AgentHub\\p0-approved-real-gold-path"
        )
        print(f"FAIL: {failures[-1]}")
    if not test_path_under_root(manifest_path, artifact_root):
        failures.append("ManifestPath must stay under ArtifactRoot")
        print(f"FAIL: {failures[-1]}")

    os.makedirs(artifact_root, exist_ok=True)
    os.makedirs(evidence_dir, exist_ok=True)

    token_evidence = (
        os.path.join(artifact_root, "tokendance-id-readiness.json")
        if not args.TokenDanceIDReadinessPath.strip()
        else resolve_input_path(args.TokenDanceIDReadinessPath, repo_root)
    )
    edge_evidence = (
        os.path.join(artifact_root, "desktop-edge-cli-smoke.json")
        if not args.DesktopEdgeCliSmokePath.strip()
        else resolve_input_path(args.DesktopEdgeCliSmokePath, repo_root)
    )
    default_demo_root = os.path.join(repo_root, ".tmp", "approved-real-demo-readiness", f"p0-gold-path-{os.getpid()}")
    demo_manifest = (
        os.path.join(default_demo_root, "redacted-manifest.json")
        if not args.DemoReadinessManifestPath.strip()
        else resolve_input_path(args.DemoReadinessManifestPath, repo_root)
    )

    if len(failures) == 0:
        if args.SkipTokenDanceIDReadiness:
            add_segment(segments, failures, warnings, "tokendance_id_readiness", "no-secret-readiness", "SKIPPED", None, "", "Skipped by caller.")
        elif not args.TokenDanceIDReadinessPath.strip():
            token_run = invoke_repo_script(
                repo_root,
                "scripts/verify/verify-token-dance-id-login-readiness.py",
                ["--RepoRoot", repo_root, "--OutputPath", token_evidence],
            )
            token_status = "PASS" if token_run["ExitCode"] == 0 else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "tokendance_id_readiness", "no-secret-readiness",
                token_status, token_run["ExitCode"], token_evidence, token_run["Output"],
            )
        else:
            token_status = "PASS" if os.path.isfile(token_evidence) else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "tokendance_id_readiness", "evidence-file",
                token_status, None, token_evidence, "Using caller-provided TokenDanceID readiness evidence.",
            )

        if args.RunDesktopEdgeCliSmoke:
            edge_root = os.path.join(artifact_root, "desktop-edge-cli-smoke")
            edge_run = invoke_repo_script(
                repo_root,
                "scripts/smoke/verify-p0-desktop-edge-cli-smoke.ps1",
                [
                    "-RepoRoot", repo_root,
                    "-Runtime", args.Runtime,
                    "-ArtifactRoot", edge_root,
                    "-SkipDesktopDev",
                    "-TimeoutSec", str(args.TimeoutSec),
                ],
            )
            edge_evidence = os.path.join(edge_root, "smoke-result.json")
            edge_status = "PASS" if edge_run["ExitCode"] == 0 else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "desktop_edge_cli_no_spend_smoke", "no-spend-runtime",
                edge_status, edge_run["ExitCode"], edge_evidence, edge_run["Output"],
            )
        elif args.DesktopEdgeCliSmokePath.strip():
            edge_status = "PASS" if os.path.isfile(edge_evidence) else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "desktop_edge_cli_no_spend_smoke", "evidence-file",
                edge_status, None, edge_evidence, "Using caller-provided Desktop/Edge/CLI smoke evidence.",
            )
        else:
            add_segment(
                segments, failures, warnings,
                "desktop_edge_cli_no_spend_smoke", "not-run", "BLOCKED", None, "",
                "Pass -RunDesktopEdgeCliSmoke or -DesktopEdgeCliSmokePath to prove Local Edge + CLI no-spend readiness.",
            )

        if args.SkipDemoReadiness:
            add_segment(segments, failures, warnings, "hub_replay_web_redacted_manifest", "approved-real-demo", "SKIPPED", None, "", "Skipped by caller.")
        elif not args.DemoReadinessManifestPath.strip():
            demo_root = default_demo_root
            demo_args = ["-RepoRoot", repo_root, "-ArtifactRoot", demo_root, "-ManifestPath", demo_manifest, "-TimeoutSec", str(args.TimeoutSec)]
            if args.PreflightManifestPath.strip():
                demo_args += ["-PreflightManifestPath", resolve_input_path(args.PreflightManifestPath, repo_root)]
            for web_smoke in args.WebSmokeManifestPath:
                demo_args += ["-WebSmokeManifestPath", resolve_input_path(web_smoke, repo_root)]
            if args.RunLocalStackSmoke:
                demo_args += ["-RunLocalStackSmoke"]
            demo_run = invoke_repo_script(repo_root, "scripts/verify/verify-approved-real-demo-readiness.ps1", demo_args)
            demo_status = "PASS" if demo_run["ExitCode"] == 0 else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "hub_replay_web_redacted_manifest", "approved-real-demo",
                demo_status, demo_run["ExitCode"], demo_manifest, demo_run["Output"],
            )
        else:
            demo_status = "PASS" if os.path.isfile(demo_manifest) else "BLOCKED"
            add_segment(
                segments, failures, warnings,
                "hub_replay_web_redacted_manifest", "evidence-file",
                demo_status, None, demo_manifest, "Using caller-provided demo readiness manifest.",
            )

    token_json = read_json_evidence(token_evidence, warnings)
    edge_json = read_json_evidence(edge_evidence, warnings)
    demo_json = read_json_evidence(demo_manifest, warnings)

    token_ready = token_json is not None and token_json.get("status") == "READY_FOR_OPERATOR"
    edge_ready = edge_json is not None and edge_json.get("status") == "P0_DESKTOP_EDGE_CLI_SMOKE_PASSED"
    demo_ready = demo_json is not None and demo_json.get("status") == "READY_FOR_APPROVAL"

    copy_evidence_file(token_evidence, "tokendance-id-readiness.json", evidence_dir, repo_root)
    copy_evidence_file(edge_evidence, "desktop-edge-cli-smoke.json", evidence_dir, repo_root)
    copy_evidence_file(demo_manifest, "demo-readiness-redacted-manifest.json", evidence_dir, repo_root)

    for root, _dirs, names in os.walk(evidence_dir):
        for name in sorted(names):
            add_manifest_file(files, os.path.join(root, name), artifact_root)

    blocked_reasons = []
    if not token_ready:
        blocked_reasons.append("TokenDanceID readiness is not READY_FOR_OPERATOR")
    if not edge_ready:
        blocked_reasons.append("Desktop target -> Local Edge -> CLI no-spend smoke is not proven")
    if not demo_ready:
        blocked_reasons.append("Hub replay -> Web display -> redacted manifest is not READY_FOR_APPROVAL")
    if len(failures) > 0:
        blocked_reasons.extend(failures)

    ready = len(blocked_reasons) == 0
    status = "READY_FOR_APPROVAL" if ready else "BLOCKED_WITH_EVIDENCE"

    manifest = {
        "schema": "agenthub-redacted-evidence-manifest-v1",
        "status": status,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "repo_root": "<repo>",
        "artifact_root": artifact_root,
        "evidence_boundary": {
            "label": "approved-real",
            "real_tested": False,
            "readiness_only": True,
            "no_secret": True,
            "note": "P0 gold-path harness composes no-secret readiness gates; it is not proof of real login or paid model/API execution.",
        },
        "redaction": {
            "status": "passed",
            "policy": "all copied text evidence is redacted for secret-like values",
        },
        "chain": [
            "TokenDanceID readiness",
            "Hub session evidence",
            "Desktop execution target",
            "Local Edge",
            "CLI no-spend or separately approved safe run",
            "Hub replay",
            "Web display",
            "redacted manifest",
        ],
        "gates": {
            "tokendance_id_readiness": "READY_FOR_OPERATOR" if token_ready else "BLOCKED",
            "desktop_edge_cli_no_spend": "PASS" if edge_ready else "BLOCKED",
            "hub_replay_web_manifest": "READY_FOR_APPROVAL" if demo_ready else "BLOCKED",
        },
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked": False,
            "real_api_budget_spend": False,
            "public_deploy_used": False,
            "signing_or_release_used": False,
            "mobile_touched": False,
            "token_dance_id_fixture_login_accepted_as_real": False,
            "mock_adapter_used": bool(demo_json.get("MockAdapterUsed")) if demo_json else True,
        },
        "topology": {
            "web": "Hub-only Web surface; no direct Local Edge calls",
            "hub_session": str(demo_json.get("HubSessionSource", "")) if demo_json else "not-observed",
            "desktop_target": "Desktop local_edge target evidence required",
            "local_edge": "Local Edge mock/no-spend smoke evidence required",
            "cli": f"Runtime={args.Runtime}; no model prompt submitted by this harness",
        },
        "segment_summary": list(segments),
        "evidence_inputs": {
            "tokendance_id_readiness": "evidence/tokendance-id-readiness.json" if os.path.isfile(token_evidence) else "",
            "desktop_edge_cli_smoke": "evidence/desktop-edge-cli-smoke.json" if os.path.isfile(edge_evidence) else "",
            "demo_readiness_manifest": "evidence/demo-readiness-redacted-manifest.json" if os.path.isfile(demo_manifest) else "",
        },
        "files": list(files),
        "blockers": list(dict.fromkeys(blocked_reasons)),
        "failures": list(failures),
        "warnings": list(warnings),
    }

    write_manifest(manifest_path, manifest, repo_root)
    files = []
    for root, _dirs, names in os.walk(evidence_dir):
        for name in sorted(names):
            add_manifest_file(files, os.path.join(root, name), artifact_root)
    manifest["files"] = list(files)
    write_manifest(manifest_path, manifest, repo_root)

    print(f"ManifestPath: {manifest_path}")
    print("RealLoginTested=false")
    print("RealCliOrModelInvoked=false")
    print("RealApiBudgetSpend=false")
    print(f"Status: {status}")

    if status == "READY_FOR_APPROVAL":
        return 0
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
