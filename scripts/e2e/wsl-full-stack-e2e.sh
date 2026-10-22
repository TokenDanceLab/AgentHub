#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AgentHub WSL full-stack Account OIDC fixture lane.
#
# Starts a repo-local, public, Account-shaped OIDC fixture plus Hub/PostgreSQL/
# Redis services in Docker. No internal Account checkout, database, API or secret is
# used. The fixture implements the public /oauth contract needed to verify Hub
# authorization, RFC 9207 iss handling, code exchange, UserInfo and Hub session
# issuance. It is fixture evidence, not a live Account acceptance run.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

PROJECT_NAME="${1:-agenthub-e2e}"
KEEP="${2:-0}"
EVIDENCE_DIR="${3:-/tmp/agenthub-e2e-evidence}"

: "${AGENTHUB_E2E_SRC_ROOT:?set AGENTHUB_E2E_SRC_ROOT to the parent directory containing the AgentHub checkout}"
REPO_HOST_ROOT="$AGENTHUB_E2E_SRC_ROOT"
WORK="/tmp/${PROJECT_NAME}-work"
COMPOSE="$WORK/docker-compose.yml"
EVIDENCE="$WORK/evidence.json"

PORT_ACCOUNT=13000
PORT_HUB=18080
PORT_HUB_ADMIN=16060
PORT_PG=15432
PORT_REDIS=15437

PASS_COUNT=0
FAIL_COUNT=0

info() { echo "E2E-INFO: $*"; }
step() { echo "E2E-INFO: === $* ==="; }
pass() { echo "E2E-PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "E2E-FAIL: $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    fail "prereq|command '$1' missing in WSL"
    exit 1
  }
}

wait_http() { # url attempts interval_s
  local url="$1" attempts="${2:-60}" interval="${3:-2}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep "$interval"
  done
  return 1
}

environment_check() {
  step "docker environment self-check"
  require_cmd docker
  require_cmd curl
  require_cmd git
  require_cmd python3
  docker info >/dev/null 2>&1 || {
    fail "docker-daemon|docker daemon not running"
    exit 1
  }
  docker compose version >/dev/null 2>&1 || {
    fail "docker-self-check|docker compose plugin unavailable"
    exit 1
  }
  pass "docker environment usable"
}

prepare_sources() {
  step "source clone"
  mkdir -p "$WORK" "$EVIDENCE_DIR"
  if [ "$KEEP" = "1" ] && [ -d "$WORK/agenthub/.git" ]; then
    info "reusing existing AgentHub source (keep mode)"
    return
  fi
  rm -rf "$WORK/agenthub"
  info "cloning AgentHub (committed state only)"
  git clone --quiet --depth 1 --no-tags "file://$REPO_HOST_ROOT/AgentHub" "$WORK/agenthub"
  pass "AgentHub source ready (committed HEAD)"
}

