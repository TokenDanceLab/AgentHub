#!/usr/bin/env python3
"""verify-conventions — router 方法 ↔ conventions.md SSOT 门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Hub router（hub-server/internal/router/router.go）用 gin 方法助手注册路由
（r.GET(、web.PUT(、client.POST( 等），其使用的每个 HTTP 方法必须出现在
api/conventions.md 的 HTTP 方法表。router 方法集合必须是 conventions.md
方法集合的子集；conventions.md 预文档化 router 尚未使用的方法只算 NOTICE。

方法名提取镜像 ps1 语义：router 侧用 [regex]::Matches（大小写敏感），
conventions 侧匹配 | `METHOD` | 表行。
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
        break
    ROOT = os.path.dirname(ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

ROUTER_PATH = os.path.join(ROOT, "hub-server/internal/router/router.go")
CONVENTIONS_PATH = os.path.join(ROOT, "api/conventions.md")

# 镜像 ps1 的 [regex]::Matches（大小写敏感）
ROUTER_METHOD = re.compile(r"\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|CONNECT|TRACE)\s*\(")
CONVENTIONS_METHOD = re.compile(r"\|\s*`([A-Z]+)`\s*\|")


def extract_router_methods() -> set:
    with open(ROUTER_PATH, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    methods = set()
    for line in content.split("\n"):
        line = re.sub(r"//.*$", "", line)
        for match in ROUTER_METHOD.finditer(line):
            methods.add(match.group(1))
    return methods


def extract_conventions_methods() -> set:
    with open(CONVENTIONS_PATH, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    return {match.group(1) for match in CONVENTIONS_METHOD.finditer(content)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Conventions method SSOT gate (router vs conventions.md)")
    parser.parse_args()

    passed = 0
    failed = 0

    def pass_line(text: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail_line(text: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    if not os.path.exists(ROUTER_PATH):
        fail_line("router file missing: hub-server/internal/router/router.go")
        return 1
    if not os.path.exists(CONVENTIONS_PATH):
        fail_line("conventions doc missing: api/conventions.md")
        return 1

    router_methods = extract_router_methods()
    conventions_methods = extract_conventions_methods()

    print()
    print("=== Conventions method SSOT (router vs conventions.md) ===")
    print(f"Router methods:        {', '.join(sorted(router_methods))}")
    print(f"Conventions.md methods: {', '.join(sorted(conventions_methods))}")

    # router 方法必须是 conventions 的子集
    undocumented = sorted(router_methods - conventions_methods)
    if undocumented:
        for method in undocumented:
            fail_line(f"router uses {method} but conventions.md does not document it")
    else:
        pass_line(f"all {len(router_methods)} router method(s) documented in conventions.md")

    # conventions 预文档化但 router 未使用 → NOTICE only
    planned = sorted(conventions_methods - router_methods)
    for method in planned:
        print(f"  NOTICE  conventions.md documents {method} but router does not use it yet (planned?)")

    print()
    print("========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
