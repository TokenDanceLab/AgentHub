# AgentHub Progress Tracker

> **Last updated**: 2026-08-05
> **Mode**: `GITHUB_FULL`
> **Authority**: current source and tests > this tracker > historical analysis. Use `git status`, `git log`, and live GitHub state before acting.

## Current objective

Restore a trustworthy green main branch, then reduce maintenance cost through single-source test infrastructure, database fixtures, frontend ownership boundaries, and deployment SSOT. Do not restart closed polish waves or copy their chronology back into this file.

## Main branch recovery

| Surface | Current evidence | Owner / next action |
|---|---|---|
| ~~CI policy parser~~ | **RESOLVED 2026-08-02** — root cause confirmed (sibling job comments leaked into the previous PowerShell job block; Bash held a stale duplicate); PowerShell is the implementation SSOT, Bash is a launcher | merged in #1481 |
| ~~Doc SSOT~~ | **RESOLVED 2026-08-02** — MASTER.md compacted below the 150-line gate; only live work and pointers remain | merged in #1482/#1492 |
| ~~Desktop typecheck~~ | **RESOLVED 2026-08-02** — strict TypeScript restored without disabling strictness; `exactOptionalPropertyTypes` debt fixed by typing | merged in #1484 |
| ~~Shared frontend tests~~ | **RESOLVED 2026-08-02** — CSS-contract fixture 路径改 `import.meta.url` 相对路径（不再依赖 runner cwd）；`vitest.workspace.ts` 收拢为 `app/vitest.config.ts` projects 结构，app 测试命令显式化；coverage 基线实测刷新（shared 72.07→76.43 / web 63.61→66.96 / desktop 67.13→71.91 lines，0 skipped） | merged in #1498 |
| ~~Edge tests on Linux~~ | **RESOLVED 2026-08-02** — backup permission-mode test portability (#1491's CI sweep verified); ACP request-sequence race fixed by recording the method before answering (`acp_client_test.go`) | merged in #1491 |
| ~~Hub integration~~ | **RESOLVED 2026-08-02** — errcode lowercase contract, admin fixture (AGENTHUB_ADMIN_USERS), OIDC config injection, refresh_token FK device seeding, OIDC E2E UUID/scopes/shared-cache SQLite, TeamRun guardrail messages, execution-target ping projection | merged in #1489 |
| ~~TokenDance ID defaults~~ | **RESOLVED 2026-08-02** — issuer default switched to id.tokendancelab.com; check-secrets.sh now exempts `*_URL` endpoint assignments (TOKENDANCE name contains "token" → false positive) | merged in #1480 |
| ~~Frontend coverage gate~~ | **RESOLVED 2026-08-02** — web 63.14→66.72 lines (executionTargetQueries/hubAuth/toastStore tests, #1490); desktop tests (#1488); master CI green on 36a24a4b | merged #1490/#1488 |
| ~~Frontend coverage truth (#1535)~~ | **RESOLVED 2026-08-02** — include contract: 4 包按 production `src/**/*.ts(x)` 全量计入分母（factory `app/test-config/coverage.ts`）；绝对下限 + baseline 非回归 + uncovered_files ratchet + 负向自测；未导入模块暴露 web 64.69 / desktop 49.29 / mobile 36.19 / shared 76.43 lines | merged in #1552 |
| ~~Edge lint debt~~ | **RESOLVED 2026-08-02** — 102→0 golangci-lint issues via pure extraction refactors (RegisterRoutes 69→14 sub-functions, PostRuns 123→~12, parseSSEStream 74→state+handlers…); `*.go text eol=lf` in .gitattributes fixes Windows CRLF gofmt churn | merged in #1491 |
| CI quality-debt ratchet (#1536) | **PHASE 1 IN REVIEW 2026-08-03** — soft gates and exact-file golangci exclusions are registered with issue/owner/introduced_at/review_by; CI self-tests unregistered gates, directory widening, linter drift, zombie entries, runtime dependency mutation, budget increase and unexplained deadline extension. Edge lint is hard-fail. Conventional Commit verification is path-independent and fail-closed in `validate` (#1576). All complexity exclusions repaid 2026-08-04 (#1606 hub / #1611 edge; `quality-debt-baseline.json` `golangci_exclusions` now empty; negative self-tests use a synthetic fixture row). Remaining debt stays separate: Edge race #1571, Hub lint findings #1573, gosec findings #1574, Desktop lint #1575 | #1570; #1536 remains open |

## Active product and architecture work

| Track | State | Link |
|---|---|---|
| Agent-team subtask live stream | SPEC merged；Phase A 已合入 master；剩余 Phase B/C 按 SPEC 推进 | docs/plan/agentteam-live-streaming.md |
| ACP migration | 管理员已批增量路线；spike 验证状态见 03-runtime-adapters.md §ACP 迁移 | docs/architecture/03-runtime-adapters.md |
| Targeted adapter extraction | A-V1 已裁决（#1523）：lifecycle 不拆；Step 0 合同 SSOT 抽离完成（#1526：合同迁入 `internal/orchestration`，adapters alias 零调用点改动，3 项回归门禁）；Step 2 完成（#1566：13 个 orchestrator 源文件 + plan_approval.go 迁入 `internal/adapters/orchestrator` 叶子包，叶子仅依赖合同与窄 ports，composition root 装配，`scripts/verify/verify-orchestrator-deps.ps1` 依赖方向门禁 + 负向自测）—— 已关闭 | #1526 → #1566 |
| Shared boundary hardening | A-V3 已裁决（#1523）：拒绝全量 shared 三分；quick-wins 与隔离门禁硬化均已落地（apiClient.ts 删除、`workspace:*` 显式依赖、edge 隔离门禁违规 exit 1 + 正负向自测） | #1525 |
| Release signing | SPEC merged；实施依赖管理员提供签名证书/密钥，按 SPEC 阶段推进 | docs/plan/proposal-desktop-release-signing.md |
| Workbench 契约切片（projects 先行） | #1546 完成：shared Workbench 对 concrete HubClient 的 type/value 引用清零，改用窄领域端口 `WorkbenchProjectsPort`（`shared/workbench/workbenchProjectsPort.ts`），Desktop/Web composition root 各实现一个 adapter 注入；projects route 单一 ownership（parent-managed 或 port，不再运行时猜测）；load-more 失败可见、可重试（UI + i18n zh/en）；`verify-shared-ui-hubclient.ps1` 升级为同时禁止 type 引用。这是 #1528 的 projects slice（agents/catalog 收口后续单独切片） | #1546, #1528 |
| WebSocket incremental sync | SPEC merged；实施按 SPEC 阶段（B1-B6/F1-F4）推进 | docs/plan/proposal-ws-incremental-sync.md |
| IM bridge (Feishu first) | SPEC merged；实施按 SPEC 阶段推进 | docs/plan/proposal-im-bridge.md |
| Automations and session import | Product backlog | backlog：SPEC 待写 |
| @提及=派单交互 | Product backlog | backlog：SPEC 待写 |

## Maintainability program

### Test architecture

1. Keep Vitest 4, Playwright 1.60, Go `testing`, and Testify. Framework replacement is not the objective.
2. Give test commands explicit evidence names: `unit`, `component`, `contract`, `integration`, `renderer-e2e`, `packaged-e2e`, and `approved-real`.
3. Default tests must be deterministic and must not start the real Edge process, bind fixed ports, or silently require PostgreSQL/Redis.
4. Consolidate repeated Vitest and Playwright configuration through shared factories/projects; platform files retain only platform differences.
5. Coverage must include all production source, including unimported modules. Baseline non-regression is additive, not a replacement for absolute thresholds.
6. CI must prove that intended suites executed; a zero-test package or skipped real dependency must not be reported as a passing integration gate.

### Database tests

Catalog-driven 表清理（#1485/#1486/#1489）、integration lane 移入 `hub-server/tests/integration/`（#1524）、弱断言修复（#1533：WS upgrade / agent-task callbacks / buffer-full / heartbeat / Redis seq；integration 全量 126 PASS）均已落地。

1. Introduce composable SQLite fixture modules for auth, messaging, and agent-team tests instead of maintaining dozens of shadow schemas.
2. Keep a PostgreSQL schema contract for migration, index, UUID, FK, and dialect semantics. Do not move every fast test to Testcontainers.
3. Add race evidence to concurrency tests after isolation is trustworthy.

### Frontend architecture

1. Close logout behavior on Desktop and Web with one session action: server logout, token/cache cleanup, transient-store reset, then UI transition.
2. Stop exposing mutable store internals; state changes must go through commands that publish a new snapshot.
3. Remove confirmed orphan Desktop surfaces and add a production-entry dead-code baseline before broad UI refactors.
4. Reduce the 56-prop workbench contract incrementally through domain assemblers (`session`, `conversation`, `agents`, `projects`, `market`, `transcript`, `runtimeEvidence`).
5. Move CSS ownership to existing component boundaries in small slices. Each UI slice needs Web and Desktop behavior tests plus `1440x810` light/dark Visual QA.

#### Visual QA gate 状态

Visual QA gate **89/100 Ship**（Phases 74-78，2026-07-20）已收口为历史波次；剩余 Type/Motion/Empty 需交互测试。规则见 `AGENTS.md` §5；已完成波次指针见 `docs/roadmap.md` 已完成波次表。

### Deployment and knowledge SSOT

1. Align `deployments/production/docker-compose.yml` with the non-secret live service shape and make CI validate that authoritative template（#1480 已完成，issuer 默认值已切换）。
2. Rename or narrow workflows that only publish images/readiness reports; do not label an `echo` step as a production deployment.
3. Keep live topology in the external server STATE. Product docs should link to it instead of copying Azure/local-PG claims.
4. This file contains current work only. Completed wave narratives belong in Git history or the external archive indexed by `docs/history.md`.

## Evidence boundaries

| Label | Meaning |
|---|---|
| `fixture_only` | Deterministic fixture or mocked dependency; never real login or production runtime proof |
| `integration` | Real declared dependencies such as ephemeral PostgreSQL/Redis; not production |
| `renderer_e2e` | Browser/Vite renderer behavior; not packaged Tauri evidence |
| `packaged_release` | Built desktop package exercised on the target OS |
| `approved_real` | Explicitly approved real external account/service flow with secrets protected |

## Closeout rule

A slice closes only when its red reproduction, green verification, affected SSOT, GitHub issue/PR, and evidence label agree. Completed chronological detail must not be appended here.
