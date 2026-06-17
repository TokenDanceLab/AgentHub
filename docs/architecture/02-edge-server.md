# Edge Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-17

## 职责

Edge Server（`edge-server/`）是本机执行层：

- 本地项目管理
- Thread 管理
- Context Builder（构建 Agent 执行上下文）
- Run lifecycle（一次执行的生命周期管理）
- Agent Runtime adapter（统一不同 Agent CLI/SDK 的协议）
- Artifact index（产物索引）

## 在架构中的位置

```text
Desktop shared workbench
  -> Desktop platform adapter
  -> Local Edge Server           <-- 本文档（执行 / Thread / Run / Artifact）
  -> AgentAdapter
  -> Claude Code / Codex / OpenCode
```

```text
Web shared workbench
  -> Web platform adapter
  -> Hub Server
  -> Edge routing / relay
  -> Edge Server                 <-- 本文档（远程）
  -> AgentAdapter
```

## 组件总览

| 组件 | 职责 |
|---|---|
| 项目管理 | 本地 workspace 的项目发现和注册 |
| Thread | 会话线程管理，上下文窗口维护 |
| Context Builder | 从 AGENTS.md、memory、Skill、MCP 等构建执行上下文 |
| Run lifecycle | 单次 Agent 执行的完整生命周期 |
| AgentAdapter | 将不同 Agent Runtime 的协议统一为 `RunEvent` 流 |
| Artifact index | Agent 产物的索引、预览和应用 |
| EventStore | 执行事件的持久化存储 |

## 与 Hub 的通信

| 方向 | 方式 |
|---|---|
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Edge -> Hub | 同步、状态上报 |

## Adapter 注册表

Edge 维护一个 adapter registry，根据 runtime type 分发到对应 adapter：

- CLI Adapters：Claude Code、Codex、OpenCode
- SDK HTTP Adapters：Anthropic SDK、OpenAI SDK

详见 [03-runtime-adapters.md](03-runtime-adapters.md)。

## Agent 产品模型中的角色

| 概念 | Edge 的角色 |
|---|---|
| Agent Runtime | adapter registry 管理 |
| Agent Profile | 本地 profile 存储 |
| Agent Configuration | Context Builder 构建 |
| Execution Target | 本地注册、remote/cloud 路由 |
| Run Session | lifecycle + EventStore |

## 事件流

```text
Agent Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript
```

```text
RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview
```

```text
Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers
```

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub 与 Edge 的同步和中继关系
- [03-runtime-adapters.md](03-runtime-adapters.md) — 所有 adapter 的详细规范
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 Edge 事件
