# Langflow & Flowise MCP/Agent 编排深度代码分析

> 源码：`D:\Code\AgentHub\reference\langflow\` 和 `D:\Code\AgentHub\reference\Flowise\`
> 分析日期：2026-05-21
> 关联文档：`langflow.md`、`flowise.md`、`cross-analysis-sandbox-tools.md`

---

## 1. Langflow `tool_mode=True` 的完整代码路径

### 1.1 三级提升链总览

Langflow 的核心设计洞察：同一个 Component output 可以不加修改地从 Canvas tool 变成 Agent tool 再变成 MCP tool。代码路径如下：

```
Component.output(tool_mode=True)
    │
    ├── [1] ComponentToolkit.get_tools()
    │       扫描 outputs 中 tool_mode=True 的，生成 LangChain StructuredTool
    │       ↓
    ├── [2] LCAgentComponent.build_agent()
    │       tools = self.tools  (包含 [1] 中生成的 StructuredTool)
    │       注入 AgentExecutor
    │       ↓
    └── [3] MCPComposerService / update_tools()
            所有 tool_mode=True 的 Component → MCP tool (自动注册到 per-project MCP server)
```

### 1.2 第 1 级：Component → LangChain Tool

**入口文件**：`src/lfx/src/lfx/base/tools/component_tool.py`

`ComponentToolkit` 类扫描 Component 的所有 output，筛选 `tool_mode=True` 的输出：

```python
# component_tool.py:196-212
def _should_skip_output(self, output: Output) -> bool:
    return not output.tool_mode or (
        output.name == TOOL_OUTPUT_NAME
        or any(tool_type in output.types for tool_type in TOOL_TYPES_SET)
    )
```

对每个入选 output，`get_tools()` (行 214-319) 执行：
1. 收集 `tool_mode=True` 的 inputs → 调用 `create_input_schema()` 生成 Pydantic arg_schema
2. 构造同步/异步执行函数 `_build_output_function()` (行 87-131)：
   - `deepcopy(component)` 创建隔离副本（解决 #8791 并发竞态）
   - `comp.set(*args, **kwargs)` 设置输入参数
   - 调用 `output_method()` 执行
   - 返回 Message.text / Data.data / 序列化结果
3. 包装为 `StructuredTool` 实例，注入 `tags`、`metadata`、`callbacks`

**关键设计**：`_patch_send_message_decorator` (行 60-84) 将 Component 的 `send_message` 替换为 no-op，确保作为 tool 被 Agent 调用时不向 UI 推送消息。

### 1.3 第 2 级：Agent Tool → AgentExecutor

**入口文件**：`src/lfx/src/lfx/base/agents/agent.py`

`LCAgentComponent` (行 37-329) 是所有 Agent 的抽象基类：

```python
class LCAgentComponent(Component):
    _base_inputs = [
        MessageInput(name="input_value", tool_mode=True),  # ← 输入本身也是 tool
        BoolInput(name="handle_parsing_errors", value=True, advanced=True),
        IntInput(name="max_iterations", value=15, advanced=True),
    ]
    outputs = [
        Output(display_name="Response", name="response", method="message_response"),
        Output(display_name="Agent", name="agent", method="build_agent", tool_mode=False),
    ]
```

`build_agent()` 是抽象方法，子类实现具体的 Agent 构造。`LCToolsAgentComponent` (行 330-349) 扩展了 tools 输入：

```python
class LCToolsAgentComponent(LCAgentComponent):
    _base_inputs = [
        HandleInput(name="tools", display_name="Tools", input_types=["Tool"], is_list=True),
        *LCAgentComponent.get_base_inputs(),
    ]
    def build_agent(self) -> AgentExecutor:
        agent = self.create_agent_runnable()
        return AgentExecutor.from_agent_and_tools(
            agent=RunnableAgent(runnable=agent, ...),
            tools=self.tools,  # ← 包含 ComponentToolkit 生成的 tools
        )
