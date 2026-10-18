# 宏观工程设计基线（Macro Engineering Design Baseline）

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-10-18（合并协议能力映射）
>
> 状态：设计基线（Accepted）。本文描述目标架构、协议分层、可靠性/安全/可观测合同与设计差距；实现状态以源码为准。

## 1. 范围

本文定义五条工程主线：平面边界、协议分层、事件一致性、最小代理权、端到端可观测。

## 2. 双平面模型

```text
UI Workbench（chat timeline + command center）
  -> typed platform contract（AgentHubPlatform / SurfaceCapabilities）
  -> Hub Control Plane：身份 / 会话 / 路由 / 审批 / 同步 / 审计 / 配额
  -> Edge Data Plane：Run lifecycle / runtime adapter / artifact / evidence / local sandbox
       -> Runtime Adapter（Codex / OpenCode / Claude Code / SDK）
       -> MCP surface（agent <-> tools/data）
```

固定原则：

- Hub 是控制面，**不执行模型 Turn**；任务拆分/路由由确定性 supervisor 承担，LLM 只能提供建议，不直接改路由、授权或审批状态机。
- 证据与执行同侧：`runtimeEvidence / artifact / real_tested` 由 Data Plane 产生并签名，Hub 只校验与审计，UI 不得代替证据源。
- 所有能力流量经受控面：Desktop 走 Local Edge 的 typed Tauri/Host contract，Web/Mobile 走 Hub relay，禁止 UI 或 agent 绕过 typed port 直连能力面。
- 双平面不是把两套服务再切一层微服务；单仓库、窄接口、事件中介仍优先于进程拆分。

## 3. 协议分层与能力映射

自有 REST/WS 是产品控制面唯一权威：`api/openapi.yaml`（命令/查询）、`api/events.md`（typed WS + Edge EventEnvelope）、`api/dispatch.md`（Hub→Edge delivery/admission/execution intent/callback ownership）。任何外部协议不得替换、覆盖或绕过这些契约。

| 协议 | 角色 | 仓库现状 | 引入状态 |
|---|---|---|---|
| 自有 REST/WS | Hub/Edge 产品控制面 SSOT | 已实现主体；标为 `x-agenthub-status: planned` 的操作未实现 | 常驻 |
| MCP | agent ↔ tools/data narrow projection | config 注入 + Edge MCP server | 已限定使用 |
| A2A | agent ↔ agent 跨信任域协作 | 未引入 | 按需引入 |
| AG-UI | agent ↔ user UI capability mapping | 未引入 | 仅评估 |
| ACP (Agent Client Protocol) / Agent SDK adapter | Edge ↔ coding agent runtime 进程契约 | adapter family | Edge data plane only |

### 3.1 MCP

Edge MCP server 暴露 8 个 canonical `agenthub_*` 工具；它们都是 REST 能力的 narrow projection，不是平行 API：

| MCP tool | REST 端点 |
|---|---|
| `agenthub_list_projects` | `GET /v1/projects` |
| `agenthub_list_threads` | `GET /v1/threads?projectId=` |
| `agenthub_get_thread` | `GET /v1/threads/{threadId}` |
| `agenthub_start_run` | `POST /v1/runs` |
| `agenthub_get_run_status` | `GET /v1/runs/{runId}` |
| `agenthub_approve_action` | `POST /v1/permissions/decide` |
| `agenthub_cancel_run` | `POST /v1/runs/{runId}:cancel` |
| `agenthub_send_message` | `POST /v1/threads/{threadId}/messages` |

红线：MCP 只做 tool surface，不承载控制面路由/授权/审计；工具必须可追溯到 REST 端点；禁止仅 MCP 可达的新业务能力；MCP endpoint 复用 Edge bearer token，不引入独立 auth 体系。Hub→Edge 的 `mcp_config` 同步只是给 CLI runtime 注入第三方 server，不等于 AgentHub 采纳 MCP 作为内部协议。

### 3.2 A2A / AG-UI

- **A2A**：仅当需要跨 Hub / 跨组织 / 跨厂商 agent 互操作或跨域 Agent Card/Task 发现时引入；单 Hub 内的 Agent Teams + Relay 已覆盖，不替换自有契约。
- **AG-UI**：只做 capability mapping，不替换 WS event contract。自有契约已覆盖 agent event stream、tool call/result、message delta、run lifecycle、approval；状态快照和多模态内容 block 为部分覆盖。若未来对接 AG-UI 生态客户端，只在 Edge/Hub 边界加翻译 adapter，内部仍用自有事件。

## 4. 编排原则

