#!/usr/bin/env python3
"""verify-outbound-client-hygiene — 出站 HTTP / runtime-config 卫生门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

service/verifier/callback 层不得读进程 env 或构造裸 http.Client：config 属于
bootstrap/composition root，transport 策略属于少数专用 client（egress dialer、
dispatch client、OIDC/JWKS clients、Edge callback client）。allowlist 只缩且
条目必须带 issue（#1549/#1564）。

检查项：
1. os.Getenv —— 零容忍；
2. 裸 &http.Client{ —— 仅 allowlist（条目必须带 issue + reason）；
3. io.ReadAll( 同行无 io.LimitReader( —— 外部响应必须 body-limited；
4. http.Get/Post/Head 包级 helper —— 隐式 client 禁止；
5. 有 HTTP 但无 retry budget 的文件里的 for attempt := 0 循环 —— 无预算重试 FAIL；
6. allowlist 卫生：匿名条目（无 #issue）与 stale 条目（allowlisted 文件已无违规）FAIL。

CLI 参数与 ps1 兼容：--scopes、--client-allowlist（可重复/多值）、
--no-default-allowlist（自测 fixture 用）。
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 检查模式（ps1 全用 -match，大小写不敏感）
GETENV = re.compile(r"os\.Getenv\(", re.IGNORECASE)
BARE_CLIENT = re.compile(r"&http\.Client\{", re.IGNORECASE)
READ_ALL = re.compile(r"io\.ReadAll\(", re.IGNORECASE)
LIMIT_READER = re.compile(r"io\.LimitReader\(", re.IGNORECASE)
PACKAGE_HELPER = re.compile(r"http\.(Get|Post|Head)\(", re.IGNORECASE)
PERFORMS_HTTP = re.compile(r"http\.(Client|NewRequest|Get|Post|Head)|\.Do\(req", re.IGNORECASE)
HAS_BUDGET = re.compile(r"udget", re.IGNORECASE)
RETRY_LOOP = re.compile(r"for\s+attempt\s*:=\s*0;", re.IGNORECASE)
ISSUE_PATTERN = re.compile(r"^#\d+$", re.IGNORECASE)
TEST_FILE = re.compile(r"_test\.go$", re.IGNORECASE)


def relative(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def walk_sorted(root: str):
    """深度优先 + 每层按名称排序的遍历，镜像 Get-ChildItem -Recurse。"""
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full):
            yield full
        elif os.path.isdir(full):
            yield from walk_sorted(full)


def parse_allowlist(entries) -> tuple:
    """解析 path|#issue|reason 条目；返回 (allowlist dict, 错误列表)。"""
    allowlist = {}
    allowlist_errors = []
    for entry in entries:
        parts = entry.split("|")
        if len(parts) != 3 or not parts[0].strip():
            allowlist_errors.append(f"malformed allowlist entry: '{entry}' (expected path|#issue|reason)")
            continue
        path = parts[0].strip()
        issue = parts[1].strip()
        reason = parts[2].strip()
        if not ISSUE_PATTERN.search(issue):
            allowlist_errors.append(
                f"anonymous allowlist entry (no issue) for '{path}': '{issue}' — every entry must carry a tracking issue"
            )
            continue
        if not reason:
            allowlist_errors.append(f"allowlist entry for '{path}' has no reason")
            continue
        allowlist[path] = (issue, reason)
    return allowlist, allowlist_errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Outbound HTTP / runtime-config hygiene verifier (#1549 + #1564 phase 2)"
    )
    parser.add_argument(
        "--scopes",
        default="hub-server/internal/service,hub-server/internal/jwtutil,edge-server/internal/hub",
        help="comma-separated scope roots relative to the repo root",
    )
    parser.add_argument(
        "--client-allowlist",
        action="append",
        nargs="+",
        metavar="ENTRY",
        help="replacement allowlist entries (path|#issue|reason); may be repeated",
    )
    parser.add_argument(
        "--no-default-allowlist",
        action="store_true",
        help="skip the default residual allowlist entirely (isolated fixture runs)",
    )
    args = parser.parse_args()

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

    # 默认 allowlist（#1594 起为空：dispatch client 已在 composition root 构建）
    client_allowlist = args.client_allowlist
    if client_allowlist is None and not args.no_default_allowlist:
        client_allowlist = [[]]

    allowlist_entries = [entry for group in (client_allowlist or []) for entry in group]
    allowlist, allowlist_errors = parse_allowlist(allowlist_entries)

    # 收集各 scope 的生产 Go 文件（排除 *_test.go）
    scope_dirs = [scope.strip() for scope in args.scopes.split(",") if scope.strip() != ""]
    go_files = []
    for scope in scope_dirs:
        scope_full = os.path.join(ROOT, scope)
        if not os.path.isdir(scope_full):
            fail_line(f"scope dir missing: {scope}")
            continue
        for file_path in walk_sorted(scope_full):
            name = os.path.basename(file_path)
            if name.endswith(".go") and not TEST_FILE.search(name):
                go_files.append(relative(file_path))

    # 每文件违规收集（file → 违规集合，供 stale-allowlist 检测）
    violations = {}
    hits = []

    for rel in go_files:
        with open(os.path.join(ROOT, rel.replace("/", os.sep)), encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
        content = "\n".join(lines)

        # 1. os.Getenv — 零容忍
        for index, line in enumerate(lines):
            if GETENV.search(line):
                hits.append(f"os.Getenv found: {rel}:{index + 1}: {line.strip()}")
                violations.setdefault(rel, set()).add("os.Getenv")

        # 2. 裸 &http.Client{ — 仅 allowlist
        for index, line in enumerate(lines):
            if BARE_CLIENT.search(line):
                violations.setdefault(rel, set()).add("bare &http.Client{")
                if rel not in allowlist:
                    hits.append(f"bare &http.Client{{ found: {rel}:{index + 1}: {line.strip()}")

        # 3. io.ReadAll( 同行无 io.LimitReader( — body cap
        for index, line in enumerate(lines):
            if READ_ALL.search(line) and not LIMIT_READER.search(line):
                violations.setdefault(rel, set()).add("io.ReadAll without io.LimitReader")
                if rel not in allowlist:
                    hits.append(f"unbounded response read (no io.LimitReader): {rel}:{index + 1}: {line.strip()}")

        # 4. http.Get/Post/Head 包级 helper — 隐式 client
        for index, line in enumerate(lines):
            if PACKAGE_HELPER.search(line):
                violations.setdefault(rel, set()).add("http.Get/Post/Head")
                if rel not in allowlist:
                    hits.append(f"implicit package-level client: {rel}:{index + 1}: {line.strip()}")

        # 5. 无预算重试循环（仅 HTTP-carrying 且无 budget 引用的文件）
        if PERFORMS_HTTP.search(content) and not HAS_BUDGET.search(content):
            for index, line in enumerate(lines):
                if RETRY_LOOP.search(line):
                    violations.setdefault(rel, set()).add("unbudgeted retry loop")
                    if rel not in allowlist:
                        hits.append(f"retry loop without a retry budget: {rel}:{index + 1}: {line.strip()}")

    # 输出发现
    if not hits:
        pass_line("no outbound client / config hygiene violations in scan scope")
    else:
        for hit in hits:
            fail_line(hit)
        print(
            "  #1549/#1564: config must be injected at the composition root; clients must come "
            "from purpose-built ports/packages. Add to the allowlist only as a tracked exception "
            "with an issue."
        )

    # allowlist 卫生
    for error in allowlist_errors:
        fail_line(error)

    for entry_path in allowlist:
        abs_path = os.path.join(ROOT, entry_path.replace("/", os.sep))
        if not os.path.exists(abs_path):
            fail_line(f"stale allowlist entry — file no longer exists: {entry_path}")
            continue
        if not violations.get(entry_path):
            fail_line(f"stale allowlist entry — '{entry_path}' has no violations; the allowlist may only shrink (remove it)")

    # 汇总
    print()
    if failed > 0:
        print(f"Outbound client hygiene: {failed} FAIL, {passed} pass")
        return 1
    print(f"Outbound client hygiene: {passed} pass")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
