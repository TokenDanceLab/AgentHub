# ADR-010: MCP Server 端点设计

## Status

Accepted

## Context

AgentHub 需要让外部 AI 工具（如 Cursor、Claude Desktop、Windsurf 等）能够通过标准协议访问其核心能力：

- **项目管理**：列出/创建/切换项目。
- **会话管理**：创建线程、发起 Run、查看历史。
- **运行控制**：启动/取消/查看 Agent 运行状态。

如果为每个外部工具实现专用集成，会导致 N*M 的集成复杂度。需要一个符合行业标准的协议层，使任何支持该协议的工具都能接入。

Anthropic 提出的 **Model Context Protocol (MCP)** 已成为 AI 工具互操作的事实标准，被 Cursor、Claude Desktop、VS Code 等主流工具支持。

## Decision

在 Edge Server 的 `internal/mcp` 包中实现 **JSON-RPC 2.0 MCP Server**，使用 Streamable HTTP Transport：

### 协议层

- 实现 MCP 协议版本 `2024-11-05`。
- Server name: `agenthub-edge`，通过 `initialize` 握手暴露 capabilities。
- 支持标准 JSON-RPC 2.0 请求/响应/通知格式。
- 错误码遵循 JSON-RPC 标准（-32700 parse error, -32600 invalid request, -32601 method not found, -32602 invalid params）。

### Tools 暴露

将 AgentHub 核心能力暴露为标准 MCP tools：
- **project_list** / **project_create** — 项目 CRUD。
- **thread_list** / **thread_create** — 会话线程管理。
- **run_start** / **run_cancel** / **run_status** — Agent 运行控制。

每个 tool 的 inputSchema 使用 JSON Schema 定义，由 `tools.go` 中的 `toolsList()` 函数声明。

### 传输层

- HTTP endpoint: `POST /mcp` — 接收 JSON-RPC 请求。
- `GET /mcp` — SSE 流式通知（可选）。
- 复用 Edge Server 现有的 HTTP server（`internal/httpserver`）和认证中间件。

### 安全

- 复用 Edge Server 的 JWT 认证中间件（`internal/middleware`）。
- CORS 策略需要支持本地开发工具（Cursor、Claude Desktop）的跨域请求。
- 敏感操作（如 run_start）需要额外的权限校验。

## Consequences

**正面：**
- 符合 Anthropic MCP 标准，任何 MCP 客户端（Cursor、Claude Desktop、VS Code Copilot）可直接接入。
- 复用 Edge Server 已有的 lifecycle/store/events 基础设施，实现成本低。
- 新增 AgentHub 能力只需在 `tools.go` 中注册新 tool，无需修改协议层。

**负面：**
- MCP 协议仍在演进中（当前 2024-11-05），可能需要跟进 breaking changes。
- 认证机制需要兼容 MCP 客户端的 token 传递方式（部分客户端不支持自定义 header）。
- CORS 策略需要针对本地开发工具做白名单，增加安全配置复杂度。
- 需要在 Edge Server 本地运行时才能访问 MCP 端点，远程工具需要通过 Hub 中继（尚未实现）。
