#!/usr/bin/env python3
"""Verify the AgentHub TokenDance Account OIDC relying-party contract.

--LocalOnly is deterministic and performs no network calls. Live mode requires
an explicitly supplied operator Account issuer and optionally checks a running
Hub. The script never starts, discovers or clones an internal Account provider.
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
USER_AGENT = "AgentHub-OIDC-Verifier/1"


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
    print(f"\n{'=' * 64}\n  {text}\n{'=' * 64}")


def fetch_json(url, label, timeout):
    try:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.load(response)
        pass_check(label)
        return body
    except (urllib.error.URLError, ValueError, OSError) as exc:
        fail_check(f"{label} failed ({type(exc).__name__})")
        return None


def unwrap_envelope(value):
    if isinstance(value, dict) and value.get("code") is not None and value.get("data") is not None:
        return value["data"]
    return value


def assert_file_contains(path, pattern, label):
    try:
        with open(path, encoding="utf-8") as handle:
            content = handle.read()
    except OSError:
        fail_check(f"{label}: file unavailable")
        return
    if re.search(pattern, content):
        pass_check(label)
    else:
        fail_check(label)


def check_local_contract(root):
    step("Local Account OIDC contract")
    config = os.path.join(root, "hub-server", "internal", "config", "config_account_oidc.go")
    service = os.path.join(root, "hub-server", "internal", "service", "oidc", "oidc.go")
    handler = os.path.join(root, "hub-server", "internal", "handler", "oidc.go")
    verifier = os.path.join(root, "hub-server", "internal", "jwtutil", "account_oidc.go")
    fixture = os.path.join(root, "pkg", "testkit", "oidcfixture", "oidcfixture.go")
    web_ports = os.path.join(root, "app", "web", "src", "api", "auth", "webPorts.ts")
    desktop_ports = os.path.join(root, "app", "desktop", "src", "api", "auth", "desktopPorts.ts")

    assert_file_contains(
        config,
        r'IssuerURL\s+string\s+`mapstructure:"issuer_url"`',
        "Hub config exposes only the canonical Account issuer",
    )
    assert_file_contains(
        service,
        r'accountOIDCScopes\s*=\s*"openid profile"',
        "Hub requests exactly openid profile",
    )
    assert_file_contains(
        service,
        r'q\.Set\("nonce",\s*nonce\)',
        "authorization requests include a fresh nonce",
    )
    assert_file_contains(
        service,
        r'IssuerEqual\(issuerParam,\s*s\.cfg\.IssuerURL\)',
        "callback requires exact RFC 9207 issuer before exchange",
    )
    assert_file_contains(
        service,
        r'authorization_response_iss_parameter_supported',
        "discovery requires RFC 9207 issuer-response support",
    )
    assert_file_contains(
        service,
        r'client_secret_basic',
        "confidential token exchange requires Basic authentication",
    )
    assert_file_contains(
        handler,
        r'Issuer\s+string\s+`json:"iss"\s+binding:"required"`',
        "Hub callback JSON requires iss",
    )
    assert_file_contains(
        verifier,
        r'jwt\.WithIssuer\(expectedIssuer\)',
        "ID token verification pins issuer",
    )
    assert_file_contains(
        verifier,
        r'jwt\.WithAudience\(expectedAudience\)',
        "ID token verification pins audience",
    )
    assert_file_contains(
        verifier,
        r'jwt\.WithExpirationRequired\(\)',
        "ID token verification requires exp",
    )
    assert_file_contains(
        verifier,
        r'jwt\.WithValidMethods\(\[\]string\{"RS256"\}\)',
        "ID token verification allows only RS256",
    )
    assert_file_contains(
        verifier,
        r'claims\.Nonce',
        "ID token verification requires the authorization nonce",
    )
    assert_file_contains(
        verifier,
        r'claims\.Azp',
        "ID token verification validates azp when present",
    )
    assert_file_contains(
        verifier,
        r'claims\.IssuedAt',
        "ID token verification validates iat",
    )
    assert_file_contains(
        service,
        r'out\.Sub\s*==\s*""\s*\|\|\s*out\.Sub\s*!=\s*expectedSubject',
        "UserInfo sub must match the ID-token subject",
    )
    for capability in (
        "/.well-known/openid-configuration",
        "/oauth/authorize",
        "/oauth/token",
        "/oauth/userinfo",
        "/oauth/jwks",
        "/oauth/end-session",
    ):
        assert_file_contains(
            fixture,
            re.escape(capability),
            f"repo-local public fixture exposes {capability}",
        )
    assert_file_contains(
        web_ports,
        r'/auth/account/callback',
        "Web callback uses /auth/account/callback under the Vite base path",
    )
    assert_file_contains(
        desktop_ports,
        r'OIDC_LOOPBACK_PORT\s*=\s*53682',
        "Desktop uses the fixed loopback port 53682",
    )
    assert_file_contains(
        desktop_ports,
        r'http://127\.0\.0\.1:\$\{port\}/callback',
        "Desktop callback URI is http://127.0.0.1:53682/callback",
    )


def same_origin(url, issuer):
    try:
        candidate = urllib.parse.urlparse(url)
        canonical = urllib.parse.urlparse(issuer)
    except ValueError:
        return False
    return (
        candidate.scheme in ("https", "http")
        and candidate.scheme == canonical.scheme
        and candidate.netloc.lower() == canonical.netloc.lower()
        and not candidate.username
        and not candidate.password
    )


def check_account_discovery(issuer, timeout):
    step("External Account discovery/JWKS")
    issuer = issuer.rstrip("/")
    if not issuer:
        fail_check("Account issuer must be supplied explicitly")
        return None
    parsed = urllib.parse.urlparse(issuer)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1", "localhost")
    ):
        fail_check("Account issuer must use HTTPS outside loopback")
        return None

    discovery = fetch_json(
        issuer + "/.well-known/openid-configuration",
        "Account OIDC discovery is reachable",
        timeout,
    )
    if not discovery:
        return None
    if discovery.get("issuer") == issuer:
        pass_check("discovery issuer exactly matches configured issuer")
    else:
        fail_check("discovery issuer does not exactly match configured issuer")

    expected = {
        "authorization_endpoint": "/oauth/authorize",
        "token_endpoint": "/oauth/token",
        "userinfo_endpoint": "/oauth/userinfo",
        "jwks_uri": "/oauth/jwks",
    }
    for field, path in expected.items():
        endpoint = str(discovery.get(field) or "")
        parsed_endpoint = urllib.parse.urlparse(endpoint)
        if parsed_endpoint.path == path and same_origin(endpoint, issuer):
            pass_check(f"discovery {field} uses public Account origin")
        else:
            fail_check(f"discovery {field} is not the expected public endpoint")

    capabilities = {
        "response_types_supported": "code",
        "response_modes_supported": "query",
        "grant_types_supported": "authorization_code",
        "id_token_signing_alg_values_supported": "RS256",
        "code_challenge_methods_supported": "S256",
        "token_endpoint_auth_methods_supported": "client_secret_basic",
    }
    for field, value in capabilities.items():
        values = discovery.get(field)
        if isinstance(values, list) and value in values:
            pass_check(f"discovery advertises {field}={value}")
        else:
            fail_check(f"discovery missing {field}={value}")
    if discovery.get("authorization_response_iss_parameter_supported") is True:
        pass_check("discovery advertises RFC 9207 authorization response issuer")
    else:
        fail_check("discovery does not advertise RFC 9207 authorization response issuer")

    jwks = fetch_json(str(discovery.get("jwks_uri") or issuer + "/oauth/jwks"), "Account JWKS is reachable", timeout)
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if isinstance(keys, list) and any(
        isinstance(key, dict) and key.get("kty") == "RSA" for key in keys
    ):
        pass_check("Account JWKS contains an RSA verification key")
    else:
        fail_check("Account JWKS contains no RSA verification key")
    return discovery


def check_hub_contract(hub_url, issuer, timeout, redirect_uri):
    step("Hub Account OIDC relying party")
    hub_url = hub_url.rstrip("/")
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    device_id = "00000000-0000-4000-8000-000000000002"
    payload = json.dumps(
        {
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "device_type": "desktop",
            "device_id": device_id,
            "redirect_uri": redirect_uri,
        }
    ).encode()
    try:
        request = urllib.request.Request(
            hub_url + "/client/auth/oidc/authorize",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            auth = unwrap_envelope(json.load(response))
    except urllib.error.HTTPError as exc:
        fail_check(f"Hub authorize rejected the redirect (HTTP {exc.code})")
        return
    except (urllib.error.URLError, ValueError, OSError) as exc:
        fail_check(f"Hub authorize unavailable ({type(exc).__name__})")
        return

    if auth.get("issuer") == issuer.rstrip("/"):
        pass_check("Hub pins the configured Account issuer")
    else:
        fail_check("Hub did not return the configured Account issuer")

    authorization_url = str(auth.get("authorization_url") or "")
    parsed = urllib.parse.urlparse(authorization_url)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if parsed.path == "/oauth/authorize" and same_origin(authorization_url, issuer):
        pass_check("Hub authorization URL uses discovered /oauth/authorize")
    else:
        fail_check("Hub authorization URL does not use the Account endpoint")
    checks = {
        "response_type": "code",
        "scope": "openid profile",
        "redirect_uri": redirect_uri,
        "code_challenge_method": "S256",
        "prompt": "consent",
    }
    for key, value in checks.items():
        if query.get(key) == [value]:
            pass_check(f"Hub authorization URL carries exact {key}")
        else:
            fail_check(f"Hub authorization URL has invalid {key}")
    for key in ("client_id", "state", "nonce", "code_challenge"):
        if query.get(key, [""])[0]:
            pass_check(f"Hub authorization URL carries {key}")
        else:
            fail_check(f"Hub authorization URL is missing {key}")

    negative = json.dumps(
        {
            "code": "invalid-code",
            "state": "invalid-state",
            "code_verifier": verifier,
            "device_type": "desktop",
            "device_id": device_id,
            "redirect_uri": redirect_uri,
        }
    ).encode()
    try:
        request = urllib.request.Request(
            hub_url + "/client/auth/oidc/callback",
            data=negative,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=timeout)
        fail_check("Hub accepted a callback without iss")
    except urllib.error.HTTPError as exc:
        if exc.code == 400:
            pass_check("Hub rejects a callback without iss before code exchange")
        else:
            fail_check(f"Hub callback without iss returned HTTP {exc.code}, expected 400")
    except (urllib.error.URLError, OSError) as exc:
        fail_check(f"Hub callback unavailable ({type(exc).__name__})")


def check_env_names(root):
    step("Account configuration names")
    path = os.path.join(root, "hub-server", ".env")
    if not os.path.isfile(path):
        warn_check("hub-server/.env is absent; use .env.example and operator secrets for live mode")
        return
    try:
        with open(path, encoding="utf-8") as handle:
            names = {
                line.split("=", 1)[0].strip()
                for line in handle
                if "=" in line and not line.lstrip().startswith("#")
            }
    except OSError:
        warn_check("hub-server/.env is unreadable")
        return
    for name in (
        "AGENTHUB_ACCOUNT_OIDC_ISSUER_URL",
        "AGENTHUB_ACCOUNT_OIDC_CLIENT_ID",
        "AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET",
        "AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI",
        "AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS",
    ):
        if name in names:
            pass_check(f"{name} is configured")
        else:
            fail_check(f"{name} is missing")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--LocalOnly", action="store_true", help="static contract checks; no network calls")
    parser.add_argument("--SkipHub", action="store_true", help="check only the external Account discovery")
    parser.add_argument("--Interactive", action="store_true", help="print the manual Account login checklist")
    parser.add_argument("--HubUrl", default="http://127.0.0.1:8080")
    parser.add_argument(
        "--AccountIssuer",
        default=os.environ.get("AGENTHUB_ACCOUNT_OIDC_ISSUER_URL", ""),
        help="canonical external TokenDance Account issuer",
    )
    parser.add_argument(
        "--RedirectUri",
        default="http://127.0.0.1:53682/callback",
        help="registered desktop loopback redirect",
    )
    parser.add_argument("--TimeoutSec", type=int, default=10)
    parser.add_argument("--RepoRoot", default="")
    args = parser.parse_args()

    root = args.RepoRoot.strip() or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    )
    banner("AgentHub TokenDance Account OIDC contract")
    check_local_contract(root)

    if args.LocalOnly:
        pass_check("live Account and Hub calls skipped")
    else:
        if not args.AccountIssuer:
            fail_check("live mode requires --AccountIssuer or AGENTHUB_ACCOUNT_OIDC_ISSUER_URL")
        else:
            check_account_discovery(args.AccountIssuer, args.TimeoutSec)
            if not args.SkipHub:
                check_hub_contract(
                    args.HubUrl,
                    args.AccountIssuer,
                    args.TimeoutSec,
                    args.RedirectUri,
                )
                check_env_names(root)

    if args.Interactive:
        step("Manual Account login checklist")
        print("  1. Start Hub with operator-provided AGENTHUB_ACCOUNT_OIDC_* values.")
        print("  2. Start Web/Desktop from this repository.")
        print("  3. Use 'Continue with TokenDance Account' / '使用 TokenDance Account 登录'.")
        print("  4. Sign in with a disposable Account test identity and approve consent.")
        print("  5. Confirm the callback URL contains code, state and iss; Hub returns a Hub session.")
        print("  6. Confirm Account credentials/ID tokens never appear in Web storage or Hub audit payloads.")

    print(f"\nPassed: {PASSED}  |  Failed: {FAILED}  |  Total: {PASSED + FAILED}")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - fail closed without echoing values
        print(f"ERROR: {type(exc).__name__}", file=sys.stderr)
        sys.exit(1)
