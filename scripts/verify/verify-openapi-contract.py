#!/usr/bin/env python3
"""verify-openapi-contract — OpenAPI ↔ Hub router 路由合同门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

解析 api/openapi.yaml（Hub-owned, x-agenthub-status: implemented 路径）并与
hub-server/internal/router/router.go 静态注册路由对比；(method, path) 任一方向
漂移即 FAIL（exit 1）。参数名差异归一为 {param}，只比较路由形状。

YAML 解析沿用 ps1 方案：subprocess 调用 python + PyYAML（本脚本 stdlib only，
禁止第三方 import；PyYAML 缺失时按 ps1 同款逻辑 pip install 兜底）。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
        break
    ROOT = os.path.dirname(ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

# ps1 内嵌的 YAML 提取 helper（原样保留：PyYAML 解析 + Hub/implemented 过滤）
OPENAPI_EXTRACT_HELPER = r'''
import json, pathlib, sys
import yaml
spec = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
out = []
paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
for path, node in paths.items():
    if not isinstance(node, dict):
        continue
    for method, op in node.items():
        if method not in ("get", "post", "put", "delete", "patch", "head", "options"):
            continue
        if not isinstance(op, dict):
            continue
        owner = op.get("x-agenthub-owner") or node.get("x-agenthub-owner")
        status = op.get("x-agenthub-status") or node.get("x-agenthub-status")
        if owner == "Hub" and status == "implemented":
            out.append(method.upper() + " " + path)
print(json.dumps(sorted(out)))
'''

OPENAPI_SCHEMA_HELPER = r"""
import json, pathlib, sys
import yaml
spec = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
out = []
paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
for path, node in paths.items():
    if not isinstance(node, dict):
        continue
    for method, op in node.items():
        if method not in ("get", "post", "put", "delete", "patch", "head", "options"):
            continue
        if not isinstance(op, dict):
            continue
        owner = op.get("x-agenthub-owner") or node.get("x-agenthub-owner")
        status = op.get("x-agenthub-status") or node.get("x-agenthub-status")
        if owner != "Hub" or status != "implemented":
            continue
        for code in ("200", "201", "202"):
            response = (op.get("responses") or {}).get(code)
            if isinstance(response, dict) and "content" not in response and "$ref" not in response:
                out.append(method.upper() + " " + path + " " + code)
