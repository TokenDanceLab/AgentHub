#!/usr/bin/env python3
"""verify-real-e2e-lane-manifest — B3 真实 E2E lane evidence manifest 合同门禁（#1839 B3）。

守护演示诚实（AGENTS §4）：stub/fixture 不得冒充真实登录；real_tested 不得夸大。
校验对象：scripts/e2e/run-real-e2e-lane.sh 产出的 tests/artifacts/manifest-<stamp>.json。

检查：
  - 顶层与每个 row 都必须含六字段（REQUIRED_SMOKE_FIELDS，与
    verify-real-e2e-contract.py / verify-e2e-smoke-matrix.py 合同一致）：
    evidence_level / real_tested / claim / status / skipped_evidence_levels /
    planned_evidence_levels（顶层）。
  - evidence_level 必须是 verify-real-e2e-contract.py 的 canonical 集合成员
    （SSOT 在那里，本文件通过 importlib 读取，不另持一份矩阵）。
  - 诚实规则：
      * status=passed ⇒ real_tested=true 且至少一个 row passed（登录证据为真）；
      * status=blocked/failed/no-evidence ⇒ real_tested=false（不得谎称跑过）；
      * status=no-evidence（playwright exit 0 但无通过行：全 skipped / report
        缺失或解析失败时的降级状态）⇒ 不得有 passed row；
      * passed row ⇒ real_tested=true（行级一致性）。
  - 无 secret 泄漏：manifest 内不得出现任何非空 secret-like key
    （password/secret/token/credential 值），凭据只允许以路径/方式引用。
  - 无私有信息泄漏：所有字符串值不得含非 loopback URL host、非 loopback IP、
    绝对文件系统路径或内网后缀 hostname（#1873）。

失败语义：任何违反 → 非零退出 + stderr 信息（ps1 $ErrorActionPreference='Stop' 对齐）。

用法：
  python3 scripts/verify/verify-real-e2e-lane-manifest.py <manifest.json>
"""

import argparse
import importlib.util
import json
import os
import re
import sys

REQUIRED_SMOKE_FIELDS = [
    "evidence_level",
    "real_tested",
    "claim",
    "status",
    "skipped_evidence_levels",
    "planned_evidence_levels",
]
REQUIRED_ROW_FIELDS = [
    "name",
    "evidence_level",
    "real_tested",
    "claim",
    "status",
    "evidence",
]

# #1873 Slice C: 公开 artifact 必须携带可追溯的 provenance（哪个 commit、哪个
# scope），但不能复制私有运行事实（非 loopback endpoint/账号/绝对路径等，
# 由 assert_no_private_names 扫描）。
REQUIRED_PROVENANCE_FIELDS = ["commit", "scope"]

SECRET_KEY_RE = re.compile(r"(password|passwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|private_key|license|api[_-]?key)", re.IGNORECASE)


class ContractError(Exception):
    pass


def fail(message):
    raise ContractError(f"real-e2e lane manifest contract check failed: {message}")


def load_canonical_levels(repo_root):
    """从 verify-real-e2e-contract.py 读取 canonical 证据等级（SSOT，不复制矩阵）。"""
    path = os.path.join(repo_root, "scripts", "verify", "verify-real-e2e-contract.py")
    if not os.path.exists(path):
        fail(f"missing canonical evidence-level SSOT: {path}")
    spec = importlib.util.spec_from_file_location("verify_real_e2e_contract", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {machine for _, machine in module.CANONICAL_LEVELS}


def assert_no_secret_values(manifest, context="manifest"):
    """递归扫描 secret-like key；非空值（尤其含真实 secret/凭据形态）即违规。

    允许的例外：值为非敏感证明（如 'tests/artifacts/real-e2e-account.env'）的
    credentials_path 之类的引用，以及布尔/枚举标记（manifests 常带
    "secrets_handled": false、key="_token" 之类的 boolean）。因此规则：
    secret-like key 且值为非空 str 时，值不得匹配凭据形态或与 key 同形。
    """
    CREDENTIAL_RE = re.compile(
        r"(?:[A-Za-z0-9+/]{16,}\.?){2,6}|cs_[A-Za-z0-9_-]{8,}|c_[A-Za-z0-9_-]{8,}|@test\.local|Passw0rd!",
        re.IGNORECASE,
    )

    def walk(node, path_):
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, (dict, list)):
                    walk(value, f"{path_}.{key}")
                elif SECRET_KEY_RE.search(key) and isinstance(value, str) and value.strip():
                    if CREDENTIAL_RE.search(value):
                        fail(f"manifest contains secret-like value at {path_}.{key}: "
                             f"value matches credential shape (redact it; only reference paths/way)")
        elif isinstance(node, list):
            for idx, value in enumerate(node):
                walk(value, f"{path_}[{idx}]")

    walk(manifest, context)


