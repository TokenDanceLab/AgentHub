#!/usr/bin/env python3
"""AgentHub real login / remote dispatch readiness record。

本脚本不做任何真实登录、分发或网络调用：它把「真实登录仍被阻止」这一事实
写成可归档的 manifest，并固定以退出码 2（blocked-with-evidence）结束，供
`scripts/smoke/verify-e2e-smoke-matrix.py` 的 login-real-readiness-gate 场景
消费。

真实登录证据只由 L3 lane 产出：`scripts/e2e/run-real-e2e-lane.sh`
（CI 里是 checks.yml 的 real-e2e-stack dispatch job）。

用法：
  python scripts/verify/verify-login-e2e-readiness.py --RepoRoot . --OutputPath <path>
"""

import argparse
import datetime
import json
import os
import sys

SCHEMA = "agenthub-login-e2e-readiness-v1"
STATUS = "BLOCKED_UNTIL_APPROVED"

REQUIRED_PREREQUISITES = [
    "OAuth client id",
    "exact callback URL",
    "Hub base URL",
    "Web URL",
    "disposable/test account indicator",
    "artifact redaction root under .tmp or tmp",
    "browser evidence boundary",
    "operator approval id",
    "separate real login and remote dispatch approvals",
]

REQUIRED_REMOTE_CONTROL_EVIDENCE = [
    "Hub-issued session proof",
    "Hub /web/execution-targets inventory proof",
    "selected online local_edge Desktop target proof",
    "Hub dispatch request proof with target_id",
    "Hub event replay proof after dispatch",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--OutputPath", default="", help="write the readiness manifest to this path")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    print("AgentHub login E2E readiness verifier")
    print("No browser, real login, dispatch, token exchange, or live endpoint call is performed by this script.")
    print("WARN: ProposalOnly blocks real login and records the required approval/evidence contract.")

    summary = {
        "schema": SCHEMA,
        "mode": "ProposalOnly",
        "status": STATUS,
        "real_login_executed_by_script": False,
        "remote_dispatch_executed_by_script": False,
        "token_values_logged": False,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "required_prerequisites": REQUIRED_PREREQUISITES,
        "required_remote_control_evidence": REQUIRED_REMOTE_CONTROL_EVIDENCE,
        "failures": [],
        "warnings": ["ProposalOnly blocks real login and records the required approval/evidence contract."],
    }

    if args.OutputPath.strip():
        output_path = args.OutputPath
        if not os.path.isabs(output_path):
            output_path = os.path.join(repo_root, output_path)
        parent = os.path.dirname(output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    print(f"Status: {STATUS}")
    print("RealLoginExecutedByScript=false")
    print("RemoteDispatchExecutedByScript=false")
    print("TokenValuesLogged=false")
    return 2


if __name__ == "__main__":
    sys.exit(main())
