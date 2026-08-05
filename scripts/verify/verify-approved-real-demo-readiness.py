#!/usr/bin/env python3
"""AgentHub approved-real/no-secret demo readiness runner — ps1 迁移。

Composes existing no-spend gates into a redacted manifest for a recordable
Web -> Hub -> Desktop/Edge -> mock adapter -> replay demo rehearsal. It never
performs TokenDanceID login, real CLI/model/API calls, deployment, signing,
release upload, or Mobile work.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot/--ArtifactRoot/--ManifestPath/--PreflightManifestPath/
--WebSmokeManifestPath/--SkipObservedFixture/--RunLocalStackSmoke/--TimeoutSec，
0=通过，-TimeoutSec<=0 → 2）；机器可读行格式（PASS:/FAIL:/WARN:/Status）与 ps1
完全一致。子门禁：verify-localhost-observed-loop / verify-localhost-real-stack-smoke
仍为 ps1（未迁移）经 pwsh 调用；verify-approved-real-preflight 已迁移为本目录 .py
经 python 调用。
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

SECRET_LIKE_PATTERN = re.compile(
    r"(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|"
    r"-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|"
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)

failures = []
warnings_list = []
segments = []
manifest_files = []


def add_failure(text: str) -> None:
    failures.append(text)
    print(f"FAIL: {text}")


def add_warning(text: str) -> None:
    warnings_list.append(text)
    print(f"WARN: {text}")


def pass_check(text: str) -> None:
    print(f"PASS: {text}")


def redact_secret_like(value: str) -> str:
    if not value:
        return value
    safe = value
    safe = re.sub(r"(Authorization:\s*Bearer\s+)[^\"'\s,}]+", r"\1<redacted-token>", safe, flags=re.IGNORECASE)
    safe = re.sub(r"(bearer\s+)[a-z0-9._-]{12,}", r"\1<redacted-token>", safe, flags=re.IGNORECASE)
    safe = re.sub(r"(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}", "<redacted-token>", safe, flags=re.IGNORECASE)
    safe = re.sub(
        r"((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password|api[_-]?key)\s*[=:]\s*)[^\"'\s,}]+",
        r"\1<redacted-secret>",
        safe,
        flags=re.IGNORECASE,
    )
    safe = re.sub(
        r"(\"?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password|api[_-]?key)\"?\s*:\s*\")[^\"]+",
        r"\1<redacted-secret>",
        safe,
        flags=re.IGNORECASE,
    )
    return safe


def test_path_under_root(path: str, root: str) -> bool:
    normalized = os.path.abspath(os.path.normpath(path)).rstrip("\\/")
    normalized_root = os.path.abspath(os.path.normpath(root)).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    prefix = normalized_root + os.sep
    return normalized.lower().startswith(prefix.lower())


def test_allowed_artifact_root(repo_root: str, path: str) -> bool:
    temp_base = os.environ.get("TEMP") or os.environ.get("TMP") or tempfile.gettempdir()
    roots = [
        os.path.join(repo_root, ".tmp", "approved-real-demo-readiness"),
        os.path.join(repo_root, "tmp", "approved-real-demo-readiness"),
        os.path.join(temp_base, "AgentHub", "approved-real-demo-readiness"),
    ]
    for root in roots:
        if test_path_under_root(path, root):
            return True
    return False


def find_powershell() -> str:
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_repo_script(repo_root: str, relative_path: str, arguments) -> dict:
    script_path = os.path.join(repo_root, relative_path)
    powershell_exe = find_powershell()
    if not powershell_exe:
        return {"ExitCode": -1, "Output": "PowerShell executable is unavailable", "ScriptPath": script_path}
    if not os.path.isfile(script_path):
        return {"ExitCode": -1, "Output": f"missing {relative_path}", "ScriptPath": script_path}

    run_result = subprocess.run(
        [powershell_exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path] + arguments,
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = redact_secret_like((run_result.stdout or "") + "\n" + (run_result.stderr or ""))
    return {"ExitCode": run_result.returncode, "Output": output, "ScriptPath": script_path}


def invoke_repo_python(repo_root: str, relative_path: str, arguments) -> dict:
    script_path = os.path.join(repo_root, relative_path)
    if not os.path.isfile(script_path):
        return {"ExitCode": -1, "Output": f"missing {relative_path}", "ScriptPath": script_path}

    run_result = subprocess.run(
        [sys.executable, script_path] + arguments,
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = redact_secret_like((run_result.stdout or "") + "\n" + (run_result.stderr or ""))
    return {"ExitCode": run_result.returncode, "Output": output, "ScriptPath": script_path}


def add_segment(name: str, mode: str, exit_code, evidence: str, output: str) -> None:
    status = "PASS" if exit_code == 0 else "FAIL"
    output_text = output or ""
    segments.append(
        {
            "name": name,
            "mode": mode,
            "status": status,
            "exit_code": exit_code,
            "evidence": evidence,
            "output_excerpt": output_text[:1200] if len(output_text) > 1200 else output_text,
        }
    )
    if exit_code == 0:
        pass_check(name)
    else:
        add_failure(f"{name} failed")


def resolve_input_path(repo_root: str, path: str) -> str:
    if not path.strip():
        return ""
    if os.path.isabs(path):
        return os.path.abspath(os.path.normpath(path))
    return os.path.abspath(os.path.normpath(os.path.join(repo_root, path)))


def copy_evidence_file(source_path: str, relative_name: str, evidence_dir: str) -> str:
    if not source_path or not os.path.isfile(source_path):
        return ""

    destination = os.path.join(evidence_dir, relative_name)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(source_path, encoding="utf-8") as handle:
        content = handle.read()
    content = redact_secret_like(content)
    with open(destination, "w", encoding="utf-8") as handle:
        handle.write(content)
    return destination


def get_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_manifest_file(path: str, artifact_root: str) -> None:
    if not path or not os.path.isfile(path):
        return

    full_path = os.path.abspath(os.path.normpath(path))
    root = os.path.abspath(os.path.normpath(artifact_root)).rstrip("\\/")
    relative = full_path[len(root):].lstrip("\\/").replace("\\", "/")
    manifest_files.append(
        {
            "path": relative,
            "sha256": get_sha256(path),
            "bytes": os.path.getsize(path),
        }
    )


def write_json_file(value, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json_text = json.dumps(value, indent=2)
    json_text = redact_secret_like(json_text)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(json_text)


def test_web_smoke_manifest_observed(repo_root: str, paths) -> bool:
    for raw_path in paths:
        path = resolve_input_path(repo_root, raw_path)
        if not os.path.isfile(path):
            add_warning(f"Web smoke manifest missing: {raw_path}")
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                manifest = json.loads(handle.read())
            if (
                manifest.get("dataMode") == "approved-real"
                and manifest.get("directLocalEdge") is False
                and manifest.get("realCliOrModelExecuted") is False
            ):
                return True
        except (ValueError, OSError):
            add_warning(f"Web smoke manifest is unreadable: {raw_path}")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--ArtifactRoot", default="", help="artifact output root (defaults under .tmp/approved-real-demo-readiness)")
    parser.add_argument("--ManifestPath", default="", help="redacted manifest output path")
    parser.add_argument("--PreflightManifestPath", default="", help="approved-real preflight manifest input")
    parser.add_argument("--WebSmokeManifestPath", nargs="*", default=[], help="web smoke manifest input paths")
    parser.add_argument("--SkipObservedFixture", action="store_true", help="skip the observed fixture replay gate")
    parser.add_argument("--RunLocalStackSmoke", action="store_true", help="run the local stack smoke gate")
    parser.add_argument("--TimeoutSec", type=int, default=12, help="child gate timeout in seconds")
    args = parser.parse_args()

    timeout_sec = args.TimeoutSec
    if timeout_sec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.")
        return 2

    repo_root = os.path.realpath(args.RepoRoot)

    if not args.ArtifactRoot.strip():
        artifact_root = os.path.join(repo_root, ".tmp", "approved-real-demo-readiness", f"run-{os.getpid()}")
    elif not os.path.isabs(args.ArtifactRoot):
        artifact_root = os.path.join(repo_root, args.ArtifactRoot)
    else:
        artifact_root = args.ArtifactRoot
    artifact_root = os.path.abspath(os.path.normpath(artifact_root))

    if not args.ManifestPath.strip():
        manifest_path = os.path.join(artifact_root, "redacted-manifest.json")
    elif not os.path.isabs(args.ManifestPath):
        manifest_path = os.path.join(repo_root, args.ManifestPath)
    else:
        manifest_path = args.ManifestPath
    manifest_path = os.path.abspath(os.path.normpath(manifest_path))

    evidence_dir = os.path.join(artifact_root, "evidence")
    generated_at = datetime.now().astimezone()

    print("AgentHub approved-real/no-secret demo readiness")
    print("Boundary: no real TokenDanceID login, no real CLI/model/API, no deploy/signing/release, no Mobile.")

    if not test_allowed_artifact_root(repo_root, artifact_root):
        add_failure("ArtifactRoot must stay under .tmp\\approved-real-demo-readiness, tmp\\approved-real-demo-readiness, or $env:TEMP\\AgentHub\\approved-real-demo-readiness")
    if not test_path_under_root(manifest_path, artifact_root):
        add_failure("ManifestPath must stay under ArtifactRoot")

    os.makedirs(artifact_root, exist_ok=True)
    os.makedirs(evidence_dir, exist_ok=True)

    observed_gate_root = os.path.join(repo_root, ".tmp", "localhost-observed-loop", f"approved-real-demo-{os.getpid()}")
    observed_manifest = os.path.join(observed_gate_root, "observed-dispatch-manifest.json")
    observed_report = os.path.join(observed_gate_root, "observed-dispatch-report.json")
    observed_passed = False

    if len(failures) == 0 and not args.SkipObservedFixture:
        observed_run = invoke_repo_script(
            repo_root,
            "scripts\\smoke\\verify-localhost-observed-loop.ps1",
            [
                "-RepoRoot", repo_root,
                "-Mode", "FixtureManifest",
                "-ArtifactRoot", observed_gate_root,
                "-ManifestPath", observed_manifest,
                "-ObservedDispatchReportPath", observed_report,
                "-TimeoutSec", str(timeout_sec),
            ],
        )
        add_segment("localhost_observed_fixture_replay", "fixture-observed", observed_run["ExitCode"], observed_manifest, observed_run["Output"])
        observed_passed = observed_run["ExitCode"] == 0

    local_stack_gate_root = os.path.join(repo_root, ".tmp", "localhost-real-stack-smoke", f"approved-real-demo-{os.getpid()}")
    local_stack_evidence = os.path.join(local_stack_gate_root, "localhost-real-stack-smoke.json")
    if len(failures) == 0 and args.RunLocalStackSmoke:
        local_stack_run = invoke_repo_script(
            repo_root,
            "scripts\\smoke\\verify-localhost-real-stack-smoke.ps1",
            [
                "-RepoRoot", repo_root,
                "-ArtifactRoot", local_stack_gate_root,
                "-EvidencePath", local_stack_evidence,
                "-SkipWeb",
                "-SkipDesktop",
                "-ProbeHub",
                "-TimeoutSec", str(timeout_sec),
            ],
        )
        add_segment("localhost_real_stack_smoke", "mock-sqlite-readiness", local_stack_run["ExitCode"], local_stack_evidence, local_stack_run["Output"])
    elif not args.RunLocalStackSmoke:
        segments.append(
            {
                "name": "localhost_real_stack_smoke",
                "mode": "optional",
                "status": "NOT_RUN",
                "exit_code": None,
                "evidence": "",
                "output_excerpt": "Use -RunLocalStackSmoke to start/probe the safe Local Edge mock+SQLite subset.",
            }
        )

    preflight_status = "NOT_PROVIDED"
    preflight_copy = ""
    if args.PreflightManifestPath.strip():
        resolved_preflight = resolve_input_path(repo_root, args.PreflightManifestPath)
        preflight_copy = copy_evidence_file(resolved_preflight, "approved-real-preflight.json", evidence_dir)
        preflight_run = invoke_repo_python(
            repo_root,
            "scripts\\verify\\verify-approved-real-preflight.py",
            ["--RepoRoot", repo_root, "--ManifestPath", resolved_preflight],
        )
        add_segment("approved_real_preflight_manifest", "approval-gate", preflight_run["ExitCode"], preflight_copy, preflight_run["Output"])
        preflight_status = "VALIDATED" if preflight_run["ExitCode"] == 0 else "BLOCKED"

    for raw_web_smoke in args.WebSmokeManifestPath:
        resolved_web_smoke = resolve_input_path(repo_root, raw_web_smoke)
        name = "web-smoke-" + os.path.basename(resolved_web_smoke)
        copy_evidence_file(resolved_web_smoke, name, evidence_dir)

    copy_evidence_file(observed_manifest, "localhost-observed-loop/observed-dispatch-manifest.json", evidence_dir)
    copy_evidence_file(observed_report, "localhost-observed-loop/observed-dispatch-report.json", evidence_dir)
    if os.path.isfile(local_stack_evidence):
        copy_evidence_file(local_stack_evidence, "localhost-real-stack-smoke.json", evidence_dir)

    web_replay_observed = observed_passed or test_web_smoke_manifest_observed(repo_root, args.WebSmokeManifestPath)
    ready_for_approval = len(failures) == 0 and web_replay_observed
    status = "READY_FOR_APPROVAL" if ready_for_approval else "BLOCKED"
    if preflight_status == "BLOCKED":
        status = "BLOCKED"

    evidence_files = sorted(
        os.path.join(dirpath, name)
        for dirpath, _, names in os.walk(evidence_dir)
        for name in names
        if os.path.isfile(os.path.join(dirpath, name))
    )
    for evidence_file in evidence_files:
        add_manifest_file(evidence_file, artifact_root)

    demo_fields = {
        "RealLoginTested": False,
        "RealCliTested": False,
        "MockAdapterUsed": True,
        "HubSessionSource": "fixture-observed-hub-replay" if web_replay_observed else "not-observed",
        "WebReplayObserved": bool(web_replay_observed),
    }

    manifest = {
        "schema": "agenthub-redacted-evidence-manifest-v1",
        "status": status,
        "generated_at": generated_at.isoformat(),
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "evidence_boundary": {
            "label": "approved-real",
            "real_tested": False,
            "readiness_only": True,
            "no_secret": True,
            "note": "approved-real/no-secret demo readiness only; not proof of real login or real CLI/model/API execution",
        },
        "redaction": {
            "status": "passed",
            "policy": "text evidence is copied into this package after secret-like value redaction",
        },
        "RealLoginTested": demo_fields["RealLoginTested"],
        "RealCliTested": demo_fields["RealCliTested"],
        "MockAdapterUsed": demo_fields["MockAdapterUsed"],
        "HubSessionSource": demo_fields["HubSessionSource"],
        "WebReplayObserved": demo_fields["WebReplayObserved"],
        "demo_readiness": demo_fields,
        "gates": {
            "approved_real_preflight": preflight_status,
            "observed_fixture_replay": "PASS" if observed_passed else ("SKIPPED" if args.SkipObservedFixture else "FAIL"),
            "localhost_real_stack_smoke": "SEE_SEGMENT" if args.RunLocalStackSmoke else "NOT_RUN",
        },
        "topology": {
            "chain": "Web -> Hub -> Desktop/Edge -> mock adapter -> Hub replay -> Web",
            "web": "http://127.0.0.1:5174",
            "hub": "http://127.0.0.1:8080",
            "desktop_bridge": "http://127.0.0.1:5173",
            "local_edge": "http://127.0.0.1:3210",
            "adapter": "fixture-sdk-adapter",
        },
        "approval": {
            "status": "approved_preflight_manifest_validated" if preflight_status == "VALIDATED" else "operator_approval_required",
            "ready_for_approval": bool(status == "READY_FOR_APPROVAL"),
            "real_recording_requires_secrets_or_safe_env": True,
        },
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked": False,
            "real_api_budget_spend": False,
            "public_deploy_used": False,
            "signing_or_release_used": False,
            "mobile_touched": False,
        },
        "segments": list(segments),
        "files": list(manifest_files),
        "blockers": [
            "real TokenDanceID login still requires approved safe env or no-secret browser evidence",
            "real CLI/model/API execution remains untested and must not run without separate approval",
            "recording still needs a human-approved run plan and capture of the local Web/Desktop surfaces",
        ],
        "failures": list(failures),
        "warnings": list(warnings_list),
    }

    write_json_file(manifest, manifest_path)
    manifest_files.clear()
    for evidence_file in evidence_files:
        add_manifest_file(evidence_file, artifact_root)
    manifest["files"] = list(manifest_files)
    write_json_file(manifest, manifest_path)

    print(f"ManifestPath: {manifest_path}")
    print("RealLoginTested=false")
    print("RealCliTested=false")
    print("MockAdapterUsed=true")
    print(f"HubSessionSource={demo_fields['HubSessionSource']}")
    print(f"WebReplayObserved={demo_fields['WebReplayObserved']}")
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
