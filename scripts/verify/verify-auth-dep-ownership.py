#!/usr/bin/env python3
"""verify-auth-dep-ownership — auth 依赖所有权门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

auth 中间件与 JWT 工具不得携带包级可变服务依赖（callback 全局、共享 verifier/config 状态）——
同一进程多个 App（并行测试、进程内 server）会互相覆盖安全配置。本门禁在 middleware/jwtutil
出现新的包级 `var` 声明时使 CI 失败。

范围：hub-server/internal/middleware 与 hub-server/internal/jwtutil 下的非测试 .go 文件。
allowlist 覆盖仅存的 1 个有意的全局量（纯原子计数器，用于 rate-limit ZSET 唯一性，非服务依赖）；
allowlist 只缩不增。

用法：
  python scripts/verify/verify-auth-dep-ownership.py
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASSED = 0
FAILED = 0

# 允许持有包级 var 的文件及其理由。
ALLOWLIST = {
    # rateLimitMemberID: 纯原子计数器，用于 ZSET member 唯一性——
    # 非服务依赖（可变服务依赖被禁止）。
    "hub-server/internal/middleware/rate_limit.go",
    # wsIPRL: WS rate-limit limiter 实例，自带 cleanup goroutine。
    # 非 auth 安全依赖——跟踪 #1551 后续（实例自持 + 生命周期 shutdown；当前在 auth 范围外）。
    "hub-server/internal/middleware/ws_rate_limit.go",
}

SCAN_DIRS = (
    "hub-server/internal/middleware",
    "hub-server/internal/jwtutil",
)


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def main() -> int:
    parser = argparse.ArgumentParser(description="auth dependency ownership verifier (#1551)")
    parser.parse_args()

    hits = []
    for scan_dir in SCAN_DIRS:
        full_dir = os.path.join(ROOT, scan_dir)
        if not os.path.isdir(full_dir):
            continue
        for name in sorted(os.listdir(full_dir)):
            if not name.endswith(".go") or name.endswith("_test.go"):
                continue
            rel = f"{scan_dir}/{name}"
            if rel in ALLOWLIST:
                continue
            with open(os.path.join(full_dir, name), encoding="utf-8", errors="replace") as handle:
                for line_no, line in enumerate(handle, start=1):
                    if re.match(r"^var\s+[A-Za-z_]", line):
                        hits.append(f"{rel}:{line_no}: {line.strip()}")

    if not hits:
        pass_check("no package-level vars in middleware/jwtutil (auth deps are instance-owned)")
    else:
        for hit in hits:
            fail_check(f"package-level var found: {hit}")
        print("  #1551: auth security dependencies must be instance-owned (AuthDependencies /")
        print("        TokenDanceVerifier constructed in the composition root).")
        return 1

    print("")
    print(f"Auth dependency ownership: {PASSED} pass")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
