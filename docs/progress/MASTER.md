# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete**
> **Started**: 2026-07-16 · residual closed 2026-07-21 · **Last Updated**: 2026-07-29
> **Mode**: `GITHUB_FULL` · **Repo**: `TokenDanceLab/AgentHub`

## Progress index

| Item | Value |
|---|---|
| Active SPEC | **3 P3 RFC DRAFT** (#1478 直播 / A-V1 #1471 / A-V3 #1472) — 待管理员定档 · PROPOSAL #1412/#1413/#1414 CLOSED 未合并 |
| Closed residual | [overview](../analysis/post-polish-project-overview.md) · plan trio under `docs/plan/post-polish-*` |
| Strategy | Strangler Fig; **no** Visual QA chase past 89 |
| Live tip | master `41309678`（leader wave：3 RFC + A-V3 quick-win + A-V1 preflight + ACP vocab lock） |

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
| 前端 coverage 基线不可退 | #1443 | shared 72.07/web 63.61/desktop 67.13（A-V3 后重测，shared +0.5pp） |
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
| ACP spike（紧迫度↑：Phase 2 prep 已落地——pure ACP→Edge 事件映射器 + 单测，待真 binary 集成） | #1404 |
| agentteam 子任务直播（#1478 已立，**SPEC 设计已写** `docs/plan/agentteam-live-streaming.md`，3 阶段 A/B/C，待管理员 sign-off） | #1478 |
| @agent 派单（方向调整：不走 @session 引用，走 IM 群聊 @agent 派单） | #1406 |
| Automations / 会话导入 / 观察池 | #1405 · #1407 |
| 签名发布 / WS 增量 SPEC | #1403 · #1411 |
| PROPOSAL（**CLOSED 未合并** 2026-07-29，提案文档归档可查） | #1412 · #1413 · #1414 |
| P3 裁决项（A-V4/D-V3 closed；D-V2 评估为低价值；D-V1 -41% 完成；A-V1/A-V3 **RFC 已写**，待管理员定档） | #1469 · #1470 · #1471 · #1472 |
| D-V1 edge run() 持续重构（Step 2: collectAndWaitOutput 40 行提取，累计 418→246 行 -41%） | 进行中 |

Research off-repo: `D:\Code\Temp\codeg-research\` — SYNTHESIS.md（v0.21.9 基准）+ v0.22.1-DELTA.md（45 commits 增量分析）。综合审计：`agenthub-comprehensive-audit-2026-07-29.md` / `agenthub-observability-audit.md`（A/D/T 源报告已被综合/证伪，已清理）。

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
| 2026-07-30 | 基线清理：分支 103→8，stash 20→0（已在之前会话清完）。codeg v0.22.1 竞品增量分析完成：45 commits 6 簇，3 个竞争信号（子 agent 直播/自定义 agent 平台/@session 提及）。产出 `v0.22.1-DELTA.md`。#1404 ACP spike 紧迫度升级，#1406 方向调整为 @agent 派单，agentteam 子任务直播待立 issue |
| 2026-07-30 | **D-V3 完成**（#1470）：startEventSubscriptions 239 行拆为 5 域方法（message/agent/team/contact/session），主函数退化为 7 行分发器。**D-V2 评估**：PostRuns 357 行实为清晰线性 pipeline，非 god function，审计高估——跳过低价值重构。**D-V1 评估**：edge run() 418 行含会话重试循环 + fault escalation 交接 + 多并发原语，高价值但高风险，需深入理解 #867 语义后专项设计 |
| 2026-07-30 | **D-V1 Step 1**：buildAndStartProcess 138 行提取到 process_executor_build.go（新文件），run() 从 418→281 行（-33%）。提取的是循环体中最机械的构建+启动阶段，每条错误路径自己发事件，调用者仅需 return。控制流决策（continue/break）未提取，留待后续步骤。lifecycle tests 全过。 |
| 2026-07-30 | **D-V1 Step 2**：collectAndWaitOutput 40 行提取到 process_executor_build.go，run() 从 281→246 行。循环体现在是清晰的 3 阶段管道：(1) buildAndStart → (2) collectAndWait → (3) evaluate+finish。累计 418→246 行（-41%）。lifecycle tests 全过。 |
| 2026-07-30 | **God function 全仓扫描**：扫出 19 个 >150 行函数。3 个真正 god function 评估：PostRuns 358 行（HTTP handler，长但线性，跳过）、StartTeamRun 226 行（已标 #1385）、HandleSubAgentFailure 158 行（已结构化 Step 0-6，委托子函数，跳过）。其余 16 个为长但线性的路由/注册/wiring/parser。D-V1 仍是唯一高价值重构——已完成（-41%）。|
| 2026-07-30 | **ACP Spike Phase 2 prep**：把 ACP session/update → run.agent.* 翻译提取为纯映射器 `acp_events.go`（无 I/O、无状态、前向兼容），ParseStream 接线通知/响应，阻塞请求留 Phase 2。8 个单测覆盖全部映射类型 + 3 个有意不映射类型 + prompt-result 边界。adapters 全测试过。|
| 2026-07-30 | **PROPOSAL 状态澄清**：#1412/#1413/#1414 经查于 2026-07-29 CLOSED 未合并（非永久挂起）。MASTER open 表从「NEEDS_FIX 不 merge」更正为「CLOSED 未合并，归档可查」。|
| 2026-07-30 | **leader wave（fable 深拆 + opus 执行）**：3 RFC 落地——#1478 agentteam 直播 SPEC（对标 codeg live subagent，3 阶段 A/B/C，edge 零改）；A-V1 #1471（驳回 lifecycle 拆分+adapters 全量叶子化，采纳定向 adapters/orchestrator 抽取，preflight 已捕获 PlanTask/TaskStatus 导入环）；A-V3 #1472（驳回 shared 三分，采纳定向剔除 apiClient+硬化 edge 隔离）。safe quick-win 执行：删 shared/apiClient（454 行零消费）+ web/desktop workspace 依赖声明 + edge-surface-isolation 软门禁 + coverage 重测（shared +0.5pp）。ACP 词汇锁测试防 §3 映射漂移。全本地验证：build/test/3 门禁/coverage gate 全过。|
