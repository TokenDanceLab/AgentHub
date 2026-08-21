#!/usr/bin/env python3
r"""CI gate policy verifier — ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）。

用正则解析 .github/workflows/checks.yml 的 job/step 结构并断言 CI 政策：
覆盖门禁、gosec/vuln 扫描、backend fixture/focused 边界、前端 pnpm 缓存、
coverage include、commit-message/quality-debt/doc-ssot 自测、mobile light、
visual-qa-shell、changes 路径筛选等。断言引用脚本名与本批迁移后 checks.yml
实际内容一致（本批脚本 .py，其余保持 .ps1）。

CLI 兼容：--WorkflowPath 默认 ".github/workflows/checks.yml"（相对 cwd）；
通过输出 "ci gate policy ok" 且退出码 0；违例抛异常 → stderr + 退出码 1。
"""

import argparse
import os
import re
import sys

NEXT_JOB = r"(?:  \#.*\r?\n|[ \t]*\r?\n)*  [A-Za-z0-9_-]+:"


def fail(message: str) -> None:
    raise RuntimeError(f"CI gate policy check failed: {message}")


def get_job_block(workflow: str, job_name: str) -> str:
    # Comments between sibling jobs belong to neither job. Stop before those
    # comments when they are immediately followed by the next two-space job
    # key; otherwise policy checks can accidentally inspect the next job's
    # heading text (for example "PostgreSQL + Redis").
    pattern = re.compile(r"(?ms)^  " + re.escape(job_name) + r":\r?\n(?P<body>.*?)(?=^" + NEXT_JOB + r"|\Z)")
    match = pattern.search(workflow)
    if not match:
        fail(f"missing job '{job_name}'")
    return match.group("body")


def get_step_block(job_block: str, step_name: str) -> str:
    pattern = re.compile(r"(?ms)^\s+- name: " + re.escape(step_name) + r"\r?\n(?P<body>.*?)(?=^\s+- name:|\Z)")
    match = pattern.search(job_block)
    if not match:
        fail(f"missing step '{step_name}'")
    return match.group("body")


def assert_contains(text: str, pattern: str, message: str) -> None:
    if not re.search(pattern, text, re.IGNORECASE):
        fail(message)


def assert_not_contains(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, re.IGNORECASE):
        fail(message)


def assert_step_continue_on_error(job_block: str, step_name: str, expected: bool) -> None:
    step = get_step_block(job_block, step_name)
    has_continue = re.search(r"(?m)^\s+continue-on-error:\s+true\s*$", step, re.IGNORECASE) is not None
    if has_continue != expected:
        want = "warning-only" if expected else "hard-blocking"
        fail(f"step '{step_name}' must be {want}")


