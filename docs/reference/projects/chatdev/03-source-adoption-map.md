# ChatDev Source Adoption Map → AgentHub

> 从 ChatDev v2 Python 源码到 AgentHub Go/TypeScript 实现的精确映射。
> 每项: ChatDev file:line → AgentHub file:line → 具体变更 → P0/P1/P2。
> 已有文档: `01-overview.md`, `02-yaml-syntax.md` — 本文件聚焦代码级映射和未覆盖维度。

---

## 1. FIELD_SPECS 动态表单 → AgentHub Config UI

### 1.1 ConfigFieldSpec 元数据驱动

```
ChatDev: entity/configs/base.py:60-85
  @dataclass
  class ConfigFieldSpec:
      name, display_name, type_hint, required, default, description,
      enum_options, category, is_advanced, is_visible, step, min, max

  entity/configs/node/agent.py:323 → AgentConfig.FIELD_SPECS:
      40+ 字段的完整 FIELD_SPECS 定义 (provider, name, role, api_key,
      params, retry, tooling, thinking, memories, skills, ...)

AgentHub: 无动态表单系统。前端组件手动硬编码每个字段。
```

**差异**: ChatDev 的 `FIELD_SPECS` 允许新增 Node 类型时只需定义 dataclass + FIELD_SPECS，前端 `FormGenerator` + `InlineConfigRenderer` 自动渲染。AgentHub 的 adapter 配置、workspace 设置、runner 参数全部需要手动编写表单组件。

**建议 P0**: 在 Web App 中引入 `ConfigSchema` 驱动的表单渲染器。定义字段元数据格式，后端通过 API 提供 schema，前端 `DynamicFormField` 按 schema 渲染。

```typescript
// app/web/src/components/FormGenerator/ConfigSchema.ts 新增
interface ConfigFieldSpec {
    name: string;
    displayName: string;
    typeHint: 'str' | 'int' | 'float' | 'bool' | 'enum' | 'text' | 'password';
    required: boolean;
    default?: unknown;
    description?: string;
    enumOptions?: { value: string; label: string }[];
    category?: string;
    isAdvanced?: boolean;
}
```

### 1.2 child_routes 变体配置

```
ChatDev: entity/configs/base.py:110-145
  BaseConfig.child_routes() → {ChildKey("config", "agent"): AgentConfig, ...}
  Node 通过 type 选择 config schema:
      "agent" → AgentConfig
      "human" → HumanConfig
      "subgraph" → SubgraphConfig
      ...

AgentHub: edge-server/internal/adapters/adapter.go:23-43
  AgentAdapter 接口固定，无运行时 type→schema 路由。
```

**建议 P1**: 在 `AgentAdapter.Capabilities()` 中增加 `ConfigSchema()` 方法返回动态配置 schema。前端根据 schema 渲染配置表单，不再硬编码每类 adapter 的表单。

```go
// edge-server/internal/adapters/adapter.go 新增
type ConfigFieldDef struct {
    Name        string       `json:"name"`
    DisplayName string       `json:"displayName"`
    Type        string       `json:"type"` // string, int, bool, enum
    Required    bool         `json:"required"`
    Default     any          `json:"default,omitempty"`
    EnumOptions []EnumOption `json:"enumOptions,omitempty"`
}

// AgentAdapter 增加方法
ConfigSchema() []ConfigFieldDef
```

---

## 2. GraphDefinition → AgentHub Workflow Model

### 2.1 Graph → Node → Edge 三层

```
ChatDev: entity/configs/graph.py:28-269
  GraphDefinition { id, description, log_level, is_majority_voting,
    nodes, edges, memory, start_nodes, end_nodes }
  Node { id, type, description, context_window, config: variant by type,
    input, output, predecessors, successors }
  EdgeLink { target, trigger, condition, condition_config, carry_data,
    keep_message, clear_context, process_config, dynamic_config }

AgentHub: edge-server/internal/adapters/orchestrator.go:17-32
  OrchestratorAdapter { inner *ClaudeCodeAdapter, systemPrompt }
  仅支持单 coordinator + 多 worker 的固定拓扑，无通用图模型。
```

**差异**: ChatDev 的图模型支持任意 DAG/Cycle 拓扑（条件路由、payload 处理器、动态边、子图嵌套）。AgentHub 的 Orchestrator 是固定的 coordinator→worker 树状结构。

**建议 P1**: 在 hub-server 中引入 `WorkflowDefinition` 模型作为 agent 编排的配置格式。参考 ChatDev 的 YAML 三层模型，AgentHub 可以用 JSON/YAML 描述 agent 间的消息路由。

```go
// hub-server/internal/workflow/definition.go 新增
type WorkflowDefinition struct {
    ID          string         `json:"id"`
    Nodes       []WorkflowNode `json:"nodes"`
    Edges       []WorkflowEdge `json:"edges"`
    StartNodes  []string       `json:"startNodes"`
    MemoryStore []MemoryConfig `json:"memory,omitempty"`
}

type WorkflowEdge struct {
    Source    string   `json:"source"`
    Target    string   `json:"target"`
    Condition string   `json:"condition,omitempty"` // "keyword" | "always"
    Keyword   string   `json:"keyword,omitempty"`   // for keyword condition
}
```

### 2.2 Edge 条件路由

```
ChatDev: entity/configs/edge/edge_condition.py
  keyword condition → 匹配消息文本中的关键词
  function condition → 自定义 Python 函数判断

  entity/configs/edge/edge_processor.py
  regex_extract → 从消息中提取正则匹配
  function → Payload 处理函数

AgentHub: 无 agent 间消息路由。Orchestrator 通过 Claude Code 的 system prompt 做语义路由，无显式条件路由。
```

