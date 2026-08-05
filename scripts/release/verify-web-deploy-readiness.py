#!/usr/bin/env python3
"""AgentHub Web deploy readiness verifier — ps1 迁移。

Build-artifact deploy readiness verifier for AgentHub Web. It inspects
app/web/dist after a production build and can write a manifest into the
ignored dist directory. It does not deploy, upload, contact Hub/TokenDance
ID, open a browser, or read secrets.

Exit 0 when all checks pass, exit 1 if any check fails.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

failed = 0
passed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}", flush=True)


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}", flush=True)


def read_repo_file(relative_path: str) -> str:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep).replace("\\", os.sep))
    if not os.path.exists(full_path):
        fail_check(f"missing {relative_path.replace('/', '\\')}")
        return ""
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def assert_contains(relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(relative_path)
    label_path = relative_path.replace("/", "\\")
    if re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({label_path} missing pattern: {pattern})")


def assert_not_contains(relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(relative_path)
    label_path = relative_path.replace("/", "\\")
    if not re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({label_path} contains pattern: {pattern})")


def get_git_value(arguments: list) -> str:
    run = subprocess.run(
        ["git", "-C", REPO_ROOT, *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if run.returncode == 0:
        return "\n".join(run.stdout.splitlines()).strip()
    return ""


def get_relative_dist_path(dist_path: str, path: str) -> str:
    return os.path.relpath(path, dist_path).replace("\\", "/")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-DistRelativePath", "--DistRelativePath", default="app\\web\\dist", help="dist directory relative to the repo root")
    parser.add_argument("-ManifestName", "--ManifestName", default="web-deploy-readiness-manifest.json", help="deploy readiness manifest file name")
    parser.add_argument("-ProductionWebOrigin", "--ProductionWebOrigin", default="https://hub.vectorcontrol.tech", help="production web origin")
    parser.add_argument("-ProductionHubUrl", "--ProductionHubUrl", default="https://api.hub.vectorcontrol.tech", help="production Hub API base URL")
    parser.add_argument("-ProductionHubWsUrl", "--ProductionHubWsUrl", default="wss://api.hub.vectorcontrol.tech/client/ws", help="production Hub WebSocket URL")
    parser.add_argument("-WriteManifest", "--WriteManifest", action="store_true", help="write the deploy readiness manifest into dist")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    dist_path = os.path.join(REPO_ROOT, args.DistRelativePath.replace("/", os.sep).replace("\\", os.sep))
    manifest_path = os.path.join(dist_path, args.ManifestName)

    print("AgentHub Web deploy readiness verifier", flush=True)
    print("No deployment, upload, live auth, secret, or browser action will be performed.", flush=True)

    if os.path.isdir(dist_path):
        pass_check(f"dist directory exists at {args.DistRelativePath}")
    else:
        fail_check(f"dist directory missing at {args.DistRelativePath}; run app/web production build first")

    if os.path.isdir(dist_path):
        index_path = os.path.join(dist_path, "index.html")
        if os.path.isfile(index_path):
            pass_check("dist index.html exists")
        else:
            fail_check("dist index.html missing")

        files = []
        for dirpath, _dirnames, filenames in os.walk(dist_path):
            for name in filenames:
                if name != args.ManifestName:
                    files.append(os.path.join(dirpath, name))
        files.sort(key=lambda path: os.path.normpath(path).lower())
        asset_files = [path for path in files if re.search(r"[\\/]assets[\\/]", os.path.normpath(path))]

        if files:
            pass_check(f"dist has {len(files)} deployable file(s)")
        else:
            fail_check("dist has no deployable files")

        if asset_files:
            pass_check("dist has hashed/static asset files")
        else:
            fail_check("dist assets directory has no files")

        dist_text_files = [path for path in files if os.path.splitext(path)[1].lower() in (".html", ".js", ".css", ".json", ".txt", ".svg")]
        forbidden_patterns = [
            {"pattern": r"127\.0\.0\.1:3210|localhost:3210", "label": "Local Edge loopback URL"},
            {"pattern": r"/v1/events|/v1/runs", "label": "Local Edge event/run API"},
            {"pattern": r"@tauri-apps/|src-tauri|desktopHost|localEdgeRuntime", "label": "Desktop/Tauri runtime reference"},
        ]
        for entry in forbidden_patterns:
            matches = []
            for file_path in dist_text_files:
                try:
                    with open(file_path, encoding="utf-8", errors="replace") as handle:
                        for line_number, line in enumerate(handle, start=1):
                            if re.search(entry["pattern"], line, re.IGNORECASE):
                                matches.append((file_path, line_number))
                except OSError:
                    continue
            if matches:
                for file_path, line_number in matches:
                    fail_check(f"{entry['label']} found in dist/{get_relative_dist_path(dist_path, file_path)}:{line_number}")
            else:
                pass_check(f"{entry['label']} absent from app/web/dist")

        file_manifests = []
        for file_path in files:
            digest = hashlib.sha256()
            with open(file_path, "rb") as handle:
                for chunk in iter(lambda: handle.read(65536), b""):
                    digest.update(chunk)
            file_manifests.append(
                {
                    "path": get_relative_dist_path(dist_path, file_path),
                    "bytes": os.path.getsize(file_path),
                    "sha256": digest.hexdigest().lower(),
                }
            )

        generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f0Z")
        manifest = {
            "schema": "agenthub-web-deploy-readiness.v1",
            "generated_at": generated_at,
            "source_commit": get_git_value(["rev-parse", "HEAD"]),
            "branch": get_git_value(["branch", "--show-current"]),
            "artifact_root": args.DistRelativePath.replace("\\", "/"),
            "deployment": {
                "public_web_origin": args.ProductionWebOrigin,
                "required_build_env": {
                    "VITE_HUB_URL": args.ProductionHubUrl,
                    "VITE_HUB_WS_URL": args.ProductionHubWsUrl,
                },
                "oidc_callbacks": {
                    "production_web": f"{args.ProductionWebOrigin}/auth/tokendance/callback",
                    "dev_web_localhost": "http://localhost:5174/auth/tokendance/callback",
                    "dev_web_loopback": "http://127.0.0.1:5174/auth/tokendance/callback",
                    "desktop_loopback_policy": "http://127.0.0.1/callback",
                },
                "not_performed": ["public_deploy", "artifact_upload", "live_tokendance_id_login", "secret_read", "browser_open"],
            },
            "files": file_manifests,
        }

        if args.WriteManifest:
            with open(manifest_path, "w", encoding="utf-8") as handle:
                json.dump(manifest, handle, indent=2, ensure_ascii=False)
            pass_check(f"wrote deploy readiness manifest to {args.DistRelativePath.replace('/', '\\')}\\{args.ManifestName}")
        else:
            pass_check("manifest can be written with -WriteManifest")

    assert_contains("app/web/vite.config.ts", r"port:\s*5174", "Web Vite dev port is 5174")
    assert_contains("app/web/vite.config.ts", r"strictPort:\s*true", "Web Vite dev port is strict")
    assert_contains("app/web/src/api/hubAuth.ts", "/auth/tokendance/callback", "Web auth owns browser callback route")
    assert_contains("hub-server/.env.example", "localhost:5174/auth/tokendance/callback", "Hub dev env documents localhost Web callback on 5174")
    assert_contains("hub-server/.env.example", r"127\.0\.0\.1:5174/auth/tokendance/callback", "Hub dev env documents loopback Web callback on 5174")
    assert_not_contains("hub-server/.env.example", "5173/auth/tokendance/callback", "Hub dev env has no stale Web 5173 callback")
    assert_contains("docker-compose.yml", "localhost:5174/auth/tokendance/callback", "root compose documents localhost Web callback on 5174")
    assert_contains("docker-compose.yml", r"127\.0\.0\.1:5174/auth/tokendance/callback", "root compose documents loopback Web callback on 5174")
    assert_contains("docker-compose.yml", r"http://127\.0\.0\.1/callback", "root compose keeps Desktop/native loopback policy")
    assert_not_contains("docker-compose.yml", "5173/auth/tokendance/callback", "root compose has no stale Web 5173 callback")
    assert_contains("deployments/production/.env.example", r"hub\.vectorcontrol\.tech/auth/tokendance/callback", "production env example uses Web browser callback as OAuth redirect")
    assert_contains("deployments/production/.env.example", "POST /client/auth/oidc/callback", "production env example documents Hub exchange endpoint separately")
    assert_contains("deployments/production/.env.example", r"http://127\.0\.0\.1/callback", "production env example keeps Desktop/native loopback policy")
    assert_contains(
        "deployments/production/docker-compose.yml",
        r"AGENTHUB_TOKENDANCE_ID_REDIRECT_URI: https://hub\.vectorcontrol\.tech/auth/tokendance/callback",
        "production compose uses Web browser callback as OAuth redirect",
    )
    assert_contains(
        "deployments/production/docker-compose.yml",
        r"AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS: https://hub\.vectorcontrol\.tech/auth/tokendance/callback",
        "production compose keeps Web callback as the only allowed redirect",
    )
    assert_contains(
        "deployments/production/docker-compose.yml",
        r"AGENTHUB_TOKENDANCE_ID_CLIENT_ID: \$\{AGENTHUB_TOKENDANCE_ID_CLIENT_ID:-\}",
        "production compose exposes OIDC client env overrides",
    )

    print("\n========================================", flush=True)
    print(f"  Passed: {passed}  |  Failed: {failed}", flush=True)
    print("========================================", flush=True)

    if failed > 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