print(json.dumps(sorted(out)))
"""

# Admin/debug/health 子路由 allowlist（与 ps1 一致；真实 API 路由必须进 OpenAPI）
ALLOWLIST = ["GET /debug/panic", "GET /health/live", "GET /health/ready"]

# Baseline of known description-only 2xx responses among Hub-implemented ops.
# The gate is fail-closed for NEW violations; fixed entries must be pruned here.
OPENAPI_SCHEMA_BASELINE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "openapi-schema-baseline.json"
)

GROUP_PATTERN = re.compile(r"(\w+)\s*:=\s*(\w+)\.Group\(\"([^\"]*)\"", re.IGNORECASE)
ROUTE_PATTERN = re.compile(r'(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"')
NORMALIZE_PARAM = re.compile(r":(\w+)", re.IGNORECASE)
NORMALIZE_PLACEHOLDER = re.compile(r"\{[^}]+\}", re.IGNORECASE)


def fail(message: str) -> None:
    raise RuntimeError(message)


def run_python(exe: str, args: list) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run([exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return None


def ensure_pyyaml() -> None:
    """镜像 ps1：import yaml 探测失败时 pip install 兜底（python → python3）。"""
    for exe in ("python", "python3"):
        check = run_python(exe, ["-c", "import yaml; print('ok')"])
        if check is not None and check.returncode == 0 and "ok" in check.stdout:
            return
    for exe in ("python", "python3"):
        install = run_python(exe, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "PyYAML"])
        if install is None or install.returncode != 0:
            continue
        check = run_python(exe, ["-c", "import yaml; print('ok')"])
        if check is not None and check.returncode == 0 and "ok" in check.stdout:
            return


def extract_openapi_routes(openapi_path: str) -> list:
    """经 subprocess 跑 PyYAML helper，返回排序后的 'METHOD /path' 列表。"""
    ensure_pyyaml()
    fd, tmp_path = tempfile.mkstemp(prefix="agenthub-openapi-extract-", suffix=".py")
    os.close(fd)
    try:
        with open(tmp_path, "w", encoding="utf-8") as handle:
            handle.write(OPENAPI_EXTRACT_HELPER)
        last_exit = None
        for exe in ("python", "python3"):
            result = run_python(exe, [tmp_path, openapi_path])
            if result is None:
                continue
            last_exit = result.returncode
            if result.returncode == 0:
                return json.loads(result.stdout)
        fail(
            f"python OpenAPI extraction failed (exit {last_exit}). "
            "Ensure PyYAML is installed: python -m pip install PyYAML"
        )
    finally:
        os.unlink(tmp_path)



def extract_openapi_schema_violations(openapi_path: str) -> list:
    """经 subprocess 跑 PyYAML helper，返回 Hub-implemented 2xx 缺 schema 清单。

    description-only 的 200/201/202（既无 content 也无 $ref）是契约空洞：
    客户端无法知道成功响应形状。204 天然无 body，不在此列。
    """
    ensure_pyyaml()
    fd, tmp_path = tempfile.mkstemp(prefix="agenthub-openapi-schema-", suffix=".py")
    os.close(fd)
    try:
        with open(tmp_path, "w", encoding="utf-8") as handle:
            handle.write(OPENAPI_SCHEMA_HELPER)
        last_exit = None
        for exe in ("python", "python3"):
            result = run_python(exe, [tmp_path, openapi_path])
            if result is None:
                continue
            last_exit = result.returncode
            if result.returncode == 0:
                return json.loads(result.stdout)
        fail(
            f"python OpenAPI schema extraction failed (exit {last_exit}). "
            "Ensure PyYAML is installed: python -m pip install PyYAML"
        )
    finally:
        os.unlink(tmp_path)


def extract_router_routes(router_path: str) -> set:
    """router.go 静态正则提取，镜像 ps1 语义：
    组声明用 -match（大小写不敏感、取首个匹配），路由注册用 [regex]::Matches
    （大小写敏感、取全部匹配）。"""
    with open(router_path, encoding="utf-8", errors="replace") as handle:
        src = handle.read()
    lines = re.split(r"\r?\n", src)

    prefix = {}
    changed = True
    while changed:
        changed = False
        for ln in lines:
            if re.match(r"^\s*//", ln, re.IGNORECASE):
                continue
            match = GROUP_PATTERN.search(ln)
            if not match:
                continue
            var, parent, seg = match.group(1), match.group(2), match.group(3)
            if var in prefix:
                continue
            if parent == "r":
                prefix[var] = seg
                changed = True
            elif parent in prefix:
                prefix[var] = prefix[parent] + seg
                changed = True

    router_routes = set()
    for ln in lines:
        if re.match(r"^\s*//", ln, re.IGNORECASE):
            continue
        for match in ROUTE_PATTERN.finditer(ln):
            var, method, path = match.group(1), match.group(2), match.group(3)
            if var == "r":
                base = ""
            elif var in prefix:
                base = prefix[var]
            else:
                continue
            full = NORMALIZE_PARAM.sub(r"{\1}", base + path)
            router_routes.add(f"{method} {full}")
    return router_routes


def normalize_route(route: str) -> str:
    method, path = route.split(" ", 1)
    path = NORMALIZE_PLACEHOLDER.sub("{param}", path)
    return f"{method} {path}"


def powershell_sort_key(value: str) -> tuple:
    """对齐 ps1 Sort-Object（当前文化、忽略大小写）的排序：标点（如 { ）权重低于字母，
    Python 默认 ordinal 排序会把 { 排到字母之后，导致漂移清单顺序不一致。"""
    return tuple((0 if not ch.isalnum() else 1, ch.lower()) for ch in value)


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenAPI <-> hub router route contract gate")
    parser.add_argument("--openapi-path", default="api/openapi.yaml", help="OpenAPI spec path")
    parser.add_argument("--router-path", default="hub-server/internal/router/router.go", help="hub router source path")
    args = parser.parse_args()

    openapi_path = args.openapi_path
    router_path = args.router_path

    if not os.path.exists(openapi_path):
        fail(f"OpenAPI spec not found: {openapi_path}")
    if not os.path.exists(router_path):
        fail(f"router source not found: {router_path}")

    router_routes = extract_router_routes(router_path)
    openapi_routes = extract_openapi_routes(openapi_path)

    router_n = {normalize_route(r) for r in router_routes}
    openapi_n = {normalize_route(r) for r in openapi_routes}
    allow_n = {normalize_route(a) for a in ALLOWLIST}

    only_openapi = sorted(openapi_n - router_n, key=powershell_sort_key)
    only_router = sorted((r for r in router_n if r not in openapi_n and r not in allow_n), key=powershell_sort_key)

    failures = []
    if only_openapi:
        failures.append(f"OpenAPI documents Hub-implemented routes NOT registered in hub router ({len(only_openapi)}):")
        failures.extend(f"  + {route}" for route in only_openapi)
    if only_router:
        failures.append(f"Hub router registers routes NOT documented in OpenAPI ({len(only_router)}):")
        failures.extend(f"  - {route}" for route in only_router)

    if failures:
        print("OpenAPI <-> hub router contract drift detected:")
        print(f"  OpenAPI Hub-implemented routes: {len(openapi_n)}")
        print(f"  Router routes: {len(router_n)}")
        print(f"  Allowlisted (admin/debug only): {len(allow_n)}")
        print()
        for line in failures:
            print(line)
        print()
        print(
            "Fix: document new router routes in api/openapi.yaml (x-agenthub-owner: Hub, "
            "x-agenthub-status: implemented), or remove stale OpenAPI paths. Admin/debug-only "
            "routes go in the allowlist in scripts/verify/verify-openapi-contract.py."
        )
        return 1

    schema_violations = extract_openapi_schema_violations(openapi_path)
    baseline: list = []
    if os.path.exists(OPENAPI_SCHEMA_BASELINE):
        with open(OPENAPI_SCHEMA_BASELINE, encoding="utf-8") as handle:
            baseline = json.load(handle)
    baseline_set = set(baseline)
    new_violations = [v for v in schema_violations if v not in baseline_set]
    stale_baseline = [b for b in baseline if b not in schema_violations]

    if new_violations:
        print("OpenAPI 2xx schema coverage drift detected (fail-closed):")
        print(f"  Hub-implemented 2xx responses without content schema: {len(schema_violations)}")
        print(f"  NEW violations not in baseline: {len(new_violations)}")
        print()
        for v in new_violations:
            print(f"  + {v}")
        print()
        print(
            "Fix: give each Hub-implemented 200/201/202 response either a content schema "
            "or a $ref to components/responses. Deliberate exceptions go in "
            "scripts/verify/openapi-schema-baseline.json."
        )
        return 1
    if stale_baseline:
        print(f"note: {len(stale_baseline)} baseline entries are now covered (prune them from openapi-schema-baseline.json)")
        for v in stale_baseline:
            print(f"  ~ {v}")

    print("openapi<->hub router contract ok")
    print(f"  OpenAPI Hub-implemented routes: {len(openapi_n)}")
    print(f"  Router routes: {len(router_n)}")
    print(f"  Allowlisted (admin/debug only): {len(allow_n)}")
    print(f"  2xx schema coverage violations: {len(schema_violations)} (new: 0)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
