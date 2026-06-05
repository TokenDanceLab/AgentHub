# Langflow & Flowise Source Adoption Map → AgentHub

> 从 Langflow/Flowise 源码到 AgentHub Go/TypeScript 实现的精确映射。
> 每项: Langflow/Flowise file:line → AgentHub file:line → 具体变更 → P0/P1/P2。
> 已有文档: `01-langflow.md`, `02-flowise.md`, `03-mcp-integration.md` — 本文件聚焦代码级映射和未覆盖维度。

---

## 1. tool_mode=True 三级提升链 → AgentHub Tool Pipeline

### 1.1 ComponentToolkit.get_tools()

```
Langflow: src/lfx/src/lfx/base/tools/component_tool.py:196-212
  _should_skip_output(output) → 检查 output.tool_mode + 过滤 Tool 类型 output
  get_tools():
    1. 收集 tool_mode=True 的 inputs → create_input_schema() 生成 Pydantic arg_schema
    2. deepcopy(component) 创建隔离副本 (并发安全)
    3. comp.set(*args, **kwargs) 设置输入
    4. output_method() 执行
    5. _patch_send_message_decorator → no-op (作为 tool 不推送 UI 消息)
    6. 包装为 LangChain StructuredTool

AgentHub: edge-server/internal/adapters/adapter.go:23-43
  AgentAdapter 无 tool 级抽象。CLI 自身的 tool 能力通过 NDJSON stream 的事
  件解析间接暴露，AgentHub 不管理 tool 定义/序列化/注册。
```

**差异**: Langflow 的 `tool_mode=True` 是一个精巧的设计——同一个 Component output 不加修改即可从 Canvas tool 变为 Agent tool 再变为 MCP tool。AgentHub 完全依赖 CLI agent 的内置 tool 能力。

**建议 P0**: 废弃无意义——AgentHub P0 不需要完整的 tool pipeline。但 `tool_mode=True` 的设计理念值得借鉴：当 AgentHub 引入自定义 tool 时，tool 定义应与执行上下文解耦，使同一 tool 可用于 agent/API/MCP 三个通道。

### 1.2 _patch_send_message_decorator 防止 UI 推送

```
Langflow: src/lfx/src/lfx/base/tools/component_tool.py:44-52
  send_message_noop → 替换 component.send_message → 当 tool 被 Agent 调用时
  不向 UI 推送消息（消息由 Agent 上下文管理）

AgentHub: edge-server/internal/adapters/parser_ndjson.go
  ParseStream 将 CLI 的所有输出都作为事件发射，无法区分 "tool 内部输出" vs "面向用户的输出"。
```

**建议 P2**: 在事件发射层增加 `internal` flag。tool 执行期间产生的中间事件标记为 `internal: true`，前端可选择隐藏（只显示 tool_call/tool_result 边界）。

---

## 2. Flowise Agentflow V2 多 Agent 架构

### 2.1 Supervisor/Worker 模式

```
Flowise: packages/components/nodes/multiagents/
  Supervisor 节点 → LLM + tools 路由 worker 选择
  Worker 节点 → 独立 Agent 执行
  四种多 Agent 模式已在 02-flowise.md §2.1-2.4 详细描述

AgentHub: edge-server/internal/adapters/orchestrator.go:17-69
  OrchestratorAdapter → 通过 Claude Code system prompt 分解任务
  单一 coordinator 模式，无 Worker 节点的独立 capability 配置。
```

**差异**: Flowise 的 Supervisor 是显式的 LLM 调用 + tool 路由——Supervisor LLM 决定下一个 worker 并传递任务。AgentHub 的 Orchestrator 完全依赖 Claude Code 的 system prompt 做隐式路由。

**建议 P1**: 在 Orchestrator 中引入显式的 worker routing config。每个 worker agent 定义 `capability_tags`，Orchestrator 在分配任务时可按 tag 匹配而非纯语义推理。

```go
// edge-server/internal/adapters/orchestrator.go 修改
type WorkerAgent struct {
    AdapterID      string   `json:"adapterId"`
    Model          string   `json:"model"`
    CapabilityTags []string `json:"capabilityTags"` // "coding", "review", "testing"
}
```

### 2.2 AgentflowV2 Canvas 独立节点类型

```
Flowise: packages/ui/src/views/agentflowsv2/Canvas.jsx:56-64
  isValidConnectionAgentflowV2 → 连接约束 (agentFlow → agentFlow 可连，其他规则)
  IterationNode → 子画布循环

AgentHub: 无可视化画布。
```

**建议 P2**: 当 AgentHub 引入 workflow 可视化编辑器时，参考 Flowise V2 的独立节点类型设计（agentFlow node + iteration 子画布）。不与 Chatflow V1 共用画布组件。

---

