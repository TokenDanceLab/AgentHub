# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete** (docs authority + mobile hubClient strangler)
> **Started**: 2026-07-16 (Visual polish); residual program 2026-07-20; closed 2026-07-21
> **Last Updated**: 2026-07-27
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`

## Progress index (no open residual program)

| Item | Value |
|---|---|
| Active SPEC | **PROPOSAL open (do not implement until approved)** — #1412 WS 增量同步 · #1413 Desktop 签名发布 · #1414 IM 反向桥接 |
| Closed residual analysis | [post-polish-project-overview](../analysis/post-polish-project-overview.md) · [module-inventory](../analysis/post-polish-module-inventory.md) · [risk-assessment](../analysis/post-polish-risk-assessment.md) |
| Closed residual plan | [task-breakdown](../plan/post-polish-task-breakdown.md) · [dependency-graph](../plan/post-polish-dependency-graph.md) · [milestones](../plan/post-polish-milestones.md) |
| Strategy (delivered) | Strangler Fig — thin mobile hubClient + docs authority; **no** big-bang rewrite; **no** static Visual QA chase past 89 |
| Tracking | Issues **#1335–#1339** (closed) · GH milestones **98–99** (closed) · PRs **#1340** / **#1341** / **#1342** |
| Live tip | master `45b6c697`（#1417 CJK） |

### Residual phases (closed 2026-07-21)

| Phase | Name | Milestone | Issues | Status |
|:------|:-----|:----------|:-------|:-------|
| 79 | Docs Authority + Gates Hygiene | 98 | #1335 #1336 | **closed** · PR #1340 |
| 80 | Mobile hubClient Strangler | 99 | #1337 #1338 #1339 | **closed** · PR #1341 (~737→~342 LOC Proxy thin) |

### Closed polish phases (2026-07-20)

| Phase | Name | Status |
|:------|:-----|:-------|
| 73 | Engineering loop host ports + import entry | closed |
| 74 | Light frosted glass + Visual QA | closed |
| 75 | HiDPI fidelity + typography | closed |
| 76 | Chat + Inspector density | closed |
| 77 | Agents density + blank browser + terminal dock | closed |
| 78 | A11y focus + Glass border/shadows/elevation + CI path-filter | closed |

Historical cleanup-baseline plan under `docs/plan/task-breakdown.md` (and siblings) is **HISTORICAL only** — not live backlog.

**No open residual-program phases.** Next work: pick from roadmap P0/P1 (E2E contract, chat reliability, deploy-only security evidence) — not static Visual QA past 89.

## Codebase audit sweep (2026-07-26)

9 份并行审计（mobile / Go 后端 / docs-CI / 前端 / WS / 依赖 / agentteam / 跨切面架构 / 测试真实性）驱动的 in-repo 清理，当日交付 **18 个 PR**，净删约 **12,000 行**。不是新 SPEC program，是一次性清扫；未竟项全部落 issue。

### Delivered

| 类别 | PR | 结果 |
|---|---|---|
| 死代码 | #1374 | web 前 Workbench 层 68 文件 / 10,673 LOC（IM 目录、13 个遗留组件、wsEventBridge/hubAdapters 旧管线） |
| 产品缺陷 | #1368 #1376 #1380 #1355 | WS Accept 层未协商 bearer subprotocol（浏览器首选鉴权路径握手即坏）· agentteam approve 后投影永久卡 `pending_review` + 终态可覆写 + CompleteAssignment 不可达 · web 已读跨会话写错 seq 且未读永不清 · openai adapter 漏 `SanitizeMessage`（anthropic 孪生已有） |
| 诚实性 | #1366 #1373 | 启动健康门 `DB()` 错误静默跳过仍报 ok · outbox 7 处投递吞错 · SQLite persist 吞错（PatchSettings 不再假 200）· 删除 OIDC 迁移后打向已删路由的口令测试 |
| 契约 | #1381 #1382 #1386 | `:ping`/`:ack` 必 404 路径修正 + 死 auth surface 清除 · agentteam TS 补 `pending_review`/`mode`/`route_audit_log`/`reviews` · openapi 补 9 个 operation 并据实改写 `/client/ws` 认证描述 |
| 供应链 | #1370 #1377 #1346 #1351 | dompurify 死依赖清除 + 6 组 pnpm overrides + vite 6.4.3（清 ~23 条 alert）· TablePreview 文件大小上限缓解 xlsx · 2 条 Go alert 经 `go mod why` 证据 dismiss |
| 仓库卫生 | #1381 #1350 #1364 | `edge.db-wal`(922KB)+`db-shm` 出库 + `.gitignore` 补模式 · CI go filter 补 `pkg/**`/`go.work*`（堵 CD 未测直推镜像窗口）· 死链与失效指针清理 |
| 可观测 | #1378 | WS 帧填充 per-conn `seq_id`（gap 检测此前不可能）+ 丢帧采样日志 |

### Closed after audit sweep（2026-07-26 → 2026-07-27）

| 主题 | 结果 |
|---|---|
| agentteam seq UNIQUE + 条件写 | **closed** · #1401 · #1419 · Closes #1383 |
| hub tests 口令依赖 OIDC 化 | **closed** · #1402 · Closes #1369 |
| openapi query-token / 悬空 `$ref` | **closed** · #1400 · #1387/#1388 |
| transport 下沉 shared | **closed** · #1416 · Refs #1395（hooks 直测仍 open） |
| 流式 16ms microbatch | **closed** · #1418 · Closes #1415 |
| CJK Markdown 渲染 | **closed** · #1417 · Closes #1409 |

### Open follow-ups（issue-tracked）

| 主题 | Issue / PR | 状态 |
|---|---|---|
| Empty 四态矩阵接到市场真表面 | #1410 · PR #1420 | open / CI |
| WS 死协议面 / logout 不杀 socket | #1362 · #1363 | open；worktree dirty，PR 收口中 |
| agentteam assignment 生命周期 | #1384 | open |
| agentteam 投影层抽取 | #1385 | open |
| web hook 零直测残余 | #1395 | open（transport 已合，hooks 仍缺） |
| ACP spike / Automations / @提及 / 观察池 | #1404 · #1405 · #1406 · #1407 | open（产品立项） |
| PROPOSAL：WS 增量 / 签名发布 / IM 桥 | #1412 · #1413 · #1414 | open（不 merge 等批） |

### Research artifacts（off-repo）

- Codeg 竞品研究仍在 `D:\Code\Temp\codeg-research\`（9 份 md，含 SYNTHESIS）；**未进仓**，以 Issue/PR 跟踪落地项

### 审计澄清（推翻既有叙事）

- Desktop「15 个 pre-existing 测试失败」是**过期叙事**：CI 实测 225 文件 / 1927 tests 全绿，注释引用的清单文档早已删除。
- 前端三包**无 coverage 门禁**：shared 声明 60% thresholds 但 CI 无任何 `--coverage` 运行，"Coverage Enforced" 不成立。
- Web/Desktop/Shared **未患** mobile 的 replicated-helper 病，251 个测试文件仅一处同构病灶。

## Product tip & Visual QA

**Product tip**: 见 master（最近合并 #1386）
**Gate**: **89**/100 — 🟢🟢🟢 **SHIP**
**Gate history**: 55 → 76 → 79 → 82 → 84 → 85 → 87 → 88 → **89**

