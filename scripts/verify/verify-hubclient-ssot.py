#!/usr/bin/env python3
"""verify-hubclient-ssot — platform hubClient.ts 薄壳 SSOT 门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

A7 架构门禁候选 #3：每个 platform client
（app/{web,desktop,mobile-rn}/src/api/hubClient.ts）必须：
  1. 通过 createSharedHubClient(...) 委托共享 SSOT（@shared/hubClient 的
     createHubClient 别名导入）；新 Hub REST 方法归 app/shared/src/hubClient.ts。
  2. 行数不超过预算：web <= 120 / desktop <= 300 / mobile <= 500。
  3. 不得新增 /client/ 或 /web/ 路径字面量（白名单外的平台胶水除外）。

共享 SSOT 源码（app/shared/src/hubClient*.ts）刻意不扫描。
"""

import argparse
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(REPO_ROOT, "AGENTS.md")):
        break
    REPO_ROOT = os.path.dirname(REPO_ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

TARGETS = [
    ("app/web/src/api/hubClient.ts", 120),
    ("app/desktop/src/api/hubClient.ts", 300),
    ("app/mobile-rn/src/api/hubClient.ts", 500),
]

# 既有平台胶水字面量白名单（trim 后精确匹配）。mobile-rn createHubWsUrl 的
# WebSocket 升级路径由 hub-server middleware.WSBearerSubprotocol 协商。
ALLOWED_LITERALS = [
    "url.pathname = '/client/ws';",
]

SHARED_CALL_RE = re.compile(r"createSharedHubClient\s*\(")


def read_lines(path):
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return handle.read().splitlines()


def is_allowed_literal(line):
    trimmed = line.strip()
    for allow in ALLOWED_LITERALS:
        if trimmed == allow.strip():
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify that platform hubClient.ts files stay thin shells over the shared SSOT.")
    parser.parse_args()

    passed = 0
    failed = 0

    def pass_check(text):
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail_check(text):
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    print("\n=== hubClient thin-shell SSOT gate ===")

    for rel, max_lines in TARGETS:
        full = os.path.join(REPO_ROOT, rel.replace("/", os.sep))
        print(f"\n[{rel}]")
        if not os.path.exists(full):
            fail_check(f"{rel} missing")
            continue

        lines = read_lines(full)
        line_count = len(lines)

        # 1. 委托共享 SSOT：调用 createSharedHubClient(...)
        has_shared_call = any(SHARED_CALL_RE.search(line, re.IGNORECASE) for line in lines)
        if has_shared_call:
            pass_check("delegates to shared createHubClient (createSharedHubClient(...))")
        else:
            fail_check("must call shared createHubClient (createSharedHubClient(...)) - new Hub REST methods belong in app/shared/src/hubClient.ts")

        # 2. 行数预算
        if line_count <= max_lines:
            pass_check(f"line count {line_count} <= {max_lines}")
        else:
            fail_check(f"line count {line_count} > {max_lines} - thin shell growing past budget")

        # 3. 白名单外禁止新增 /client/ 或 /web/ 路径字面量。
        # 先剥 // 行注释，避免 doc 注释（如头部 "/client/ws"）误报。
        for index, raw in enumerate(lines, start=1):
            code = re.sub(r"//.*$", "", raw)
            if re.search(r"/client/", code, re.IGNORECASE) or re.search(r"/web/", code, re.IGNORECASE):
                if is_allowed_literal(raw):
                    continue
                fail_check(f"{rel}:{index} path literal /client/ or /web/ - Hub REST paths belong in shared SSOT, not thin shell")

    # 3b. 白名单保鲜守卫：白名单字面量必须仍存在于其文件，防止被删行后
    # 旧白名单掩盖未来同类回流。
    mobile_path = os.path.join(REPO_ROOT, "app", "mobile-rn", "src", "api", "hubClient.ts")
    if os.path.exists(mobile_path):
        with open(mobile_path, encoding="utf-8-sig", errors="replace") as handle:
            mobile_content = handle.read()
        found_allow = False
        for allow in ALLOWED_LITERALS:
            if re.search(re.escape(allow.strip()), mobile_content, re.IGNORECASE):
                found_allow = True
                break
        if found_allow:
            pass_check("mobile-rn /client/ws allow-list literal still present (not stale)")
        else:
            fail_check("mobile-rn allow-list literal missing - update allow-list or restore glue")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")

    return 1 if failed != 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