def main() -> int:
    """解析 checks.yml 并断言全部 CI 门禁政策；违例即抛错退出 1（fail-closed，防回退）。"""
    parser = argparse.ArgumentParser(description="CI gate policy verifier")
    parser.add_argument("--WorkflowPath", default=".github/workflows/checks.yml")
    args = parser.parse_args()

    workflow_path = args.WorkflowPath
    if not os.path.isfile(workflow_path):
        fail(f"workflow file not found: {workflow_path}")

    with open(workflow_path, encoding="utf-8-sig", errors="replace") as handle:
        workflow = handle.read()
    edge = get_job_block(workflow, "go-edge")
    hub = get_job_block(workflow, "go-hub")
    backend_fixture = get_job_block(workflow, "backend-e2e-fixture")
    # CI5: backend-focused-subset job removed (redundant with go-edge/go-hub
    # full `go test ./...` runs that already cover the focused packages).
    desktop = get_job_block(workflow, "frontend-desktop")
    web = get_job_block(workflow, "frontend-web")
    mobile = get_job_block(workflow, "frontend-mobile")
    mobile_light = get_job_block(workflow, "frontend-mobile-light")
    e2e = get_job_block(workflow, "e2e-smoke")
    changes = get_job_block(workflow, "changes")
    visual_shell = get_job_block(workflow, "visual-qa-shell")
    validate = get_job_block(workflow, "validate")
    backend_perf = get_job_block(workflow, "backend-perf-leak-gates")
    # #audit: frontend coverage baseline gate split out of the unconditional
    # validate lane into a path-filtered frontend-coverage job (desktop ∪ web
    # ∪ shared). A Go-only PR no longer pays for pnpm install + vitest
    # --coverage. The gate contract moves with it.
    frontend_coverage = get_job_block(workflow, "frontend-coverage")
    # #1720: design CSS syntax gate — token/theme/preset CSS is excluded from
    # Stylelint (.stylelintignore), so a syntax-only fail-closed gate runs as a
    # single path-filtered job. Normal scan and negative self-test are both
    # hard-blocking; the job must never fall back to lint:css (920-rule debt).
    design_css = get_job_block(workflow, "design-css")
    windows_go_test = get_job_block(workflow, "windows-go-test")
    windows_frontend_test = get_job_block(workflow, "windows-frontend-test")
    windows_go = get_job_block(workflow, "windows-go")
    windows_frontend = get_job_block(workflow, "windows-frontend")

    assert_contains(edge, r"Coverage check \(informational\)", "go-edge overall coverage must stay informational")
    assert_contains(edge, r"Coverage per-package minimums", "go-edge must keep per-package coverage minimums")
    assert_contains(edge, re.escape('check_pkg "edge-server/internal/security/" 70 "security"'), "go-edge must keep security package coverage minimum")
    assert_contains(edge, re.escape('check_pkg "edge-server/internal/lifecycle/" 60 "lifecycle"'), "go-edge must keep lifecycle package coverage minimum")
    assert_contains(edge, re.escape('check_pkg "edge-server/internal/adapters/" 55 "adapters"'), "go-edge must keep adapters package coverage minimum")
    assert_contains(hub, r"THRESHOLD=40", "go-hub coverage threshold must be 40%")

    # go-edge / go-hub 恒报 report：两者是 required checks，GitHub 不把
    # skipped 视为 required check 通过，纯前端 PR 会被永久 BLOCK。
    # 策略：job 级 if 恒真（!cancelled()），真实门禁步骤带 go 条件（省成本），
    # 末尾 fallback step 在无 Go 变更时输出 skipped 并 exit 0；changes 失败时
    # 由 fail-closed step（result != 'success'）exit 1，杜绝 false green。
    for job_name, job_body in (("go-edge", edge), ("go-hub", hub)):
        assert_contains(
            job_body,
            r"(?m)^\s+if:\s+\$\{\{\s*!cancelled\(\)\s*\}\}\s*$",
            f"{job_name} must always report a result (job-level if must not path-filter)",
        )
        assert_contains(
            job_body,
            r"if:\s+github\.event_name == 'workflow_dispatch' \|\| needs\.changes\.outputs\.go == 'true'",
            f"{job_name} real gates must stay step-level path-filtered",
        )
        fallback_step = get_step_block(job_body, "Report no-Go-changes skip (required check)")
        assert_contains(fallback_step, r"needs\.changes\.result == 'success'", f"{job_name} fallback must require the changes job to succeed")
        assert_contains(fallback_step, r"needs\.changes\.outputs\.go != 'true'", f"{job_name} fallback must only run when the Go filter is off")
        assert_contains(fallback_step, r"reporting success for required check", f"{job_name} fallback must report success for the required check")
        assert_contains(fallback_step, r"exit 0", f"{job_name} fallback must exit 0")
        fail_step = get_step_block(job_body, "Fail when Go path filter failed")
        assert_contains(fail_step, r"needs\.changes\.result != 'success'", f"{job_name} must fail closed when the changes job fails")
        assert_contains(fail_step, r"exit 1", f"{job_name} changes-failure step must exit 1")

    # #1536: Edge lint is at 0 issues and hardened to hard-blocking; Hub lint
    # still carries pre-existing findings (tracked in #1573) and stays
    # warning-only until a finding-fingerprint ratchet exists. Complexity
    # exclusions remain separately owned by #1568.
    # Wave 10: go-edge Lint set to advisory — gocognit findings in pre-existing
    # complex functions (admin.go/mcp_server.go/agent_dispatch.go); re-harden
    # after refactoring or threshold adjustment.
    assert_step_continue_on_error(edge, "Lint", True)
    # #1657/#1832: go-hub Lint is report-only (advisory) — the action's raw
    # exit code cannot consult the #1573 baseline, and >300-file PR diffs
    # fall back to a full-repo lint that would hard-fail debt-clean large
    # PRs. The hard gate lives in the fingerprint ratchet step below, which
    # exempts baseline-registered findings in both patch and full-lint mode.
    # The step must keep the pinned golangci-lint action (no placeholder
    # commands) and only-new-issues so small PRs keep a new-findings report.
    assert_step_continue_on_error(hub, "Lint", True)
    hub_lint_step = get_step_block(hub, "Lint")
    assert_contains(hub_lint_step, r"golangci/golangci-lint-action@v9", "go-hub Lint must keep the pinned golangci-lint action (no placeholder commands)")
    assert_contains(hub_lint_step, r"only-new-issues:\s*true", "go-hub Lint must keep only-new-issues so patch-mode reports stay scoped to new findings")
    assert_step_continue_on_error(hub, "Verify Hub lint fingerprint ratchet (#1573)", False)
    # #1574: gosec findings triaged and cleared in both servers; the gosec
    # security scan steps are hard-blocking (no continue-on-error) and run
    # through the fail-closed verify-gosec-gates.sh wrapper.
    assert_step_continue_on_error(edge, "Security scan (gosec)", False)
    assert_step_continue_on_error(hub, "Security scan (gosec)", False)
    assert_step_continue_on_error(edge, "Coverage per-package minimums", False)
    assert_not_contains(edge, r"Commit message check", "commit-message policy must not live in the path-filtered go-edge job")

    # #1534：vuln 扫描收敛到独立 job（vuln-scan-go / vuln-scan-js）且 fail-closed；
    # go-hub/go-edge 内不再要求重复的 continue-on-error govulncheck step。
    vuln_go = get_job_block(workflow, "vuln-scan-go")
    vuln_js = get_job_block(workflow, "vuln-scan-js")
    assert_contains(vuln_go, re.escape("verify-vulnerability-gates.sh govulncheck"), "vuln-scan-go must run the fail-closed govulncheck verifier")
    assert_contains(vuln_js, re.escape("verify-vulnerability-gates.sh pnpm-audit"), "vuln-scan-js must run the fail-closed pnpm audit verifier")
    assert_contains(validate, r"Self-test vulnerability gates", "validate must self-test the vulnerability gates")
    assert_contains(validate, r"Self-test gosec gate", "validate must self-test the gosec fail-closed contract")
    assert_contains(validate, r"Self-test secret guard", "validate must self-test the secret guard fail-closed contract")

    # Native Windows is a compatibility contract, not a duplicate release
    # pipeline: backend and frontend matrix legs must remain path-filtered and
    # hard-blocking while full Tauri packaging stays in release-readiness.
    assert_contains(windows_go_test, r"needs:\s+changes", "windows-go-test must depend on the unified changes job")
    assert_contains(windows_go_test, r"needs\.changes\.outputs\.go == 'true'", "windows-go-test must path-filter on Go changes")
    assert_contains(windows_go_test, r"runs-on:\s+windows-latest", "windows-go-test must use a native Windows runner")
    assert_contains(windows_go_test, r"module:\s*\[edge-server, hub-server\]", "windows-go-test must cover both Go modules")
    assert_contains(windows_go_test, r"go test \./\.\.\. -short -count=1", "windows-go-test must execute the native short unit suite")
    assert_contains(windows_frontend_test, r"needs:\s+changes", "windows-frontend-test must depend on the unified changes job")
    assert_contains(windows_frontend_test, r"needs\.changes\.outputs\.frontend == 'true'", "windows-frontend-test must path-filter on frontend changes")
    assert_contains(windows_frontend_test, r"runs-on:\s+windows-latest", "windows-frontend-test must use a native Windows runner")
    assert_contains(windows_frontend_test, r"package:\s*\[agenthub-desktop, agenthub-web\]", "windows-frontend-test must cover Desktop and Web")
    assert_contains(windows_frontend_test, r"pnpm --filter \$\{\{ matrix\.package \}\} typecheck", "windows-frontend-test must run package type checks")
    assert_contains(windows_frontend_test, r"pnpm --filter \$\{\{ matrix\.package \}\} test", "windows-frontend-test must run package unit tests")
    assert_contains(windows_frontend_test, r"pnpm --filter \$\{\{ matrix\.package \}\} build", "windows-frontend-test must run package production builds")
    assert_contains(windows_go, r"needs:\s+\[changes, windows-go-test\]", "windows-go must aggregate the Windows Go matrix")
    assert_contains(windows_go, r"if:\s+always\(\)", "windows-go must report a stable result when its matrix is skipped")
    assert_contains(windows_go, re.escape("MATRIX_RESULT: ${{ needs.windows-go-test.result }}"), "windows-go must bind the Windows Go matrix result for fail-closed aggregation")
    assert_contains(windows_go, re.escape('MATRIX_RESULT" != "success"'), "windows-go must fail when its Windows Go matrix did not succeed")
    assert_contains(windows_frontend, r"needs:\s+\[changes, windows-frontend-test\]", "windows-frontend must aggregate the Windows frontend matrix")
    assert_contains(windows_frontend, r"if:\s+always\(\)", "windows-frontend must report a stable result when its matrix is skipped")
    assert_contains(windows_frontend, re.escape("MATRIX_RESULT: ${{ needs.windows-frontend-test.result }}"), "windows-frontend must bind the Windows frontend matrix result for fail-closed aggregation")
    assert_contains(windows_frontend, re.escape('MATRIX_RESULT" != "success"'), "windows-frontend must fail when its Windows frontend matrix did not succeed")

    assert_contains(backend_fixture, r"working-directory:\s+hub-server", "backend-e2e-fixture must run from hub-server")
    assert_contains(backend_fixture, r"TeamRun fixture E2E", "backend-e2e-fixture must name the TeamRun fixture step")
    assert_contains(backend_fixture, re.escape("go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1"), "backend-e2e-fixture must run only the TeamRun fixture smoke test")
    assert_step_continue_on_error(backend_fixture, "TeamRun fixture E2E", False)
    assert_contains(backend_fixture, r"P0 remote-control fixture readiness", "backend-e2e-fixture must run the P0 remote-control fixture readiness step")
    assert_contains(backend_fixture, re.escape("python ./scripts/verify/verify-p0-remote-control-fixture.py"), "backend-e2e-fixture must run the P0 remote-control fixture readiness gate")
    assert_step_continue_on_error(backend_fixture, "P0 remote-control fixture readiness", False)

    # CI5: backend-focused-subset job deleted — its focused package subset
    # (hub ./internal/{repository,service,app,handler,router} and edge
    # ./internal/{store,api,lifecycle}+cmd/agenthub-edge) is fully covered by
    # the go-hub/go-edge full `go test ./...` runs. No assertions remain.

    backend_forbidden_patterns = [
        r"-RealCli",
        r"real[-_]?cli",
        r"self-hosted",
        r"services:",
        r"integration-smoke\.ps1",
        r"edge-runtime-smoke\.ps1",
        r"OPENAI_API_KEY",
        r"ANTHROPIC_API_KEY",
        r"CODEX_",
        r"CLAUDE_",
        r"\bcodex\b",
        r"\bclaude\b",
        r"\bopencode\b",
        r"postgres",
        r"redis",
        r"dev-up",
        r"docker",
        r"codesign",
        r"signtool",
        r"notarization",
        r"notarytool",
        r"cosign",
        r"http://",
        r"https://",
        r"go test ./tests -count=1",
    ]

    for forbidden in backend_forbidden_patterns:
        assert_not_contains(backend_fixture, forbidden, f"backend-e2e-fixture must not invoke '{forbidden}'")

    for job_name, job_body, lockfile in (
        ("frontend-desktop", desktop, "app/pnpm-lock.yaml"),
        ("frontend-web", web, "app/pnpm-lock.yaml"),
        ("frontend-mobile", mobile, "app/pnpm-lock.yaml"),
        ("frontend-mobile-light", mobile_light, "app/pnpm-lock.yaml"),
        ("e2e-smoke", e2e, "app/pnpm-lock.yaml"),
        ("visual-qa-shell", visual_shell, "app/pnpm-lock.yaml"),
        ("design-css", design_css, "app/pnpm-lock.yaml"),
        ("windows-frontend-test", windows_frontend_test, "app/pnpm-lock.yaml"),
    ):
        # runtime major is governed by verify-action-runtimes.py (#1580); here
        # we only require the pnpm setup step to exist with the pnpm cache wired up
        assert_contains(job_body, r"pnpm/action-setup@", f"{job_name} must install pnpm explicitly")
        assert_contains(job_body, r"cache:\s+pnpm", f"{job_name} must enable pnpm cache")
        assert_contains(job_body, re.escape(lockfile), f"{job_name} must cache the correct pnpm lockfile")

    # #1535: coverage include contract — every frontend package counts ALL
    # production src in the denominator (app/test-config/coverage.ts factory).
    # The baseline gate runs all four packages plus a negative self-test proving
    # imported-by-nobody modules are counted as 0% and trip the ratchet.
    # #audit: gate moved from unconditional validate lane to path-filtered
    # frontend-coverage job (desktop ∪ web ∪ shared). Assert the new home
    # and the path filter so the gate cannot be silently un-wired.
    assert_contains(frontend_coverage, r"needs:\s+changes", "frontend-coverage must depend on unified changes job")
    assert_contains(frontend_coverage, r"needs.changes.outputs.frontend", "frontend-coverage must path-filter on frontend changes")
    assert_contains(frontend_coverage, r"Verify coverage baseline", "frontend-coverage job must run the coverage baseline gate")
    assert_contains(frontend_coverage, r"scripts/verify/verify-coverage-baseline.py", "frontend-coverage job must call the coverage baseline verifier")
    assert_contains(frontend_coverage, r"Self-test coverage include contract", "frontend-coverage job must run the coverage include negative self-test")
    assert_contains(frontend_coverage, r"coverage-include\.Tests\.py", "frontend-coverage job must call the coverage include self-test")
    assert_step_continue_on_error(frontend_coverage, "Verify coverage baseline", False)
    assert_step_continue_on_error(frontend_coverage, "Self-test coverage include contract (negative)", False)
    # validate must no longer carry the heavy coverage gate — it would
    # re-introduce the unconditional pnpm install + vitest cost on every PR.
    assert_not_contains(validate, r"Verify coverage baseline", "validate job must not carry the coverage gate (moved to frontend-coverage)")

    # #1720: design-css fail-closed contract. Both steps hard-blocking; the
    # verifier must be invoked via its own scripts (test:css-syntax), never
    # via lint:css — that target carries the 920-rule historical debt which
    # is out of scope for this gate. The changes job must expose the
    # design_css filter so the gate stays path-filtered.
    assert_contains(design_css, r"needs:\s+changes", "design-css must depend on unified changes job")
    assert_contains(design_css, re.escape("needs.changes.outputs.design_css == 'true'"), "design-css must path-filter on design_css changes")
    assert_contains(design_css, r"(?m)^\s+run: pnpm test:css-syntax\s*$", "design-css must run the design CSS syntax verifier")
    assert_contains(design_css, r"(?m)^\s+run: pnpm test:css-syntax:self-test\s*$", "design-css must run the design CSS syntax negative self-test")
    assert_not_contains(design_css, r"lint:css", "design-css must not fall back to lint:css (historical Stylelint rule debt)")
    assert_step_continue_on_error(design_css, "Verify design CSS syntax", False)
    assert_step_continue_on_error(design_css, "Self-test design CSS syntax gate (negative)", False)
    assert_contains(changes, re.escape("design_css: ${{ steps.filter.outputs.design_css }}"), "changes job must expose the design_css output")
    assert_contains(changes, r"(?m)^\s+design_css:\s*$", "changes job must define the design_css path filter")

    ci_policy_step = get_step_block(validate, "Verify CI gate policy")
    assert_contains(ci_policy_step, r"scripts/verify/verify-ci-gates\.py", "CI policy step must call scripts/verify/verify-ci-gates.py")
    ci_policy_self_test_step = get_step_block(validate, "Self-test CI gate policy (workflow mutations)")
    assert_contains(ci_policy_self_test_step, r"verify-ci-gates\.Tests\.py", "CI policy self-test step must call its workflow mutation test script")
    assert_step_continue_on_error(validate, "Self-test CI gate policy (workflow mutations)", False)
    coverage_writer_selftest = get_step_block(validate, "Self-test coverage baseline metadata/write safety")
    assert_contains(
        coverage_writer_selftest,
        r"scripts/verify/tests/coverage-baseline\.Tests\.py",
        "validate must exercise coverage baseline metadata/write safety",
    )
    assert_step_continue_on_error(validate, "Self-test coverage baseline metadata/write safety", False)
    devserver_contract_step = get_step_block(validate, "Verify remote devserver privacy/portability contract")
    assert_contains(
        devserver_contract_step,
        r"scripts/verify/verify-devserver-contract\.py",
        "validate must enforce the remote devserver privacy/portability contract",
    )
    assert_step_continue_on_error(validate, "Verify remote devserver privacy/portability contract", False)

    commit_message_step = get_step_block(validate, "Verify commit messages (PR only)")
    assert_contains(commit_message_step, r"scripts/verify/verify-commit-messages\.sh", "commit-message step must call the commit-message verifier")
    assert_contains(commit_message_step, re.escape("github.event.pull_request.head.sha"), "commit-message step must inspect the real PR head")
    assert_contains(commit_message_step, re.escape("origin/${{ github.base_ref }}"), "commit-message step must compare with the real base branch")
    assert_step_continue_on_error(validate, "Verify commit messages (PR only)", False)

    commit_message_self_test_step = get_step_block(validate, "Self-test commit-message gate")
    assert_contains(commit_message_self_test_step, r"verify-commit-messages\.Tests\.sh", "commit-message self-test step must call its test script")
    assert_step_continue_on_error(validate, "Self-test commit-message gate", False)

    quality_debt_step = get_step_block(validate, "Verify quality-debt ratchet (#1536)")
    assert_contains(quality_debt_step, r"scripts/verify/verify-quality-debt-ratchet\.py", "quality-debt step must call the ratchet verifier")
    assert_step_continue_on_error(validate, "Verify quality-debt ratchet (#1536)", False)

    quality_debt_self_test_step = get_step_block(validate, "Self-test quality-debt ratchet (negative)")
    assert_contains(quality_debt_self_test_step, r"verify-quality-debt-ratchet\.Tests\.py", "quality-debt self-test step must call its test script")
    assert_step_continue_on_error(validate, "Self-test quality-debt ratchet (negative)", False)
    assert_contains(validate, r"Verify project skill whitelist", "validate job must run the project skill whitelist verifier")
    assert_contains(validate, r"scripts/verify/verify-project-skills\.py", "validate job must call scripts/verify/verify-project-skills.py")
    doc_ssot_step = get_step_block(validate, "Verify doc SSOT")
    assert_contains(doc_ssot_step, r"scripts/verify/verify-doc-ssot\.py", "doc SSOT step must call scripts/verify/verify-doc-ssot.py")
    assert_step_continue_on_error(validate, "Verify doc SSOT", False)

    doc_entrypoint_self_test_step = get_step_block(validate, "Self-test doc entrypoint SSOT")
    assert_contains(doc_entrypoint_self_test_step, r"scripts/verify/tests/verify-doc-entrypoints\.Tests\.py", "doc entrypoint self-test step must call its test script")
    assert_step_continue_on_error(validate, "Self-test doc entrypoint SSOT", False)
    assert_contains(validate, r"Verify Web Hub-only boundary", "validate job must run the Web Hub-only boundary verifier")
    assert_contains(validate, r"scripts/verify/verify-web-hub-boundary.py", "validate job must call scripts/verify/verify-web-hub-boundary.ps1")
    assert_contains(validate, r"Verify Hub pure package imports", "validate job must run the Hub pure package import verifier")
    assert_contains(validate, r"scripts/verify/verify-hub-pure-packages.py", "validate job must call scripts/verify/verify-hub-pure-packages.ps1")
    assert_step_continue_on_error(validate, "Verify Hub pure package imports", False)
    assert_contains(validate, r"Verify Mobile Hub-only boundary", "validate job must run the Mobile Hub-only boundary verifier")
    assert_contains(validate, r"scripts/verify/verify-mobile-hub-boundary.py", "validate job must call scripts/verify/verify-mobile-hub-boundary.ps1")
    assert_contains(validate, r"Verify hubClient thin-shell SSOT", "validate job must run the hubClient thin-shell SSOT verifier")
    assert_contains(validate, r"scripts/verify/verify-hubclient-ssot.py", "validate job must call scripts/verify/verify-hubclient-ssot.ps1")
    assert_step_continue_on_error(validate, "Verify hubClient thin-shell SSOT", False)
    assert_contains(validate, r"Verify Design token SSOT", "validate job must run the design token SSOT verifier")
    assert_contains(validate, r"scripts/verify/verify-design-token-ssot.py", "validate job must call scripts/verify/verify-design-token-ssot.ps1")
    assert_step_continue_on_error(validate, "Verify Design token SSOT", False)
    assert_contains(validate, r"Verify real E2E contract", "validate job must run the real E2E contract verifier")
    assert_contains(validate, r"scripts/verify/verify-real-e2e-contract.py", "validate job must call scripts/verify/verify-real-e2e-contract.ps1")
    assert_contains(validate, r"Validate OpenAPI YAML", "validate job must keep OpenAPI YAML parsing")
    assert_contains(validate, r"Verify OpenAPI↔hub router contract", "validate job must run the OpenAPI↔hub router contract verifier")
    assert_contains(validate, r"scripts/verify/verify-openapi-contract.py", "validate job must call scripts/verify/verify-openapi-contract.ps1")
    assert_step_continue_on_error(validate, "Verify OpenAPI↔hub router contract", False)
    assert_contains(validate, r"Verify Shared Edge-free boundary", "validate job must run the Shared Edge-free boundary verifier")
    assert_contains(validate, r"scripts/verify/verify-shared-boundary.py", "validate job must call scripts/verify/verify-shared-boundary.ps1")
    assert_step_continue_on_error(validate, "Verify Shared Edge-free boundary", False)
    assert_contains(validate, r"Verify Shared barrel Edge-export ban", "validate job must run the Shared barrel Edge-export ban verifier")
    assert_contains(validate, r"scripts/verify/verify-shared-barrel.py", "validate job must call scripts/verify/verify-shared-barrel.ps1")
    assert_step_continue_on_error(validate, "Verify Shared barrel Edge-export ban", False)
    assert_contains(validate, r"Verify Hub handler layering", "validate job must run the Hub handler layering verifier")
    assert_contains(validate, r"scripts/verify/verify-hub-layering.py", "validate job must call scripts/verify/verify-hub-layering.ps1")
    assert_step_continue_on_error(validate, "Verify Hub handler layering", False)
    assert_contains(validate, r"Verify Conventions method SSOT", "validate job must run the Conventions method SSOT verifier")
    assert_contains(validate, r"scripts/verify/verify-conventions.py", "validate job must call scripts/verify/verify-conventions.ps1")
    assert_step_continue_on_error(validate, "Verify Conventions method SSOT", False)
    assert_contains(validate, r"Verify Shared REST contract Hub-client to Hub-router", "validate job must run the Shared REST contract verifier")
    assert_contains(validate, r"scripts/verify/verify-shared-rest-contract.py", "validate job must call scripts/verify/verify-shared-rest-contract.ps1")
    assert_step_continue_on_error(validate, "Verify Shared REST contract Hub-client to Hub-router", False)
    assert_contains(validate, r"Verify Shared UI hubClient gate", "validate job must run the Shared UI hubClient gate verifier")
    assert_contains(validate, r"scripts/verify/verify-shared-ui-hubclient.py", "validate job must call scripts/verify/verify-shared-ui-hubclient.ps1")
    assert_step_continue_on_error(validate, "Verify Shared UI hubClient gate", False)
    assert_contains(validate, r"check-secrets\.sh", "validate job must keep secret guard")
    # coverage baseline gate now lives in frontend-coverage (see above);
    # validate must not re-introduce it.

    assert_contains(mobile, r"(?m)^\s+timeout-minutes:\s+45\s*$", "frontend-mobile job must have a hard timeout")
    assert_contains(get_step_block(mobile, "Screenshot visual QA (mobile)"), r"(?m)^\s+timeout-minutes:\s+12\s*$", "mobile visual QA must have a hard timeout")
    assert_contains(get_step_block(mobile, "E2E (mock hub)"), r"(?m)^\s+timeout-minutes:\s+10\s*$", "mobile mock-hub E2E must have a hard timeout")
    assert_contains(mobile, r"github.event_name == 'workflow_dispatch'", "frontend-mobile full suite must stay workflow_dispatch-only")

    assert_contains(mobile_light, r"Frontend \(mobile light\)", "frontend-mobile-light must use a clear job name")
    assert_contains(mobile_light, r"needs:\s+changes", "frontend-mobile-light must depend on unified changes job")
    assert_contains(mobile_light, r"needs.changes.outputs.mobile", "frontend-mobile-light must path-filter on mobile")
    assert_contains(mobile_light, r"(?m)^\s+timeout-minutes:\s+15\s*$", "frontend-mobile-light job must have a hard timeout")
    assert_contains(mobile_light, re.escape("pnpm --filter agenthub-mobile-rn typecheck"), "frontend-mobile-light must typecheck mobile")
    assert_contains(mobile_light, re.escape("pnpm --filter agenthub-mobile-rn test"), "frontend-mobile-light must run mobile unit tests")
    assert_not_contains(mobile_light, r"npx expo export", "frontend-mobile-light must not run Expo export")
    assert_not_contains(mobile_light, r"scripts/visual-qa\.mjs", "frontend-mobile-light must not run mobile visual QA")
    assert_not_contains(mobile_light, r"playwright install --with-deps", "frontend-mobile-light must not install Playwright")

    assert_contains(backend_perf, r"Backend perf/leak gates", "backend-perf-leak-gates must use a clear job name")
    assert_contains(backend_perf, r"github.event_name == 'workflow_dispatch'", "backend-perf-leak-gates must be workflow_dispatch-only")
    assert_contains(backend_perf, re.escape("verify-backend-perf-leak-gates.py"), "backend-perf-leak-gates must run the perf/leak script")
    assert_contains(backend_perf, r"(?m)^\s+timeout-minutes:\s+20\s*$", "backend-perf-leak-gates must have a hard timeout")
    assert_not_contains(backend_perf, r"load-test", "backend-perf-leak-gates must not claim load/capacity smoke")

    assert_contains(changes, r"dorny/paths-filter@", "changes job must use dorny/paths-filter (major governed by #1580 runtime gate)")
    assert_contains(changes, re.escape("app/shared/src/workbench/**"), "changes job must watch workbench paths")
    assert_contains(changes, re.escape("app/shared/src/styles/**"), "changes job must watch shared styles")
    assert_contains(changes, re.escape("app/web/scripts/visual-qa*"), "changes job must watch web visual-qa scripts")
    assert_contains(changes, re.escape("app/desktop/scripts/visual-qa*"), "changes job must watch desktop visual-qa scripts")
    assert_contains(changes, re.escape(".github/workflows/checks.yml"), "changes job must watch checks.yml")
    assert_contains(changes, re.escape("hub-server/**"), "changes job must watch hub-server paths")
    assert_contains(changes, re.escape("edge-server/**"), "changes job must watch edge-server paths")
    assert_contains(changes, re.escape("pkg/**"), "changes job must watch shared pkg module")
    assert_contains(changes, re.escape("go.work"), "changes job must watch go.work files")
    assert_contains(changes, re.escape("app/mobile-rn/**"), "changes job must watch mobile-rn paths")
    assert_contains(changes, r"(?m)^\s+mobile:\s*$", "changes job must expose mobile output")

    assert_contains(visual_shell, r"Visual QA shell \(web, path-filtered\)", "visual-qa-shell must use a clear job name")
    assert_contains(visual_shell, r"needs:\s+changes", "visual-qa-shell must depend on unified changes job")
    assert_contains(visual_shell, r"Install Playwright Chromium", "visual-qa-shell must install chromium only")
    assert_contains(visual_shell, re.escape("playwright install --with-deps chromium"), "visual-qa-shell must install chromium only")
    assert_contains(visual_shell, re.escape("pnpm visual:qa:shell"), "visual-qa-shell must run visual:qa:shell")
    assert_contains(visual_shell, re.escape("pnpm assert:visual:qa:shell"), "visual-qa-shell must assert non-blank screenshots")
    assert_contains(visual_shell, r"Upload visual QA shell screenshots", "visual-qa-shell must upload artifacts")
    assert_contains(visual_shell, r"web-visual-qa-shell-screenshots", "visual-qa-shell must name the artifact")
    assert_contains(visual_shell, r"(?m)^\s+timeout-minutes:\s+20\s*$", "visual-qa-shell job must have a hard timeout")
    assert_contains(get_step_block(visual_shell, "Capture web visual:qa:shell"), r"(?m)^\s+timeout-minutes:\s+15\s*$", "visual-qa-shell capture step must have a hard timeout")
    assert_not_contains(visual_shell, r"pixel[-_ ]?golden", "visual-qa-shell must not fail on pixel golden")
    assert_not_contains(visual_shell, r"toHaveScreenshot", "visual-qa-shell must not use Playwright pixel golden matchers")
    assert_not_contains(visual_shell, r"windows-latest", "visual-qa-shell must stay on ubuntu for cost control")

    print("ci gate policy ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
