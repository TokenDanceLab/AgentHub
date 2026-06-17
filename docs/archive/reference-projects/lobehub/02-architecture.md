# LobeHub 架构深度分析

## 1. 进程/服务拓扑

```
┌─────────────────────────────────────────────────────┐
│                    LobeHub Server                     │
│                                                       │
│  Next.js App Router (src/app/)                        │
│  ├── (backend)/webapi/     ← REST API 层             │
│  │   ├── models/           ← 模型供应商管理           │
│  │   ├── agents/           ← Agent 创建/运行          │
│  │   ├── sessions/         ← 会话管理                 │
│  │   └── plugins/          ← 插件市场                 │
│  ├── (main)/               ← 前端页面                │
│  │   ├── chat/             ← 聊天主界面               │
│  │   ├── market/           ← Agent/插件市场           │
│  │   └── settings/         ← 用户设置                 │
│  └── api/                  ← Next.js Route Handlers   │
│                                                       │
│  Database Layer (Drizzle ORM)                         │
│  ├── PostgreSQL (primary)                             │
│  └── Redis (cache/session)                            │
│                                                       │
│  Agent Runtime (packages/agent-runtime/)               │
│  ├── GeneralChatAgent     ← 主 Agent 决策循环         │
│  ├── GraphAgent           ← 图 Agent（LangGraph）     │
│  └── groupOrchestration/  ← 多 Agent 编排             │
│                                                       │
│  External Services                                    │
│  ├── Claude Code (via builtin-tool-claude-code)       │
│  ├── MCP Servers (via builtin-tool-*)                 │
│  └── TTS/STT/Search/RAG plugins                       │
└─────────────────────────────────────────────────────┘
```

## 2. Agent 决策循环状态机

这是 LobeHub 最核心的设计——AgentHub M3b Orchestrator 的直接模板。

```
                  ┌──────────┐
                  │  IDLE    │
                  └────┬─────┘
                       │ user_input
                  ┌────▼─────┐
                  │ CALL_LLM │◄────────────────────────┐
                  └────┬─────┘                         │
                       │ llm_result                     │
                  ┌────▼─────┐                         │
                  │ CHECK    │                         │
                  │ TOOLS    │                         │
                  └────┬─────┘                         │
                       │                               │
          ┌────────────┼────────────┐                  │
          ▼            ▼            ▼                  │
     no tools    safe tools    needs approval          │
          │            │            │                  │
          ▼            ▼            ▼                  │
      ┌──────┐  ┌──────────┐  ┌──────────┐           │
      │FINISH│  │CALL_BATCH│  │REQUEST   │           │
      └──────┘  │ (auto)   │  │APPROVAL  │           │
                └────┬─────┘  └────┬─────┘           │
                     │             │                   │
                     │        ┌────▼─────┐            │
                     │        │ WAITING   │            │
                     │        │ (human)   │            │
                     │        └────┬─────┘            │
                     │             │ approved          │
                     ▼             ▼                   │
                ┌────────────────────┐                 │
                │  CALL_TOOLS_BATCH  │                 │
                │  (merged results)  │                 │
                └────────┬───────────┘                 │
                         │ tool_results                │
                         └─────────────────────────────┘
```

**AgentHub Go 端对应实现位置**：
- `edge-server/internal/adapters/orchestrator.go` — 当前只是转发，无决策循环
- 需要新增 `edge-server/internal/orchestrator/decision_loop.go`

## 3. 关键边界处理

| 边界场景 | LobeHub 处理 | AgentHub 应借鉴 | 实现位置 |
|------|------|------|------|
| LLM 调用超时 | AbortController + 重试（3次指数退避） | `context.WithTimeout` + retry | `lifecycle/process_executor.go` |
| 工具调用失败 | 单个工具失败不影响其他工具（独立 batch 隔离） | 批量工具调用时 per-tool error channel | `orchestrator/` (new) |
| 人工审批超时 | 可配置超时（默认 5min），超时自动拒绝 | PermissionDialog 增加超时倒计时 | `app/desktop/src/components/PermissionDialog.tsx` |
| 上下文溢出 | `shouldCompress()` 检测 + auto-summarize | ContextBudget 模型（已设计，未实现） | `edge-server/internal/context/` |
| Agent 间通信 | 通过消息队列 + shared state | TODO: Hub 的消息路由 | `hub-server/internal/service/message.go` |

## 4. 与 AgentHub 架构对照

| LobeHub 组件 | AgentHub 对应 | 差距 |
|------|------|:--:|
| `packages/agent-runtime/src/agents/GeneralChatAgent.ts` | `edge-server/internal/adapters/orchestrator.go` | **大** — AgentHub 无决策循环 |
| `packages/builtin-tool-claude-code/` | `edge-server/internal/adapters/claude_code.go` | 小 — AgentHub 已实现基础适配 |
| `packages/database/src/models/session.ts` | `hub-server/internal/model/session.go` (Johnny) | 中 — schema 结构参考 |
| `src/app/(backend)/webapi/models/` | `edge-server/internal/adapters/model_config.go` | 小 — AgentHub 已有基础 |
| `plugins/` 插件市场 | AgentHub M5 规划 | **大** — 整个模块缺失 |
| `src/app/(main)/chat/` 聊天 UI | `app/desktop/src/components/ChatView.tsx` | 中 — UI 品质差距 |
| `builtin-tool-group-agent-builder` | AgentHub M3b Orchestrator | **大** — 多 Agent 编排缺失 |
