#!/usr/bin/env python3
"""verify-shared-rest-contract — Hub 前端 hubClient 模块 REST 契约门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Hub server 声明的 REST 面静态注册于 hub-server/internal/router/router.go；Hub 前端客户端在
app/shared/src（hubClient*.ts，尤其 hubClientPayloadPaths.ts）用纯路径构造器拼调用路径。
每个客户端调用路径必须能解析到 Hub server 实际提供的路由——否则客户端在调不存在的端点
（契约漂移 / 运行时 404）。本门禁捕获这类漂移。

归一化（两侧按路由*形状*比较，不是字面文本）：
  - Router gin 参数 :id / :user_id            -> {param}
  - 客户端路径参数 ${encodeURIComponent(x)} / ${id} -> {param}
  - 客户端查询构造器 ${qs(...)} 被剥掉（追加段，不是路由段）
  - 查询串 (?...) 被剥掉
  - 客户端 RPC 风格 :action（如 :read-all / :cancel / :register）改写为 /action。
    客户端用 requestWithFallback(colon, slash)；Hub server 注册斜杠形式，因此必须成立
    的契约是斜杠形式。真正缺失的路由仍会失败（不存在斜杠形式）。

已知缺陷 allowlist：master 上为空。当前门禁干净（0 漂移）；其价值在于防止未来的
客户端<->服务端契约回归。

范围说明：本门禁覆盖 Hub 前端 hubClient 模块对 Hub server 面；Edge 侧 REST 面
（apiClient.ts，按 RFC A-V3 §4.1 已删除）是独立关注点，刻意不在范围内。

用法：
  python scripts/verify/verify-shared-rest-contract.py
  python scripts/verify/verify-shared-rest-contract.py --client-src-dir app/shared/src --router-path hub-server/internal/router/router.go
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASSED = 0
FAILED = 0

# 已知缺陷 allowlist（合法但今天没有 hub 路由的客户端路径）。master 上为空。
KNOWN_DEFECTS = set()


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def read_text(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def normalize_client_path(raw: str):
    # 只考虑相对 API 路径；忽略整 URL 构造（${baseUrl}...）与日志字符串。
    if not re.match(r"^(/client|/web|/edge|/api|/cloud|/v1)/", raw):
        return None
    path = re.sub(r"\$\{encodeURIComponent\([^)]*\)\}", "{param}", raw)
    path = re.sub(r"\$\{qs.*", "", path)          # 剥掉 ${qs(...)} 查询构造器
    path = re.sub(r"\$\{[^}]*\}", "{param}", path)  # 其余 ${...} -> param
    path = path.split("?")[0]                     # 剥掉 ?query
    path = re.sub(r":([a-zA-Z0-9_-]+)", r"/\1", path)  # RPC :action -> /action
    path = re.sub(r"/{2,}", "/", path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Hub client <-> Hub router REST contract verifier (#1467)")
    parser.add_argument("--client-src-dir", default="app/shared/src/hub", help="client source directory (default: app/shared/src/hub)")
    parser.add_argument("--router-path", default="hub-server/internal/router/router.go", help="router source path (default: hub-server/internal/router/router.go)")
    args = parser.parse_args()

    # ── 声明的 Hub REST 面（router.go）──
    router_path = os.path.join(ROOT, args.router_path.replace("/", os.sep))
    if not os.path.isfile(router_path):
        fail_check(f"router source not found: {args.router_path}")
        return 1
    router_lines = re.split(r"\r?\n", read_text(router_path))

    # 迭代解析 group 前缀（public := r.Group(...)，child := parent.Group(...)）
    prefix = {}
    changed = True
    while changed:
        changed = False
        for line in router_lines:
            if re.match(r"^\s*//", line):
                continue
            group_match = re.search(r'(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"', line)
            if not group_match:
                continue
            var, parent, segment = group_match.group(1), group_match.group(2), group_match.group(3)
            if var in prefix:
                continue
            if parent == "r":
                prefix[var] = segment
                changed = True
            elif parent in prefix:
                prefix[var] = prefix[parent] + segment
                changed = True

    hub_routes = set()
    for line in router_lines:
        if re.match(r"^\s*//", line):
            continue
        for route_match in re.finditer(r'(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"', line):
            var, path = route_match.group(1), route_match.group(3)
            if var == "r":
                base = ""
            elif var in prefix:
                base = prefix[var]
            else:
                continue
            full = re.sub(r":(\w+)", "{param}", base + path)
            hub_routes.add(full)

    # ── 客户端调用路径（Hub 前端 hubClient 模块）──
    client_dir = os.path.join(ROOT, args.client_src_dir.replace("/", os.sep))
    if not os.path.isdir(client_dir):
        fail_check(f"client source dir missing: {args.client_src_dir}")
        return 1
    client_files = sorted(
        name for name in os.listdir(client_dir)
        if name.startswith("hubClient") and name.endswith(".ts") and not name.endswith(".test.ts")
    )
    if not client_files:
        fail_check(
            f"no hubClient*.ts files under {args.client_src_dir}; "
            "the shared client moved to app/shared/src/hub — a 0-path scan must FAIL, not pass"
        )
        return 1

    raw_paths = []
    for file_name in client_files:
        src = read_text(os.path.join(client_dir, file_name))
        # 单引号 + 双引号 + 反引号 return
        raw_paths += re.findall(r"""return\s+['"`]([^'"`]*)['"`]""", src)
        # 数组 return：return [ 'a', 'b' ] 或 [ `a`, `b` ]
        for array_match in re.finditer(r"return\s+\[([^\]]*)\]", src):
            raw_paths += re.findall(r"""['"`]([^'"`]*)['"`]""", array_match.group(1))

    normalized = set()
    for raw in raw_paths:
        norm = normalize_client_path(raw)
        if norm is not None:
            normalized.add(norm)

    print("\n=== Shared REST contract (Hub client <-> Hub router) ===")
    print(f"Hub routes: {len(hub_routes)} | client path(s) scanned: {len(raw_paths)} | normalized unique: {len(normalized)}")

    drift = 0
    for key in sorted(normalized):
        if key in hub_routes:
            continue
        if key in KNOWN_DEFECTS:
            print(f"  KNOWN DEFECT  client path has no hub route: {key} (allowlisted)")
            continue
        sample = next((raw for raw in raw_paths if normalize_client_path(raw) == key), "")
        fail_check(f"client path has no matching hub route: {key} (from '{sample}')")
        drift += 1

    if FAILED == 0:
        if drift == 0:
            pass_check(f"all Hub-client call paths resolve to a registered hub route ({len(normalized)} unique path(s))")
        else:
            pass_check(f"no new client<->hub contract drift ({drift} known-defect note(s) in allowlist)")

    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    return 1 if FAILED != 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
