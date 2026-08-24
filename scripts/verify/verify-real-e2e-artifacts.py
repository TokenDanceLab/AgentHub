#!/usr/bin/env python3
"""verify-real-e2e-artifacts — raw L3 artifact 脱敏 fail-closed 门禁（#1873 Slice D）。

Public Actions 不得上传含私有运行事实的原始 artifact（Playwright JSON report /
HTML report / trace.zip / 失败截图）。本门禁在 lane 上传前对原始 artifact 做内容
扫描，任何私有信息泄漏 → 非零退出（fail-closed）。

复用 verify-real-e2e-lane-manifest.py 的 private_info_violation（同一份正则 SSOT，
避免两套阈值漂移，AGENTS §5.5），并新增 raw-text 才有的凭据形态：JWT / Bearer /
OIDC callback 参数 / 运行期凭据前缀（cs_/c_）/ 测试账号邮箱 / Set-Cookie /
请求正文中的 password。

扫描对象（调用方传入 tests/artifacts 根目录）：
  report-*.json          Playwright JSON reporter 输出（含 error message / URL）
  html-*/**              HTML report（含测试元数据 / attachment 路径）
  test-results/**        trace.zip（解包后扫 trace.trace / trace.network / trace.stacks
                         等文本成员）；失败截图/视频（PNG/JPEG/WEBM 二进制）跳过——
                         视觉隐私由 Slice A 路由处理，非本门禁文本扫描范围。

显式跳过（由其它机制负责，不重复扫描）：
  manifest-*.json        已由 verify-real-e2e-lane-manifest.py 校验
  real-e2e-account.env   凭据文件，已从 upload 路径显式排除

用法：
  python3 scripts/verify/verify-real-e2e-artifacts.py <artifacts-dir>
"""

import argparse
import importlib.util
import os
import re
import sys
import zipfile


class ArtifactSanitizeError(Exception):
    pass


def _load_manifest_verifier(repo_root):
    path = os.path.join(repo_root, "scripts", "verify", "verify-real-e2e-lane-manifest.py")
    if not os.path.exists(path):
        raise ArtifactSanitizeError(f"missing manifest verifier SSOT: {path}")
    spec = importlib.util.spec_from_file_location("verify_real_e2e_lane_manifest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── raw-text 凭据形态（manifest 是 schema'd JSON 用 key 匹配；raw artifact 无
#    schema/key 上下文，凭据嵌在值里，必须用值形态匹配）────────────────────
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{10,}", re.IGNORECASE)
# OIDC redirect/callback 参数：code / state / nonce / session_state / id_token /
# access_token / refresh_token。值需 ≥8 字符且非纯数字（避免 ?code=200 误报）。
OIDC_CALLBACK_RE = re.compile(
    r"[?&](code|state|nonce|session_state|id_token|access_token|refresh_token)=([A-Za-z0-9._~+/-]{8,})",
    re.IGNORECASE,
)
# 运行期凭据前缀（与 checks.yml creds step / provision 脚本同形）：
#   c_<hex>  = OIDC client id；cs_<hex> = OIDC client secret。
RUNTIME_CRED_RE = re.compile(r"\b(?:cs_[A-Fa-f0-9]{16,}|c_[A-Fa-f0-9]{12,})\b")
# 测试账号邮箱（runtime-random test identities 使用 internal/test/local 域）。
ACCOUNT_EMAIL_RE = re.compile(
    r"\b[\w.+-]+@(?:[A-Za-z0-9-]+\.)*(?:internal|local|corp|lan|test)\b", re.IGNORECASE
)
# Set-Cookie 头（cookie 内含会话凭据）。
SET_COOKIE_RE = re.compile(r"set-cookie\s*:\s*[A-Za-z0-9_-]+=", re.IGNORECASE)
# 请求/响应正文中的 password（测试账号口令）。client_secret/cs_ 由 RUNTIME_CRED_RE 覆盖。
PASSWORD_RE = re.compile(r"password[^A-Za-z0-9]{0,4}[A-Za-z0-9._~+/=-]{6,}", re.IGNORECASE)

TEXT_SUFFIXES = (".json", ".txt", ".log", ".md", ".html", ".htm", ".trace", ".network", ".stacks")
BINARY_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".webm", ".mp4", ".zip", ".woff", ".woff2", ".ttf", ".otf", ".ico")