LOOPBACK_IPV4_RE = re.compile(r"^127(?:\.\d{1,3}){3}$")
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}

URL_RE = re.compile(r"https?://([^\s/?#]+)", re.IGNORECASE)
IPV4_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
WINDOWS_ABS_PATH_RE = re.compile(r"\b[A-Za-z]:[\\/][^\s\"']*")
UNIX_ABS_PATH_RE = re.compile(r"(?<![\w./\\])/(?![\s/])[\w.-]+(?:/[\w.-]+)+")
INTERNAL_SUFFIX_HOST_RE = re.compile(
    r"\b[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.(?:internal|local|corp|lan)\b",
    re.IGNORECASE,
)


def _url_hosts(value):
    """提取字符串内所有 http(s):// URL 的 host（去端口/去 IPv6 方括号）。"""
    hosts = []
    for match in URL_RE.finditer(value):
        authority = match.group(1)
        host = authority
        if host.startswith("["):
            end = host.find("]")
            host = host[1:end] if end != -1 else host
        else:
            host = host.split(":", 1)[0]
        hosts.append(host)
    return hosts


def _is_loopback_host(host):
    """host 是否 loopback/localhost（公开 artifact 唯一允许的端点形态）。"""
    lowered = host.lower()
    return lowered in LOOPBACK_HOSTS or LOOPBACK_IPV4_RE.match(lowered)


def _is_valid_ipv4(ip):
    parts = ip.split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def private_info_violation(value, path_, label="manifest"):
    """对单个字符串做私有信息 fail-closed 扫描，返回违规信息或 None。

    与 assert_no_private_names 共用同一份正则 SSOT（URL_RE/IPV4_RE/
    WINDOWS_ABS_PATH_RE/UNIX_ABS_PATH_RE/INTERNAL_SUFFIX_HOST_RE）。
    供 verify-real-e2e-artifacts.py 对 raw artifact（report JSON / HTML /
    trace.network）做同口径内容扫描，避免两套阈值漂移（AGENTS §5.5）。
    """
    if not value.strip():
        return None
    for host in _url_hosts(value):
        if not _is_loopback_host(host):
            return (f"{label} leaks non-loopback URL host '{host}' at {path_}: "
                    f"public artifacts only allow loopback/localhost endpoints")
    for match in IPV4_RE.finditer(value):
        ip = match.group(0)
        if _is_valid_ipv4(ip) and not LOOPBACK_IPV4_RE.match(ip):
            return f"{label} leaks non-loopback IPv4 '{ip}' at {path_}"
    if WINDOWS_ABS_PATH_RE.search(value):
        return f"{label} leaks absolute Windows path at {path_}: redact filesystem paths"
    if UNIX_ABS_PATH_RE.search(value):
        return f"{label} leaks absolute Unix path at {path_}: redact filesystem paths"
    if INTERNAL_SUFFIX_HOST_RE.search(value):
        return f"{label} leaks internal-suffix hostname at {path_}: only public hostnames allowed"
    return None


def assert_no_private_names(manifest, context="manifest"):
    """递归扫描所有字符串值，拦截私有信息泄漏（#1873 第一切片）。

    公开 Actions artifact 只应携带 sanitized manifest；以下形态 fail-closed：
      * http(s):// URL host 非 loopback/localhost（含单标签内网 host、内网 IP、IPv6）
      * 非 loopback IPv4（127.0.0.0/8 之外）
      * 绝对文件系统路径（Windows 盘符或 Unix 前导 /）
      * 内网后缀 hostname（*.internal / *.local / *.corp / *.lan）

    允许（不误报）：loopback/localhost URL、相对路径（tests/artifacts/...、
    app/web）、镜像引用 postgres:16 / redis:7、报告 basename、枚举值。
    单标签内网 host 仅在 URL host 位置判定（唯一无歧义位置）；裸单标签
    token（web/up/none/passed 等）不视作 hostname，避免把枚举误报为泄漏。
    """

    def walk(node, path_):
        if isinstance(node, dict):
            for key, value in node.items():
                walk(value, f"{path_}.{key}")
        elif isinstance(node, list):
            for idx, value in enumerate(node):
                walk(value, f"{path_}[{idx}]")
        elif isinstance(node, str):
            _check_string(node, path_)

    def _check_string(value, path_):
        violation = private_info_violation(value, path_, label="manifest")
        if violation:
            fail(violation)

    walk(manifest, context)


