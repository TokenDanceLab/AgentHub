#!/usr/bin/env python3
"""AgentHub TokenDance ID OIDC Full-Link Smoke Verification（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

验证 Desktop → Hub → TokenDance ID 的完整 OIDC PKCE 流程。连接 live 服务。
除需要有效凭据的 token exchange 模拟外，所有检查均为只读。

前置条件：
  - TokenDance ID 运行在 http://localhost:3000
  - Hub Server 运行在 http://localhost:8080
  - TokenDance ID 中注册了有效 OAuth client（运行 setup-tokendance-oidc.sh）
  - Hub Server .env 配置了 AGENTHUB_TOKENDANCE_ID_* 变量

用法：
  python scripts/verify/verify-oidc-flow.py                       # Full check
  python scripts/verify/verify-oidc-flow.py --LocalOnly           # Local fake/static gate; no live Hub/TokenDance ID calls
  python scripts/verify/verify-oidc-flow.py --SkipHub             # Check only TokenDance ID
  python scripts/verify/verify-oidc-flow.py --SkipTD              # Check only Hub Server
  python scripts/verify/verify-oidc-flow.py --Interactive         # Run manual browser flow guide
"""

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

PASSED = 0
FAILED = 0


def pass_check(text):
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text):
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def warn_check(text):
    print(f"  WARN  {text}")


def step(text):
    print(f"\n=== {text} ===")


def banner(text):
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}")


def fetch_json(url, label, timeout):
    try:
        request = urllib.request.Request(url)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.load(response)
        pass_check(f"{label} — {url}")
        return body
    except (urllib.error.URLError, ValueError, OSError) as exc:
        fail_check(f"{label} — {url} ({exc})")
        return None


def unwrap_envelope(obj):
    if isinstance(obj, dict) and obj.get("data") is not None and obj.get("code") is not None:
        return obj["data"]
    return obj


def test_health_ok(health):
    body = unwrap_envelope(health)
    if isinstance(body, str):
        return body.strip() == "ok"
    return body is not None and body.get("status") == "ok"


def assert_field(obj, field, label):
    if obj is not None and obj.get(field):
        pass_check(f"{label} = {obj[field]}")
    else:
        fail_check(f"{label} — field '{field}' missing or empty")


def assert_contains(haystack, needle, label):
    if needle in haystack:
        pass_check(label)
    else:
        fail_check(f"{label} — expected '{needle}' not found")


def assert_status(actual, expected, label):
    if actual == expected:
        pass_check(f"{label} (HTTP {actual})")
    else:
        fail_check(f"{label} — expected HTTP {expected}, got {actual}")


def assert_field_present(obj, field, label):
    if obj is not None and obj.get(field):
        pass_check(f"{label} is present")
    else:
        fail_check(f"{label} — field '{field}' missing or empty")


