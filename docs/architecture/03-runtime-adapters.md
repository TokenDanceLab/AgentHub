# Runtime Adapters

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 概述

Edge Server 的 adapter 层负责将不同 Agent Runtime 的协议统一为内部 `RunEvent` 流。所有 adapter 实现统一的 Go interface，Edge 不关心底层 Agent 的具体协议差异。

## CLI Adapters

| Adapter | 文件 | 功能 |
|---------|------|------|
| Claude Code | `edge-server/internal/adapters/claude_code.go` | 真实 CLI 执行验证通过，`claude --output-format stream-json` |
| Codex | `edge-server/internal/adapters/codex.go` | PreflightAdapter 预检 `OPENAI_API_KEY`，env var 透传 |
| OpenCode | `edge-server/internal/adapters/opencode.go` | `--session` 仅在 resume 时传递 |

### CLI 执行模式

所有 CLI adapter 遵循以下统一模式：

1. Edge 启动 Agent CLI 进程
2. Agent 输出 JSON stream 到 stdout
3. Edge 解析 stream，normalize 为 `RunEvent`
4. `RunEvent` 流入 EventStore，经 WebSocket 推送到前端

## SDK HTTP Adapters

| Adapter | 文件 | 调用方式 |
|---------|------|---------|
| `AnthropicSDKAdapter` | `edge-server/internal/adapters/anthropic_sdk.go` | HTTP direct call Anthropic Messages API + SSE streaming |
| `OpenAISDKAdapter` | `edge-server/internal/adapters/openai_sdk.go` | HTTP direct call OpenAI Chat Completions API + SSE streaming |

### 特征

- 注册标志：`--anthropic-sdk-path` / `--openai-sdk-path`
- API key 通过环境变量 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 注入
- 无外部 SDK 依赖，纯 `net/http`
- Key 缺失时 `Available=false`，不阻塞 Edge 启动

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
