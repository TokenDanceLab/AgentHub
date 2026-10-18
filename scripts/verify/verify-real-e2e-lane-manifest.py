#!/usr/bin/env python3
"""verify-real-e2e-lane-manifest — 真实 E2E lane evidence manifest 合同门禁。

守护演示诚实（AGENTS 的「生态与真实性边界」）：stub/fixture 不得冒充真实登录；real_tested 不得夸大。
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
        例外：整次运行只含 backend-api 行（chat-real 使用本地 Hub 签发的
        会话 JWT）时，real_tested=false，所有 row 的 evidence_level 均为
        backend-api 且 status=passed；
      * status=blocked/failed/no-evidence ⇒ real_tested=false（不得谎称跑过）；
      * status=no-evidence（playwright exit 0 但无通过行：全 skipped / report
        缺失或解析失败时的降级状态）⇒ 不得所有 row 都 passed；
      * observed-local / approved-real 的 passed row ⇒ real_tested=true（行级一致性）；
      * scope 声称跑完 all testMatch 且 status=passed ⇒ spec_files 必须覆盖
        playwright.real.config.ts 的全部 testMatch spec。
  - 无 secret 泄漏：manifest 内不得出现任何非空 secret-like key
    （password/secret/token/credential 值），凭据只允许以路径/方式引用。
  - 无私有信息泄漏：所有字符串值不得含非 loopback URL host、非 loopback IP、
    绝对文件系统路径或内网后缀 hostname。

失败语义：任何违反 → 非零退出 + stderr 信息。

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

# 公开 artifact 必须携带可追溯的 provenance（哪个 commit、哪个 scope），
# 但不能复制敏感运行数据（非 loopback endpoint/账号/绝对路径等，
# 由 assert_no_private_names 扫描）。
REQUIRED_PROVENANCE_FIELDS = ["commit", "scope"]
FULL_SCOPE = "app/e2e (playwright.real.config.ts all testMatch)"

# Only observed real runs count as login evidence; fixture/stub levels never do.
REAL_EVIDENCE_LEVELS = ("observed-local", "approved-real")

SECRET_KEY_RE = re.compile(r"(password|passwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|cookie|session[_-]?key|jwt|private_key|license|api[_-]?key)", re.IGNORECASE)


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
    return set(module.EVIDENCE_LEVELS)


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
UNC_PATH_RE = re.compile(r"\\\\[A-Za-z0-9._$-]+\\[^\s\"']+")
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
    trace.network）做同口径内容扫描，避免两套阈值漂移（AGENTS 的「验证与证据」）。
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
    if UNC_PATH_RE.search(value):
        return f"{label} leaks UNC path at {path_}: redact filesystem paths"
    if WINDOWS_ABS_PATH_RE.search(value):
        return f"{label} leaks absolute Windows path at {path_}: redact filesystem paths"
    if UNIX_ABS_PATH_RE.search(value):
        return f"{label} leaks absolute Unix path at {path_}: redact filesystem paths"
    if INTERNAL_SUFFIX_HOST_RE.search(value):
        return f"{label} leaks internal-suffix hostname at {path_}: only public hostnames allowed"
    return None


CREDENTIAL_SHAPES = [
    ("JWT", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("Bearer token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{10,}", re.IGNORECASE)),
    ("runtime credential", re.compile(r"\b(?:cs_[A-Fa-f0-9]{16,}|c_[A-Fa-f0-9]{12,})\b")),
    ("password value", re.compile(r"(?i)password\s*[:=]\s*[A-Za-z0-9._~+/=-]{6,}")),
]


def assert_no_credential_shapes(manifest, context="manifest"):
    """Scan every string value for credential shapes, not just secret-like keys.

    A manifest is schema'd JSON, but a leak can hide under an innocent key
    (for example note/evidence); key-only matching misses it.
    """
    def walk(node, path_):
        if isinstance(node, dict):
            for key, value in node.items():
                walk(value, f"{path_}.{key}")
        elif isinstance(node, list):
            for idx, value in enumerate(node):
                walk(value, f"{path_}[{idx}]")
        elif isinstance(node, str):
            for label, pattern in CREDENTIAL_SHAPES:
                if pattern.search(node):
                    fail(f"{context} contains a {label} at {path_}: redact credentials")

    walk(manifest, context)


def expected_testmatch(repo_root):
    """Read the real Playwright config's testMatch spec list."""
    config = os.path.join(repo_root, "app", "web", "playwright.real.config.ts")
    with open(config, encoding="utf-8") as handle:
        text = handle.read()
    match = re.search(r"testMatch:\s*\[(.*?)\]", text, re.DOTALL)
    if not match:
        fail(f"cannot read testMatch from {config}")
    return sorted(re.findall(r"['\"]([^'\"]+\.spec\.ts)['\"]", match.group(1)))


