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
| Live tip | master `31c482cc`（#1476 dispatch 成功路径单测 + #1475 oidc tautology 修正） |

Phases 73–80 **closed**. Historical `docs/plan/task-breakdown.md` is **HISTORICAL only**.

## 企业稳定·综合优化（2026-07-29）

坏了有人知道、回归挡在 CI。两波闭环。

### 强制门禁波（validate 硬阻断，七层）
| 门禁 | PR | 覆盖 |
|---|---|---|
| Web Hub-only boundary | #1431 | web 不直连 Local Edge |
| Mobile Hub-only boundary | #1436 | mobile 禁 3210/v1 events|runs/edgeAuth |
| Hub pure packages import | #1435 | dispatch/outbox/im/agentevent 无 DB/WS/cache |
| Design token re-export | #1440 | styles 仅 @import shared |
| 前端 coverage 基线不可退 | #1443 | shared 71.57/web 63.61/desktop 67.13 |
| OpenAPI↔hub 路由契约 | #1444 | 152/155 + 3 admin 白名单 |
| hubClient thin-shell SSOT | #1452 | web 59/desktop 212/mobile 378 行，禁 `/client/` 新字面量 |
| shared 边界 / barrel / handler 分层 / conventions | #1463 | 4 门禁扩展（A #1/#2/#4/#5） |
| shared-UI hubClient 门禁（A-V2 / A7#4 专属面） | #1468 | 共享 UI 层禁运行时 import hubClient，类型导入放行；与 #1463 互补（依赖图相反两侧） |
| Hub 客户端↔Hub router REST 契约 | #1467 | A#3 契约门禁（verify-shared-rest-contract.ps1，0 drift；Edge 面未纳入） |

### 观测波（12 缺口全闭环，Prometheus 11→32 counter）
| 缺口 | PR | metric |
|---|---|---|
| G3 outbox 重试/死信/redispatch | #1447 | 4 counter |
| G4 edge-dispatch 6 类失败 | #1447 | CounterVec + unreachable Debug→Warn |
| G9 JWT/WS auth 失败 | #1447 | 3 counter + WS audit log |
| G11 redis_pool_hits Gauge→Counter | #1447 | 类型修复 |
| G12 sendFrame seq_id bypass | #1446 | characterization + bypass counter（KNOWN DEFECT） |
| G1 ws delivery 失败 | #1449 | CounterVec |
| G2 ws 断连/重连/僵死 | #1449 | 3 counter |
| G5 dispatch offline push | #1449 | CounterVec 6 route |
| G6 team 超时/状态转移 | #1449 | 2 counter |
| G7 eventbus submit 失败 | #1449 | counter |
| G10 admin server up | #1449 | Gauge |
| G8 DB 慢查询/错误 | #1450 | 2 counter + db_pool_idle（rows==0 metric 仍计） |
| notification/heartbeat/dead-letter-move | #1462 | 4 counter（dispatch_dead_letter_move / notification / heartbeat / session_touch） |

### correctness
| 主题 | 结果 |
|---|---|
| A10 TurnInProgress 409 全链路 | **closed** · #1437 Hub per-agent_instance 409 + #1442 前端可恢复 |
| fault-escalation event 不裸吞 | **closed** · #1441 |
| agentteam 并发/生命周期/投影 | **closed** · #1383 #1384 #1385 #1427 #1429 |
| WS 死面 / 幂等语义 | **closed** · #1422 #1433 |
| edge 存储 | **closed** · #1424 #1426 |
| #1395 测试残余 | **closed** · #1425 #1432 |
| 删 2 处过时 skip 恢复覆盖 | **closed** · #1461 |
| resolveCache 三包提取 / agentteam payload 去重 | **closed** · #1464 #1465（8/10 统一，#1385 投影不重做） |
| dispatch 成功路径单测 / #1430 gate 直测 | **closed** · #1476（TriggerAgentTask 成功 + 4 错误路径 + TurnInProgress 409 二次触发 gate） |
| TS 常量自等 tautology 修正 | **closed** · #1475（全仓扫仅 1 处真 tautology：oidc-login `expect(true).toBe(true)` → DOM 渲染断言） |

### Open follow-ups