```

**Agent 执行时工具自动收集**：`_get_component_toolkit()` (在 component.py:63-69) 将所有 `tool_mode=True` inputs 的 Component 转化为 `ComponentToolkit`，再由 Agent 基类统一组装。

### 1.4 第 3 级：MCP Tool 包装

**入口文件**：`src/lfx/src/lfx/base/mcp/util.py`

`update_tools()` (行 1796-2012) 是整个 MCP 工具注册的核心：

```
update_tools(server_name, server_config)
    │
    ├── 1. 确定传输模式 (Stdio / Streamable_HTTP / SSE)
    ├── 2. 调用 MCPStdioClient.connect_to_server() 或
    │      MCPStreamableHttpClient.connect_to_server()
    ├── 3. session.list_tools() → 获取远程 MCP server 的工具列表
    ├── 4. 对每个 tool:
    │      ├── create_input_schema_from_json_schema(tool.inputSchema)
    │      │   → 将 MCP JSON Schema 转为 Pydantic BaseModel
    │      ├── MCPStructuredTool(StructuredTool) 子类包装
    │      │   ├── _to_args_and_kwargs(): 预处理参数 (camelCase→snake_case, unflatten, normalize)
    │      │   ├── _convert_parameters(): maybe_unflatten_dict + _normalize_arguments_for_mcp
    │      │   ├── _run() / _arun(): 执行 + _convert_mcp_result() 转换输出
    │      │   └── response_format="content_and_artifact" (同期返回文本+原始 MCP 结果)
    │      └── 加入 tool_list + tool_cache
    └── 5. 返回 (mode, tool_list, tool_cache)
```

**MCPStructuredTool** (行 1918-1984) 是 LangChain StructuredTool 的子类，补丁了三处：
1. **参数预处理**：camelCase → snake_case, `maybe_unflatten_dict`, JSON 字符串→dict 自动解析
2. **执行安全**：参数 normalize 后 Pydantic validate
3. **结果转换**：`_convert_mcp_result()` (行 490-538) 处理 text/image/mixed 三种输出类型，保障 vision-capable LLM 收到正确的 multimodal 数据

### 1.5 MCP Session 管理

**核心类**：`MCPSessionManager` (行 725-1285)，是 Langflow MCP 的持久连接层。

关键设计决策：
- **按 server 身份（而非 context_id）复用 session** (`_get_server_key`, 行 795-814)：对同一 `command+args+env` 的 stdio 或 `URL+headers` 的 HTTP 连接，共享同一个持久 session
- **per-server 最大 session 限制** (`mcp_max_sessions_per_server`)：超出时淘汰最旧的
- **健康检查** (`_validate_session_connectivity`, 行 816-857)：复用前执行轻量 `list_tools()` 测试
- **idle timeout + 定期清理** (`_periodic_cleanup`, 行 757-767)：默认 5 分钟 idle timeout，定期清理任务
- **参考计数** (`_session_refcount`, 行 743)：只有最后一个 context 释放时才真正关闭 session

**传输策略**：`MCPStreamableHttpClient._create_streamable_http_session()` (行 997-1153)
1. 先尝试 Streamable HTTP (2s 超时)
2. 失败 → 自动回退到 SSE
3. 成功后缓存 `_transport_preference[server_key]`，后续连接跳过失败路径

### 1.6 MCP Composer（per-project MCP Server）

**文件**：`src/lfx/src/lfx/services/mcp_composer/service.py`

`MCPComposerService` (行 69-1498) 管理每个 Project 的独立 MCP 子进程：

```
每个 Folder/Project → 1 个 mcp-composer 子进程
    ├── 启动: uvx mcp-composer@<version> --port <port> --mode http --endpoint <url>
    ├── OAuth: --env OAUTH_CLIENT_ID xxx --env OAUTH_CLIENT_SECRET xxx
    ├── 生命周期: 启动轮询(40 checks×2s) → 正常运行 → SIGTERM+超时 SIGKILL
    └── 跟踪: port→project, pid→project 双向映射
```

**竞态安全机制**：
- `_start_locks: dict[str, asyncio.Lock]` per-project 锁
- `_active_start_tasks` 跟踪活跃启动任务，新的 start 请求会 cancel 旧的
- 僵尸进程清理：Windows 用 `taskkill`+PowerShell `Get-WmiObject` 双保险

---

## 2. Flowise Supervisor/Worker 代码模式

### 2.1 架构总览

Flowise 的 Multi Agents 模块 (`packages/components/nodes/multiagents/`) 采用经典的 Supervisor/Worker 架构，核心在两条独立的 `init()` 流程：

```
Supervisor.init()                          Worker.init()
    │                                          │
    ├── createTeamSupervisor(llm, prompt,       ├── createAgent(llm, tools, prompt)
    │   members)                                │   → AgentExecutor (有工具)
    │   → RouteTool {reasoning,next,            │   或 RunnableSequence (纯对话)
    │      instructions}                        │
    │   → Runnable (prompt→model→parser)         │
    │                                          ├── agentNode(state, agent, name)
    │   返回: IMultiAgentNode {                  │   → agent.invoke(state)
    │     node, name, workers,                   │   → HumanMessage(content=output, name=workerName)
    │     checkpointMemory                     │
    │   }                                       └── 返回: IMultiAgentNode { node, name, type:'worker' }
    └──
