---
id: hotspots
title: God-file 与债务热点（P0–P2）
type: hotspot
status: active
severity: p0
updated: 2026-07-18
sources:
  - docs/analysis/_lane_digest.md
  - docs/analysis/_raw_lane_results.json
  - docs/architecture.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - docs/progress/MASTER.md
  - AGENTS.md
tags:
  - god-file
  - debt-hotspot
  - cleanup-priority
  - strangler-fig
  - security-gap
related:
  - module-hub-server
  - module-edge-server
  - module-shared-workbench
  - risks-open
  - cleanup-playbook
  - architecture-seams
summary: >
  AgentHub 全仓 god-file 与架构债务热点汇总，按 P0/P1/P2 分级，标注位置、行数、风险与推荐拆分方向。
  活 residual LOC 以 MASTER residual band 为准（Phase 63）；历史 baseline 数字仅作上下文。
---

本页是 AgentHub 清理基线中所有高耦合、大文件、安全半成品与分叉残留的集中索引。
每个热点标注文件路径、规模、严重度、根因及推荐处置方向。优先按 [[cleanup-playbook]] 的 strangler-fig 模式渐进拆分，不重写架构。

相关总览：[[architecture-seams]]（架构缝线总图）、[[risks-open]]（安全风险未关闭项）。
活进度：`docs/progress/MASTER.md`（Phase 63 / milestone 84）。

---

## P0：阻断级热点（安全半成品 / god-file / 叙事漂移）

P0 热点要么是安全 gate 未闭合（AH-SR 项），要么是超过 2000 行的 god-file 阻塞安全修复，
要么是产品 LIVE/下线叙事冲突导致 CI 门禁失准。**P0 必须在 P1/P2 之前闭合。**

| # | 文件 | 规模 | 根因 | 推荐方向 |
|---|---|---|---|---|
| **叙事漂移** |
| 1 | `.github/workflows/checks.yml` | header + jobs | CI header 与 job 注释仍写 runtime decommissioned，同 hk3 LIVE 事实冲突；mobile/e2e/benchmark 全设 manual | 重写 CI 叙事为 LIVE/hk3；恢复应运行的 gate，昂贵 lane 保留 manual+显式理由 |
| **Edge god-files 与安全半成品** |
| 2 | `edge-server/internal/api/handlers.go` | ~2374 行 | REST/WS 单 god-file：authz、run create、events WS、permissions、plans、profiles、runners health、cc-switch、memory 全耦合 | 按 route domain 拆分（runs / threads+projects / events+ws / agents+profiles / approvals / health+runners），Handler facade 保持薄层 |
| 3 | `edge-server/internal/lifecycle/process_executor.go` | **90** 行入口 + companions（P62 #1084 closed） | 入口已 file-split；pure dump 仍大 | 入口 peel 完成；不 big-bang pure dump |
| 4 | `edge-server/internal/hub/callback.go` | fire-and-forget | AH-SR-049：仅 best-effort HTTP callback，无 durable outbox、sequence、idempotent ack、reconciliation | 实现 Edge outbox/journal + retry worker + Hub 幂等 endpoint；先建合同再扩 payload |
| 5 | `edge-server/internal/jwtutil/capability.go` | schema 不完整 | AH-SR-046：capability token 缺少 workspace/target/action/route 字段；purpose 未在 call site 强制 | 扩展 claims + PostRuns 校验 + wrong-target/project/action/stale 负例；purpose==run-start 强制 |
| 6 | `edge-server/internal/httpserver/server.go` | composition root | Remote Edge auth 入口：CORS 缺 X-AgentHub-Capability-Token header；read API 授权粒度不足 | remote mode 强制 HubJWT + device/purpose 绑定；read API 加 route/target/workspace/user-action 负例 |
| **Hub 安全与核心服务** |
| 7 | `hub-server/internal/service/agent_dispatch.go` | **384** 行（P62 #1085 closed；pure `service/dispatch` residual） | 多关注点 dispatch 核心已拆 companions | preserve offline/outbox redispatch；typed package move deferred |
| 8 | `hub-server/internal/service/delivery_outbox.go` | **360** 行（P62 #1087 closed；+ companions） | outbox model+repo+retry 已 thin；仍 flat package residual | 保持 retry loop wiring；optional model package move deferred high-risk |
| 9 | `app/web/src/api/hubTokenStorage.ts` | sessionStorage | AH-SR-037：Web session 仍存 sessionStorage，XSS 可读 | 做 BFF/HttpOnly server-owned session，或正式 Accepted risk + CSP/短TTL/refresh 轮换补偿 |
| **前端 hubClient 三重分叉** |
| 10 | `app/shared/src/hubClient.ts` | **327** 行（P62 #1086 closed；payload/utils companions） | 共享 SSOT 主体已 thin；payload utils 仍大（#1094） | 继续 payload residual peel；desktop/web thin re-export 方向不变 |
| 11 | `app/desktop/src/api/hubClient.ts` | ~1854 行 | 最大分叉：方法与 web/shared 重叠但不一致；types/task/team API/auth 差异大 | 以 shared 为 SSOT；desktop 薄化为 re-export + desktop-only 扩展；冻结新方法 |
| 12 | `app/web/src/api/hubClient.ts` | ~1705 行 | 与 desktop 近乎重复，Session 类型与 task approvals/artifacts 方法集漂移 | diff shared+desktop；迁移 web 调用方到 shared client；仅保留 web 专属 transport/auth glue |
| **AH-SR-043：demo/mock 泄漏到生产 mutation 路径** |
| 13 | `app/shared/src/demo/dataMode.ts` | contract | auto 模式允许 mock/fixture fallback，AH-SR-043 仍可伪造执行成功 | 保持 contract；强制 explicit badge；生产 mutation 只在 observed/approved-real + auth 时放行 |
| 14 | `app/web/src/platform/webPlatform.ts` | adapter | 混合 contract 合规 + demo export + 乐观 Hub mutation cache 写入 + demoRuntimeFallback | 拆分纯 adapter port vs demo seed/mutation helper；demo fallback 严格受 dataMode contract + auth 门控 |
| 15 | `app/desktop/src/platform/desktopPlatform.ts` | adapter | 构造器 import 并暴露 demo conversations/agents/transcript 为默认；conversations.list 始终 demo | demo 仅显式 mock/fixture 时可用；real conversations 不活在 module-level demo export |