| 主题 | Issue / PR |
|---|---|
| G12 sendFrame 走 PushToConn 修复（M，待管理员定档） | #1446 PR body 建议 |
| ACP / Automations / @提及 / 观察池 | #1404 · #1405 · #1406 · #1407 |
| 签名发布 / WS 增量 SPEC | #1403 · #1411 |
| PROPOSAL（**NEEDS_FIX**，不 merge） | #1412 · #1413 · #1414 |

Research off-repo: `D:\Code\Temp\codeg-research\` + `agenthub-a7-architecture-gates.md` / `agenthub-a10-turn-in-progress.md` / `agenthub-observability-audit.md`。

### 审计澄清

- Desktop「15 pre-existing fail」过期；CI 全绿
- A7 候选余量：hubClient thin-shell / shared UI hubClient（**A-V2 已由 #1468 合入**，全闭环）

## Product tip & Visual QA

**Gate**: **89**/100 SHIP。**不追 89+**。Refs: [scorecard](../analysis/visual-qa-scorecard.md)

## Infrastructure

- `validate` 硬门禁：doc-ssot · ci-gates · web/mobile-hub-boundary · pure-packages · token-ssot · coverage-baseline · openapi-contract · hubclient-ssot · shared-boundary · shared-barrel · hub-layering · conventions · shared-rest-contract · shared-ui-hubclient（**14 层全部合入**）
- 观测：`/metrics`（admin server，basic auth）+ 36 Prometheus counter（11 基线 + 25 新增）
- 供应链：Dependabot 0 open（brace-expansion fix #1370/#1397 + alert #43 dismissed）
- 综合审计 off-repo：`agenthub-comprehensive-audit-2026-07-29.md`（D 32 + T 13 + A 17，top 10 落地 **10/10**：#1461(1) · #1462(2/3/4) · #1463(5/6/7) · #1464(9) · #1465(8) · #1475(10，实测仅 1 处真 tautology，审计「52 处」高估)）+ T-M1 dispatch 成功路径 #1476
- residual out of scope: live OIDC evidence · full Mobile redesign · QA>89

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-27 | #1420–#1433 波；#1385/#1395 closed；A10=#1430；PROPOSAL 三审 NEEDS_FIX |
| 2026-07-29 | 强制门禁波（#1435-#1445）+ 观测波 12 缺口闭环（#1441/#1446/#1447/#1449/#1450）+ hubClient 门禁（#1452）；A10 全链路；32 metrics；Dependabot 0 open |
| 2026-07-29 | 综合审计三维度（D/T/A 62 条）→ 快修波（#1461 删skip/#1462 counter/#1463 4门禁）+ 重构波（#1464 resolveCache/#1465 agentteam payload）；12 门禁/36 metrics |
| 2026-07-29 | P2 收口：A#3 Hub 契约门禁合并（#1467 → master 6d3875cb；A#4/A#5 已在 #1463）。P3 裁决：8 项实测，D-V1 受 #867 硬阻塞 DEFER；D-V2/D-V3/A-V1/A-V3/A-V4 转 PLAN issue #1469–#1473；A-V5 已采纳 |
| 2026-07-29 | A-V2 澄清修正：非「由 #1463 覆盖」——p2 关门前补 A-V2 专属门禁 PR #1468（shared-UI 禁运行时 import hubClient，类型导入放行；与 #1463「平台↛共享Edge」是依赖图相反两侧的互补面，master 上 0 违规）。#1468 rebase 至最新 master 解 checks.yml/verify-ci-gates.ps1 加法冲突，本地 anti-cheat 通过，MERGEABLE 待 CI |
| 2026-07-29 | MASTER 同步：A-V2 澄清 + #1468 门禁入 14 层索引；live tip `6d3875cb`（#1467），#1468 待 CI 后合 |
| 2026-07-29 | #1468 合入 master `54c21867`（A-V2 闭环）；MASTER tip 同步至 #1468，14 层门禁全部合入；综合审计 top10 落地 6/10 |
| 2026-07-30 | fable 并行 lane 收口：Lane A #1476（TriggerAgentTask 成功 + 4 错误路径 + #1430 TurnInProgress gate 直测，320 行）/ Lane B #1475（全仓扫仅 1 处真 TS tautology，审计「52 处」高估→澄清）合入 master `31c482cc`。综合审计 top10 **10/10** 全落地 + T-M1 覆盖缺口闭环 |