```

### 2.2 Supervisor 的 RouteTool 机制

**文件**：`Supervisor.ts:136-142`

Supervisor 的核心是一个 `RouteTool`：

```typescript
const tool = new RouteTool({
    schema: z.object({
        reasoning: z.string(),
        next: z.enum(['FINISH', ...members]),  // ← 关键：约束为 Worker 名列表
        instructions: z.string().describe('The specific instructions...')
    })
})
```

这个 Schema 定义了 Supervisor 的决策协议：
- `reasoning`：路由推理（对用户透明）
- `next`：下一个 Worker 名称，或 `FINISH` 表示结束
- `instructions`：传递给 Worker 的具体子任务描述

**Per-model 强制 tool 使用策略** (行 146-370)：

| 模型 | 策略 |
|------|------|
| **Mistral** | `bindTools([tool], tool_choice:'any')` + `JsonOutputToolsParser` |
| **Anthropic** | user prompt 追加 "Use the route tool in your response" + `bindTools([tool])` + `ToolCallingAgentOutputParser` |
| **OpenAI/Azure** | `bindTools([tool], tool_choice:{type:'function', function:{name:'route'}})` |
| **Gemini** | `bindTools([tool])` + 特殊 prompt 结构（system+human 放最后） |
| **通用 fallback** | `bindTools([tool])` + `ToolCallingAgentOutputParser` |

所有分支的输出都经过统一的 post-processing pipe，将 tool output 转换为 `{next, instructions, team_members}` 结构。

### 2.3 Worker 的消息传递模式

**文件**：`Worker.ts:161-300`

Worker 创建 Agent 的分歧点在于**是否有 tools**：

**有 tools** (行 170-238)：
```
RunnableSequence.from([
    RunnablePassthrough.assign({ agent_scratchpad: formatToOpenAIToolMessages }),
    prompt,           // system: workerPrompt + team协作提示
    modelWithTools,    // llm.bindTools(tools)
    ToolCallingAgentOutputParser()
])
→ AgentExecutor.fromAgentAndTools(agent, tools, { maxIterations })
```

**无 tools** (行 239-266)：
```
RunnableSequence.from([
    prompt, llm, createTextOnlyOutputParser()
])
```

**Worker 执行函数 `agentNode()`** (行 269-300)：
```typescript
async function agentNode({state, agent, name, nodeId, abortControllerSignal}, config) {
    const result = await agent.invoke({ ...state, signal }, config)
    return {
        messages: [new HumanMessage({
            content: result.output,
            name,                                          // ← workerName
            additional_kwargs: { nodeId, type: 'worker' }  // ← tracing info
        })]
    }
}
```

关键要点：
- Worker 的输出以 `HumanMessage(name=workerName)` 形式写回 `state.messages`
- `additional_kwargs` 携带 `nodeId` 和 `type:'worker'`，用于 tracing
- `ITeamState` 是一个共享 messages 列表，Supervisor 和所有 Worker 通过它交换信息

### 2.4 协作提示注入

Worker 的 system prompt 末尾自动追加 (行 172-176)：
```
Work autonomously according to your specialty, using the tools available to you.
Do not ask for clarification.
Your other team members (and other teams) will collaborate with you with their own specialties.
You are chosen for a reason! You are one of the following team members: {team_members}.
```

这确保 Worker 知道自己是团队一部分、可以用工具自主执行、不需要澄清。

### 2.5 Supervisor/Worker 返回接口

**IMultiAgentNode** (`Interface.ts`)：
```typescript
interface IMultiAgentNode {
    node: Function,           // LangGraph node 可执行函数
    name: string,             // worker/supervisor name
    label: string,
    type: 'worker' | 'supervisor',
    llm?: BaseChatModel,
    workers?: IMultiAgentNode[],
    // ... message tracing
}
```

Supervisor 的 `workers` 数组由 Flowise 后端在 build 阶段从画布连线中自动收集，`flatten(nodeData.inputs.workerNodes)`。

---

## 3. 对 AgentHub ToolRegistry + MCPManager 的实现建议

### 3.1 借鉴 Langflow 的 `tool_mode=True` 三级提升链

AgentHub 现有的 `ToolDescriptor` 模型中应增加一个 `ExposureLevel` 字段：

```go
// 对 cross-analysis-sandbox-tools.md 中 ToolDescriptor 的扩展
type ExposureLevel int

