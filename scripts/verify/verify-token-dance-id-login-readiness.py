#!/usr/bin/env python3
"""AgentHub TokenDanceID no-secret login readiness gate（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

只检查 operator 是否提供了 approved 登录测试元数据、TokenDanceID OIDC
discovery 是否可读。不打开浏览器、不提交凭据、不交换 authorization code、
不把 fixture 数据当作真实登录证据。

用法：
  python scripts/verify/verify-token-dance-id-login-readiness.py
  python scripts/verify/verify-token-dance-id-login-readiness.py --IssuerUrl ... --ClientId ... --TestAccountRef ...
  环境变量：AGENTHUB_TDID_LOGIN_ISSUER_URL / AGENTHUB_TDID_LOGIN_CLIENT_ID /
  AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF / AGENTHUB_TDID_LOGIN_DISCOVERY_DOCUMENT
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}"
    r"|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*="
    r"|password\s*=|client_secret\s*=|secret[_-]?[a-z0-9]*\s*=)"
)
TEST_ACCOUNT_REF_PATTERN = re.compile(r"(?i)(approved|test|disposable|sandbox|throwaway)")
DISCOVERY_FIELDS = ("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AgentHub TokenDanceID no-secret login readiness gate (ps1 migration)"
    )
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--IssuerUrl", default="", help="TokenDanceID issuer URL")
    parser.add_argument("--ClientId", default="", help="approved TokenDanceID OIDC client id")
    parser.add_argument("--TestAccountRef", default="", help="approved/disposable test account reference")
    parser.add_argument("--DiscoveryDocumentPath", default="", help="path to a discovery document fixture JSON")
    parser.add_argument("--OutputPath", default="", help="write the v1 summary JSON to this path")
    args = parser.parse_args()

    failures = []
    warnings = []

    def add_failure(text):
        failures.append(text)
        print(f"FAIL: {text}")

    def add_warning(text):
        warnings.append(text)
        print(f"WARN: {text}")

    def pass_check(text):
        print(f"PASS: {text}")

    def first_value(current, env_name):
        if current and current.strip():
            return current
        return os.environ.get(env_name, "")

    def resolve_repo_path(path):
        if not path or not path.strip():
            return ""
        if os.path.isabs(path):
            return path
        return os.path.join(repo_root, path)

    def test_http_url(url):
        try:
            parsed = urlparse(url)
            return parsed.scheme in ("http", "https")
        except ValueError:
            return False

    def test_secret_like(value):
        if not value or not value.strip():
            return False
        return SECRET_LIKE_PATTERN.search(value) is not None

    def assert_no_secret_like(name, value):
        if test_secret_like(value):
            add_failure(
                f"{name} contains secret-like material; pass a public identifier or private evidence reference, "
                "not token/password/secret values"
            )

    def assert_required(name, value, env_name):
        if not value or not value.strip():
            add_failure(f"{name} is required; set {env_name} or pass the matching parameter")
        else:
            pass_check(f"{name} supplied")

    def read_discovery_document(issuer, path):
        if path and path.strip():
            full_path = resolve_repo_path(path)
            if not os.path.exists(full_path):
                add_failure("discovery document fixture path does not exist")
                return None
            try:
                with open(full_path, encoding="utf-8") as handle:
                    return json.load(handle)
            except (ValueError, OSError):
                add_failure("discovery document fixture must be valid JSON")
                return None

        if not issuer or not issuer.strip():
            return None
        if not test_http_url(issuer):
            add_failure("issuer URL must be an http(s) URL")
            return None

        discovery_url = issuer.rstrip("/") + "/.well-known/openid-configuration"
        try:
            request = urllib.request.Request(discovery_url)
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        except (urllib.error.URLError, ValueError, OSError):
            add_failure("OIDC discovery is not reachable at configured issuer")
            return None

    def assert_discovery(discovery, expected_issuer):
        if discovery is None:
            return

        for field in DISCOVERY_FIELDS:
            value = discovery.get(field)
            if value is None or not str(value).strip():
                add_failure(f"OIDC discovery missing {field}")
            elif field != "issuer" and not test_http_url(str(value)):
                add_failure(f"OIDC discovery {field} must be an http(s) URL")
            else:
                pass_check(f"OIDC discovery has {field}")

        if expected_issuer and expected_issuer.strip() and discovery.get("issuer") is not None:
            actual = str(discovery["issuer"]).rstrip("/")
            expected = expected_issuer.rstrip("/")
            if actual != expected:
                add_failure("discovery issuer does not match configured issuer")
            else:
                pass_check("discovery issuer matches configured issuer")

        response_types = discovery.get("response_types_supported")
        if response_types is not None:
            if "code" in list(response_types):
                pass_check("OIDC discovery supports authorization code response type")
            else:
                add_failure("OIDC discovery does not advertise authorization code response type")
        else:
            add_warning(
                "OIDC discovery response_types_supported is absent; operator must verify "
                "authorization code support before real login"
            )

        challenge_methods = discovery.get("code_challenge_methods_supported")
        if challenge_methods is not None:
            if "S256" in list(challenge_methods):
                pass_check("OIDC discovery supports PKCE S256")
            else:
                add_failure("OIDC discovery does not advertise PKCE S256")
        else:
            add_warning(
                "OIDC discovery code_challenge_methods_supported is absent; operator must verify "
                "PKCE S256 before real login"
            )

    repo_root = os.path.abspath(args.RepoRoot)
    issuer_url = first_value(args.IssuerUrl, "AGENTHUB_TDID_LOGIN_ISSUER_URL")
    client_id = first_value(args.ClientId, "AGENTHUB_TDID_LOGIN_CLIENT_ID")
    test_account_ref = first_value(args.TestAccountRef, "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF")
    discovery_document_path = first_value(args.DiscoveryDocumentPath, "AGENTHUB_TDID_LOGIN_DISCOVERY_DOCUMENT")

    print("AgentHub TokenDanceID no-secret login readiness")
    print("Schema: agenthub-token-dance-id-login-readiness-v1")
    print(
        "No browser, credential submission, code exchange, token exchange, or real login "
        "is performed by this script."
    )

    assert_required("TokenDanceID issuer URL", issuer_url, "AGENTHUB_TDID_LOGIN_ISSUER_URL")
    assert_required("approved TokenDanceID OIDC client id", client_id, "AGENTHUB_TDID_LOGIN_CLIENT_ID")
    assert_required("approved/disposable test account reference", test_account_ref, "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF")

    assert_no_secret_like("IssuerUrl", issuer_url)
    assert_no_secret_like("ClientId", client_id)
    assert_no_secret_like("TestAccountRef", test_account_ref)
    assert_no_secret_like("DiscoveryDocumentPath", discovery_document_path)

    if issuer_url.strip() and not test_http_url(issuer_url):
        add_failure("issuer URL must be an http(s) URL")

    if test_account_ref.strip() and TEST_ACCOUNT_REF_PATTERN.search(test_account_ref) is None:
        add_failure(
            "test account reference must clearly identify an approved test/disposable/sandbox "
            "account without containing credentials"
        )

    discovery = read_discovery_document(issuer_url, discovery_document_path)
    assert_discovery(discovery, issuer_url)

    status = "READY_FOR_OPERATOR" if len(failures) == 0 else "BLOCKED"

    summary = {
        "schema": "agenthub-token-dance-id-login-readiness-v1",
        "status": status,
        "issuer_configured": bool(issuer_url.strip()),
        "approved_client_id_configured": bool(client_id.strip()),
        "approved_test_account_ref_configured": bool(test_account_ref.strip()),
        "discovery_checked": discovery is not None,
        "discovery_source": (
            "fixture"
            if discovery_document_path.strip()
            else ("issuer" if issuer_url.strip() else "none")
        ),
        "real_login_executed_by_script": False,
        "fixture_login_accepted_as_real": False,
        "secret_values_logged": False,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "required_operator_next_steps": [
            "Verify the configured client id is the approved AgentHub TokenDanceID client",
            "Verify the test account reference maps to an approved disposable or pre-approved test account",
            "Run the separate approved real-login harness only after operator approval and without committing credentials or tokens",
        ],
        "failures": list(failures),
        "warnings": list(warnings),
    }

    if args.OutputPath and args.OutputPath.strip():
        full_output_path = resolve_repo_path(args.OutputPath)
        parent = os.path.dirname(full_output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(full_output_path, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    print(f"Status: {status}")
    print("RealLoginExecutedByScript=false")
    print("FixtureLoginAcceptedAsReal=false")
    print("SecretValuesLogged=false")

    if len(failures) > 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
