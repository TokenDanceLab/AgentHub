# 宏观工程设计基线（Macro Engineering Design Baseline）

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-29
>
> 状态：设计基线（Accepted）。本文定义目标架构、协议分层、可靠性/安全/可观测合同与差距路线。**本文是设计合同，不是实现完成声明**：落地状态以 GitHub Issues/PR、`AGENTS.md` 验收门禁和源码为准。

## 1. 一句话结论

AgentHub 不需要再引入一套 agent 编排框架。它已经具备业界少见的双平面 agent 工作台雏形；要补的是把五条工程主线显式化并机器化：

1. 平面边界（Hub control plane / Edge data plane）
2. 协议分层（自有契约 / MCP / A2A / AG-UI）
3. 事件一致性（outbox / idempotency / version / snapshot）
4. 最小代理权（task-scoped / per-action authorization / sandbox 分级）
5. 端到端可观测（OTel GenAI span + token/cost + approval/audit trace）

## 2. 双平面模型（目标架构）

```text
UI Workbench（chat timeline + command center）
  -> typed platform contract（AgentHubPlatform / SurfaceCapabilities）
  -> Hub Control Plane：身份 / 会话 / 路由 / 审批 / 同步 / 审计 / 配额
  -> Edge Data Plane：Run lifecycle / runtime adapter / artifact / evidence / local sandbox
       -> Runtime Adapter（Codex / OpenCode / Claude Code / SDK）
       -> MCP surface（agent <-> tools/data）
       -> A2A（仅远程/跨设备 agent 协作，按需引入）
```

固定原则：

- Hub 是控制面，**不执行模型 Turn**；任务拆分/路由由确定性 supervisor 承担，LLM 只能提供建议，不直接改路由、授权或审批状态机。
- 证据与执行同侧：`runtimeEvidence / artifact / real_tested` 由 Data Plane 产生并签名，Hub 只校验与审计，UI 不得代替证据源。
- 所有能力流量经受控面：Desktop 走 Local Edge 的 typed Tauri/Host contract，Web/Mobile 走 Hub relay，禁止 UI 或 agent 绕过 typed port 直连能力面。
- 双平面不是把两套服务再切一层微服务；单仓库、窄接口、事件中介仍优先于进程拆分。

## 3. 协议分层（不追新、不并行引入）

| 协议 | 角色 | 现状/目标 | 红线 |
|---|---|---|---|
| 自有 REST/WS | Hub/Edge 产品控制面 SSOT | 保持 `api/openapi.yaml` + `api/events.md` | 不替换 |
| ACP / Agent SDK adapter | Edge <-> coding agent runtime 进程契约 | 已有 adapter family | 只属于 Edge data plane |
| MCP | agent <-> tools/data | 已有 mcp_config + Edge MCP server（8 个 canonical 工具，见 11） | tool 需要 narrow capability，不当作通用业务协议 |
| A2A | agent <-> agent | 仅远程/跨设备协作引入；当前未引入（见 11） | 不替换自有 Hub/Edge 契约 |
| AG-UI | agent <-> user UI | 只做 capability mapping 兼容评估 | 不替换现有 WS event contract |

## 4. 编排原则

- 从最低复杂度开始：direct model call -> single agent + tools -> multi-agent；multi-agent 增加协调开销、延迟和失败模式。
- Orchestrator-worker 只用于独立、可并行、超出单上下文的任务；强依赖、共享上下文过多的任务不拆。
- 多 agent 成本要显式预估（业界量化：单 agent 约 4x chat，multi-agent 约 15x chat），并在 run 前设置 cost/token 上限。
- 确定性 supervisor：路由、重试、审批、超时、dead-letter 都由非 LLM 状态机承担。

## 5. 事件一致性合同

已有资产（源码级已核实）：

- `hub-server/internal/service/deliveryoutbox/`：`RecordDelivery` / `MarkDeliverySent` / `AckDelivery` / CAS claim / 指数退避 / dead-letter / 7 天 purge。
- `hub-server/internal/service/agent/agent_edge_callback.go`：`client_msg_id` 幂等去重；stream+seq 写入走事务。
- `api/events.md`：at-least-once、`EventEnvelope.seq/id`、UPSERT / idempotent / watermark / ephemeral 标签、`agent.dispatch` 带 `task_id + delivery_id`。

目标合同（P0 审计对象，不是已实现事实）：

1. 业务变更与 outbox 写入**同一本地事务**；先产生稳定 `event_id/delivery_id`，再落 outbox row。
2. 事件携带 `aggregate_version`；consumer 用 inbox 幂等，拒绝旧版本，允许重放收敛。
3. relay 用 lease/CAS claim；ack 前 crash 允许重复发布，因此 consumer 幂等是硬约束。
4. 明确 per-aggregate / per-tenant / global 的排序级别；不做隐式全局顺序。
5. 事件日志必须有 snapshot + retention/cursor 只前进策略，避免无限 replay。
6. payload 是合同：插入后不可变，按 version 演进，不含 secret/不必要的个人数据。

审计完成标准：集成测试覆盖“业务回滚则无事件、relay 重复发送收敛、旧版本拒绝、restore/redrive 重放安全”。

## 6. 安全与最小代理权

已有资产：TokenDance ID 只证身份、Hub-local 授权分离；Web/Mobile Hub-only；Desktop renderer 无 raw process；`env_sanitizer` / `tool_allowlist` / `security_hooks` / 出站 egress；JWT rotation/revoke/jti blacklist/`auditPermission`。