### Dimension grid (7/9 maxed)

| Dim | Score | Max | Status |
|-----|-------|-----|--------|
| Glass | 18 | 18 | ✅ |
| Hierarchy | 14 | 14 | ✅ |
| Spacing | 14 | 14 | ✅ |
| Light | 12 | 12 | ✅ |
| Dark | 8 | 8 | ✅ |
| A11y | 8 | 8 | ✅ |
| Empty | 5 | 6 | ⏳ multi-state needed |
| Type | 9 | 10 | ⏳ zh refinement |
| Motion | 9 | 10 | ⏳ interactive eval |

References: [visual-qa-scorecard](../analysis/visual-qa-scorecard.md) · [rescore-17-final](../analysis/visual-qa-score-2026-07-20-rescore-17-final.md) · [_archive/](../analysis/_archive/)

### Methodology ceiling

Remaining 3pt (Type/Motion/Empty) require interactive testing, multi-state data, or multi-component CJK font changes — beyond static 1440×810 screenshot evaluation. **Do not chase gate past 89** under residual program.

## Infrastructure & gates hygiene

### CI path-filter

- Unified `changes` job (`dorny/paths-filter@v3`) in `.github/workflows/checks.yml`
- Go-only PR skips frontend CI; CSS-only PR skips Go CI
- Estimated savings: up to ~20 CI minutes per PR

### Backend perf / leak gates (T79.2 evidence)

| Item | State | Note |
|---|---|---|
| `scripts/verify/verify-backend-perf-leak-gates.ps1` | **PASS** (behavior + short microbench) | Not production capacity |
| [backend-performance-gates.md](../reference/backend-performance-gates.md) | Active owner (dated 2026-06-27) | Evidence classes: behavior / microbench / load smoke / pprof |
| Capacity claim | **Not claimed** | Load smoke / pprof still path-specific; no “production capacity proven” language |

Optional future: wire script as `workflow_dispatch` only — not every PR (see residual risk assessment T5).

## Explicit out of scope (residual)

- Live OIDC / secret rotation / packaged Desktop evidence
- Full Mobile UI redesign
- Static Visual QA gate chase past 89
- Edge handlers further split without concrete API change

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-20 | 🟢🟢🟢 **Ship 89** — polish Phases 73–78 closed; CI path-filter; docs rescore archive |
| 2026-07-20 | SDD Phase 0–1: post-polish analysis trio committed |
| 2026-07-21 | Residual program delivered: Phase 79 #1340 + Phase 80 #1341; milestones 98–99 closed; hubClient ~342 LOC |
| 2026-07-21 | Closeout #1342 + SSOT sync #1343 · tip `1ac86aa5`; analysis inventory marked delivered |
| 2026-07-21 | CI: mobile light path-filter + backend perf/leak `workflow_dispatch` (T5) |
| 2026-07-26 | **Codebase audit sweep** — 9 份并行审计 → 18 PR 合入，净删 ~12,000 行；WS bearer 握手 / agentteam 审阅门 / web 已读 / openai sanitize 四处产品缺陷修复；~25 条依赖 alert 清理；922KB SQLite WAL 出库；未竟项落 #1358 #1362 #1363 #1369 #1383–#1385 #1387 #1388 |
| 2026-07-26–27 | 审计 follow-up 合入：#1400 query-token · #1401 seq UNIQUE · #1402 OIDC 测试 · #1408 门禁 hotfix · #1416 transport shared · #1418 stream microbatch · #1419 agentteam 条件写 · #1417 CJK；Empty #1420 在飞；PROPOSAL #1412–#1414 等批 |
