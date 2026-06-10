# Runtime Adapters

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 概述

Edge Server 的 adapter 层负责将不同 Agent Runtime 的协议统一为内部 `RunEvent` 流。所有 adapter 实现统一的 Go interface，Edge 不关心底层 Agent 的具体协议差异。

## CLI Adapters

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| Claude Code | `claude-code` | `claude_code.go` | 真实 CLI 执行验证通过，`claude --output-format stream-json` |
| Codex | `codex` | `codex.go` | PreflightAdapter 预检 `OPENAI_API_KEY`，env var 透传 |
| OpenCode | `opencode` | `opencode.go` | `--session` 仅在 resume 时传递 |

### CLI 执行模式

所有 CLI adapter 遵循以下统一模式：

1. Edge 启动 Agent CLI 进程
2. Agent 输出 JSON stream 到 stdout
3. Edge 解析 stream，normalize 为 `RunEvent`
4. `RunEvent` 流入 EventStore，经 WebSocket 推送到前端

## SDK HTTP Adapters

| Adapter | 注册 ID | 文件 | 调用方式 |
|---------|---------|------|---------|
| `AnthropicSDKAdapter` | `anthropic-sdk` | `anthropic_sdk.go` | HTTP direct call Anthropic Messages API + SSE streaming |
| `OpenAISDKAdapter` | `openai-sdk` | `openai_sdk.go` | HTTP direct call OpenAI Chat Completions API + SSE streaming |

### 特征

- 注册标志：`--anthropic-sdk-path` / `--openai-sdk-path`
- API key 通过环境变量注入（flag 值为 `env` 或空时从环境变量读取，否则直接使用 flag 值作为 key）
- 无外部 SDK 依赖，纯 `net/http`
- Key 缺失时 `Available=false`，不阻塞 Edge 启动
- 属于 `sdkAdapterIDs`，`IsSDKAdapter()` 返回 true

## Orchestrator Adapter

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| `OrchestratorAdapter` | `orchestrator` | `orchestrator.go` | 群聊编排：包装 Claude Code + 系统提示，分解任务并分发给子 Agent |

- 仅在 `--claude-code-path` 非空时自动注册
- 作为 `orchestrator` 角色的默认 adapter
- 自动发现已注册的子 Agent（`claude-code`、`codex`、`opencode`、`anthropic-sdk`、`openai-sdk`），生成调度提示
- 支持子 Agent spawn 重试（最多 3 次，指数退避）和并发调度（默认 10）

## Runtime Manifest / Fixture Adapter

| Adapter | 注册 ID | 文件 | 功能 |
|---------|---------|------|------|
| `RuntimeManifestAdapter` | 由 manifest JSON 定义 | `runtime_manifest.go` | 基于 JSON manifest 的自定义 fixture adapter |

- 通过 `--runtime-manifest` 标志注册（可重复），env `AGENTHUB_RUNTIME_MANIFESTS`
- Manifest schema: `agenthub-runtime-manifest-v1`
- Fixture 类型：`fixture-file`（从文件回放）和 `fixture-subprocess`（启动子进程）
- 支持 `--agenthub-runtime-fixture-replay` 独立回放模式
- `AgentSpec fixture` 使用此机制注册 demo runtime/profile

## PreflightAdapter 接口

```go
// PreflightAdapter 在真实执行前检查必要条件，快速失败
type PreflightAdapter interface {
    Preflight(ctx context.Context) error
}
```

Codex adapter 实现了此接口：预检 `OPENAI_API_KEY` 是否存在，缺失时返回描述性错误而非进程启动后失败。

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

## 权限桥接

- Desktop 文件操作必须经过 allowlist 和 typed Host API
- Edge 不直接暴露文件系统给 Hub
- Hub -> Edge 的执行请求通过 REST callbacks，Edge 校验后才启动 runtime

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge Server 整体架构
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 adapter 产生的事件
- [06-auth-identity.md](06-auth-identity.md) — 认证和权限体系
