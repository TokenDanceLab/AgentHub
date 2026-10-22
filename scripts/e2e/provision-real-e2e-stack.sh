#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AgentHub real Account OIDC E2E preflight.
#
# This script never creates clients, registers accounts, reads a provider
# database, or starts/clones an internal Account checkout. Operators must
# pre-register the AgentHub Account client and provide disposable test
# identities through the environment. The script validates the public Account
# contract and the already-running Hub, then writes only runtime E2E settings
# to tests/artifacts/real-e2e-account.env (gitignored, mode 0600).
#
# Required operator inputs:
#   AGENTHUB_E2E_ACCOUNT_ISSUER (or AGENTHUB_ACCOUNT_OIDC_ISSUER_URL)
#   AGENTHUB_E2E_USER_EMAIL / AGENTHUB_E2E_USER_PASSWORD
#   AGENTHUB_E2E_PARTNER_EMAIL / AGENTHUB_E2E_PARTNER_PASSWORD
#
# Optional:
#   AGENTHUB_E2E_HUB_BASE_URL (default http://127.0.0.1:8080)
#   AGENTHUB_E2E_EDGE_BASE_URL (default http://127.0.0.1:3210)
#   AGENTHUB_E2E_WEB_BASE_URL (default http://127.0.0.1:5174)
#   AGENTHUB_E2E_WEB_CALLBACK_URL (default <web>/workbench/auth/account/callback)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

ISSUER="${AGENTHUB_E2E_ACCOUNT_ISSUER:-${AGENTHUB_ACCOUNT_OIDC_ISSUER_URL:-}}"
ISSUER="${ISSUER%/}"
HUB_BASE_URL="${AGENTHUB_E2E_HUB_BASE_URL:-http://127.0.0.1:8080}"
EDGE_BASE_URL="${AGENTHUB_E2E_EDGE_BASE_URL:-http://127.0.0.1:3210}"
WEB_BASE_URL="${AGENTHUB_E2E_WEB_BASE_URL:-http://127.0.0.1:5174}"
WEB_CALLBACK_URL="${AGENTHUB_E2E_WEB_CALLBACK_URL:-${WEB_BASE_URL%/}/workbench/auth/account/callback}"
USER_EMAIL="${AGENTHUB_E2E_USER_EMAIL:-}"
USER_PASSWORD="${AGENTHUB_E2E_USER_PASSWORD:-}"
PARTNER_EMAIL="${AGENTHUB_E2E_PARTNER_EMAIL:-}"
PARTNER_PASSWORD="${AGENTHUB_E2E_PARTNER_PASSWORD:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/tests/artifacts"
ACCOUNT_ENV="$ARTIFACT_DIR/real-e2e-account.env"

info() { echo "E2E-INFO: $*"; }
ok() { echo "E2E-PASS: $*"; }
die() { echo "E2E-FAIL: $*" >&2; exit 1; }

require_value() { # name value
  [ -n "$2" ] || die "$1 is required; internal provider setup is not a fallback"
}

command -v curl >/dev/null 2>&1 || die "missing command: curl"
command -v python3 >/dev/null 2>&1 || die "missing command: python3"

require_value AGENTHUB_E2E_ACCOUNT_ISSUER "$ISSUER"
require_value AGENTHUB_E2E_USER_EMAIL "$USER_EMAIL"
require_value AGENTHUB_E2E_USER_PASSWORD "$USER_PASSWORD"
require_value AGENTHUB_E2E_PARTNER_EMAIL "$PARTNER_EMAIL"
require_value AGENTHUB_E2E_PARTNER_PASSWORD "$PARTNER_PASSWORD"

for value in "$USER_EMAIL" "$USER_PASSWORD" "$PARTNER_EMAIL" "$PARTNER_PASSWORD"; do
  case "$value" in
    *$'\n'*|*$'\r'*) die "test account values must not contain newlines" ;;
  esac
done

info "validating external Account discovery and Hub OIDC contract"
ACCOUNT_ISSUER="$ISSUER" HUB_BASE_URL="$HUB_BASE_URL" WEB_CALLBACK_URL="$WEB_CALLBACK_URL" \
python3 - <<'PYEOF'
import base64
import hashlib
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.parse
import urllib.request