write_account_fixture() {
  step "repo-local Account-shaped OIDC fixture"
  local fixture_dir="$WORK/account-fixture"
  mkdir -p "$fixture_dir"
  cat >"$fixture_dir/mock.py" <<'PYEOF'
import base64
import hashlib
import json
import os
import secrets
import subprocess
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ISSUER = os.environ["ACCOUNT_ISSUER"].rstrip("/")
CLIENT_ID = os.environ["ACCOUNT_CLIENT_ID"]
CLIENT_SECRET = os.environ["ACCOUNT_CLIENT_SECRET"]
PORT = int(os.environ.get("PORT", "13000"))
KID = "account-fixture-2026-10"
SUBJECT = os.environ.get("FIXTURE_SUBJECT", "fixture-account-user")
NAME = os.environ.get("FIXTURE_NAME", "Account Fixture User")
KEY_PATH = "/tmp/account-fixture-private.pem"

subprocess.run(
    ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
     "-out", KEY_PATH],
    check=True,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
modulus = subprocess.check_output(
    ["openssl", "rsa", "-in", KEY_PATH, "-noout", "-modulus"],
    text=True,
).strip().split("=", 1)[1]


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def int_b64url(value):
    return b64url(value.to_bytes((value.bit_length() + 7) // 8, "big"))


codes = {}
access_tokens = {}


def sign_jwt(claims):
    header = {"alg": "RS256", "kid": KID, "typ": "JWT"}
    signing_input = (
        b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url(json.dumps(claims, separators=(",", ":")).encode())
    )
    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", KEY_PATH],
        input=signing_input.encode(),
        stdout=subprocess.PIPE,
        check=True,
    ).stdout
    return signing_input + "." + b64url(signature)


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentHubAccountFixture/1"

    def log_message(self, _format, *_args):
        return

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def basic_client(self):
        raw = self.headers.get("Authorization", "")
        if not raw.startswith("Basic "):
            return None
        try:
            decoded = base64.b64decode(raw[6:], validate=True).decode()
        except Exception:
            return None
        client_id, _, secret = decoded.partition(":")
        return client_id, secret

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        if parsed.path == "/.well-known/openid-configuration":
            self.send_json(
                200,
                {
                    "issuer": ISSUER,
                    "authorization_endpoint": ISSUER + "/oauth/authorize",
                    "token_endpoint": ISSUER + "/oauth/token",
                    "userinfo_endpoint": ISSUER + "/oauth/userinfo",
                    "jwks_uri": ISSUER + "/oauth/jwks",
                    "end_session_endpoint": ISSUER + "/oauth/end-session",
                    "response_types_supported": ["code"],
                    "response_modes_supported": ["query"],
                    "grant_types_supported": ["authorization_code"],
                    "id_token_signing_alg_values_supported": ["RS256"],
                    "token_endpoint_auth_methods_supported": ["client_secret_basic"],
                    "code_challenge_methods_supported": ["S256"],
                    "scopes_supported": ["openid", "profile"],
                    "authorization_response_iss_parameter_supported": True,
                },
            )
            return
        if parsed.path == "/oauth/jwks":
            self.send_json(
                200,
                {
                    "keys": [
                        {
                            "kty": "RSA",
                            "use": "sig",
                            "alg": "RS256",
                            "kid": KID,
                            "n": int_b64url(int(modulus, 16)),
                            "e": "AQAB",
                        }
                    ]
                },
            )
            return
        if parsed.path == "/oauth/authorize":
            self.authorize(urllib.parse.parse_qs(parsed.query, keep_blank_values=True))
            return
        if parsed.path == "/oauth/userinfo":
            self.userinfo()
            return
        if parsed.path == "/oauth/end-session":
            self.send_response(204)
            self.end_headers()
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/oauth/token":
            self.token()
            return
        if parsed.path == "/oauth/userinfo":
            self.userinfo()
            return
        self.send_json(404, {"error": "not_found"})

    def authorize(self, query):
        def one(name):
            values = query.get(name) or [""]
            return values[0]

        if one("response_type") != "code":
            self.send_json(400, {"error": "unsupported_response_type"})
            return
        if one("client_id") != CLIENT_ID:
            self.send_json(400, {"error": "invalid_request"})
            return
        redirect_uri = one("redirect_uri")
        if redirect_uri != "http://127.0.0.1/callback":
            self.send_json(400, {"error": "invalid_request"})
            return
        if one("scope").split() != ["openid", "profile"]:
            self.send_json(400, {"error": "invalid_scope"})
            return
        if one("code_challenge_method") != "S256" or not one("code_challenge"):
            self.send_json(400, {"error": "invalid_request"})
            return
        state, nonce = one("state"), one("nonce")
        if not state or not nonce:
            self.send_json(400, {"error": "invalid_request"})
            return
        code = "fixture-code-" + secrets.token_urlsafe(24)
        codes[code] = {
            "redirect_uri": redirect_uri,
            "challenge": one("code_challenge"),
            "nonce": nonce,
            "created": int(time.time()),
        }
        query_out = urllib.parse.urlencode({"code": code, "state": state, "iss": ISSUER})
        self.redirect(redirect_uri + "?" + query_out)

    def token(self):
        client = self.basic_client()
        if client != (CLIENT_ID, CLIENT_SECRET):
            self.send_json(401, {"error": "invalid_client"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        form = urllib.parse.parse_qs(
            self.rfile.read(length).decode("utf-8"), keep_blank_values=True
        )

        def one(name):
            return (form.get(name) or [""])[0]

        if one("grant_type") != "authorization_code":
            self.send_json(400, {"error": "unsupported_grant_type"})
            return
        code = one("code")
        record = codes.pop(code, None)
        if (
            not record
            or int(time.time()) - record["created"] > 300
            or one("redirect_uri") != record["redirect_uri"]
        ):
            self.send_json(400, {"error": "invalid_grant"})
            return
        verifier = one("code_verifier")
        challenge = b64url(hashlib.sha256(verifier.encode()).digest())
        if not verifier or challenge != record["challenge"]:
            self.send_json(400, {"error": "invalid_grant"})
            return

        now = int(time.time())
        id_token = sign_jwt(
            {
                "iss": ISSUER,
                "sub": SUBJECT,
                "aud": CLIENT_ID,
                "azp": CLIENT_ID,
                "exp": now + 600,
                "iat": now,
                "nonce": record["nonce"],
            }
        )
        access_token = "fixture-access-" + secrets.token_urlsafe(24)
        access_tokens[access_token] = True
        self.send_json(
            200,
            {
                "access_token": access_token,
                "token_type": "Bearer",
                "expires_in": 600,
                "id_token": id_token,
                "scope": "openid profile",
            },
        )

    def userinfo(self):
        raw = self.headers.get("Authorization", "")
        token = raw[7:] if raw.startswith("Bearer ") else ""
        if not access_tokens.get(token):
            body = json.dumps({"error": "invalid_token"}).encode()
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Bearer error="invalid_token"')
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json(200, {"sub": SUBJECT, "name": NAME})


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
PYEOF
  pass "public Account-shaped fixture source written"
}

generate_compose() {
  step "compose generation"
  JWT_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  ACCOUNT_CLIENT_ID="tdc_agenthub_fixture"
  ACCOUNT_CLIENT_SECRET="fixture-client-secret-$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
  cat >"$COMPOSE" <<EOF
services:
  pg:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME}-pg
    environment:
      POSTGRES_USER: agenthub
      POSTGRES_PASSWORD: e2e-pg-pass
      POSTGRES_DB: agenthub
    ports:
      - "127.0.0.1:${PORT_PG}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agenthub -d agenthub"]
      interval: 3s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME}-redis
    ports:
      - "127.0.0.1:${PORT_REDIS}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 20

  account:
    image: python:3.13-alpine
    container_name: ${PROJECT_NAME}-account-fixture
    command:
      - sh
      - -c
      - apk add --no-cache openssl >/dev/null && python3 /app/mock.py
    environment:
      ACCOUNT_ISSUER: "http://account:${PORT_ACCOUNT}"
      ACCOUNT_CLIENT_ID: "${ACCOUNT_CLIENT_ID}"
      ACCOUNT_CLIENT_SECRET: "${ACCOUNT_CLIENT_SECRET}"
      PORT: "${PORT_ACCOUNT}"
    volumes:
      - ${WORK}/account-fixture:/app:ro
    ports:
      - "127.0.0.1:${PORT_ACCOUNT}:${PORT_ACCOUNT}"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:${PORT_ACCOUNT}/.well-known/openid-configuration >/dev/null"]
      interval: 4s
      timeout: 4s
      retries: 30

  hub:
    build:
      context: ${WORK}/agenthub
      dockerfile: hub-server/deployments/Dockerfile
    container_name: ${PROJECT_NAME}-hub
    depends_on:
      pg:
        condition: service_healthy
      redis:
        condition: service_healthy
      account:
        condition: service_healthy
    environment:
      AGENTHUB_DB_HOST: pg
      AGENTHUB_DB_PORT: "5432"
      AGENTHUB_DB_USER: agenthub
      AGENTHUB_DB_PASSWORD: e2e-pg-pass
      AGENTHUB_DB_NAME: agenthub
      AGENTHUB_DB_SSLMODE: disable
      AGENTHUB_REDIS_HOST: redis
      AGENTHUB_REDIS_PORT: "6379"
      AGENTHUB_JWT_SECRET: "${JWT_SECRET}"
      AGENTHUB_SERVER_PORT: "8080"
      AGENTHUB_SERVER_ADMIN_PORT: "6060"
      AGENTHUB_LOG_LEVEL: warn
      AGENTHUB_UPLOAD_DIR: /app/uploads
      AGENTHUB_ACCOUNT_OIDC_ISSUER_URL: "http://account:${PORT_ACCOUNT}"
      AGENTHUB_ACCOUNT_OIDC_CLIENT_ID: "${ACCOUNT_CLIENT_ID}"
      AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET: "${ACCOUNT_CLIENT_SECRET}"
      AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI: "http://127.0.0.1/callback"
      AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS: "http://127.0.0.1/callback"
    ports:
      - "127.0.0.1:${PORT_HUB}:8080"
      - "127.0.0.1:${PORT_HUB_ADMIN}:6060"
    volumes:
      - uploads_data:/app/uploads
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/health >/dev/null"]
      interval: 5s
      timeout: 5s
      retries: 40
      start_period: 20s

volumes:
  uploads_data:
EOF
  chmod 600 "$COMPOSE"
  pass "compose written (Account fixture + Hub/Edge data services)"
}