def assert_file_contains(path, pattern, label):
    if not os.path.isfile(path):
        fail_check(f"{label} — missing file: {path}")
        return
    try:
        with open(path, encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        fail_check(f"{label} — unreadable file: {path} ({exc})")
        return
    if re.search(pattern, content):
        pass_check(label)
    else:
        fail_check(f"{label} — expected pattern not found")


def check_packaged_desktop_readiness(root):
    step("Packaged Desktop loopback/keyring readiness")

    oidc_server_path = os.path.join(root, "app", "desktop", "src-tauri", "src", "oidc_server.rs")
    secure_store_path = os.path.join(root, "app", "desktop", "src-tauri", "src", "secure_store.rs")
    commands_path = os.path.join(root, "app", "desktop", "src-tauri", "src", "commands.rs")
    lib_path = os.path.join(root, "app", "desktop", "src-tauri", "src", "lib.rs")

    assert_file_contains(oidc_server_path, r"pub fn check_loopback_callback_readiness\(\)", "  Desktop loopback readiness source is wired")
    assert_file_contains(oidc_server_path, r'TcpListener::bind\("127\.0\.0\.1:0"\)', "  Desktop loopback readiness uses random localhost bind")
    assert_file_contains(secure_store_path, r"pub fn check_credential_store_readiness\(\)", "  Desktop keyring readiness source is wired")
    assert_file_contains(secure_store_path, r"Entry::new\(SERVICE, HUB_REFRESH_TOKEN_USER\)", "  Desktop keyring readiness checks Hub refresh-token credential entry")
    assert_file_contains(commands_path, r"pub async fn get_packaged_login_readiness\(\)", "  Desktop packaged login readiness command exists")
    assert_file_contains(commands_path, r'status: "proposal_only"\.to_string\(\)', "  Real packaged login E2E remains proposal-only")
    assert_file_contains(lib_path, r"commands::get_packaged_login_readiness", "  Desktop readiness command is registered in Tauri invoke handler")


def sha256_prefix(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def redact_oidc_config_value(name, value):
    if re.search(r"(?i)secret|token|password|key", name):
        return f"<redacted len={len(value)} sha256_prefix={sha256_prefix(value)}>"
    return value


def redact_url_query(url):
    query_start = url.find("?")
    if query_start < 0:
        return url

    prefix = url[:query_start]
    query_and_fragment = url[query_start + 1:]
    fragment = ""
    fragment_start = query_and_fragment.find("#")
    if fragment_start >= 0:
        fragment = query_and_fragment[fragment_start:]
        query_and_fragment = query_and_fragment[:fragment_start]

    redacted_pairs = []
    for pair in query_and_fragment.split("&"):
        if not pair.strip():
            continue
        key = pair.split("=", 1)[0]
        if not key.strip():
            redacted_pairs.append("<redacted>")
        else:
            redacted_pairs.append(f"{key}=<redacted>")

    if not redacted_pairs:
        return f"{prefix}?{fragment}"
    return f"{prefix}?{'&'.join(redacted_pairs)}{fragment}"


def base64_url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main() -> int:
    global PASSED, FAILED
    parser = argparse.ArgumentParser(
        description="AgentHub TokenDance ID OIDC Full-Link Smoke Verification (ps1 migration)"
    )
    parser.add_argument("--LocalOnly", action="store_true", help="local fake/static gate; no live Hub/TokenDance ID calls")
    parser.add_argument("--SkipHub", action="store_true", help="skip live Hub Server phase")
    parser.add_argument("--SkipTD", action="store_true", help="skip live TokenDance ID phase")
    parser.add_argument("--Interactive", action="store_true", help="print the manual browser flow guide")
    parser.add_argument("--HubUrl", default="http://localhost:8080", help="Hub Server base URL")
    parser.add_argument("--TdUrl", default="http://localhost:3000", help="TokenDance ID base URL")
    parser.add_argument("--TimeoutSec", type=int, default=10, help="HTTP timeout in seconds")
    parser.add_argument("--RepoRoot", default="", help="repository root (defaults to the script's repository root)")
    args = parser.parse_args()

    repo_root = args.RepoRoot.strip() or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

    banner("TokenDance ID OIDC Full-Link Smoke Verification")

    if args.LocalOnly:
        args.SkipHub = True
        args.SkipTD = True
        step("Local-only fake/static gate")
        pass_check("Live Hub and TokenDance ID phases are skipped")
        check_packaged_desktop_readiness(repo_root)

    # ═══════════════════════════════════════════════════
    # Phase 1: TokenDance ID Provider
    # ═══════════════════════════════════════════════════

    if not args.SkipTD:
        step(f"Phase 1 — TokenDance ID OIDC Provider ({args.TdUrl})")

        # 1.1 Health / reachability
        try:
            request = urllib.request.Request(f"{args.TdUrl}/health")
            with urllib.request.urlopen(request, timeout=5) as response:
                health = json.load(response)
            if test_health_ok(health):
                pass_check("TokenDance ID health endpoint reachable")
            else:
                fail_check(f"TokenDance ID health returned: {json.dumps(health)}")
        except (urllib.error.URLError, ValueError, OSError):
            fail_check("TokenDance ID health endpoint unreachable — is it running? (cd tokendance-id && go run ./cmd/tokendance-id)")

        # 1.2 OIDC Discovery document
        discovery = fetch_json(f"{args.TdUrl}/.well-known/openid-configuration", "OIDC Discovery document", args.TimeoutSec)
        if discovery:
            assert_field(discovery, "issuer", "  issuer")
            assert_field(discovery, "authorization_endpoint", "  authorization_endpoint")
            assert_field(discovery, "token_endpoint", "  token_endpoint")
            assert_field(discovery, "jwks_uri", "  jwks_uri")
            assert_field(discovery, "userinfo_endpoint", "  userinfo_endpoint")
            code_challenge_methods = ",".join(discovery.get("code_challenge_methods_supported", []) or [])
            assert_contains(code_challenge_methods, "S256", "  code_challenge_methods_supported includes S256")
            grant_types = ",".join(discovery.get("grant_types_supported", []) or [])
            assert_contains(grant_types, "authorization_code", "  grant_types_supported includes authorization_code")
            scopes = ",".join(discovery.get("scopes_supported", []) or [])
            assert_contains(scopes, "openid", "  scopes_supported includes openid")
            assert_contains(scopes, "profile", "  scopes_supported includes profile")
            assert_contains(scopes, "email", "  scopes_supported includes email")

        # 1.3 JWKS endpoint
        jwks = fetch_json(f"{args.TdUrl}/oidc/jwks", "JWKS endpoint", args.TimeoutSec)
        if jwks:
            keys = jwks.get("keys")
            if keys:
                pass_check(f"  JWKS has {len(keys)} key(s)")
                rsa_keys = [key for key in keys if key.get("kty") == "RSA"]
                if rsa_keys:
                    pass_check(f"  JWKS contains RSA key(s): {len(rsa_keys)} found")
                else:
                    fail_check("  JWKS has no RSA keys")
            else:
                fail_check("  JWKS keys array empty or missing")

        # 1.4 CORS headers for Hub Server
        try:
            request = urllib.request.Request(
                f"{args.TdUrl}/.well-known/openid-configuration",
                method="OPTIONS",
                headers={
                    "Origin": args.HubUrl,
                    "Access-Control-Request-Method": "GET",
                },
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                cors_status = response.status
                allow_origin = response.headers.get("Access-Control-Allow-Origin")
            if allow_origin or cors_status == 204:
                pass_check("  TokenDance ID responds to CORS preflight from Hub")
            else:
                warn_check("  TokenDance ID CORS headers not verified (may need allowed_origins config)")
        except (urllib.error.URLError, OSError) as exc:
            warn_check(f"  CORS preflight check skipped ({exc})")

    # ═══════════════════════════════════════════════════
    # Phase 2: Hub Server OIDC Endpoints
    # ═══════════════════════════════════════════════════

    verify_state = None
    verify_auth_url = None
    verify_code_verifier = None
    verify_device_id = None

    if not args.SkipHub:
        step(f"Phase 2 — Hub Server ({args.HubUrl})")

        # 2.1 Hub health
        try:
            request = urllib.request.Request(f"{args.HubUrl}/health")
            with urllib.request.urlopen(request, timeout=5) as response:
                hub_health = json.load(response)
            if test_health_ok(hub_health):
                pass_check("Hub Server health endpoint reachable")
            else:
                fail_check(f"Hub Server health returned: {json.dumps(hub_health)}")
        except (urllib.error.URLError, ValueError, OSError):
            fail_check("Hub Server unreachable — start with: docker compose up -d postgres redis && cd hub-server && go run ./cmd/server-hub")

        # 2.2 OIDC Authorize endpoint
        authorize_url = f"{args.HubUrl}/client/auth/oidc/authorize"
        try:
            code_verifier = base64_url_encode(secrets.token_bytes(32))
            code_challenge = base64_url_encode(hashlib.sha256(code_verifier.encode("utf-8")).digest())
            device_id = str(secrets.token_hex(16))

            authorize_body = json.dumps({
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "device_type": "desktop",
                "device_id": device_id,
                "redirect_uri": "http://127.0.0.1/callback",
            }).encode("utf-8")

            request = urllib.request.Request(
                authorize_url,
                data=authorize_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=args.TimeoutSec) as response:
                auth_resp = json.load(response)

            auth_data = unwrap_envelope(auth_resp)

            if auth_data.get("state") and auth_data.get("authorization_url"):
                pass_check("  POST /client/auth/oidc/authorize — returns state + authorization_url")
                assert_field_present(auth_data, "state", "    state")
                assert_field_present(auth_data, "authorization_url", "    authorization_url")

                auth_url_parsed = auth_data["authorization_url"]
                assert_contains(auth_url_parsed, "response_type=code", "    auth URL includes response_type=code")
                assert_contains(auth_url_parsed, "client_id=", "    auth URL includes client_id")
                assert_contains(auth_url_parsed, "redirect_uri=", "    auth URL includes redirect_uri")
                assert_contains(auth_url_parsed, "scope=openid", "    auth URL includes scope=openid")
                assert_contains(auth_url_parsed, "code_challenge=", "    auth URL includes code_challenge")
                assert_contains(auth_url_parsed, "code_challenge_method=S256", "    auth URL includes code_challenge_method=S256")

                verify_state = auth_data["state"]
                verify_auth_url = redact_url_query(auth_data["authorization_url"])
                verify_code_verifier = code_verifier
                verify_device_id = device_id
                pass_check("  Authorization URL is well-formed OIDC PKCE request")
            else:
                fail_check("  POST /client/auth/oidc/authorize — missing state or authorization_url")
        except urllib.error.HTTPError as exc:
            if exc.code:
                assert_status(exc.code, 400, "  POST /client/auth/oidc/authorize")
            fail_check(f"  OIDC authorize failed: {exc}")
        except (urllib.error.URLError, ValueError, OSError) as exc:
            fail_check(f"  OIDC authorize failed: {exc}")

        # 2.3 OIDC Callback endpoint (negative test — should reject bad code)
        callback_url = f"{args.HubUrl}/client/auth/oidc/callback"
        try:
            bad_callback = json.dumps({
                "code": "invalid-code-abc123",
                "state": "invalid-state",
                "code_verifier": "invalid-verifier",
                "device_type": "desktop",
                "device_id": str(secrets.token_hex(16)),
            }).encode("utf-8")

            request = urllib.request.Request(
                callback_url,
                data=bad_callback,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=args.TimeoutSec) as response:
                pass  # expected rejection

            fail_check("  POST /client/auth/oidc/callback — expected rejection but got 200")
        except urllib.error.HTTPError as exc:
            if exc.code >= 400:
                pass_check(f"  POST /client/auth/oidc/callback — correctly rejects invalid code (HTTP {exc.code})")
            else:
                fail_check(f"  OIDC callback test failed: {exc}")
        except (urllib.error.URLError, ValueError, OSError) as exc:
            fail_check(f"  OIDC callback test failed: {exc}")

        # 2.4 CORS headers for Desktop dev
        try:
            request = urllib.request.Request(
                f"{args.HubUrl}/health",
                method="OPTIONS",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "GET",
                },
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                allow_origin = response.headers.get("Access-Control-Allow-Origin")
            if allow_origin == "http://localhost:5173":
                pass_check("  Hub CORS allows Desktop Vite dev origin (localhost:5173)")
            else:
                warn_check(f"  Hub CORS origin for localhost:5173 = {allow_origin} (expected http://localhost:5173)")
        except (urllib.error.URLError, OSError) as exc:
            warn_check(f"  Hub CORS check skipped ({exc})")

    # ═══════════════════════════════════════════════════
    # Phase 3: Full Flow Diagnostics
    # ═══════════════════════════════════════════════════

    step("Phase 3 — Full-Flow Diagnostics")

    # 3.1 Verify auth URL can be opened
    if verify_auth_url:
        pass_check("  Authorization URL generated — redacted diagnostic form:")
        print(f"    {redact_url_query(verify_auth_url)}")
    else:
        if args.LocalOnly:
            warn_check("  Authorization URL not available because live Hub authorize is skipped")
        else:
            warn_check("  Authorization URL not available because Hub authorize did not complete")

    # 3.2 Check required env vars in hub-server/.env
    hub_env_path = os.path.join(repo_root, "hub-server", ".env")
    if os.path.isfile(hub_env_path):
        try:
            with open(hub_env_path, encoding="utf-8") as handle:
                hub_env = handle.read()
        except OSError as exc:
            warn_check(f"  hub-server/.env unreadable ({exc})")
            hub_env = ""
        env_vars = [
            {"Name": "AGENTHUB_TOKENDANCE_ID_ISSUER_URL", "Pattern": r"AGENTHUB_TOKENDANCE_ID_ISSUER_URL=(.+)"},
            {"Name": "AGENTHUB_TOKENDANCE_ID_CLIENT_ID", "Pattern": r"AGENTHUB_TOKENDANCE_ID_CLIENT_ID=(.+)"},
            {"Name": "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "Pattern": r"AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=(.+)"},
            {"Name": "AGENTHUB_TOKENDANCE_ID_REDIRECT_URI", "Pattern": r"AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=(.+)"},
        ]

        for var in env_vars:
            match = re.search(var["Pattern"], hub_env)
            if match:
                value = match.group(1).strip()
                display_value = redact_oidc_config_value(var["Name"], value)
                if value and "fill in" not in value and "your-" not in value and not value.startswith("<"):
                    pass_check(f"  {var['Name']} is configured ({display_value})")
                else:
                    fail_check(f"  {var['Name']} has placeholder value: \"{display_value}\" — fill in real value")
            else:
                fail_check(f"  {var['Name']} is not in hub-server/.env")
    else:
        warn_check("  hub-server/.env not found — copy from .env.example and fill in TokenDance ID values")

    # 3.3 Config code validation
    config_go_path = os.path.join(repo_root, "hub-server", "internal", "config", "config.go")
    if os.path.isfile(config_go_path):
        try:
            with open(config_go_path, encoding="utf-8") as handle:
                config_go = handle.read()
        except OSError as exc:
            warn_check(f"  config.go unreadable ({exc})")
            config_go = ""
        if re.search(r"tokendance_id\.issuer_url is required when", config_go):
            pass_check("  Hub config validates interdependency (issuer_url required when client_id set)")
        else:
            fail_check("  Hub config missing interdependency validation")
        if re.search(r"tokendance_id\.client_secret is required when", config_go):
            pass_check("  Hub config validates client_secret required when client_id set")
        else:
            fail_check("  Hub config missing client_secret validation")
        if re.search(r"tokendance_id\.redirect_uri is required when", config_go):
            pass_check("  Hub config validates redirect_uri required when client_id set")
        else:
            fail_check("  Hub config missing redirect_uri validation")

    # ═══════════════════════════════════════════════════
    # Phase 4: Interactive Manual Flow Guide
    # ═══════════════════════════════════════════════════

    if args.Interactive:
        step("Phase 4 — Interactive Manual Flow")

        print("\n  Manual OIDC flow verification:")
        print("  1. Make sure TokenDance ID is running:  cd tokendance-id && go run ./cmd/tokendance-id")
        print("  2. Make sure Hub Server is running:     cd hub-server && go run ./cmd/server-hub")
        print("  3. Make sure Desktop dev is running:    cd app/desktop && pnpm dev")

        print("\n  Steps:")
        print("  a) Open http://localhost:5173 in browser")
        print("  b) Click 'TokenDance ID 登录' button")
        print("  c) Browser opens TokenDance ID authorization page")
        print("  d) Login to TokenDance ID (create account if needed)")
        print("  e) Approve authorization consent screen")
        print("  f) Browser redirects back — Desktop receives Hub tokens")
        print("  g) Verify /client/auth/me returns user profile")

        print("\n  Check Hub Server logs:")
        print("  docker compose logs -f hub-server")

        print("\n  Check TokenDance ID logs:")
        print("  cd tokendance-id && go run ./cmd/tokendance-id (attached)")

        print("\n  Expected log lines in Hub Server:")
        print("  - 'stored PKCE state in redis'")
        print("  - 'token exchange: HTTP 200'")
        print("  - 'ID token validated, sub=...'")
        print("  - 'user found/created by TokenDance sub'")
        print("  - 'Hub access token issued'")

        print("\n  Curl to verify Hub session:")
        print("  curl -H 'Authorization: Bearer <access_token>' http://localhost:8080/client/auth/me")

    # ═══════════════════════════════════════════════════
    # Summary
    # ═══════════════════════════════════════════════════

    print(f"\n{'=' * 60}")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}  |  Total: {PASSED + FAILED}")
    print(f"{'=' * 60}")

    if FAILED == 0:
        if args.LocalOnly:
            print("\n  Local-only fake/static OIDC checks passed. No live Hub or TokenDance ID calls were made.\n")
        else:
            print("\n  All checks passed. The OIDC infrastructure is correctly wired.\n")
            print("  Next step: run Desktop app for end-to-end browser flow.\n")
    elif FAILED <= 2:
        print("\n  Minor issues found. Review warnings above and re-run.\n")
    else:
        print("\n  Multiple issues found. Ensure both TokenDance ID and Hub Server are running,\n")
        print("  and the OIDC client is registered (run: hub-server/scripts/setup-tokendance-oidc.sh)\n")

    if FAILED > 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
