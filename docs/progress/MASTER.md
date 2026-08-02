# AgentHub Progress Tracker

> **Last updated**: 2026-08-02
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
| ~~Edge lint debt~~ | **RESOLVED 2026-08-02** — 102→0 golangci-lint issues via pure extraction refactors (RegisterRoutes 69→14 sub-functions, PostRuns 123→~12, parseSSEStream 74→state+handlers…); zero .golangci.yml exclusions; `*.go text eol=lf` in .gitattributes fixes Windows CRLF gofmt churn | merged in #1491 |

## Active product and architecture work

| Track | State | Link |
|---|---|---|
| Agent-team subtask live stream | SPEC merged (`docs/plan/agentteam-live-streaming.md`); Phase A and frontend starting slice exist; remaining protocol/UI phases require explicit scope | #1478 |
| ACP migration | Official ACP adapters exist; filesystem/terminal frames, timeout policy, registration, and approved real-run evidence remain | #1404 |
| Targeted adapter extraction | A-V1 已裁决（#1523）：lifecycle 不拆（D-V1 已解拆分动机）；adapters 定向抽取 orchestrator 子域，先解决合同导入环（PlanTask/TaskStatus 等 owner 重定），后移动文件 | #1526（原 #1471） |
| Shared boundary hardening | A-V3 已裁决（#1523）：拒绝全量 shared 三分；quick-wins 与隔离门禁硬化均已落地（apiClient.ts 删除、`workspace:*` 显式依赖、edge 隔离门禁违规 exit 1 + 正负向自测） | #1525 |
| Release signing | SPEC draft on `docs/spec-release-signing` (proposal-desktop-release-signing.md, unmerged); needs review + merge | #1403 |
| WebSocket incremental sync | SPEC draft on `docs/spec-ws-incremental-sync` (proposal-ws-incremental-sync.md, unmerged); needs review + merge | #1411 |
| IM bridge (Feishu first) | SPEC draft on `docs/spec-im-bridge` (proposal-im-bridge.md, unmerged); not yet an issue | — |
| Automations and session import | Product backlog | #1405, #1407 |

## Maintainability program

### Test architecture

1. Keep Vitest 4, Playwright 1.60, Go `testing`, and Testify. Framework replacement is not the objective.
2. Give test commands explicit evidence names: `unit`, `component`, `contract`, `integration`, `renderer-e2e`, `packaged-e2e`, and `approved-real`.
3. Default tests must be deterministic and must not start the real Edge process, bind fixed ports, or silently require PostgreSQL/Redis.
4. Consolidate repeated Vitest and Playwright configuration through shared factories/projects; platform files retain only platform differences.
5. Coverage must include all production source, including unimported modules. Baseline non-regression is additive, not a replacement for absolute thresholds.
6. CI must prove that intended suites executed; a zero-test package or skipped real dependency must not be reported as a passing integration gate.

### Database tests

Catalog-driven 表清理已落地（#1485/#1486/#1489）：`hub-server/tests/setup_test.go` 动态扫描当前 schema、排除 `schema_migrations`、`TRUNCATE ... RESTART IDENTITY CASCADE`、错误即失败，新表自动发现。

1. Split self-contained fixture tests from real PostgreSQL/Redis integration tests; remove the package-wide `-short` escape hatch.
2. Introduce composable SQLite fixture modules for auth, messaging, and agent-team tests instead of maintaining dozens of shadow schemas.
3. Keep a PostgreSQL schema contract for migration, index, UUID, FK, and dialect semantics. Do not move every fast test to Testcontainers.
4. Add race evidence to concurrency tests after isolation is trustworthy.

### Frontend architecture

1. Close logout behavior on Desktop and Web with one session action: server logout, token/cache cleanup, transient-store reset, then UI transition.
2. Stop exposing mutable store internals; state changes must go through commands that publish a new snapshot.
3. Remove confirmed orphan Desktop surfaces and add a production-entry dead-code baseline before broad UI refactors.
4. Reduce the 56-prop workbench contract incrementally through domain assemblers (`session`, `conversation`, `agents`, `projects`, `market`, `transcript`, `runtimeEvidence`).
5. Move CSS ownership to existing component boundaries in small slices. Each UI slice needs Web and Desktop behavior tests plus `1440x810` light/dark Visual QA.

#### Visual QA gate 状态

当前 Visual QA gate: **89/100 Ship**（Phases 74-78，2026-07-20）。7/9 维度满分。剩余 Type/Motion/Empty 需交互测试或跨组件改动，已触及静态截图方法论天花板。规则本身见 `AGENTS.md` §5 前端规范（UI 改动用自动化 Playwright + Visual QA 证明）。

### Deployment and knowledge SSOT

1. Land #1480 before editing the overlapping issuer line in the production compose template.
2. Align `deployments/production/docker-compose.yml` with the non-secret live service shape and make CI validate that authoritative template.
3. Rename or narrow workflows that only publish images/readiness reports; do not label an `echo` step as a production deployment.
4. Keep live topology in the external server STATE. Product docs should link to it instead of copying Azure/local-PG claims.
5. This file contains current work only. Completed wave narratives belong in Git history or the external archive indexed by `docs/history.md`.

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