start_stack() {
  step "stack up (build may take several minutes)"
  if [ -n "${AGENTHUB_E2E_HTTP_PROXY:-}" ]; then
    export HTTP_PROXY="$AGENTHUB_E2E_HTTP_PROXY"
    export HTTPS_PROXY="$AGENTHUB_E2E_HTTP_PROXY"
    export NO_PROXY="localhost,127.0.0.1"
  fi
  (cd "$WORK" && docker compose up -d --build) || {
    fail "stack-up|docker compose up failed"
    (cd "$WORK" && docker compose logs --no-color 2>/dev/null | tail -40 || true)
    return 1
  }
  wait_http "http://127.0.0.1:${PORT_ACCOUNT}/.well-known/openid-configuration" 120 2 ||
    { fail "health|Account fixture"; return 1; }
  wait_http "http://127.0.0.1:${PORT_HUB}/health" 120 2 ||
    { fail "health|hub-server"; return 1; }
  pass "stack healthy (Account fixture/hub/pg/redis)"
}

run_oidc_flow() {
  step "Account OIDC Authorization Code + PKCE contract"
  local verifier challenge device_id
  device_id="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  verifier="$(python3 -c 'import secrets,string;print("".join(secrets.choice(string.ascii_letters+string.digits+"-._~") for _ in range(64)))')"
  challenge="$(printf '%s' "$verifier" | python3 -c 'import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.stdin.buffer.read()).digest()).rstrip(b"=").decode())')"

  local authorize redirect_uri authz state auth_url issuer
  redirect_uri="http://127.0.0.1/callback"
  authz="$(curl -sf -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/authorize" \
    -H 'Content-Type: application/json' \
    -d "{\"code_challenge\":\"$challenge\",\"code_challenge_method\":\"S256\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"$redirect_uri\"}")"
  state="$(printf '%s' "$authz" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["state"])')"
  auth_url="$(printf '%s' "$authz" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["authorization_url"])')"
  issuer="$(printf '%s' "$authz" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["issuer"])')"
  [ "$issuer" = "http://account:${PORT_ACCOUNT}" ] || {
    fail "oidc|Hub pinned unexpected issuer"
    return 1
  }
  auth_url="$(printf '%s' "$auth_url" | PORT_ACCOUNT="$PORT_ACCOUNT" python3 -c '