---

## P1：高优先拆分（大文件 / 分叉残留 / 半成品接线）

P1 在 P0 闭合后推进。主要是 800-1600 行的大文件拆分、package 边界违规、孤儿 UI 分叉。

| # | 文件 | 规模 | 根因 | 推荐方向 |
|---|---|---|---|---|
| **Edge** |
| 16 | `edge-server/internal/store/store.go` + `sqlite_store.go` + `sqlite_store_query.go` | store 历史大 · **sqlite_store.go 461** · **query 806**（P63 #1093） | 内存多实体 repository + sqlite residual；query companions 仍大 | 继续 query/pure peel（#1093）；domain 接口拆分保持 composite |
| 17 | `edge-server/internal/adapters/orchestrator.go` + `orchestrator_failure.go` | ~818 + **1013** 行（P63 #1095） | orchestrator + failure recovery + DAG/dispatch interceptor 混在 adapter 包 | residual pure peel failure surface（#1095）；typed package move deferred |
| **Hub** |
| 18 | `hub-server/internal/service/` | ~12k 行/41 文件 | 扁平 service 包混合 IM、auth、catalog、audit、dispatch、outbox、relay、documents；仅 agentteam 已提取 | 按 domain subpackage 绞杀（im/ auth/ catalog/ agent/ audit/），先建立 Bus/WS/Cache 端口 |
| 19 | `hub-server/internal/router/router.go` | god-param func | 单 SetupRoutes 注册所有 domain + auth variant；无法独立测试/切片 | 拆分为 registerClient/Web/Edge/Cloud/Public route modules；传 RoutesDeps struct |
| 20 | `hub-server/internal/service/message.go` | 860 行 | 最大单 service 文件，混合 send/sync/search/pin/recall/edit/forward | 拆 MessageService 为 message_write/read/search/pin 模块；保持 handler 接口稳定 |
| 21 | `hub-server/internal/service/agent_run_event.go` | 694 行 | event listing + approval/artifact projection + payload parsing 寄生在 AgentService | 提取 RunEventProjector service |
| 22 | `hub-server/internal/service/relay.go` | ~104 行 | 最小 Redis 命令存储；ownership 用 CreatedBy；PushToUser 以 targetEdgeID 为 userID | 定义 Relay 成熟度合同（device-scoped push、durable store、非 admin 产品路径） |
| **前端孤儿分叉** |
| 23 | `app/web/src/components/SettingsPage.tsx` | ~2386 行 | 巨型孤儿，与 WorkbenchRoutes 使用的 shared SettingsPage 并行 | 确认运行时 import graph 无引用后 quarantine/delete；提取独有 section 入 shared SettingsPort |
| 24 | `app/desktop/src/components/SettingsPage.tsx` | ~869 行 | 孤儿 settings shell；仅 SectionId type 仍被 useTopMenuConfig 引用 | 迁出 SectionId type；退役孤儿 SettingsPage；Edge diagnostics 迁入 shared SettingsPort |
| 25 | `app/web/src/views/TeamRunConsole.tsx` | ~999 行 | desktop TeamRunConsole 近克隆，无产品 importer，仅单测 | 不盲目合并；先确定 TeamRun 产品 owner 或 archive |
| 26 | `app/desktop/src/views/TeamRunConsole.tsx` | ~636 行 | 同样未接入当前 App/workbench shell | 确认是否被 TeamRunDock/workbench routes 替代；如是则 archive |
| 27 | `app/shared/src/workbench/AgentHubWorkbench.tsx` | ~1768 行 + 2987 行测试 | 巨型 orchestrator；ConversationHost 提取已开始但 shell 仍过大 | 继续提取 routes/inspector/callbacks；拆分 state machine；保持行为测试，不放 UI snapshot mega-test |
| 28 | `app/shared/src/workbench/WorkbenchRoutes.tsx` | ~1404 行 | 巨型 router，拥有 settings/agents/projects pages 接线 | 保持 page 组件，减薄 route table |
| **安全/治理追加** |
| 29 | `hub-server/internal/service/delivery_outbox.go` | AH-SR-049 | Hub outbox 已存在但 end-to-end contract 未闭合 | outbox status 机 + ack + retry + dead-letter 与 Edge callback/replay 写合同测试 |
| 30 | `docs/governance/security-risk-register.md` | SSOT 漂移 | AH-SR-046/049 代码半落地但文档仍 Open | 刷新为 partial mitigated + 明确剩余关闭条件/owner |
| 31 | `app/mobile-rn/src/platform/mobilePlatform.ts` | adapter | 实现 AgentHubPlatform 但默认 mock；非 mock hub 失败静默 fallback 到 fixture | observed/approved-real 时 fail closed；空/错误状态代替 fixture 成功 |