- 从最低复杂度开始：direct model call → single agent + tools → multi-agent；multi-agent 增加协调开销、延迟和失败模式。
- Orchestrator-worker 只用于独立、可并行、超出单上下文的任务；强依赖、共享上下文过多的任务不拆。
- 多 agent 成本要显式预估，并在 run 前设置 cost/token 上限。
- 确定性 supervisor：路由、重试、审批、超时、dead-letter 都由非 LLM 状态机承担。

## 5. 事件一致性合同

已有资产：`hub-server/internal/service/deliveryoutbox/`（Record/MarkSent/Ack、CAS claim、指数退避、dead-letter、7 天 purge）；`agent_edge_callback.go` 的 `client_msg_id` 幂等去重与 stream+seq 事务；`api/events.md` 的 at-least-once、`EventEnvelope.seq/id`、UPSERT/idempotent/watermark/ephemeral 标签、`agent.dispatch` 的 `task_id + delivery_id`。

目标合同（设计目标，尚未实现）：

1. 业务变更与 outbox 写入**同一本地事务**；先产生稳定 `event_id/delivery_id`，再落 outbox row。
2. 事件携带 `aggregate_version`；consumer 用 inbox 幂等，拒绝旧版本，允许重放收敛。
3. relay 用 lease/CAS claim；ack 前 crash 允许重复发布，因此 consumer 幂等是硬约束。
4. 明确 per-aggregate / per-tenant / global 排序级别；不做隐式全局顺序。
5. 事件日志必须有 snapshot + retention/cursor 只前进策略，避免无限 replay。
6. payload 是合同：插入后不可变，按 version 演进，不含 secret/不必要的个人数据。

验收标准：集成测试覆盖“业务回滚则无事件、relay 重复发送收敛、旧版本拒绝、restore/redrive 重放安全”。

## 6. 安全与最小代理权

已有资产：TokenDance ID 只证身份、Hub-local 授权分离；Web/Mobile Hub-only；Desktop renderer 无 raw process；`env_sanitizer` / `tool_allowlist` / `security_hooks` / 出站 egress；JWT rotation/revoke/jti blacklist/`auditPermission`。

演进合同：

1. **least agency 而非 least privilege**：task-scoped、time-bound 凭据；每个 privileged action 都过集中 policy engine，而不是只在发 token 时授权一次。
2. per-tool capability token / 短 TTL；user access token、agent session、tool credential 分层，不互相复用。
3. run 级临时凭据；secret 不进入 agent context、sandbox 或日志。
4. 审批是确定性 broker：pending/decided 状态机、iteration cap、timeout 默认拒绝或安全降级；禁止模型自评。
5. sandbox 按风险分级：本地受限 sandbox（当前 Edge 边界）与远端 untrusted code（microVM/gVisor、egress allowlist、DNS 限制、非 root、短生命周期）分开授权。
6. gateway 单入口：远端 runtime 只接受 gateway 来源的调用；client backend 自己维护 session↔user mapping。

## 7. 可观测

- 现状：Hub Prometheus 覆盖 HTTP/WS/DB/Redis/outbox/auth/audit；`edge-server/internal/runnerctx/session_metrics.go` 记录本地 token/cost；OTel GenAI span 导出未落地。
- 目标：一条 trace 贯穿 `runId → agentId → model/tool span → token/cost → approval → artifact`，按 OTel GenAI semantic conventions 打点。
- 审计关联字段：agent id、tenant、action、resource、input/output hash、approver、trace id、result。
- span 族口径见 ADR-027：`agenthub.run*` / `gen_ai.*`；不为 WS 帧、DB/Redis 建 GenAI span。

## 8. 前端与工程化

- UI 主叙事是聊天时间线；Evidence / Artifact / Approval 围绕时间线渐进披露，不做全屏堆叠。
- `app/shared/src/platform/types.ts` 已有 `SurfaceCapabilities` + Conversation/Run/Attachment/Preview/Checkpoint/Workspace/Terminal ports；`approval / runtimeEvidence / remoteExecution / sandbox` 能力域已显式定义，继续用 package exports + import boundary verifier 把边界机器化。

## 9. Anti-goals

- 不让 LLM 当控制面/supervisor；路由、授权、审批、重试必须 deterministic。
- 不并行引入 MCP + A2A + AG-UI 三套内部协议。
- 不让 Web/Mobile 直连 Local Edge。
- 不现在上 CRDT；先 event log + snapshot，确有并发协作编辑场景再评估。
- 不让模型自评审批/完成度；`real_tested` 与证据等级继续是唯一真实性口径。
- 不在真实 E2E/approved-real 证据前宣称远程执行、sandbox 或发布“生产就绪”。

## 10. 治理入口

- 规则常驻面：`AGENTS.md` 的「架构与产品边界」。
- 决策摘要：`docs/decisions.md` ADR-025 / ADR-026。
- 机器验证映射：`docs/governance/verifier-map.md`。