issuer = os.environ["ACCOUNT_ISSUER"].strip().rstrip("/")
hub = os.environ["HUB_BASE_URL"].strip().rstrip("/")
redirect_uri = os.environ["WEB_CALLBACK_URL"].strip()
user_agent = "AgentHub-Real-E2E/1"


def fail(message):
    print(f"E2E-FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def get_json(url, label):
    try:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": user_agent},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError, OSError):
        fail(f"{label} is unavailable")


def same_origin(endpoint, canonical_issuer):
    parsed = urllib.parse.urlparse(endpoint)
    canonical = urllib.parse.urlparse(canonical_issuer)
    return (
        parsed.scheme in ("https", "http")
        and parsed.scheme == canonical.scheme
        and parsed.netloc.lower() == canonical.netloc.lower()
        and not parsed.username
        and not parsed.password
    )


parsed_issuer = urllib.parse.urlparse(issuer)
if parsed_issuer.scheme not in ("https", "http") or not parsed_issuer.netloc:
    fail("Account issuer must be an absolute http(s) URL")
if parsed_issuer.scheme != "https" and parsed_issuer.hostname not in ("127.0.0.1", "::1", "localhost"):
    fail("non-loopback Account issuers must use HTTPS")

discovery = get_json(issuer + "/.well-known/openid-configuration", "Account discovery")
if discovery.get("issuer") != issuer:
    fail("Account discovery issuer does not exactly match the configured issuer")

required_endpoints = {
    "authorization_endpoint": issuer + "/oauth/authorize",
    "token_endpoint": issuer + "/oauth/token",
    "userinfo_endpoint": issuer + "/oauth/userinfo",
    "jwks_uri": issuer + "/oauth/jwks",
}
for field, expected in required_endpoints.items():
    actual = str(discovery.get(field) or "")
    if actual != expected or not same_origin(actual, issuer):
        fail(f"Account discovery {field} does not match the public /oauth contract")


def supports(field, value):
    values = discovery.get(field)
    return isinstance(values, list) and value in values


if not supports("response_types_supported", "code"):
    fail("Account discovery must support response_type=code")
if not supports("response_modes_supported", "query"):
    fail("Account discovery must support response_mode=query")
if not supports("grant_types_supported", "authorization_code"):
    fail("Account discovery must support authorization_code")
if not supports("id_token_signing_alg_values_supported", "RS256"):
    fail("Account discovery must support RS256 ID tokens")
if not supports("code_challenge_methods_supported", "S256"):
    fail("Account discovery must require PKCE S256")
if not supports("token_endpoint_auth_methods_supported", "client_secret_basic"):
    fail("Account discovery must support confidential client_secret_basic")
if discovery.get("authorization_response_iss_parameter_supported") is not True:
    fail("Account discovery must advertise RFC 9207 authorization response issuer support")

jwks = get_json(required_endpoints["jwks_uri"], "Account JWKS")
keys = jwks.get("keys") if isinstance(jwks, dict) else None
if not isinstance(keys, list) or not any(
    key.get("kty") == "RSA" for key in keys if isinstance(key, dict)
):
    fail("Account JWKS must contain an RSA signing key")

# Starting authorization is read-only and proves that Hub is configured with
# the external client/issuer. It deliberately does not exchange a code.
verifier = "".join(
    secrets.choice(string.ascii_letters + string.digits + "-._~") for _ in range(64)
)
challenge = base64.urlsafe_b64encode(
    hashlib.sha256(verifier.encode("utf-8")).digest()
).rstrip(b"=").decode("ascii")
payload = json.dumps(
    {
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "device_type": "web",
        "device_id": "00000000-0000-4000-8000-000000000002",
        "redirect_uri": redirect_uri,
    }
).encode("utf-8")

try:
    request = urllib.request.Request(
        hub + "/client/auth/oidc/authorize",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": user_agent},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        envelope = json.load(response)
except urllib.error.HTTPError as exc:
    fail(f"Hub rejected the registered web redirect (HTTP {exc.code})")
except (urllib.error.URLError, ValueError, OSError):
    fail("Hub Account authorize endpoint is unavailable or returned invalid JSON")

auth = (
    envelope.get("data")
    if isinstance(envelope, dict) and envelope.get("data") is not None
    else envelope
)
if not isinstance(auth, dict):
    fail("Hub Account authorize response is invalid")
if auth.get("issuer") != issuer:
    fail("Hub did not pin the configured Account issuer")

authorization_url = str(auth.get("authorization_url") or "")
parsed_auth = urllib.parse.urlparse(authorization_url)
if not same_origin(authorization_url, issuer) or parsed_auth.path != "/oauth/authorize":
    fail("Hub authorization URL does not use the discovered Account endpoint")
params = urllib.parse.parse_qs(parsed_auth.query, keep_blank_values=True)
expected_query = {
    "response_type": "code",
    "scope": "openid profile",
    "redirect_uri": redirect_uri,
    "code_challenge_method": "S256",
    "prompt": "consent",
}
for key, expected in expected_query.items():
    if params.get(key) != [expected]:
        fail(f"Hub authorization URL has an invalid {key}")
for key in ("client_id", "state", "nonce", "code_challenge"):
    if not params.get(key, [""])[0]:
        fail(f"Hub authorization URL is missing {key}")
if auth.get("state") != params.get("state", [""])[0]:
    fail("Hub authorization state is not bound to the returned URL")

# RFC 9207 iss is mandatory at callback binding, before state/code exchange.
negative = json.dumps(
    {
        "code": "invalid-code",
        "state": "invalid-state",
        "code_verifier": verifier,
        "device_type": "web",
        "device_id": "00000000-0000-4000-8000-000000000002",
        "redirect_uri": redirect_uri,
    }
).encode("utf-8")
try:
    request = urllib.request.Request(
        hub + "/client/auth/oidc/callback",
        data=negative,
        headers={"Content-Type": "application/json", "User-Agent": user_agent},
        method="POST",
    )
    urllib.request.urlopen(request, timeout=15)
    fail("Hub accepted an Account callback without RFC 9207 iss")
except urllib.error.HTTPError as exc:
    if exc.code != 400:
        fail(f"Hub callback without iss must fail with HTTP 400, got {exc.code}")
except (urllib.error.URLError, OSError):
    fail("Hub Account callback endpoint is unavailable")

print("E2E-PASS: external Account discovery matches the canonical issuer")
print(
    "E2E-PASS: Account advertises code/query, authorization_code, RS256, S256, "
    "client_secret_basic and RFC 9207"
)
print(
    "E2E-PASS: Hub authorize uses /oauth/authorize, openid profile, nonce, "
    "state and exact redirect_uri"
)
print("E2E-PASS: Hub rejects an Account callback without iss")
PYEOF

mkdir -p "$ARTIFACT_DIR"
chmod 700 "$ARTIFACT_DIR"
{
  printf 'AGENTHUB_E2E_ACCOUNT_ISSUER=%s\n' "$ISSUER"
  printf 'AGENTHUB_E2E_HUB_BASE_URL=%s\n' "$HUB_BASE_URL"
  printf 'AGENTHUB_E2E_EDGE_BASE_URL=%s\n' "$EDGE_BASE_URL"
  printf 'AGENTHUB_E2E_WEB_BASE_URL=%s\n' "$WEB_BASE_URL"
  printf 'AGENTHUB_E2E_USER_EMAIL=%s\n' "$USER_EMAIL"
  printf 'AGENTHUB_E2E_USER_PASSWORD=%s\n' "$USER_PASSWORD"
  printf 'AGENTHUB_E2E_PARTNER_EMAIL=%s\n' "$PARTNER_EMAIL"
  printf 'AGENTHUB_E2E_PARTNER_PASSWORD=%s\n' "$PARTNER_PASSWORD"
} >"$ACCOUNT_ENV"
chmod 600 "$ACCOUNT_ENV"
ok "operator-provided test accounts accepted; credentials written to $ACCOUNT_ENV (mode 0600)"

echo "E2E-RESULT: PASS"
