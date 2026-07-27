# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete**
> **Started**: 2026-07-16 · residual closed 2026-07-21 · **Last Updated**: 2026-07-27
> **Mode**: `GITHUB_FULL` · **Repo**: `TokenDanceLab/AgentHub`

## Progress index

| Item | Value |
|---|---|
| Active SPEC | **PROPOSAL open (do not implement until approved)** — #1412 WS 增量 · #1413 签名发布 · #1414 IM 桥 |
| Closed residual | [overview](../analysis/post-polish-project-overview.md) · [inventory](../analysis/post-polish-module-inventory.md) · [risk](../analysis/post-polish-risk-assessment.md) · plan trio under `docs/plan/post-polish-*` |
| Strategy | Strangler Fig; **no** Visual QA chase past 89 |
| Tracking | Issues #1335–#1339 closed · milestones 98–99 · PRs #1340/#1341/#1342 |
| Live tip | master `7a6746dd`（#1422 WS 死面） |

Phases 73–78 polish + 79–80 residual **closed**. Historical `docs/plan/task-breakdown.md` is **HISTORICAL only**. Next: roadmap P0/P1, not static QA past 89.

## Codebase audit sweep (2026-07-26)

9 路并行审计 → 当日 ~18 PR / 净删 ~12k 行；后续 follow-up 继续合入。

| 类别 | 代表 PR |
|---|---|
| 死代码 | #1374 web Workbench 68 文件 |
| 产品缺陷 | #1368 WS bearer · #1376 agentteam 审阅门 · #1380 已读 · #1355 sanitize |
| 诚实性/契约/供应链/卫生/可观测 | #1366 #1373 #1381 #1382 #1386 #1370 #1377 #1350 #1378 |

### Closed after sweep（→ 2026-07-27）

| 主题 | 结果 |
|---|---|
| agentteam 并发 | **closed** · #1401 · #1419 · #1383 |
| OIDC 测试 / query-token | **closed** · #1402 · #1400 · #1369/#1387/#1388 |
| transport shared / stream microbatch / CJK | **closed** · #1416 · #1418 · #1417 |
| Empty 四态市场真表面 | **closed** · #1410 · #1420 |
| WS 死协议面 / logout 不杀 socket | **closed** · #1362 · #1363 · #1422 |

### Open follow-ups

| 主题 | Issue / PR |
|---|---|
| agentteam 生命周期 / 投影层 | #1384 · #1385 |
| web hook 零直测残余 | #1395（transport 已合） |
| ACP / Automations / @提及 / 观察池 | #1404 · #1405 · #1406 · #1407 |
| 签名发布 / WS 增量 SPEC 排队 | #1403 · #1411 |
| PROPOSAL（不 merge 等批） | #1412 · #1413 · #1414 |

Research off-repo: `D:\Code\Temp\codeg-research\`（含 SYNTHESIS）；**未进仓**。

### 审计澄清

- Desktop「15 pre-existing fail」过期；CI 1927/1927 绿
- 前端三包无 coverage 门禁（shared 60% 声明未接线）
- Web/Desktop/Shared 未患 mobile replicated-helper 病

## Product tip & Visual QA

**Gate**: **89**/100 SHIP（55→89）。Empty 5/6 · Type 9/10 · Motion 9/10 需交互/多态/CJK——**不追 89+**。
Refs: [scorecard](../analysis/visual-qa-scorecard.md) · [rescore-17](../analysis/visual-qa-score-2026-07-20-rescore-17-final.md)

## Infrastructure

- path-filter `dorny/paths-filter@v3` in checks.yml（Go/CSS 互跳）
- backend perf/leak gates script PASS as behavior/microbench only — **no capacity claim**
- residual out of scope: live OIDC evidence · full Mobile redesign · QA>89 · edge handler split without API change

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-20–21 | Ship 89 · residual #1340/#1341 · closeout #1342/#1343 · mobile light path-filter |
| 2026-07-26 | audit sweep ~18 PR；未竟落 #1358 #1362 #1363 #1369 #1383–#1385 #1387 #1388 |
| 2026-07-26–27 | #1400–#1402 #1408 #1416–#1419 合入；#1420 Empty / #1422 WS 在飞；PROPOSAL #1412–#1414 |
| 2026-07-27 | tip `7a6746dd`；#1420 Empty · #1422 WS 收口；open 仅 #1384/#1385/#1395 立项与 PROPOSAL |
