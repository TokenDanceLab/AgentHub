#!/usr/bin/env python3
"""setup-tokendance-oidc — 创建/轮换 AgentHub Desktop 的 OAuth client 凭据（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

用法: python hub-server/scripts/setup-tokendance-oidc.py [--TokenDanceUrl <url>]
前置: TokenDance ID 正在运行（默认 http://localhost:3000）
输出: 打印 AGENTHUB_TOKENDANCE_ID_* env 变量到 stdout

契约：stdlib only；参数/输出行（`[1/3]` / `[2/3]` / `[3/3]` 分步与 env 输出）
与 ps1 一致；退出码 1=失败（TokenDance ID 不可达 / 无 API key / 创建失败）。
交互式 API key 输入走 stdin（对齐 ps1 Read-Host）。
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

CLIENT_NAME = "AgentHub Desktop"
CLIENT_ID = "agenthub-desktop"


def http_json(method: str, url: str, headers: dict, body=None, timeout: int = 10):
    request = urllib.request.Request(url, method=method, headers=headers)
    if body is not None:
        request.data = json.dumps(body).encode("utf-8")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--TokenDanceUrl", "-TokenDanceUrl", default="http://localhost:3000")
    args = parser.parse_args()

    token_dance_url = args.TokenDanceUrl.rstrip("/")

    print("=== AgentHub Desktop — TokenDance ID OAuth Client Setup ===")
    print("")

    # ── Step 1: Check TokenDance ID is reachable ──────────────────────────
    print(f"[1/3] Checking TokenDance ID at {token_dance_url} ...")
    try:
        http_json("GET", f"{token_dance_url}/health", {}, timeout=5)
        print("  TokenDance ID is running.")
    except Exception:  # noqa: BLE001 —— 对齐 ps1 try/catch 的不可达语义
        print(f"  ERROR: TokenDance ID is not reachable at {token_dance_url}")
        print("  Start it with: cd ..\\tokendance-id; go run .\\cmd\\tokendance-id")
        print("  Then retry this script.")
        return 1

    # ── Step 2: Get admin credentials ─────────────────────────────────────
    print("")
    print("[2/3] You need an API key to create OAuth clients.")
    print(f"  Open {token_dance_url} in your browser and log in.")
    print("  Then go to API Keys and create a key with name 'setup-script'.")
    print("")
    api_key = input("  Paste your API key (starts with sk-): ").strip()

    if not api_key:
        print("  ERROR: No API key provided.")
        return 1

    if not api_key.startswith("sk-"):
        print("  WARNING: API key does not start with 'sk-'. Continuing anyway...")

    # ── Step 3: Create or rotate client ──────────────────────────────────
    print("")
    print(f"[3/3] Setting up OAuth client '{CLIENT_NAME}' ...")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Try to find existing client
    existing = None
    try:
        list_response = http_json("GET", f"{token_dance_url}/api/clients", {"Authorization": f"Bearer {api_key}"}, timeout=10)
        for client in list_response.get("clients") or []:
            if client.get("client_id") == CLIENT_ID:
                existing = client
                break
    except Exception:  # noqa: BLE001 —— 对齐 ps1 catch 置 $existing = $null
        existing = None

    secret = None
    if existing:
        print(f"  Client '{CLIENT_ID}' already exists. Rotating secret...")
        try:
            rotate_response = http_json(
                "POST",
                f"{token_dance_url}/api/clients/{existing.get('id')}/rotate-secret",
                {"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            secret = rotate_response.get("client_secret")
            print("  Secret rotated.")
        except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 的 WARNING 语义
            print(f"  WARNING: Rotate failed: {exc}")

    if not secret:
        print(f"  Creating new client '{CLIENT_ID}' ...")
        try:
            body = {
                "name": CLIENT_NAME,
                "redirect_uris": [
                    "http://127.0.0.1/callback",
                    "http://localhost:5174/auth/tokendance/callback",
                    "http://127.0.0.1:5174/auth/tokendance/callback",
                ],
                "grant_types": ["authorization_code"],
                "scopes": ["openid", "profile", "email"],
            }
            create_response = http_json("POST", f"{token_dance_url}/api/clients", headers, body, timeout=10)
            secret = create_response.get("client_secret")
            print("  Client created.")
        except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch 的 ERROR 语义
            print(f"  ERROR: Failed to create client: {exc}")
            print("  Fallback: run the seed SQL:")
            print("    sqlite3 ..\\tokendance-id\\data\\tokendance.db < scripts\\seed-tokendance-client.sql")
            return 1

    if not secret:
        print("  ERROR: Could not obtain client_secret.")
        return 1

    # ── Output ────────────────────────────────────────────────────────────
    print("")
    print("=== Add these to your hub-server\\.env ===")
    print("")
    print(f"AGENTHUB_TOKENDANCE_ID_ISSUER_URL={token_dance_url}")
    print(f"AGENTHUB_TOKENDANCE_ID_CLIENT_ID={CLIENT_ID}")
    print(f"AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET={secret}")
    print("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=http://127.0.0.1/callback")
    print("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS=http://127.0.0.1/callback,http://localhost:5174/auth/tokendance/callback,http://127.0.0.1:5174/auth/tokendance/callback")
    print("")
    print("Done. Keep the client_secret safe — it will never be shown again.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
