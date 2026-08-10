# AgentHub Progress Tracker

> **Last updated**: 2026-08-09
> **Mode**: `GITHUB_FULL`
> **Authority**: current source and tests > this tracker > historical analysis. Use `git status`, `git log`, and live GitHub state before acting.

## Current objective

Restore a trustworthy green main branch, then reduce maintenance cost through single-source test infrastructure, database fixtures, frontend ownership boundaries, and deployment SSOT. Do not restart closed polish waves or copy their chronology back into this file.

## Main branch recovery

RESOLVED 2026-08-04 — CI parser / doc SSOT / desktop typecheck / shared tests / edge tests / hub integration / TokenDance ID defaults / frontend coverage gate & truth / edge lint / CI quality-debt ratchet 全部收口；PR #1480–#1611，细节见 `git log` 与 #1536 closed。

Wave5/6 收口（working tree，未提交）— PR 段 #1612–#1666；下列 track 在工作树落地，待提交验证后收口：

- 迁移收尾（0061-0066 / toolchain 1.26.5 / 安全门禁四修）：迁移触发器双炸弹修复链 + Go toolchain 升级 + CI 门禁接线；详见 CHANGELOG `[Unreleased]`。
- 安全加固 track（AuthFailClosed/PKCE/RS256/err.Error 清洗/rate limit code/edge debug auth）：hub access-token 校验失败即拒；PKCE 强制；RS256 JWKS；err.Error 清洗；rate limit code 规范化；edge debug 端点分层鉴权（Dev→nil / LocalAuthToken→Bearer / HubJWTSecret→hub-JWT 校验）。
- 可观测性 track（request_id 关联/persist 重试/离线队列 cap/health 503/截断指标/23505 重试）：request_id 跨层关联；persist 重试与离线队列 cap；`/health` 503 降级；截断指标暴露；PostgreSQL 23505 唯一冲突重试。
- 契约对齐 track（List 形状/Message schema/429 文档/107 op 错误响应/Check E）：List 响应形状统一；Message schema 收敛；429 文档化；107 op 错误响应规范；Check E 边界。

## Active product and architecture work

| Track | State | Link |
|---|---|---|
| Agent-team subtask live stream | SPEC merged；issue 已归档，实施 tracker 以 docs/plan/agentteam-live-streaming.md 为准 | docs/plan/agentteam-live-streaming.md |
| ACP migration | SPEC merged；issue 已归档，实施 tracker 以 docs/architecture/03-runtime-adapters.md §ACP 迁移 为准 | docs/architecture/03-runtime-adapters.md |
| Targeted adapter extraction (A-V1) | closed 2026-08-04 — lifecycle 不拆；Step 0 合同 SSOT（#1526）+ Step 2 orchestrator 叶子包迁移（#1566）落地 | #1523/#1526/#1566 · `docs/decisions.md` |
| Shared boundary hardening (A-V3) | closed 2026-08-04 — 拒绝全量 shared 三分；quick-wins + edge 隔离门禁落地 | #1523/#1525 · `docs/decisions.md` |
| Release signing | SPEC merged；实施依赖管理员提供签名证书/密钥，按 SPEC 阶段推进 | docs/plan/proposal-desktop-release-signing.md |
| Workbench 契约切片（projects 先行） | #1546 完成：shared Workbench 对 concrete HubClient 的 type/value 引用清零，改用窄领域端口 `WorkbenchProjectsPort`（`shared/workbench/workbenchProjectsPort.ts`），Desktop/Web composition root 各实现一个 adapter 注入；projects route 单一 ownership（parent-managed 或 port，不再运行时猜测）；load-more 失败可见、可重试（UI + i18n zh/en）；`verify-shared-ui-hubclient.py` 升级为同时禁止 type 引用。这是 #1528 的 projects slice（agents/catalog 收口后续单独切片） | #1546, #1528 |
| WebSocket incremental sync | SPEC merged；issue 已归档，实施 tracker 以 docs/plan/proposal-ws-incremental-sync.md 为准 | docs/plan/proposal-ws-incremental-sync.md |
| IM bridge (Feishu first) | SPEC merged；issue 已归档，实施 tracker 以 docs/plan/proposal-im-bridge.md 为准 | docs/plan/proposal-im-bridge.md |
| WSL 全栈 E2E（真实 OIDC 登录） | closed 2026-08-06 — 全栈真实 OIDC PKCE 登录流 18 断言过 · `real_tokendance_id_login=true`（integration 级） | docs/plan/proposal-wsl-full-stack-e2e.md |
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

1. Introduce composable SQLite fixture modules for auth, messaging, and agent-team tests instead of maintaining dozens of shadow schemas. Keep a PostgreSQL schema contract for migration/index/UUID/FK/dialect semantics; do not move every fast test to Testcontainers.
2. Add race evidence to concurrency tests after isolation is trustworthy.

### Frontend architecture

1. Close logout behavior on Desktop and Web with one session action: server logout, token/cache cleanup, transient-store reset, then UI transition.
2. Stop exposing mutable store internals; state changes must go through commands that publish a new snapshot. Remove confirmed orphan Desktop surfaces and add a production-entry dead-code baseline before broad UI refactors.
3. Reduce the 56-prop workbench contract incrementally through domain assemblers (`session`, `conversation`, `agents`, `projects`, `market`, `transcript`, `runtimeEvidence`). **Step 1 已完成**（首个 domain assembler 切片落地，见前端通道交付）。
4. Move CSS ownership to existing component boundaries in small slices. Each UI slice needs Web and Desktop behavior tests plus `1440x810` light/dark Visual QA.

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
