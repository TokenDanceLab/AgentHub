#!/usr/bin/env python3
"""AgentHub real login and remote-control E2E readiness verifier（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

这是一个 approval gate 与证据形状验证器。不打开浏览器、不执行
TokenDanceID 登录、不分发 Hub 工作、不调用 live 服务。真实登录/分发仍然
被阻止，除非 operator 提供显式 approval 元数据且 Playwright harness 单独运行。

用法：
  python scripts/verify/verify-login-e2e-readiness.py --Mode ProposalOnly
  python scripts/verify/verify-login-e2e-readiness.py --Mode RealApproved --ApproveRealLogin --ApproveRemoteDispatch ...
  python scripts/verify/verify-login-e2e-readiness.py --Mode EvidenceReview --EvidenceManifest <path>
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse
from urllib.parse import urlparse

SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}"
    r"|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*="
    r"|password\s*=|client_secret\s*=)"
)
TEST_ACCOUNT_INDICATOR_PATTERN = re.compile(r"(?i)(disposable|test|throwaway|sandbox)")
SENSITIVE_FIELD_PATTERN = re.compile(r"(token|secret|password|cookie|authorization|session)")
REDACTED_PLACEHOLDER_PATTERN = re.compile(r"(?i)^(<redacted>|\[redacted\]|redacted|\*{3,}|<[^>]*redacted[^>]*>)$")
URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
LOOPBACK_IP_PATTERN = re.compile(r"^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$")

MANIFEST_FIELDS = (
    "hub_session",
    "target_inventory",
    "selected_desktop_target",
    "dispatch_request",
    "event_replay",
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AgentHub real login and remote-control E2E readiness verifier (ps1 migration)"
    )
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--Mode", default="ProposalOnly", choices=["ProposalOnly", "RealApproved", "EvidenceReview"])
    parser.add_argument("--UseEnvironment", action="store_true", help="fall back to AGENTHUB_LOGIN_E2E_* environment variables")
    parser.add_argument("--OAuthClientId", default="")
    parser.add_argument("--CallbackUrl", default="")
    parser.add_argument("--HubBaseUrl", default="")
    parser.add_argument("--WebUrl", default="")
    parser.add_argument("--LocalEdgeUrl", default="http://127.0.0.1:3210")
    parser.add_argument("--TestAccountIndicator", default="")
    parser.add_argument("--ArtifactRoot", default="")
    parser.add_argument("--BrowserEvidenceBoundary", default="", choices=["", "metadata-only", "redacted-screenshots"])
    parser.add_argument("--OperatorApprovalId", default="")
    parser.add_argument("--ApproveRealLogin", action="store_true")
    parser.add_argument("--ApproveRemoteDispatch", action="store_true")
    parser.add_argument("--HubSessionProof", default="")
    parser.add_argument("--TargetInventoryProof", default="")
    parser.add_argument("--SelectedDesktopTargetProof", default="")
    parser.add_argument("--DispatchRequestProof", default="")
    parser.add_argument("--EventReplayProof", default="")
    parser.add_argument("--EvidenceManifest", default="")
    parser.add_argument("--OutputPath", default="")
    args = parser.parse_args()

    failures = []
    warnings = []

    def add_failure(text):
        failures.append(text)
        print(f"FAIL: {text}")

    def add_warning(text):
        warnings.append(text)
        print(f"WARN: {text}")

    def pass_check(text):
        print(f"PASS: {text}")

    def first_value(current, name):
        if current and current.strip():
            return current
        if args.UseEnvironment:
            return os.environ.get(name, "")
        return ""

    def test_http_url(url):
        try:
            parsed = urlparse(url)
            return parsed.scheme in ("http", "https")
        except ValueError:
            return False

    def get_origin(url):
        try:
            parsed = urlparse(url)
            if parsed.port:
                port = parsed.port
            elif parsed.scheme == "https":
                port = 443
            else:
                port = 80
            return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}:{port}"
        except ValueError:
            return ""

    def test_loopback_host(hostname):
        if not hostname or not hostname.strip():
            return False
        normalized = hostname.lower().strip("[]")
        if normalized in ("localhost", "::1"):
            return True
        return LOOPBACK_IP_PATTERN.match(normalized) is not None

    def test_loopback_url(url):
        try:
            parsed = urlparse(url)
            return test_loopback_host(parsed.hostname or "")
        except ValueError:
            return False

    def test_direct_local_edge_url(url, configured_local_edge_url):
        try:
            uri = urlparse(url)
            edge = urlparse(configured_local_edge_url)
            if uri.scheme not in ("http", "https"):
                return False
            if not test_loopback_host(uri.hostname or ""):
                return False
            if uri.port != edge.port:
                return False
            edge_path = edge.path or ""
            if not edge_path or edge_path == "/":
                return True
            return (uri.path or "").lower().startswith(edge_path.rstrip("/").lower())
        except ValueError:
            return False

    def test_secret_like(value):
        if not value or not value.strip():
            return False
        return SECRET_LIKE_PATTERN.search(value) is not None

    def assert_no_secret_like(name, value):
        if test_secret_like(value):
            add_failure(f"{name} contains secret-like material; pass ownership/proof references, not token values")

    def assert_required(name, value):
        if not value or not value.strip():
            add_failure(f"{name} is required")
        else:
            pass_check(f"{name} supplied")

    def assert_url(name, value):
        assert_required(name, value)
        if value.strip() and not test_http_url(value):
            add_failure(f"{name} must be an http(s) URL")

    def resolve_repo_path(path):
        if not path or not path.strip():
            return ""
        if os.path.isabs(path):
            return path
        return os.path.join(repo_root, path)

    def test_allowed_artifact_root(path):
        if not path or not path.strip():
            return False
        full = os.path.normcase(os.path.abspath(resolve_repo_path(path))).rstrip("/\\")
        allowed = [
            os.path.normcase(os.path.abspath(os.path.join(repo_root, ".tmp"))).rstrip("/\\"),
            os.path.normcase(os.path.abspath(os.path.join(repo_root, "tmp"))).rstrip("/\\"),
        ]
        for root in allowed:
            if full == root:
                return True
            if full.startswith(root + os.sep) or full.startswith(root + "/"):
                return True
        return False

    def read_json_file(path):
        if not path or not path.strip():
            return None
        full = resolve_repo_path(path)
        if not os.path.exists(full):
            add_failure("evidence manifest not found")
            return None
        try:
            with open(full, encoding="utf-8") as handle:
                return json.load(handle)
        except (ValueError, OSError):
            add_failure("evidence manifest must be valid JSON")
            return None

    def test_json_for_secret_like(node):
        return test_secret_like(json.dumps(node, ensure_ascii=False))

    def test_redacted_placeholder(value):
        if value is None:
            return True
        if isinstance(value, str):
            return REDACTED_PLACEHOLDER_PATTERN.match(value) is not None
        if isinstance(value, list):
            return all(test_redacted_placeholder(item) for item in value)
        if isinstance(value, dict):
            return all(test_redacted_placeholder(v) for v in value.values())
        return False

    def test_sensitive_field_name(name, parent_path):
        if parent_path == "$" and name.lower() == "hub_session":
            return False
        normalized = re.sub(r"[^a-z0-9]", "", name.lower())
        return SENSITIVE_FIELD_PATTERN.search(normalized) is not None

    def assert_manifest_safety(node, path="$"):
        if node is None:
            return
        if isinstance(node, str):
            for match in URL_PATTERN.findall(node):
                if test_direct_local_edge_url(match, local_edge_url):
                    add_failure(f"evidence manifest contains direct Local Edge URL at {path}")
            return
        if isinstance(node, list):
            for index, item in enumerate(node):
                assert_manifest_safety(item, f"{path}[{index}]")
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if test_sensitive_field_name(str(key), path) and not test_redacted_placeholder(value):
                    add_failure(f"evidence manifest contains unredacted sensitive field at {path}.{key}")
                assert_manifest_safety(value, f"{path}.{key}")

    def test_manifest_evidence(manifest):
        if manifest is None:
            return

        if test_json_for_secret_like(manifest):
            add_failure("evidence manifest contains secret-like material")
        assert_manifest_safety(manifest)

        for field in MANIFEST_FIELDS:
            if manifest.get(field) is None:
                add_failure(f"evidence manifest missing {field} proof")
            else:
                pass_check(f"evidence manifest contains {field} proof")

        if manifest.get("real_login_approved") is not True:
            add_failure("evidence manifest must record real_login_approved=true")
        if manifest.get("remote_dispatch_approved") is not True:
            add_failure("evidence manifest must record remote_dispatch_approved=true")
        if manifest.get("redaction_status") != "redacted":
            add_failure("evidence manifest redaction_status must be redacted")
        if manifest.get("web_to_local_edge_direct") is True:
            add_failure("evidence manifest must not prove a direct Web-to-LocalEdge path")

    repo_root = os.path.abspath(args.RepoRoot)
    oauth_client_id = first_value(args.OAuthClientId, "AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID")
    callback_url = first_value(args.CallbackUrl, "AGENTHUB_LOGIN_E2E_CALLBACK_URL")
    hub_base_url = first_value(args.HubBaseUrl, "AGENTHUB_LOGIN_E2E_HUB_BASE_URL")
    web_url = first_value(args.WebUrl, "AGENTHUB_LOGIN_E2E_WEB_URL")
    local_edge_url = first_value(args.LocalEdgeUrl, "AGENTHUB_LOGIN_E2E_LOCAL_EDGE_URL")
    test_account_indicator = first_value(args.TestAccountIndicator, "AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR")
    artifact_root = first_value(args.ArtifactRoot, "AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT")
    browser_evidence_boundary = first_value(args.BrowserEvidenceBoundary, "AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY")
    operator_approval_id = first_value(args.OperatorApprovalId, "AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID")
    hub_session_proof = first_value(args.HubSessionProof, "AGENTHUB_LOGIN_E2E_HUB_SESSION_PROOF")
    target_inventory_proof = first_value(args.TargetInventoryProof, "AGENTHUB_LOGIN_E2E_TARGET_INVENTORY_PROOF")
    selected_desktop_target_proof = first_value(args.SelectedDesktopTargetProof, "AGENTHUB_LOGIN_E2E_SELECTED_DESKTOP_TARGET_PROOF")
    dispatch_request_proof = first_value(args.DispatchRequestProof, "AGENTHUB_LOGIN_E2E_DISPATCH_REQUEST_PROOF")
    event_replay_proof = first_value(args.EventReplayProof, "AGENTHUB_LOGIN_E2E_EVENT_REPLAY_PROOF")
    evidence_manifest = first_value(args.EvidenceManifest, "AGENTHUB_LOGIN_E2E_EVIDENCE_MANIFEST")
    approve_real_login = args.ApproveRealLogin
    approve_remote_dispatch = args.ApproveRemoteDispatch
    if args.UseEnvironment:
        approve_real_login = approve_real_login or os.environ.get("AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN") == "true"
        approve_remote_dispatch = approve_remote_dispatch or os.environ.get("AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH") == "true"

    print("AgentHub login E2E readiness verifier")
    print(f"Mode: {args.Mode}")
    print("No browser, real login, dispatch, token exchange, or live endpoint call is performed by this script.")

    for name, value in [
        ("OAuthClientId", oauth_client_id),
        ("CallbackUrl", callback_url),
        ("HubBaseUrl", hub_base_url),
        ("WebUrl", web_url),
        ("LocalEdgeUrl", local_edge_url),
        ("TestAccountIndicator", test_account_indicator),
        ("ArtifactRoot", artifact_root),
        ("BrowserEvidenceBoundary", browser_evidence_boundary),
        ("OperatorApprovalId", operator_approval_id),
        ("HubSessionProof", hub_session_proof),
        ("TargetInventoryProof", target_inventory_proof),
        ("SelectedDesktopTargetProof", selected_desktop_target_proof),
        ("DispatchRequestProof", dispatch_request_proof),
        ("EventReplayProof", event_replay_proof),
    ]:
        assert_no_secret_like(name, value)

    if args.Mode == "ProposalOnly":
        add_warning("ProposalOnly blocks real login and records the required approval/evidence contract.")
    else:
        assert_required("OAuth client id", oauth_client_id)
        assert_url("Callback URL", callback_url)
        assert_url("Hub base URL", hub_base_url)
        assert_url("Web URL", web_url)
        assert_required("disposable/test account indicator", test_account_indicator)
        assert_required("artifact redaction root", artifact_root)
        assert_required("browser evidence boundary", browser_evidence_boundary)
        assert_required("operator approval id", operator_approval_id)

        if TEST_ACCOUNT_INDICATOR_PATTERN.search(test_account_indicator) is None:
            add_failure("test account indicator must clearly name a disposable/test/sandbox account")
        if not test_allowed_artifact_root(artifact_root):
            add_failure("artifact root must stay under .tmp or tmp so redacted evidence cannot enter Git")
        if browser_evidence_boundary not in ("metadata-only", "redacted-screenshots"):
            add_failure("browser evidence boundary must be metadata-only or redacted-screenshots")
        if not approve_real_login:
            add_failure("real login requires -ApproveRealLogin or AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN=true")
        if not approve_remote_dispatch:
            add_failure("remote-control dispatch requires -ApproveRemoteDispatch or AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH=true")

        if test_direct_local_edge_url(web_url, local_edge_url):
            add_failure("Web URL must not point directly at Local Edge")
        if test_direct_local_edge_url(hub_base_url, local_edge_url):
            add_failure("Hub base URL must not point directly at Local Edge")
        if test_loopback_url(hub_base_url) and not test_loopback_url(web_url):
            add_warning("Hub is loopback while Web is not; verify this is an approved test topology")

    if args.Mode == "RealApproved":
        for name, value in [
            ("Hub session proof", hub_session_proof),
            ("target inventory proof", target_inventory_proof),
            ("selected Desktop target proof", selected_desktop_target_proof),
            ("dispatch request proof", dispatch_request_proof),
            ("event replay proof", event_replay_proof),
        ]:
            assert_required(name, value)

    if args.Mode == "EvidenceReview":
        manifest = read_json_file(evidence_manifest)
        test_manifest_evidence(manifest)

    if len(failures) == 0:
        if args.Mode == "ProposalOnly":
            status = "BLOCKED_UNTIL_APPROVED"
        elif args.Mode == "EvidenceReview":
            status = "EVIDENCE_CONTRACT_ACCEPTED"
        else:
            status = "READY_FOR_APPROVED_REAL_LOGIN_E2E"
    else:
        status = "BLOCKED"

    summary = {
        "schema": "agenthub-login-e2e-readiness-v1",
        "mode": args.Mode,
        "status": status,
        "real_login_executed_by_script": False,
        "remote_dispatch_executed_by_script": False,
        "token_values_logged": False,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "required_prerequisites": [
            "OAuth client id",
            "exact callback URL",
            "Hub base URL",
            "Web URL",
            "disposable/test account indicator",
            "artifact redaction root under .tmp or tmp",
            "browser evidence boundary",
            "operator approval id",
            "separate real login and remote dispatch approvals",
        ],
        "required_remote_control_evidence": [
            "Hub-issued session proof",
            "Hub /web/execution-targets inventory proof",
            "selected online local_edge Desktop target proof",
            "Hub dispatch request proof with target_id",
            "Hub event replay proof after dispatch",
        ],
        "failures": list(failures),
        "warnings": list(warnings),
    }

    if args.OutputPath and args.OutputPath.strip():
        full_output_path = resolve_repo_path(args.OutputPath)
        parent = os.path.dirname(full_output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(full_output_path, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    print(f"Status: {status}")
    print("RealLoginExecutedByScript=false")
    print("RemoteDispatchExecutedByScript=false")
    print("TokenValuesLogged=false")

    if len(failures) > 0:
        return 1
    if args.Mode == "ProposalOnly":
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