## 3. MCP ComposerService → AgentHub MCP 自注册

### 3.1 tool_mode=True → 自动 MCP tool

```
Langflow: src/lfx/src/lfx/services/mcp_composer_service.py
  update_tools():
    收集所有 tool_mode=True 的 Component → 自动注册为 MCP tool
    → 每个 flow 自动获得 per-project MCP server endpoint

AgentHub: edge-server/internal/adapters/adapter.go:58-68
  Capabilities.MCPIntegration: true (间接, 通过 Claude CLI)
```

**差异**: Langflow 的 MCP server 是自动派生的——任何 `tool_mode=True` 的 Component 自动成为 MCP tool。AgentHub 无此自动派生能力。

**建议 P2**: 当 AgentHub 引入独立 MCP tool provider 后，参考 Langflow 的自动注册模式——任何注册到 ToolRegistry 的 tool 自动被 MCP server 发现。

---

## 4. ReactFlow 画布 → AgentHub 未来 UI

### 4.1 GenericNode 组件树

```
Langflow: src/frontend/src/CustomNodes/GenericNode/index.tsx
  handle-based wiring: inputs 作为 target handles, outputs 作为 source handles
  NodeStatus (build 状态指示)、NodeName、NodeDescription、NodeInputField、
  NodeOutputfield、OutputModal (支持切换视图)

Flowise: packages/ui/src/views/canvas/index.jsx:74
  isAgentCanvas → URL 判断决定节点菜单/标题/类型过滤

AgentHub: app/web/src/ (React + Vite)
  当前 UI 为自定义聊天组件，无可视化画布。
```

**建议 P2**: 当 AgentHub 需要 workflow 可视化时，ReactFlow (`@xyflow/react`) 是已验证的选择。关键实现点：handle-based wiring、自定义 Node 组件、Node 右键菜单、拖拽从 palette 添加。

---

## 5. Zustand Store 模式 → AgentHub 状态管理

### 5.1 14+ 独立 Zustand Stores

```
Langflow: src/frontend/src/stores/
  flowStore, messagesStore, playgroundStore, alertStore, authStore,
  tabsStore, sessionStore, ...

AgentHub: app/web/src/state/
  有限的 Zustand stores（预估 3-5 个）。
```

**建议 P2**: 随着 AgentHub Web App 功能增长，参考 Langflow 的细粒度 store 策略——按领域拆分 store（sessionStore、workspaceStore、agentStore、toolStore），而非单一大 store。

---

## 6. Agentflow SDK Domain-Driven Architecture

```
Flowise: packages/agentflow/src/
  ARCHITECTURE.md:187-228
  atoms/ (UI 原语) → features/ (领域功能) → infrastructure/ (外部服务) → core/ (纯 TS)
  依赖单向: features → {atoms, infrastructure} → core
  Features 之间禁止相互导入
  Core 是叶子节点，不依赖任何层

AgentHub: app/web/src/
  暂无明确的层级约束。
```

**建议 P2**: 当 AgentHub Web App 模块增多时，引入 Flowise Agentflow SDK 的层级约束：
- `core/` — 纯 TypeScript 类型和工具函数，零 React 依赖
- `infrastructure/` — API client、WebSocket manager
- `features/` — 按领域拆分 (chat, workflow, settings)
- `atoms/` — 无状态 UI 组件

---

## 7. Chatflow/Agentflow 列表页分离

```
Flowise: packages/ui/src/routes/MainRoutes.jsx
  /chatflows → Chatflows 列表 (卡片/表格视图切换)
  /agentflows → Agentflows 列表 (V1/V2 版本切换, 废弃提示横幅)

AgentHub: 无分离的列表页。会话列表使用统一视图。
```

**建议 P2**: 在 AgentHub Web App 中按 agent 类型分离列表页。Chat（单 agent 对话）和 Workflow（多 agent 编排）是不同的产品概念，应使用独立的列表入口。

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | tool_mode=True 设计理念 | **P0** | 设计参考，无直接代码映射 |
| 2 | Worker capability_tags 显式路由 | **P1** | `adapters/orchestrator.go:25-31` |
| 3 | MCP tool 自动注册模式 | **P2** | 新增 `hub-server/tool/mcp_provider.go` |
| 4 | internal event flag 过滤中间输出 | **P2** | `adapters/parser_ndjson.go` |
| 5 | ReactFlow 画布集成评估 | **P2** | 新建 `app/web/src/pages/FlowPage/` |
| 6 | Zustand 细粒度 store 拆分 | **P2** | `app/web/src/state/` |
| 7 | Agentflow SDK 层级约束 | **P2** | `app/web/src/` 目录结构 |
| 8 | Chat/Workflow 列表页分离 | **P2** | `app/web/src/pages/` |
