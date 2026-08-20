# Runtime Adapters

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-20

## 概述

Edge Server 的 adapter 层负责将不同 Agent Runtime 的协议统一为内部 `RunEvent` 流。所有 adapter 实现统一的 Go interface，Edge 不关心底层 Agent 的具体协议差异。

`internal/adapters/` 已按 Agent 家族归组为叶子子包（[#1760]，见 [02-edge-server.md](02-edge-server.md) §Adapter 家族子包）：`claude/`、`codex/`、`opencode/`、`orchestrator/`、`sdk/`；共享机制（`AcpAdapter`、NDJSON parser、registry）留在根包。下表文件列给出子包内路径（未标注的仍在根包平铺区）。

[#1760]: https://github.com/TokenDanceLab/AgentHub/issues/1760

## CLI Adapters

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| Claude Code (ACP) | `claude-acp` | `claude/claude_acp.go` | 官方 `@agentclientprotocol/claude-agent-acp` 0.62.0 二进制 + `ANTHROPIC_API_KEY`，embed `AcpAdapter`（coder/acp-go-sdk） |
| Codex (ACP) | `codex-acp` | `codex/codex_acp.go` | 官方 `codex-acp` 1.1.7 二进制 + `OPENAI_API_KEY`，embed `AcpAdapter` |
| OpenCode (ACP) | `opencode-acp` | `opencode/opencode_acp.go` | 原生 ACP 模式 `opencode acp` + 4 provider key passthrough，embed `AcpAdapter` |
| Claude Code (legacy) | `claude-code` | `claude/claude_code.go` ⚠️ DEPRECATED | 旧手写 stream-json parser，仅保留作 orchestrator inner；Phase B 移除 |

> `codex.go` / `opencode.go`（旧手写批处理 parser）已在 ACP 收敛（阶段 A）中删除，运行时统一走 ACP 层。

### ACP 迁移（2026-08，对标 codeg 官方 Wrapper）

ACP 协议层**禁止手写 JSON-RPC loop**，必须用官方 Wrapper/适配层（对标 codeg）。三大家 CLI adapter 已接入官方 ACP 层，并成为**默认执行路径**（阶段 A 收敛完成）：

- **协议边界**：100% 官方 adapter 二进制（claude-agent-acp / codex-acp / opencode 原生 ACP），Go runtime 用 `coder/acp-go-sdk` v0.13.5（Coder/Windsurf 厂维护，官方收录，从官方 schema 生成类型 + 自带 JSON-RPC 连接层）
- **runtime 共享层**：`acp.go` `AcpAdapter`（SDK `acp.Client` 接口 9 方法自动分发）+ `acp_events.go`（typed 映射 `acp.SessionUpdate` → `run.agent.*`）+ `acp_client.go`（client skeleton）
- **审批链**：`request_permission` → `Responder` → `PermissionDecisionBroker`（复用既有 broker，零新协议）
- **默认注册**：`claude-acp` / `codex-acp` / `opencode-acp` 默认注册（空 launcher 回退平台原生 `npx`/`opencode`）；`--agent-default` 与 `--runner-profile` 默认 cutover 到 `*-acp`。真跑验证需 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` + npx registry 网络。进度与剩余项见 GitHub issues（ACP migration 跟踪）。

### CLI 执行模式

所有 CLI adapter 遵循以下统一模式：

1. Edge 启动 Agent CLI 进程
2. Agent 输出 JSON stream 到 stdout
3. Edge 解析 stream，normalize 为 `RunEvent`
4. `RunEvent` 流入 EventStore，经 WebSocket 推送到前端

## SDK HTTP Adapters

| Adapter | 注册 ID | 文件 | 调用方式 |
|---------|---------|------|---------|
| `AnthropicSDKAdapter` | `anthropic-sdk` | `sdk/anthropic_sdk.go` | HTTP direct call Anthropic Messages API + SSE streaming |
| `OpenAISDKAdapter` | `openai-sdk` | `sdk/openai_sdk.go` | HTTP direct call OpenAI Chat Completions API + SSE streaming |

### 特征

- 注册标志：`--anthropic-sdk-path` / `--openai-sdk-path`
- API key 通过环境变量注入（flag 值为 `env` 或空时从环境变量读取，否则直接使用 flag 值作为 key）
- 无外部 SDK 依赖，纯 `net/http`
- Key 缺失时 `Available=false`，不阻塞 Edge 启动
- 属于 `sdkAdapterIDs`，`IsSDKAdapter()` 返回 true
- 重试机制：指数退避 + jitter（最大 3 次，1s/2s/4s (±25%)），匹配 `anthropic_sdk.go` 的 `doRequestWithRetry` 模式（v0.5.2+）

## Orchestrator Adapter

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| `OrchestratorAdapter` | `orchestrator` | `orchestrator/orchestrator.go` | 群聊编排：包装 Claude Code + 系统提示，分解任务并分发给子 Agent |

- 仅在 `--claude-code-path` 非空时自动注册
- 作为 `orchestrator` 角色的默认 adapter
- 自动发现已注册的子 Agent（`claude-code`、`codex-acp`、`opencode-acp`、`anthropic-sdk`、`openai-sdk`），生成调度提示
- 支持子 Agent 并发调度（默认 10）；子 Agent 失败恢复由 lifecycle `FaultEscalation` 统一承担（自动重试 + in-context 自纠错，见 [02-edge-server.md](02-edge-server.md) §Run Lifecycle）

### Dispatch Interceptor 内部组件

Orchestrator 的 `ParseStream` 在 Claude Code 输出流上包装了 `dispatchInterceptor`，负责拦截文本事件、解析 dispatch JSON、执行分发和结果回注。Interceptor 内部包含以下子层：

| 子层 | 位置 | 职责 |
|------|------|------|
| **Rule Engine** (T2-A08) | `orchestrator/orchestrator_dispatch_interceptor.go` `applyRuleEngine` / `ruleEnginePreprocess` | 文本级和事件级的确定性预处理：完成信号检测（done/finish/completed 关键词匹配）、审批决策关键词短路（yes/no/approve/reject 跳过 JSON 解析）、单 finish dispatch 跳过优化、同 Agent 批量 dispatch 自动转顺序执行 |
| **Plan Approval Gate** (P0 #3) | `orchestrator/plan_approval.go` `PlanApprovalBroker` | 在 dispatch 前暂停，发出 `plan.proposed` 事件并等待用户审批；支持超时自动批准（默认 60s） |
| **Fan-Out Pool** | `orchestrator/orchestrator_dispatch_interceptor.go` `fanOutDispatches` / `fanOutSequential` | 信号量限制并发（默认 10），注入兄弟 Agent 上下文避免 workspace 文件冲突；同 Agent 批量自动降级为顺序执行 |
| **Result Listener** | `orchestrator/orchestrator_dispatch_results.go` `runResultListener` / `handleSubAgentResult` | 通过消息队列接收子 Agent 结果/错误，注入回 orchestrator 文本流，触发进度汇总 |
| **Failure Recovery** | lifecycle `FaultEscalation`（`internal/lifecycle/fault_escalation.go`） | 已收敛（#4ddde5b，2026-08-14）：删除 `orchestrator_failure.go`/`FailureRecoveryManager`/断路器三态/Reflexion，失败恢复改为纯自动重试（`MaxRetries` 默认 1，`AGENTHUB_MAX_RETRIES` 可调）+ 错误 review/replan 由 agent in-context 自纠错 |

**Rule Engine 规则说明**（按评估顺序）：

1. **完成信号检测**：匹配独立完成信号（`done`、`finish`、`all tasks done` 等），短路跳过 JSON 解析并发出进度汇总。多词短语在任意长度文本匹配；单词信号仅在 80 字符内匹配以避免误触发。
2. **审批决策关键词**：当 `PlanApprovalBroker` 存在且文本 ≤40 字符时，匹配独立决策关键词（`yes`/`no`/`approve`/`reject`/`deny` 等），短路跳过 JSON 解析。
3. **单 finish dispatch 跳过**：当 orchestrator 发出仅含完成语义描述的单个 dispatch 时，跳过 fanOut 直接发出进度汇总。
4. **同 Agent 顺序执行**：当所有 dispatch 都指向同一 Agent 时，自动从并发 fanOut 降级为顺序执行，避免单个 adapter 的实例内竞争。

**Failure Recovery 现状**（旧决策矩阵已随 #4ddde5b 删除）：

> 旧 `FailureRecoveryManager` 的三分类（transient/capability/cancel）+ 断路器（Closed/Open/Half-Open）决策矩阵已于 2026-08-14 删除，不再维护。当前失败处理为 lifecycle `FaultEscalation` 纯自动重试（`MaxRetries` 默认 1）+ agent in-context 自纠错，见上表 Failure Recovery 行。

## Runtime Manifest / Fixture（测试/开发辅助，不计入生产 adapter 数）

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| `RuntimeManifestAdapter` | 由 manifest JSON 定义 | `runtime_manifest.go` | 基于 JSON manifest 的自定义 fixture adapter |

- 通过 `--runtime-manifest` 标志注册（可重复），env `AGENTHUB_RUNTIME_MANIFESTS`
- Manifest schema: `agenthub-runtime-manifest-v1`
- Fixture 类型：`fixture-file`（从文件回放）和 `fixture-subprocess`（启动子进程）
- 支持 `--agenthub-runtime-fixture-replay` 独立回放模式
- `AgentSpec fixture` 使用此机制注册 demo runtime/profile

## PreflightCheck 接口

```go
// PreflightCheck 在真实执行前检查必要条件，快速失败
type PreflightCheck interface {
    PreflightCheck() error
}
```

`PreflightCheck` 接口定义在 `adapter.go`。所有 adapter 均实现：预检 launcher 二进制 / API key 是否存在，缺失时返回描述性错误而非进程启动后失败（例如 `codex-acp` 预检 `npx` launcher，`claude-code` 预检 `ANTHROPIC_API_KEY`）。

## 事件映射合同

所有 adapter 必须将底层 Agent 事件 normalize 到统一的 `RunEvent` 类型：

```text
Agent 原生输出 -> Adapter normalize -> RunEvent -> EventStore -> WS -> Transcript
```

`RunEvent` 映射到前端 `TranscriptBlock` 的关系：

| RunEvent 类型 | TranscriptBlock 类型 |
|---|---|
| text | text |
| thinking | thinking |
| tool_call | tool_call |
| tool_result | tool_result |
| diff | diff |
| approval_request | approval |
| artifact | artifact |
| deploy | deploy |
| error | error |

## 动态模型路由（cc-switch 集成）

Edge Server 支持通过 cc-switch 透明代理实现动态模型路由。当 cc-switch 在本机安装并激活时，Edge 启动阶段会调用 `ConsumeCCSwitchModels()` 读取 `~/.cc-switch/cc-switch.db`，将 cc-switch 配置的 provider 模型别名合并到静态 `ModelAliases` 表中。

### 合并规则

- cc-switch 动态别名覆盖同 key 的静态别名（例如 cc-switch 将 `sonnet` 映射到 `deepseek-v4-pro` 时，静态 `claude-sonnet-4-6` 被替换）。
- 未冲突的静态条目保留（不会被删除）。
- 只消费 `appTypeToAgentID` 映射中已知的 app_type（`claude → claude-code`）。codex / opencode 已迁移到 ACP，模型解析在 ACP 进程内完成，不再走本表。

### 优雅降级

cc-switch 是可选增强，不是硬依赖。数据库缺失、不可读或无可用 provider 时，`ConsumeCCSwitchModels()` 返回 error，Edge 记录 WARNING 日志后以静态配置继续运行——不影响 Edge 正常启动和服务。

### 对用户的意义

当 cc-switch 激活时，用户在 AgentHub 中选择 "claude-sonnet" 可能实际运行在 DeepSeek、GLM 或 Qwen 等后端上，无需修改 AgentHub Profile。这是 cc-switch 为 Claude Code / Codex CLI 提供的同一透明代理机制，现在已对 Edge Server adapter 模型解析层开放。

实现细节见 `edge-server/internal/adapters/model_config.go`（`ConsumeCCSwitchModels`）和 `edge-server/internal/ccswitch/reader.go`。

## 权限桥接

- Desktop 文件操作必须经过 allowlist 和 typed Host API
- Edge 不直接暴露文件系统给 Hub
- Hub -> Edge 的执行请求通过 REST callbacks，Edge 校验后才启动 runtime

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge Server 整体架构
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 adapter 产生的事件
- [06-auth-identity.md](06-auth-identity.md) — 认证和权限体系
