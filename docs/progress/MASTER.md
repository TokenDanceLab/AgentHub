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
| Live tip | master `070c17f7`（#1447 观测 counters） |

Phases 73–80 **closed**. Historical `docs/plan/task-breakdown.md` is **HISTORICAL only**.

## 企业稳定·综合优化（2026-07-29）

坏了有人知道、回归挡在 CI。两波：强制门禁 + 观测。

### 强制门禁波（validate 硬阻断，七层）
| 门禁 | PR | 覆盖 |
|---|---|---|
| Web Hub-only boundary | #1431 | web 不直连 Local Edge |
| Mobile Hub-only boundary | #1436 | mobile 禁 3210/v1 events|runs/edgeAuth |
| Hub pure packages import | #1435 | dispatch/outbox/im/agentevent 无 DB/WS/cache |
| Design token re-export | #1440 | styles 仅 @import shared |
| 前端 coverage 基线不可退 | #1443 | shared 71.57/web 63.61/desktop 67.13，删测试/.skip 即红 |
| OpenAPI↔hub 路由契约 | #1444 | 152/155 + 3 admin 白名单，多缺即红 |

### 观测波（坏了有人知道）
| 主题 | 结果 |
|---|---|
| fault-escalation event 不裸吞 | **closed** · #1441 + `team_fault_escalation_review_event_failures_total` |
| A10 TurnInProgress 409 全链路 | **closed** · #1437 Hub + #1442 前端可恢复 |
| G3 outbox 重试/死信/redispatch | **closed** · #1447 4 counter |
| G4 edge-dispatch 6 类失败 | **closed** · #1447 + unreachable Debug→Warn |
| G9 JWT/WS auth 失败 | **closed** · #1447 3 counter + WS audit log |
| G11 redis_pool_hits Gauge→Counter | **closed** · #1447 类型修复 |
| G12 sendFrame seq_id bypass | **closed** · #1446 characterization + `ws_sendframe_bypass_total`（KNOWN DEFECT，修复待管理员定档） |

### 其它已合
| 主题 | 结果 |
|---|---|
| agentteam 并发/生命周期/投影 | **closed** · #1383 #1384 #1385 #1427 #1429 |
| WS 死面 / 幂等语义 | **closed** · #1422 #1433 |
| edge 存储 | **closed** · #1424 #1426 |
| #1395 测试残余 | **closed** · #1425 #1432 |

### Open follow-ups

| 主题 | Issue / PR |
|---|---|
| D 审计剩余缺口（G1/G2/G5/G6/G7/G8/G10，S–M） | off-repo `agenthub-observability-audit.md` |
| G12 sendFrame 走 PushToConn 修复（M，待管理员定档） | #1446 PR body 建议 |
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
- 观测：`/metrics`（admin server，basic auth）+ 11→20 Prometheus counter
- residual out of scope: live OIDC evidence · full Mobile redesign · QA>89

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-27 | #1420–#1433 波；#1385/#1395 closed；A10=#1430；PROPOSAL 三审 NEEDS_FIX |
| 2026-07-29 | 强制门禁波（#1435-#1445）+ 观测波（#1441/#1446/#1447）；A10 全链路；20 metrics |