import os, sys
print(sys.stdin.read().replace(
    "http://account:" + os.environ["PORT_ACCOUNT"],
    "http://127.0.0.1:" + os.environ["PORT_ACCOUNT"],
))
')"
  pass "Hub pinned exact Account issuer and issued authorize state"

  local response location code returned_state returned_iss
  response="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$auth_url")"
  [[ "$response" == 302\ * ]] || { fail "oidc|fixture authorize did not redirect"; return 1; }
  location="${response#* }"
  code="$(printf '%s' "$location" | python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(urllib.parse.urlparse(sys.stdin.read()).query)["code"][0])')"
  returned_state="$(printf '%s' "$location" | python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(urllib.parse.urlparse(sys.stdin.read()).query)["state"][0])')"
  returned_iss="$(printf '%s' "$location" | python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(urllib.parse.urlparse(sys.stdin.read()).query)["iss"][0])')"
  [ "$returned_state" = "$state" ] && [ "$returned_iss" = "$issuer" ] || {
    fail "oidc|authorization response state/iss mismatch"
    return 1
  }
  pass "authorization response carries exact state and RFC 9207 iss"

  local no_iss wrong_iss
  no_iss="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/callback" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\",\"state\":\"$state\",\"code_verifier\":\"$verifier\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"$redirect_uri\"}")"
  [ "$no_iss" = "400" ] || { fail "negative|callback without iss expected 400, got $no_iss"; return 1; }
  pass "negative test: callback without iss rejected"

  wrong_iss="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/callback" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\",\"state\":\"$state\",\"iss\":\"https://wrong-issuer.invalid\",\"code_verifier\":\"$verifier\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"$redirect_uri\"}")"
  [ "$wrong_iss" = "400" ] || { fail "negative|callback with wrong iss expected 400, got $wrong_iss"; return 1; }
  pass "negative test: callback with wrong issuer rejected"

  local callback access_token me
  callback="$(curl -sf -X POST "http://127.0.0.1:${PORT_HUB}/client/auth/oidc/callback" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\",\"state\":\"$state\",\"iss\":\"$issuer\",\"code_verifier\":\"$verifier\",\"device_type\":\"desktop\",\"device_id\":\"$device_id\",\"redirect_uri\":\"$redirect_uri\"}")"
  access_token="$(printf '%s' "$callback" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])')"
  [ -n "$access_token" ] || { fail "oidc|Hub callback exchange failed"; return 1; }
  pass "fixture code exchange issued a Hub access token"

  me="$(curl -sf -H "Authorization: Bearer $access_token" "http://127.0.0.1:${PORT_HUB}/client/auth/me")"
  printf '%s' "$me" | grep -q '"code":"ok"' ||
    { fail "me|/client/auth/me failed"; return 1; }
  pass "Hub product API authenticated"
}