**建议 P2**: 在 `WorkflowEdge` 中支持 `keyword` 条件路由。Agent 产出消息后，系统按 edge 的 keyword 匹配决定下一个激活的 agent。

---

## 3. Memory 分层设计 → AgentHub Context 管理

### 3.1 Graph-level + Agent-level Memory

```
ChatDev: entity/configs/node/memory.py
  SimpleMemory (单文件 JSON, 可选 embedding)
  FileMemory (本地文件索引 + FAISS)
  BlackboardMemory (JSON append-only, 按时间裁剪)
  Mem0Memory (云端托管)

  workflow/graph.py:150-191
  _build_global_memories() → MemoryFactory.create_memory(store)
  _build_agent_memories() → MemoryManager 关联 agent 到 store

AgentHub: edge-server/internal/store/file_store.go
  仅提供 JSON 文件级持久化 (Run/Workspace CRUD)。无 memory 分层概念。
```

**差异**: ChatDev 的 memory 是异步的三阶段检索（Pre-Gen / Gen / Post-Gen），支持 embedding 语义检索和多 store 组合。

**建议 P2**: 在 hub-server 中引入 `MemoryStore` 抽象。P0 实现 `SimpleMemory`（JSON 文件 + 可选 embedding），P2 扩展到 `FileMemory`（文件索引）。

---

## 4. Dynamic Edge (Map/Tree) → AgentHub Parallel Dispatch

```
ChatDev: workflow/executor/dynamic_edge_executor.py:18
  Map 模式: payload → N 个 execution unit → 并行执行目标节点 → 汇总
  Tree 模式: Map + group + reduce 多层归并

AgentHub: edge-server/internal/adapters/orchestrator.go:47-57
  Orchestrator 通过 Claude Code system prompt 描述并行 dispatch。
  实际 task 派发由 Claude Code 的 Task tool 内部实现，非 AgentHub 框架层。
```

**建议 P2**: 当 AgentHub 引入显式 workflow 模型后，为 edge 增加 `parallel` 标记。标记为 `parallel: true` 的 edge 将 upstream 消息按规则拆分后并行发送给多个下游 agent。

---

## 5. Schema Registry → AgentHub Config Discovery

```
ChatDev: schema_registry/registry.py
  get_node_schema(type) → (config_cls, summary)
  iter_model_provider_schemas() → 前端 provider 下拉框
  Schema API: POST /api/config/schema → 完整 JSON Schema

AgentHub: edge-server/internal/adapters/model_config.go:5-24
  ModelAliases / ReasoningEfforts / DefaultModels — 硬编码 map
  前端通过硬编码的下拉列表显示可选 model。
```

**建议 P1**: 引入 Schema Registry 模式，通过 API 动态提供可用的 model/provider/agent_type 列表。前端不再硬编码选项，从 `/api/config/schema` 动态获取。

```go
// hub-server/internal/api/config_schema.go 新增
type SchemaRegistry struct {
    Providers []ProviderSchema
    Models    []ModelSchema
    Agents    []AgentTypeSchema
}

// GET /api/config/schema → SchemaRegistry JSON
```

---

## 6. YAML 唯一事实源 → AgentHub 配置策略

```
ChatDev: yaml_instance/
  30+ YAML 文件，存储完整 workflow 定义
  前端 VueFlow 画布读取 YAML → 展示 → 编辑 → 写回 YAML

AgentHub: 无 workflow YAML。Orchestrator 配置为 Go 代码中硬编码的 system prompt 字符串。
```

**建议 P2**: 将 Orchestrator 的 system prompt 外置为 `workflows/default-orchestrator.yaml`。YAML 作为唯一事实源，代码读取 YAML 文件，用户可以修改 YAML 自定义 coordinator 行为。

---

## 7. WebSocket 实时执行 → AgentHub 日志流

```
ChatDev: server/services/websocket_executor.py
  WebSocketGraphExecutor → WebSocketLogger → 推送日志到前端
  WebPromptChannel → Human-in-the-Loop 推送 prompt
  ArtifactDispatcher → 推送生成的文件

AgentHub: edge-server/internal/events/bus.go:49-80
  Bus.Publish() → 全局事件广播
  无 human-in-the-loop prompt 推送；artifact 由 agent CLI 自定义格式输出。
```

**建议 P2**: 在事件总线中增加 `human_prompt` 和 `artifact` 事件类型。支持 Human-in-the-Loop 场景（审批、确认）和结构化 artifact 推送（代码文件、图片、报告）。

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | FIELD_SPECS 动态表单 | **P0** | 新增 `app/web/FormGenerator/` |
| 2 | Schema Registry 动态能力发现 | **P1** | 新增 `hub-server/api/config_schema.go` |
| 3 | ConfigSchema() adapter 方法 | **P1** | `adapters/adapter.go` |
| 4 | WorkflowDefinition 图模型 | **P1** | 新增 `hub-server/workflow/definition.go` |
| 5 | Edge keyword 条件路由 | **P2** | `hub-server/workflow/definition.go` |
| 6 | Graph-level + Agent-level Memory | **P2** | 新增 `hub-server/memory/` |
| 7 | Dynamic Edge 并行 dispatch | **P2** | `hub-server/workflow/executor.go` |
| 8 | YAML 外部化 Orchestrator 配置 | **P2** | `workflows/default-orchestrator.yaml` |
| 9 | human_prompt + artifact 事件类型 | **P2** | `adapters/adapter.go` 事件类型扩展 |