演进合同：

1. **least agency 而非 least privilege**：task-scoped、time-bound 凭据；每个 privileged action 都过集中 policy engine，而不是只在发 token 时授权一次。
2. per-tool capability token / 短 TTL；user access token、agent session、tool credential 分层，不互相复用。
3. run 级临时凭据；secret 不进入 agent context、sandbox 或日志。
4. 审批是确定性 broker：pending/decided 状态机、iteration cap、timeout 默认拒绝或安全降级；禁止模型自评。
5. sandbox 按风险分级：本地受限 sandbox（当前 Edge 边界）与远端 untrusted code（microVM/gVisor、egress allowlist、DNS 限制、非 root、短生命周期）分开授权。
6. gateway 单入口：远端 runtime 只接受 gateway 来源的调用，否则所有 guardrail 会被绕过；client backend 自己维护 session<->user mapping。

## 7. 可观测

- 现状：Hub Prometheus 覆盖 HTTP/WS/DB/Redis/outbox/auth/audit；`edge-server/internal/runnerctx/session_metrics.go` 有本地 token/cost 记录。未发现 OTel GenAI span 导出。
- 目标：一条 trace 贯穿 `runId -> agentId -> model/tool span -> token/cost -> approval -> artifact`，按 [OTel GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) 打点。
- 审计关联字段：agent id、tenant、action、resource、input/output hash、approver、trace id、result。

## 8. 前端与工程化

- UI 主叙事是聊天时间线；Evidence / Artifact / Approval 围绕时间线渐进披露，不做全屏堆叠。
- `app/shared/src/platform/types.ts` 已有 `SurfaceCapabilities` + Conversation/Run/Attachment/Preview/Checkpoint/Workspace/Terminal 等 ports；需要补显式 `approval / runtimeEvidence / remoteExecution / sandbox` 能力域，并用 package exports + import boundary verifier 把边界机器化。
- issue-as-spec：大型任务 issue 必须含 Summary / Scope / Files / Interfaces / Invariants / Acceptance / Negative Constraints / Dependencies / File Ownership；缺项先补 spec 再派发。
- 一个 worktree 一个写 agent；主线负责最终验收与合并裁决。merge queue 引入前先验证 `merge_group` 与 `paths-filter` 兼容性。

## 9. 差距与路线图

| 优先级 | 工作 | 现状 | 验收 |
|---|---|---|---|
| P0 | 事件一致性审计 | outbox 骨架已存在 | 业务同事务、event version、幂等、snapshot 集成测试 |
| P0 | 权限最小面 | 身份/会话基础已有 | task-scoped + per-action 授权可审计 |
| P0 | 审批 broker 状态机 | 事件与控制面已有 | timeout 默认拒绝、iteration cap、可回放 |
| P1 | MCP/A2A/AG-UI capability mapping | 已成文（docs/architecture/11-protocol-capability-mapping.md） | mapping 文档与自有契约不冲突 |
| P1 | OTel GenAI 可观测 | 本地 cost/token 有，无 OTel span | 一条 trace 可查 run/tool/model/cost |
| P1 | 远程执行安全契约 | 已有 egress 边界 | gateway 单入口 + session 隔离真实证据 |
| P2 | command-center UI / capability 域补齐 | shared/workbench 已分层 | 行为断言 + Visual QA |
| P2 | issue-as-spec + eval harness | 已接近 | 模板落地 + agent effectiveness eval |

## 10. Anti-goals

- 不让 LLM 当控制面/supervisor；路由、授权、审批、重试必须 deterministic。
- 不并行引入 MCP + A2A + AG-UI 三套内部协议。
- 不让 Web/Mobile 直连 Local Edge。
- 不现在上 CRDT；先 event log + snapshot，确有并发协作编辑场景再评估。
- 不让模型自评审批/完成度；`real_tested` 与 9 级证据等级继续是唯一真实性口径。
- 不在真实 E2E/approved-real 证据前宣称远程执行、sandbox、发布“生产就绪”。

## 11. 来源与证据等级

- 已读全文：AWS AgentCore 安全实践（microVM、gateway 单入口、MMDSv2）、FlowVerify local-first sync、OneUptime transactional outbox、AG-UI、A2A v1.0 spec、OTel GenAI conventions。
- snippet 级：Google Cloud Gemini Enterprise Agent Platform、OpenAI Agents SDK（官方页 403）、OWASP ASI 官方页（429）、NVIDIA OpenShell / AgentScope / AISA（页面 timeout，靠搜索交叉验证）。
- 本地源码级：上文标注的 Go/TS 文件路径。

## 12. 未验证清单

- checkpoint 写回恢复是否接线。
- `agent.dispatch` 业务变更与 outbox 是否同事务；事件是否有 aggregate version/snapshot。
- Hub 是否已有完整 resource-action 权限层（本轮只确认身份与 session 层）。
- 远程执行是否已有真实 E2E 证据。
- 开放 Issue #2064 的五项低风险发现仍是独立待办，不在本文范围内关闭。

## 13. 治理入口

- 规则常驻面：`AGENTS.md` 宏观工程设计基线（引用主题名，不写章节编号）。
- 决策摘要：`docs/decisions.md` ADR-025 / ADR-026。
- 机器验证映射：`docs/governance/verifier-map.md`（新增规则目前为“无”机器门禁）。