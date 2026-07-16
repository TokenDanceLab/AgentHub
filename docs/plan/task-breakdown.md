# Task Breakdown — AgentHub Cleanup Baseline

> last-updated: 2026-07-16
> program: knowledge-first strangler cleanup + lightweight wiki (non-SSOT)
> tracking: GITHUB_FULL (Issues + Milestones + Project board)
> hard rule: **NO big-bang rewrite**
> reality: Phases 1–6 complete (#424–#445); Phase 7 closeout in progress (#447–#451)

## Overview
- **Total Phases**: 7 (Phases 1–6 baseline complete; Phase 7 = CI green + SDD closeout)
- **Total Tasks**: 27 (22 baseline #424–#445 + 5 Phase 7 #447–#451)
- **Baseline Closed**: 22 / 22 (Phases 1–6)
- **Estimated Total Effort**: L (multi-PR, multi-week strangler)
- **Strategy**: Strangler Fig + Spec-Driven Develop + GitHub Project board
- **Live status SSOT**: `docs/progress/MASTER.md` + GitHub Project board

## S.U.P.E.R Design Constraints
- **S**: 每个切片只解决一个 seam（client SSOT / handler 路由组 / outbox 接线…）
- **U**: Hub/Edge/platform 依赖方向不可逆转；Web 永不依赖 Local Edge
- **P**: 先合同（OpenAPI/events/AgentHubPlatform/capability claims）再实现
- **E**: 不写死主机/密钥；生产事实指针到 server STATE
- **R**: 可替换 adapters / thin platform shells；禁止再分叉 shared UI

## Testing and Governance Constraints
- 行为变更默认要测试；docs-only 任务写明验证命令
- 真实登录/真实 CLI/model 必须 approved-real 证据等级
- 稳定规则写入 `AGENTS.md`；运维事实不进 git
- wiki 只编译、不覆盖 SSOT
- **禁止无 Issue 的自由发挥重构**；Workflow/subagent 只能执行已建 Issue

## Phase 1: Governance Lock (GITHUB_FULL) — COMPLETE
**Goal**: 把清理程序从 ad-hoc Workflow 切到 SPEC + GitHub Project 正规管理
**Prerequisite**: analysis 四件套 + hygiene baseline commits
**S.U.P.E.R Focus**: E/R（权威面与可替换工作流）
**Issues**: #424–#426 (closed)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T1.1 | 建立 GitHub Project + labels/milestones/issues，并把 MASTER 改为 GITHUB_FULL 索引 | P0 | M | — | A | E,R | process/docs: `gh issue list --label spec-driven` | Update native memory + MASTER | Project board 存在；任务均有 Issue；MASTER 指向 Project/Milestones |
| T1.2 | 冻结 ad-hoc fleets：实现只允许 issue-bound PR；更新 cleanup-strategy 执行协议 | P0 | S | T1.1 | A | R | docs: `git diff --check` | Update progress/strategy | cleanup-strategy 写明 “Workflow 仅实现已建 Issue” |
| T1.3 | 统一镜像名/CD 叙事决策记录（agenthub-hub-server SSOT） | P1 | S | — | B | E | docs dry-read of CD workflows | None | decision 写入 plan；cd-production 与 compose 命名差异有明确 owner |

### Parallel Lanes
| Lane | Tasks | Merge Risk | Key Files |
|:-----|:------|:-----------|:----------|
| A | T1.1, T1.2 | Low | `docs/progress/MASTER.md`, `docs/analysis/cleanup-strategy.md` |
| B | T1.3 | Low | `docs/plan/*`, CD docs |

## Phase 2: Truth & Hygiene residual — COMPLETE
**Goal**: 清完 P0 叙事/脏树/权威面残留
**S.U.P.E.R Focus**: E
**Issues**: #427–#429 (closed)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T2.1 | 主工作区 dirty 政策：src-tauri/gen android 删除策略 + hub-server binary ignore | P0 | S | T1.1 | A | E | `git status` 政策文档化；必要时更新 `.gitignore` | Optional | 政策写入 MASTER；不提交二进制 |
| T2.2 | 中和 `.agenthub/memory/project.md` 为指针（禁止 SUPER 假进度） | P1 | S | — | B | E | docs-only | Update memory surface | 无 active SUPER phase 假叙述 |
| T2.3 | 降级 `hub-server/deployments/*` 旧 prod 模板 banner（非权威） | P1 | S | T1.3 | A | E | docs-only | None | banner 指向 `deployments/production` + server STATE |

## Phase 3: Frontend strangler (hubClient SSOT) — COMPLETE
**Goal**: 按 frontend-dedupe-plan 收敛 client，不改 UX
**S.U.P.E.R Focus**: S,P,R
**Issues**: #430–#433 (closed)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T3.1 | hubClient 类型/导出对齐 + 方法矩阵 + freeze 注释（无 caller 大爆炸） | P0 | M | T1.1 | A | S,P,R | shared unit/export 或 typecheck | None | `docs/analysis/hubclient-ssot-slice1.md`；desktop/web 注释禁止新方法 |
| T3.2 | shared hubClient 方法补齐 + contract tests | P0 | L | T3.1 | A | P,R | shared vitest contract | None | shared 覆盖 desktop∩web 主干方法；测试绿 |
| T3.3 | Desktop thin re-export cutover | P1 | M | T3.2 | B | R | desktop typecheck + focused tests | None | desktop 不再维护完整 fork |
| T3.4 | Web thin re-export cutover + AH-SR-043 demo mutation fail-closed | P0 | M | T3.2 | C | R,S | web typecheck + unit/e2e fixture | risk notes if needed | 生产 mutation 不静默 demo 成功 |

### Parallel Lanes
| Lane | Tasks | Merge Risk | Key Files |
|:-----|:------|:-----------|:----------|
| A | T3.1→T3.2 | Med | `app/shared/src/hubClient.ts` |
| B | T3.3 | Med | `app/desktop/src/api/**` |
| C | T3.4 | Med | `app/web/src/api/**`, platform |

## Phase 4: Edge seams + security half-loops — COMPLETE
**Goal**: god-file 可维护 + capability/outbox 半闭环可继续
**S.U.P.E.R Focus**: S,U,P
**Issues**: #434–#437 (closed)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T4.1 | Edge split plan 固化 + handlers 路由组机械拆分（不改 OpenAPI） | P1 | L | T1.1 | A | S,U | `go test ./edge-server/... -short` | None | handlers 按 runs/events/agents 等文件拆分；行为不变 |
| T4.2 | ProcessExecutor 抽 CallbackReporter/SubAgent 接口（不改语义） | P1 | L | T4.1 | A | S,P | lifecycle tests | None | process_executor 职责收敛；接口可测 |
| T4.3 | AH-SR-046 capability 闭环：Hub 签发 + dispatch header + 负例 | P0 | L | T4.1 | B | P,E | hub+edge unit + negative tests | risk register | Edge 验 + Hub 发；wrong project/device/stale 拒绝 |
| T4.4 | AH-SR-049：启动 Hub outbox retry + 失败不 silent continue；Edge journal 最小合同 | P0 | L | T4.2 | B | U,P | service/outbox tests | risk register | retry loop 在 app wiring 运行；剩余关闭条件明确 |

## Phase 5: Closure decisions & residual — COMPLETE
**Goal**: 发布门禁可解释；orphan UI 决策；程序可继续或归档
**S.U.P.E.R Focus**: R
**Issues**: #438–#440 (closed)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T5.1 | AH-SR-037 决策：BFF/HttpOnly 或 Accepted risk + 补偿控制 | P0 | M | T1.1 | A | E,R | docs + optional spike | risk register | 二选一落地并写入 register |
| T5.2 | Settings/TeamRun orphan 决策：归档或迁 shared（仅决策+最小动作） | P1 | M | T3.2 | B | R | import-graph proof | None | 无双活 Settings 误导；TeamRun owner 明确 |
| T5.3 | 专项收口：MASTER/Project 状态同步；history 归档计划 | P1 | S | T5.1 | A | E | process | history index when archiving | 完成项 closed；剩余项有 owner |

## Phase 6: Baseline Hardening — COMPLETE
**Goal**: 收紧 Phase 3–5 残留：frontend tsc 绿、orphan 类型依赖解除、capability purpose 强制、journal 持久化
**S.U.P.E.R Focus**: S,P,R
**Issues**: #441–#445 (closed) · GitHub milestone 27
**Landed commits** (see MASTER): `83f5e1ea` (#441/#442) · `8fd3625f` (#443) · `e41ed1ed` (#444) · `342cc711` (#445)

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T6.1 | 修复 desktop hubClient cutover 后 tsc 残留 | P0 | M | T3.3 | A | R | desktop typecheck | None | desktop tsc 绿；thin re-export 可编译 |
| T6.2 | 修复 web hubClient 类型与测试对齐 shared SSOT | P0 | M | T3.4 | B | R,P | web typecheck + focused tests | None | web 与 shared 类型/测试对齐 |
| T6.3 | 抽取 SectionId 并解除对 orphan SettingsPage 的类型依赖 | P1 | S | T5.2 | A | R | typecheck | None | SectionId 独立；不依赖 orphan Settings |
| T6.4 | AH-SR-046 Edge purpose=run-start 强制校验 + 负例 | P0 | M | T4.3 | C | P,E | edge unit + negative tests | risk register | 非 run-start purpose 拒绝 |
| T6.5 | AH-SR-049 Edge DeliveryJournal SQLite 最小持久化 | P1 | L | T4.4 | C | U,P | edge unit/integration | risk register | journal 落 SQLite；重启可恢复最小状态 |

### Parallel Lanes
| Lane | Tasks | Merge Risk | Key Files |
|:-----|:------|:-----------|:----------|
| A | T6.1, T6.3 | Med | `app/desktop/**`, shared SectionId |
| B | T6.2 | Med | `app/web/**`, `app/shared/**` |
| C | T6.4, T6.5 | Med | `edge-server/**` capability + journal |

## Phase 7: Baseline CI Green + SDD Closeout — IN PROGRESS
**Goal**: 让汇总 PR #446 CI 绿，并同步/归档 SPEC 文档
**S.U.P.E.R Focus**: E,R
**Issues**: #447–#451 (open) · GitHub milestone 28

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| T7.1 | Fix shared hubClient envelope OK/ok + desktop/web contract tests for PR #446 | P0 | M | T6.2 | A | P,R | shared/desktop/web vitest | None | envelope 字段兼容；contract tests 绿 |
| T7.2 | Fix docs trailing whitespace so PR #446 validate job passes | P0 | S | — | B | E | `git diff --check` | None | validate job 无 trailing whitespace 失败 |
| T7.3 | Sync docs/plan milestones + task-breakdown to Phase 6 complete state | P1 | S | T6.5 | C | E | docs-only | None | plan 文档与 MASTER/#424–#445 一致 |
| T7.4 | SDD archive cleanup-baseline analysis/plan/progress snapshots | P1 | M | T7.3 | C | E,R | docs dry-read | Optional archive index | 归档快照不覆盖 SSOT |
| T7.5 | Re-verify PR #446 CI green after T7.1–T7.4 and fix remaining failures | P0 | M | T7.1,T7.2,T7.3,T7.4 | D | E | full PR checks | None | PR #446 CI 绿或剩余失败有明确 owner |

## Issue index (baseline + closeout)
| Phase | Tasks | Issues | Status |
|:------|:------|:-------|:-------|
| 1 | T1.1–T1.3 | #424–#426 | closed |
| 2 | T2.1–T2.3 | #427–#429 | closed |
| 3 | T3.1–T3.4 | #430–#433 | closed |
| 4 | T4.1–T4.4 | #434–#437 | closed |
| 5 | T5.1–T5.3 | #438–#440 | closed |
| 6 | T6.1–T6.5 | #441–#445 | closed |
| 7 | T7.1–T7.5 | #447–#451 | open |

## Non-goals
- 重写 Hub/Edge 协议双平面
- Mobile 深度 UI/native
- 把 `reference/` 研究克隆当产品源码清理
- 无 Issue 的自由发挥重构
