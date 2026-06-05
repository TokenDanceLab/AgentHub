# ADR-007: 三运行时统一适配器架构

## Status

Accepted

## Context

AgentHub 需要同时支持多种外部 Agent CLI 运行时：

- **Claude Code**：以 NDJSON 格式流式输出，通过 stdin 接收控制指令（permission response），支持 thinking/tool_use/file_change 等事件类型。
- **Codex**：以 JSONL 格式输出，支持 task_dispatched 子 agent 派生（AgentTree 模式），通过 control protocol 交互。
- **OpenCode**：以结构化 JSON 输出，会话管理方式与前两者不同。

三种运行时在输出格式、进程通信方式、能力集合上存在显著差异。如果前端或上层逻辑直接依赖某一运行时的具体实现，会导致：
1. 新增运行时时需要修改大量上层代码。
2. 前端必须感知 runtime 差异并做条件分支处理。
3. 测试和 mock 变得困难。

## Decision

在 Edge Server 的 `internal/adapters` 包中建立统一的 **AgentAdapter 接口**和 **AdapterRegistry**：

```go
type AgentAdapter interface {
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    BuildCommand(ctx RunProcessContext) (cmdPath, args, env, workDir)
    ParseStream(ctx, stdout, stdin, emitter, run) error
    NeedsStdin() bool
    Available() bool
}
```

每个运行时实现一个 Adapter（`claude_code.go`、`codex.go`、`opencode.go`），各自负责：
- 构建该 CLI 的 exec.Cmd 参数（BuildCommand）。
- 解析该 CLI 的 stdout 流并转换为统一的 EventEmitter 事件（ParseStream）。
- 声明自身能力集（Capabilities：Streaming、ToolCalls、FileChanges、PermissionHooks 等）。

Registry 提供 `Register`/`Get`/`Resolve`/`SetDefault` 方法，上层（lifecycle、orchestrator）通过 Registry 获取 Adapter，而非直接引用具体实现。

所有 Adapter 将运行时事件标准化为统一的 Bus 事件类型（`run.agent.text_delta`、`run.agent.tool_call`、`run.agent.file_change` 等 30+ 事件常量），通过 EventEmitter 接口投递到事件总线。

## Consequences

**正面：**
- 新增运行时只需实现 AgentAdapter 接口并注册到 Registry，无需修改任何上层代码。
- 前端通过 SSE 消费标准化事件，完全无需感知当前运行的是哪个 CLI。
- 每个 Adapter 可独立测试，EventEmitter 接口可轻松 mock。
- AgentCapabilities 允许 UI 根据当前运行时的能力动态调整展示（如隐藏不支持的 thinking 面板）。

**负面：**
- 统一事件模型需要覆盖所有运行时的能力超集，事件类型会持续膨胀（当前已有 30+ 事件常量）。
- 某些运行时的特有能力（如 Codex 的 AgentTree 子 agent 派生）需要通过 SubAgentSpawner 等额外接口暴露，增加了接口复杂度。
- Adapter 之间的行为差异（如 stdin 需求、流解析错误恢复策略）需要在 lifecycle 层做条件处理。