def main():
    parser = argparse.ArgumentParser(description="Verify a real-e2e lane evidence manifest against the six-field contract.")
    parser.add_argument("manifest", help="path to tests/artifacts/manifest-<stamp>.json")
    parser.add_argument("--repo-root", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
                        help="repository root (default: derived from this script)")
    args = parser.parse_args()

    if not os.path.exists(args.manifest):
        fail(f"missing manifest: {args.manifest}")
    with open(args.manifest, encoding="utf-8") as handle:
        manifest = json.load(handle)

    allowed_levels = load_canonical_levels(args.repo_root)

    for field in REQUIRED_SMOKE_FIELDS:
        if field not in manifest:
            fail(f"manifest missing required field '{field}'")
    for field in REQUIRED_PROVENANCE_FIELDS:
        if field not in manifest or not isinstance(manifest[field], str) or not manifest[field].strip():
            fail(f"manifest missing/empty required provenance field '{field}'")
    if not isinstance(manifest["real_tested"], bool):
        fail("manifest field 'real_tested' must be a boolean")
    for field in ("evidence_level", "claim", "status"):
        if not isinstance(manifest[field], str) or not manifest[field].strip():
            fail(f"manifest field '{field}' must be a non-empty string")
    for field in ("skipped_evidence_levels", "planned_evidence_levels"):
        if not isinstance(manifest[field], list) or not manifest[field]:
            fail(f"manifest field '{field}' must be a non-empty list")
    if manifest["evidence_level"] not in allowed_levels:
        fail(f"manifest evidence_level '{manifest['evidence_level']}' not in canonical set {sorted(allowed_levels)}")
    for level in manifest["skipped_evidence_levels"]:
        if level not in allowed_levels:
            fail(f"manifest skipped_evidence_levels declares non-canonical level '{level}'")
    for level in manifest["planned_evidence_levels"]:
        if level not in allowed_levels:
            fail(f"manifest planned_evidence_levels declares non-canonical level '{level}'")

    rows = manifest.get("rows", [])
    if not isinstance(rows, list) or not rows:
        fail("manifest rows must be a non-empty array")

    status = manifest["status"]
    if status not in ("passed", "blocked", "failed", "no-evidence"):
        fail(f"manifest status '{status}' not in (passed|blocked|failed|no-evidence)")

    for row in rows:
        for field in REQUIRED_ROW_FIELDS:
            if field not in row:
                fail(f"row '{row.get('name', '?')}' missing required field '{field}'")
        if row["evidence_level"] not in allowed_levels:
            fail(f"row '{row['name']}' evidence_level '{row['evidence_level']}' not in canonical set")
        if row["status"] == "passed" and row["real_tested"] is not True:
            fail(f"row '{row['name']}' claims passed but real_tested is not true")
        if row["status"] != "passed" and row["real_tested"] is True:
            fail(f"row '{row['name']}' real_tested=true but status is '{row['status']}'")

    if status == "passed":
        if manifest["real_tested"] is not True:
            fail("status=passed but real_tested is not true")
        if not any(row["status"] == "passed" and row["real_tested"] for row in rows):
            fail("status=passed but no row actually passed with real login evidence")
    if status in ("blocked", "failed", "no-evidence") and manifest["real_tested"] is True:
        fail(f"status={status} but real_tested is true (honesty violation)")
    if status == "no-evidence" and any(row["status"] == "passed" for row in rows):
        fail("status=no-evidence but a row claims passed (status should be passed)")

    assert_no_secret_values(manifest)
    assert_no_private_names(manifest)

    print("real-e2e lane manifest contract ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 throw 语义
        print(str(exc), file=sys.stderr)
        sys.exit(1)