SKIP_BASENAMES = {"real-e2e-account.env"}


def _violations_for_text(text, path, mv):
    """对一段原始文本做 fail-closed 扫描，返回违规信息列表。"""
    violations = []
    private = mv.private_info_violation(text, path, label="artifact")
    if private:
        violations.append(private)
    if JWT_RE.search(text):
        violations.append(f"{path}: JWT token leaked (redact; route raw trace to private evidence store)")
    if BEARER_RE.search(text):
        violations.append(f"{path}: Bearer token leaked")
    for match in OIDC_CALLBACK_RE.finditer(text):
        violations.append(f"{path}: OIDC callback param '{match.group(1)}' leaked")
    if RUNTIME_CRED_RE.search(text):
        violations.append(f"{path}: runtime credential token (cs_/c_ hex) leaked")
    if ACCOUNT_EMAIL_RE.search(text):
        violations.append(f"{path}: test account email leaked")
    if SET_COOKIE_RE.search(text):
        violations.append(f"{path}: Set-Cookie header leaked")
    if PASSWORD_RE.search(text):
        violations.append(f"{path}: password value in request/response body leaked")
    return violations


def _is_skipped(name):
    return name in SKIP_BASENAMES or name.startswith("manifest-")


def _scan_text_file(path, mv, violations):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError as exc:
        violations.append(f"{path}: unreadable artifact ({exc})")
        return
    violations.extend(_violations_for_text(text, path, mv))


def _scan_zip(path, mv, violations):
    """解包 Playwright trace.zip，扫描其文本成员（trace.trace / trace.network /
    trace.stacks）。zip 本身与二进制资源成员跳过。"""
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                lower = name.lower()
                if lower.endswith(BINARY_SUFFIXES) or lower.endswith(".zip"):
                    continue
                if not lower.endswith((".trace", ".network", ".stacks", ".json", ".txt")):
                    continue
                try:
                    text = zf.read(name).decode("utf-8", errors="replace")
                except (KeyError, OSError):
                    continue
                violations.extend(_violations_for_text(text, f"{path}::{name}", mv))
    except zipfile.BadZipFile as exc:
        violations.append(f"{path}: bad trace zip ({exc})")
    except OSError as exc:
        violations.append(f"{path}: unreadable trace zip ({exc})")


def _scan_dir(root, mv):
    violations = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for filename in filenames:
            if _is_skipped(filename):
                continue
            path = os.path.join(dirpath, filename)
            lower = filename.lower()
            if lower.endswith(".zip"):
                _scan_zip(path, mv, violations)
            elif lower.endswith(BINARY_SUFFIXES):
                continue
            elif lower.endswith(TEXT_SUFFIXES):
                _scan_text_file(path, mv, violations)
            else:
                # 未知扩展：仅当内容可解码为 UTF-8 文本时扫描，避免漏掉扩展名
                # 不规范的 trace/network 成员。
                try:
                    with open(path, "rb") as handle:
                        head = handle.read(1024)
                    head.decode("utf-8")
                    _scan_text_file(path, mv, violations)
                except (UnicodeDecodeError, OSError):
                    continue
    return violations


def main():
    parser = argparse.ArgumentParser(description="Sanitize raw L3 evidence artifacts (fail-closed).")
    parser.add_argument("artifacts_dir", help="path to tests/artifacts/")
    parser.add_argument("--repo-root", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
                        help="repository root (default: derived from this script)")
    args = parser.parse_args()

    if not os.path.isdir(args.artifacts_dir):
        raise ArtifactSanitizeError(f"artifacts dir not found: {args.artifacts_dir}")

    mv = _load_manifest_verifier(args.repo_root)
    violations = _scan_dir(args.artifacts_dir, mv)

    if violations:
        for v in violations:
            print(f"artifact sanitize violation: {v}", file=sys.stderr)
        raise ArtifactSanitizeError(
            f"{len(violations)} raw-artifact private-info leak(s); route raw evidence to private store, "
            f"upload only sanitized manifest + redacted summary"
        )

    print("raw L3 artifacts sanitize ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，fail-closed 退出 1
        print(str(exc), file=sys.stderr)
        sys.exit(1)