---

## P2：低优先清理（兼容残留 / 厚文件 / 词汇统一）

P2 不阻塞安全或架构边界，但持续增加维护摩擦与语义漂移。

| # | 文件 | 规模 | 根因 | 推荐方向 |
|---|---|---|---|---|
| **Edge 兼容残留** |
| 32 | `edge-server/internal/runners/registry.go` | 兼容包 | 旧兼容 registry 仍接入 health 与 /v1/runners；真 runtime 是 adapters.Registry | 从 AdapterRegistry+executor health 派生 /v1/runners 或冻结为纯 summary DTO |
| **Hub 拆分** |
| 33 | `hub-server/internal/cache/client.go` | 650 行 | 多用途 Redis facade（routes、pending tasks、controls、seq、blacklist、rate limit） | 拆为 RouteCache / PendingTaskCache / AuthCache / SeqCache |
| 34 | `hub-server/internal/model/agent_team.go` | 627 行 | model 文件打包过多 team domain type/constant | 按 team/run/assignment/approval 拆分 model 类型 |
| 35 | `api/openapi.yaml` | ~235k | 单文件混合 Edge /v1 与 Hub surface；已知路径漂移注释 | 按 server/surface 分区或清晰 tag Hub vs Edge；CI 增加 route-vs-OpenAPI 路径校验 |
| 36 | `hub-server/internal/service/` thick files | agent_test/message/session 等 | 厚文件增加 cleanup 耦合风险 | 仅在测试绿 + 不改行为前提下做 mechanical extract |
| **前端词汇与测试** |
| 37 | `app/shared/src/workbenchDataMode.ts` | 旧词汇 | 旧 dataMode 词汇（loading/live/offline-snapshot/mock）与 demo/dataMode.ts 共存 | 废弃或更名为 catalog-source mode；停止作为 product dataMode 导出 |
| 38 | `app/shared/src/chatview/adapter.ts` | 659 行 + 1773+1361 行测试 | 核心渲染 adapter 健康但测试过大 | 保持行为；按 concern 拆分测试（grouping/order/tool-replace/markdown） |
| **API 响应信封** |
| 39 | `api/conventions.md` | 明确债务 | Hub `{code:OK,data}` vs Edge bare JSON；双重解析复杂度 | 规划版本化响应信封收敛；不双写 |

---

## 聚合统计

| 等级 | 数量 | 典型规模 | 主要域 |
|---|---|---|---|
| P0 | 15 | 600–2400 行/文件 | 叙事漂移、Edge god-files、hubClient 三重分叉、安全半成品 |
| P1 | 16 | 500–2400 行/文件 | Edge/Hub 大文件拆分、孤儿 UI 分叉、governance SSOT 漂移 |
| P2 | 8 | 600–235k | 兼容残留、厚文件、词汇统一、响应信封 |

总计 39 个标注热点，覆盖 Edge Server、Hub Server、前端 shared/desktop/web/mobile、CI/CD 与治理层。

## 处置顺序

1. **P0 叙事**：CI checks.yml 去 decommissioned 措辞，锁定 LIVE hk3 叙事（1 项）
2. **P0 安全半成品**：AH-SR-046 capability 闭环、AH-SR-049 Edge outbox、AH-SR-037 Web session（6 项）
3. **P0 god-files**：handlers.go / process_executor.go / agent_dispatch.go 接口提取（3 项）
4. **P0 前端分叉**：hubClient 统一 + AH-SR-043 demo 泄漏硬化（5 项）
5. **P1**：store/orchestrator/service/router 拆分 + 孤儿 UI quarantine（16 项）
6. **P2**：兼容残留 shrinking + 词汇统一（8 项）

每步遵循 [[cleanup-playbook]]：先建端口/接口，再迁移调用方，最后删除旧实现。不改行为、不改 OpenAPI 路径。
