# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete**
> **Started**: 2026-07-16 · residual closed 2026-07-21 · **Last Updated**: 2026-07-27
> **Mode**: `GITHUB_FULL` · **Repo**: `TokenDanceLab/AgentHub`

## Progress index

| Item | Value |
|---|---|
| Active SPEC | **PROPOSAL open (NEEDS_FIX, do not merge/implement)** — #1412 WS · #1413 签名 · #1414 IM |
| Closed residual | [overview](../analysis/post-polish-project-overview.md) · plan trio under `docs/plan/post-polish-*` |
| Strategy | Strangler Fig; **no** Visual QA chase past 89 |
| Live tip | master `4ac188a3`（#1433 事件幂等文档） |

Phases 73–80 **closed**. Historical `docs/plan/task-breakdown.md` is **HISTORICAL only**.

## Codebase audit sweep (2026-07-26→27)

9 路审计 → ~18 PR / 净删 ~12k；后续 follow-up 已继续合入。

| 类别 | 代表 |
|---|---|
| 死代码 / 产品缺陷 / 契约 | #1374 · #1368 · #1376 · #1380 · #1422 |
| 诚实性 / 供应链 / 可观测 | #1366 #1373 #1381 #1378 |

### Closed after sweep（→ 2026-07-27 tip）

| 主题 | 结果 |
|---|---|
| agentteam 并发 / 生命周期 / 投影 | **closed** · #1383 #1384 #1385 · #1401 #1419 #1427 #1429 |
| OIDC / query-token | **closed** · #1400 #1402 |
| transport / stream / CJK / Empty | **closed** · #1416 #1418 #1417 #1420 |
| WS 死面 / 幂等语义文档 | **closed** · #1422 #1433 |
| edge 存储 | **closed** · #1424 #1426 |
| #1395 测试残余（web+desktop） | **closed** · #1425 #1432 |
| A7 Web Hub-only → validate | **closed** · #1431 |

### Open follow-ups

| 主题 | Issue / PR |
|---|---|
| TurnInProgress 409（A10） | **#1430**（新建） |
| ACP / Automations / @提及 / 观察池 | #1404 · #1405 · #1406 · #1407 |
| 签名发布 / WS 增量 SPEC 排队 | #1403 · #1411 |
| PROPOSAL（**NEEDS_FIX**，不 merge） | #1412 · #1413 · #1414 |

Research off-repo: `D:\Code\Temp\codeg-research\` + `D:\Code\Temp\agenthub-a7-architecture-gates.md` / `agenthub-a10-turn-in-progress.md`。

### 审计澄清

- Desktop「15 pre-existing fail」过期；CI 全绿
- A7 候选余量：mobile hub-only / pure packages / hubClient thin-shell（#1431 仅钉 web boundary）

## Product tip & Visual QA

**Gate**: **89**/100 SHIP。**不追 89+**。Refs: [scorecard](../analysis/visual-qa-scorecard.md)

## Infrastructure

- path-filter + Web Hub-only boundary 在 `validate` 硬门禁（#1431）
- residual out of scope: live OIDC evidence · full Mobile redesign · QA>89

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-20–21 | Ship 89 · residual closeout |
| 2026-07-26 | audit sweep ~18 PR |
| 2026-07-27 | #1420–#1427 波；#1428 MASTER；#1429 投影；#1431 A7 CI；#1432 #1395；#1433 幂等；A10=#1430；PROPOSAL 三审 NEEDS_FIX |