write_evidence() {
  step "evidence manifest"
  python3 - "$EVIDENCE" "$EVIDENCE_DIR" <<'PYEOF'
import json
import os
import sys
import time

path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
doc = {
    "kind": "wsl-full-stack-e2e",
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "real_account_login": False,
    "account_oidc_contract": True,
    "login_mode": "repo-local-account-shaped-fixture",
    "evidence_level": "fixture",
    "stack": [
        "account-oidc-fixture",
        "hub-server",
        "postgres:16-alpine",
        "redis:7-alpine",
    ],
    "checks": {
        "environment": "PASS",
        "source": "PASS",
        "stack_healthy": "PASS",
        "exact_issuer": "PASS",
        "rfc9207_iss": "PASS",
        "oidc_pkce_login": "PASS",
        "hub_product_api": "PASS",
    },
}
json.dump(doc, open(path, "w"), indent=2, ensure_ascii=False)
json.dump(doc, open(os.path.join(out_dir, "evidence.json"), "w"), indent=2, ensure_ascii=False)
print("E2E-INFO: evidence written to " + os.path.join(out_dir, "evidence.json"))
PYEOF
}

cleanup() {
  local rc=$?
  if [ "$KEEP" = "1" ]; then
    info "keep mode: stack and source retained at $WORK"
  else
    if [ -f "$COMPOSE" ]; then
      (cd "$WORK" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK"
    info "stack cleaned"
  fi
  if [ "$rc" -eq 0 ]; then
    echo "E2E-RESULT: PASS"
  else
    echo "E2E-RESULT: FAIL"
  fi
  exit "$rc"
}
trap cleanup EXIT

environment_check
prepare_sources
write_account_fixture
generate_compose
start_stack
run_oidc_flow
write_evidence