const (
    ExposureCanvas ExposureLevel = 0  // 仅在 Canvas 上可视化连接
    ExposureAgent  ExposureLevel = 1  // Agent 可直接调用 (对应 tool_mode=True)
    ExposureMCP    ExposureLevel = 2  // 暴露为 MCP tool 供外部 Agent 调用
)
```

**建议**：AgentHub 的 ToolRegistry 在注册工具时自动计算 ExposureLevel：
- 所有工具默认为 `ExposureAgent` (AgentHub 是 Agent 平台，几乎全部工具都应 Agent 可用)
- 标记了 `hidden` 或 `internal` 的工具设为 `ExposureCanvas`
- 标记了 `mcp_export` 的工具设为 `ExposureMCP`

### 3.2 借鉴 Flowise 的 Supervisor 路由协议

从 Flowise Supervisor 的 RouteTool Schema 可以直接提取出 AgentHub 需要的最小协调协议：

```go
// 建议：packages/agent-core/coordination.go

type CoordinatorRouteDecision struct {
    Reasoning    string   `json:"reasoning"`              // 路由推理
    NextWorker   string   `json:"next_worker"`            // FINISH | workerName
    Instructions string   `json:"instructions,omitempty"` // 传递给 Worker 的子任务
}
```

AgentHub 的 orchestrator（Hub 或 Edge 的 local-orchestrator）应复刻 Flowise 的 per-model 策略矩阵：
- 对 Anthropic 模型：user prompt 追加 "Use the route tool in your response" (不做 tool_choice 强约束)
- 对 OpenAI 模型：`tool_choice: { type: 'function', function: { name: 'route' } }`
- 保留通用 fallback 路径

### 3.3 借鉴 Langflow MCP Session Manager

AgentHub 需要实现一个类似 `MCPSessionManager` 的 `MCPManager`，但用 Go 实现时可以利用 goroutine + channel 实现更简洁的并发模型：

```go
// 建议：services/runner/mcp_manager.go

type MCPManager struct {
    sessions   map[string]*MCPServerSession  // serverKey → session
    mu         sync.RWMutex
    stopCh     chan struct{}
}

type MCPServerSession struct {
    Client         *mcp.Client           // mcp-go SDK
    TransportType  string                // "stdio" | "sse" | "streamable_http"
    LastUsedAt     time.Time
    RefCount       int32
    Cancel         context.CancelFunc
    TransportPref  string                // 缓存成功的 transport 类型
}
```

关键策略（直接照搬 Langflow）：
1. **按 server identity 复用 session**：key = `hash(command+args+env)` 或 `hash(URL+headers)`
2. **Streamable HTTP → SSE fallback**：先尝试 Streamable HTTP (2s 超时)，失败回退 SSE
3. **health check before reuse**：`list_tools()` 轻量探测
4. **idle session cleanup**：5 分钟 idle → 清理 goroutine

与 Langflow 的区别：
- AgentHub 不需要 Python asyncio 的 Event/Future 模式——Go channel 和 context 更简洁
- 不需要 `_session_refcount` 的向后兼容层（AgentHub 全新设计）
- Go `defer` + `context.WithCancel` 天然替代 Langflow 的 `try/finally` 模式

### 3.4 借鉴 Flowise Worker 的消息格式

AgentHub 的 inter-agent message 协议应设计为：

```protobuf
// 建议：packages/protocol/proto/agent_coord.proto

message CoordinatorMessage {
    string next_worker = 1;        // "FINISH" | worker_name
    string instructions = 2;       // sub-task description
    repeated string team_members = 3;  // 当前团队所有 worker
    string reasoning = 4;          // 路由推理
    optional string summarization = 5; // 可选对话摘要
}
```

每条 Worker 执行的返回消息标注：
- `sender_name` = worker name
- `metadata.node_id` = tracing 用
- `metadata.type` = "worker" | "supervisor"

与 Flowise 的区别：AgentHub 不需要用 `HumanMessage` 类型模拟 Worker 回执——直接使用自定义 Protocol Buffer 消息类型。

### 3.5 借鉴 Langflow MCPStructuredTool 的参数转换

AgentHub 需要 `JSON Schema → ToolSchema` 的自动转换（`cross-analysis-sandbox-tools.md` 已有规划）。Langflow 的 `_convert_parameters` 逻辑可以转化为 Go：

```go
// 建议：packages/tool-core/schema_convert.go

