#!/usr/bin/env python3
"""verify-oidc-code-ssot — 校验 OIDC 错误码前后端 SSOT（#2123 P1-2）。

后端 hub-server/internal/errcode/codes.go 的 oidc_* 错误码集合必须与前端
app/shared/src/api/auth/types.ts 的 OidcBackendErrorCodes 值集合完全一致：
任一侧新增/删除/改名而另一侧未同步即红，避免后端改码前端静默失配。

提取规则：
- 后端：codes.go 中 New("oidc_...", ...) 的字面量；
- 前端：types.ts 中 OidcBackendErrorCodes 对象体内的 'oidc_...' 字面量。
"""
import re
import sys

ROOT = "/".join(__file__.split("/")[:-3])
BACKEND_PATH = f"{ROOT}/hub-server/internal/errcode/codes.go"
FRONTEND_PATH = f"{ROOT}/app/shared/src/api/auth/types.ts"

BACKEND_RE = re.compile(r'New\("(oidc_[a-z0-9_]+)"')
FRONTEND_RE = re.compile(r"['\"](oidc_[a-z0-9_]+)['\"]")


def extract(path, pattern):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as exc:
        print(f"FAIL: cannot read {path}: {exc}")
        sys.exit(1)
    return set(pattern.findall(text))


def main():
    backend = extract(BACKEND_PATH, BACKEND_RE)
    frontend = extract(FRONTEND_PATH, FRONTEND_RE)
    if not backend:
        print(f"FAIL: no OIDC codes extracted from {BACKEND_PATH}")
        sys.exit(1)
    if not frontend:
        print(f"FAIL: no OIDC codes extracted from {FRONTEND_PATH}")
        sys.exit(1)
    missing_frontend = sorted(backend - frontend)
    missing_backend = sorted(frontend - backend)
    if missing_frontend or missing_backend:
        print("FAIL: OIDC code SSOT drift detected (#2123 P1-2)")
        if missing_frontend:
            print(f"  backend-only (add to OidcBackendErrorCodes): {missing_frontend}")
        if missing_backend:
            print(f"  frontend-only (remove or add backend code): {missing_backend}")
        sys.exit(1)
    print(f"PASS: OIDC code SSOT aligned ({len(backend)} codes)")

if __name__ == "__main__":
    main()
