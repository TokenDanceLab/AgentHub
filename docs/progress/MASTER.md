# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete**
> **Started**: 2026-07-16 · residual closed 2026-07-21 · **Last Updated**: 2026-07-29
> **Mode**: `GITHUB_FULL` · **Repo**: `TokenDanceLab/AgentHub`

## Progress index

| Item | Value |
|---|---|
| Active SPEC | **PROPOSAL open (NEEDS_FIX, do not merge/implement)** — #1412 WS · #1413 签名 · #1414 IM |
| Closed residual | [overview](../analysis/post-polish-project-overview.md) · plan trio under `docs/plan/post-polish-*` |
| Strategy | Strangler Fig; **no** Visual QA chase past 89 |
| Live tip | master `986b5307`（#1444 OpenAPI 契约门禁） |

Phases 73–80 **closed**. Historical `docs/plan/task-breakdown.md` is **HISTORICAL only**.

## 企业稳定·强制门禁波（2026-07-29）

坏了有人知道、回归挡在 CI。六层门禁全在 `validate` job 硬阻断。

| 门禁 | PR | 覆盖 |
|---|---|---|
| Web Hub-only boundary | #1431 | web 不直连 Local Edge |
| Mobile Hub-only boundary | #1436 | mobile 禁 3210/v1 events|runs/edgeAuth |
| Hub pure packages import | #1435 | dispatch/outbox/im/agentevent 无 DB/WS/cache |
| Design token re-export | #1440 | styles 仅 @import shared，禁全表 fork |
| 前端 coverage 基线不可退 | #1443 | shared 71.57 / web 63.61 / desktop 67.13，删测试/.skip 即红 |
| OpenAPI↔hub 路由契约 | #1444 | 152 OpenAPI / 155 router / 3 admin 白名单，多缺即红 |

### 同波收口
| 主题 | 结果 |
|---|---|
| A10 TurnInProgress 409 全链路 | **closed** · #1437 Hub per-agent_instance 409 + #1442 前端可恢复 UX（#1438 closed） |
| fault-escalation event 不裸吞 | **closed** · #1441 + `team_fault_escalation_review_event_failures_total` metric |
| agentteam 并发/生命周期/投影 | **closed** · #1383 #1384 #1385 #1427 #1429 |
| WS 死面 / 幂等语义 | **closed** · #1422 #1433 |
| edge 存储 | **closed** · #1424 #1426 |
| #1395 测试残余 | **closed** · #1425 #1432 |

### Open follow-ups

| 主题 | Issue / PR |
|---|---|
| 可观测性 metrics 缺口（D 批，审计中） | off-repo `D:\Code\Temp\agenthub-observability-audit.md` |
| ACP / Automations / @提及 / 观察池 | #1404 · #1405 · #1406 · #1407 |
| 签名发布 / WS 增量 SPEC | #1403 · #1411 |
| PROPOSAL（**NEEDS_FIX**，不 merge） | #1412 · #1413 · #1414 |

Research off-repo: `D:\Code\Temp\codeg-research\` + `agenthub-a7-architecture-gates.md` / `agenthub-a10-turn-in-progress.md` / `agenthub-observability-audit.md`。

### 审计澄清

- Desktop「15 pre-existing fail」过期；CI 全绿
- A7 候选余量：hubClient thin-shell / shared UI hubClient（policy-first，未做）

## Product tip & Visual QA

**Gate**: **89**/100 SHIP。**不追 89+**。Refs: [scorecard](../analysis/visual-qa-scorecard.md)

## Infrastructure

- `validate` 硬门禁：doc-ssot · ci-gates · web/mobile-hub-boundary · pure-packages · token-ssot · coverage-baseline · openapi-contract
- residual out of scope: live OIDC evidence · full Mobile redesign · QA>89

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-27 | #1420–#1433 波；#1385/#1395 closed；A10=#1430；PROPOSAL 三审 NEEDS_FIX |
| 2026-07-29 | A7 四层门禁 + coverage 基线 + OpenAPI 契约 + A10 全链路 + fault metric（#1435-#1444） |