def assert_scope_claim(manifest):
    """A partial run must not claim that every testMatch spec passed."""
    scope = str(manifest.get("scope", ""))
    if scope == FULL_SCOPE:
        return
    claim = str(manifest.get("claim", ""))
    if "全部 spec" in claim or "all testMatch" in claim:
        fail(f"manifest scope '{scope}' does not cover all specs but the claim says every spec passed")


def assert_no_private_names(manifest, context="manifest"):
    """递归扫描所有字符串值，拦截私有信息泄漏。

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
        if row["status"] == "passed" and row["real_tested"] is not True and row["evidence_level"] in REAL_EVIDENCE_LEVELS:
            fail(f"row '{row['name']}' claims passed at {row['evidence_level']} but real_tested is not true")
        if row["status"] != "passed" and row["real_tested"] is True:
            fail(f"row '{row['name']}' real_tested=true but status is '{row['status']}'")
        if row["real_tested"] is True and row["evidence_level"] not in REAL_EVIDENCE_LEVELS:
            fail(f"row '{row['name']}' claims real_tested at non-real level '{row['evidence_level']}'")

    if status == "passed":
        api_only = (
            manifest["evidence_level"] == "backend-api"
            and bool(rows)
            and all(
                row["status"] == "passed"
                and row["evidence_level"] == "backend-api"
                and row["real_tested"] is False
                for row in rows
            )
        )
        if api_only:
            pass
        else:
            if manifest["real_tested"] is not True:
                fail("status=passed but real_tested is not true")
            backed = any(
                row["status"] == "passed"
                and row["real_tested"] is True
                and row["evidence_level"] == manifest["evidence_level"]
                for row in rows
            )
            if not backed:
                fail(
                    "manifest evidence_level '"
                    + str(manifest["evidence_level"])
                    + "' is not backed by a passed row at the same level"
                )
    if status in ("blocked", "failed", "no-evidence") and manifest["real_tested"] is True:
        fail(f"status={status} but real_tested is true (honesty violation)")
    if status == "no-evidence":
        if manifest["real_tested"] is True:
            fail("status=no-evidence but real_tested is true")
        if all(row["status"] == "passed" for row in rows):
            fail("status=no-evidence but every row passed (status should be passed)")

    spec_files = manifest.get("spec_files")
    if spec_files is not None:
        if not isinstance(spec_files, list) or not spec_files or not all(
            isinstance(item, str) and item for item in spec_files
        ):
            fail("manifest field 'spec_files' must be a non-empty list of strings")
    if status == "passed" and manifest["scope"] == FULL_SCOPE:
        expected = expected_testmatch(args.repo_root)
        if not spec_files:
            fail("status=passed over all testMatch must record the spec_files that produced the report")
        missing = sorted(set(expected) - set(spec_files))
        unexpected = sorted(set(spec_files) - set(expected))
        if missing or unexpected:
            fail(
                "status=passed over all testMatch but the report covered "
                f"missing={missing} unexpected={unexpected}"
            )

    assert_no_secret_values(manifest)
    assert_no_credential_shapes(manifest)
    assert_scope_claim(manifest)
    assert_no_private_names(manifest)

    print("real-e2e lane manifest contract ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— fail closed：未捕获异常返回非零
        print(str(exc), file=sys.stderr)
        sys.exit(1)