func ConvertMCPParams(input map[string]any, schema *ToolSchema, toolName string) (map[string]any, error) {
    result := make(map[string]any)
    for key, value := range input {
        // 1. camelCase → snake_case 尝试
        // 2. 扁平键 (params.search) → maybe_unflatten
        // 3. JSON 字符串 → struct 自动解析（如果 schema 期望 object/array）
        // 4. 类型强制转换 (int/float/bool/string)
    }
    // 5. Pydantic 等效的 schema validation
    return result, nil
}
```

### 3.6 关键差异与简化

| Langflow 设计 | AgentHub 简化方向 |
|--------------|------------------|
| Python asyncio Event/Future 管理模式 | Go goroutine + channel，天然并发安全 |
| Pydantic `model_validate` 参数校验 | JSON Schema validate (gojsonschema 或自定义) |
| `deepcopy(component)` 并发隔离 | Go struct value copy 天然隔离 |
| `functools.wraps` + decorator 模式 | Go middleware 函数组合 |
| 向后兼容 layer (legacy=True, replacement=[]) | 无历史包袱，全新设计 |

---

## 4. 实施路径建议

### P0：核心 ToolRegistry + MCPManager（1-2 周）

1. 实现 `ToolRegistry` 的 Provider 匹配（`builtin` + `mcp` 两种先上）
2. 实现 `MCPManager` 的 session 管理（借鉴 Langflow `MCPSessionManager`）
3. 实现 `JSON Schema → ToolSchema` 转换器（借鉴 Langflow `create_input_schema_from_json_schema`）
4. 跑通端到端：Runner 注册 MCP server → Agent CLI 调用 MCP tool

### P1：Agent 协调协议（2-3 周）

1. 实现 Coordinator 路由协议（借鉴 Flowise RouteTool Schema）
2. 实现 per-model 策略选择器
3. 实现 inter-agent message 传递

### P2：审批门控 + MCP 工具暴露（2 周+）

1. MCP tool 审批集成（`cross-analysis-sandbox-tools.md` 2.4 节）
2. AgentHub 内的 tool → MCP export（借鉴 Langflow `MCPComposerService`）
3. ExposureLevel 控制精细化

---

## 附录：文件索引

### Langflow 核心 MCP/Agent 文件
- `src/lfx/src/lfx/base/agents/agent.py` -- Agent 抽象基类 (`LCAgentComponent`:37, `build_agent`:86, `run_agent`:147)
- `src/lfx/src/lfx/base/tools/component_tool.py` -- Component → StructuredTool 转换 (`ComponentToolkit`:191, `_build_output_function`:87)
- `src/lfx/src/lfx/base/mcp/util.py` -- MCP 客户端全实现 (`MCPSessionManager`:725, `MCPStdioClient`:1287, `MCPStreamableHttpClient`:1516, `update_tools`:1796)
- `src/lfx/src/lfx/services/mcp_composer/service.py` -- per-project MCP 子进程管理 (`MCPComposerService`:69)
- `src/backend/base/langflow/api/v1/mcp_projects.py` -- MCP Project API 路由 (`router`:77)
- `src/backend/base/langflow/agentic/mcp/server.py` -- Agentic FastMCP server (模板/组件搜索工具)

### Flowise 核心 Multi-Agent 文件
- `packages/components/nodes/multiagents/Supervisor/Supervisor.ts` -- Supervisor 节点 (`Supervisor_MultiAgents`:28, `createTeamSupervisor`:127, RouteTool:136)
- `packages/components/nodes/multiagents/Worker/Worker.ts` -- Worker 节点 (`Worker_MultiAgents`:14, `createAgent`:161, `agentNode`:269)
- `packages/components/src/agentflowv2Generator.ts` -- AI 自动生成 Agentflow V2 流程

### AgentHub 参考文件
- `docs/reference/cross-analysis-sandbox-tools.md` -- ToolRegistry 现有设计 (2.3 节)
- `docs/architecture.md` -- AgentHub 架构总览
- `docs/agent-loop.md` -- Agent 执行循环
