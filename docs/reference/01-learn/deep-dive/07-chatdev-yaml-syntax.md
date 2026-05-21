# ChatDev YAML Workflow 语法深度解析

> 基于源码：`D:\Code\AgentHub\reference\ChatDev`
> 源码解读范围：`entity/configs/` (base, graph, node, edge), `schema_registry/`, `yaml_template/`, `yaml_instance/`
> 目的：为 AgentHub YAML Agent 配置设计提供精确的语法参考

---

## 1. 整体结构：DesignConfig -> GraphDefinition -> Node/Edge 三层模型

### 1.1 根层：DesignConfig

源码位置：`entity/configs/graph.py:271-314`

```yaml
version: "0.4.0"          # 版本号，可选，默认 "0.0.0"
vars:                      # 全局变量字典，引用方式 ${VAR_NAME}
  COMMON_PROMPT: "..."
graph:                     # 必填，GraphDefinition 定义
  id: my-workflow
  ...
```

**字段清单**（`DesignConfig.FIELD_SPECS`）：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | str | 否 | "0.0.0" | 配置版本号，advance field |
| `vars` | dict[str, Any] | 否 | {} | 全局变量，通过 `${VAR}` 在任意位置引用 |
| `graph` | GraphDefinition | **是** | - | 核心图定义对象 |

**关键约束**：`vars` 只能在 DesignConfig 根层使用，`GraphDefinition.from_dict()` 会拒绝 graph 内部出现 `vars`（抛出 ConfigError）。

---

### 1.2 图层：GraphDefinition

源码位置：`entity/configs/graph.py:28-269`

```yaml
graph:
  id: my-workflow              # 必填，图标识符
  description: "描述文本"       # 可选，人类可读说明
  log_level: INFO              # 可选，枚举值 DEBUG|INFO|WARNING|ERROR|CRITICAL
  is_majority_voting: false    # 可选，多数投票模式开关
  nodes: [...]                 # 节点列表
  edges: [...]                 # 有向边列表
  memory: [...]                # 可选，图级 Memory Store 列表
  initial_instruction: "..."   # 可选，用户初始提示
  start: [node_id, ...]        # 入口节点 ID 列表
  end: [node_id, ...]          # 出口节点 ID 列表（有序，取第一个有输出的）
```

**入口/出口语义**（`from_dict()` 162-227 行）：
- `start`：接受 string 或 list[string]，自动去重
- `end`：接受 string 或 list[string]，保序；执行时按 list 顺序检查，第一个有输出的节点作为图输出
- 多数投票模式下（`is_majority_voting: true`），start 中的所有节点并行执行，结果进行投票

**校验规则**（`validate()` 231-268 行）：
1. 节点 ID 不可重复
2. start 和 end 中引用的节点必须在 nodes 中存在
3. 边的 source/target 节点必须在 nodes 中存在
4. Agent memory attachment 引用的 store name 必须在 `graph.memory` 中已定义

---

### 1.3 节点层：Node（8 种类型）

源码位置：`entity/configs/node/node.py:63-472`

#### Node 基类字段

```yaml
- id: node-unique-id          # 必填，唯一标识符
  type: agent                 # 必填，节点类型（决定 config schema）
  description: "说明文本"      # 可选，日志/UI 中展示
  context_window: 0           # 可选，上下文窗口大小（0=清除所有非keep，-1=无限，N=保留最近N条）
  log_output: true            # 可选，是否输出日志（advance field）
  config:                     # 必填，变体配置（由 type 决定 schema）
    ...
```

#### 8 种节点类型详解

| type | config class | 用途 | 关键字段 |
|------|-------------|------|---------|
| `agent` | AgentConfig | LLM-backed 智能体 | provider, name, role, tooling, thinking, memories, retry |
| `human` | HumanConfig | 暂停等人类输入 | description: str |
| `subgraph` | SubgraphConfig | 嵌套子图 | type (config/file), config (inline/ref) |
| `python` | PythonRunnerConfig | 执行 Python 脚本 | interpreter, args, env, timeout_seconds |
| `passthrough` | PassthroughConfig | 消息透传（路由/汇聚） | only_last_message: bool |
| `literal` | LiteralConfig | 固定文本注入 | content: str, role: user/assistant |
| `loop_counter` | LoopCounterConfig | 迭代次数上限 | max_iterations: int, reset_on_emit: bool |
| `loop_timer` | LoopTimerConfig | 迭代时间上限 | max_duration_seconds: float |

**loop_counter 行为**：消息每经过一次 loop_counter 节点，内部计数器 +1。当计数达 `max_iterations` 时，节点输出 `message`（如果有）并放行下游；未达上限时阻塞下游，通过循环边返回上游节点继续迭代。`reset_on_emit` 控制放行后是否重置计数器。

**passthrough 路由模式**：ChatDev_v1 使用 `PSEUDO`, `USER`, `FINAL` 三个 passthrough 节点实现汇聚路由。`USER` 节点被标记为 start 节点并向所有 Agent 发 `trigger: false` 的边（非触发边仅携带数据），实现全局上下文注入。

---

### 1.4 边层：Edge（条件路由 + Payload 处理 + 动态分叉）

源码位置：`entity/configs/edge/edge.py:20-151`

#### Edge 基类字段

```yaml
- from: source_node_id        # 必填，源节点 ID
  to: target_node_id          # 必填，目标节点 ID
  trigger: true               # 可选，默认 true，是否触发下游执行
  condition:                  # 可选，条件路由，默认 "true"（永真）
    type: keyword             # 条件类型：function | keyword
    config: {...}             # 变体配置
  carry_data: true            # 可选，默认 true，是否传递数据
  keep_message: false         # 可选，默认 false，消息是否标记为 keep
  clear_context: false        # 可选，默认 false，到达前是否清除非 keep 消息
  clear_kept_context: false   # 可选，默认 false，到达前是否清除 keep 消息
  process:                    # 可选，Payload 处理器
    type: regex_extract       # 处理器类型：regex_extract | function
    config: {...}
  dynamic:                    # 可选，动态边执行（Map/Tree 分叉）
    type: map                 # 动态类型：map | tree
    split: {...}              # 分裂策略
    config: {...}             # 模式配置
```

**Edgelink 运行时字段**（`node.py:38-59`）：`condition_manager`, `payload_processor`, `triggered` 等运行时状态仅在 `add_successor()` 构建 Edgelink 时初始化。

---

## 2. ConfigFieldSpec：动态表单元数据系统

### 2.1 核心数据结构

源码位置：`entity/configs/base.py:78-120`

```python
@dataclass(frozen=True)
class ConfigFieldSpec:
    name: str               # 字段名
    type_hint: str          # 类型提示（str, int, bool, text, enum:LogLevel, list[Node]）
    required: bool = False  # 是否必填
    display_name: str       # 前端展示名
    default: Any            # 默认值
    enum: Sequence[Any]     # 枚举值列表（驱动下拉框）
    enum_options: Sequence[EnumOption]  # 枚举的富文本选项（label + description）
    description: str        # 字段说明（前端 RichTooltip 展示）
    child: type[BaseConfig]  # 嵌套子类型（驱动递归表单）
    advance: bool = False   # 是否高级字段（默认折叠）
```

**字段语义映射到前端**：

| FIELD_SPEC 字段 | 前端渲染 |
|----------------|---------|
| `type_hint: "str"` | TextInput |
| `type_hint: "text"` | TextArea（多行） |
| `type_hint: "int"` | NumberInput |
| `type_hint: "bool"` | Switch/Toggle |
| `type_hint: "enum:LogLevel"` | Select 下拉 |
| `type_hint: "list[Node]"` | 列表 + 嵌套表单 |
| `enum` | Select 的 options 数据源 |
| `enum_options` | Select 的 label + tooltip |
| `child: Node` | 递归展开子表单 |
| `advance: true` | 默认折叠，点击 "Advanced" 展开 |

### 2.2 SchemaNode 收集

```python
@dataclass(frozen=True)
class SchemaNode:
    node: str                            # 类名
    fields: Sequence[ConfigFieldSpec]    # 字段规格列表
    constraints: Sequence[RuntimeConstraint]  # 运行时约束

# BaseConfig.collect_schema() 封装：
SchemaNode(node=cls.__name__, fields=list(cls.field_specs().values()), constraints=list(cls.constraints()))
```

### 2.3 变体配置路由：child_routes()

这是 ChatDev 最核心的动态表单机制。每个包含 `type` 字段的配置类通过 `child_routes()` 声明 `type value -> config class` 的映射。

**三级路由示例**（Node -> AgentConfig -> ToolingConfig）：

```
Node.child_routes()
  └── {ChildKey("config", "agent"): AgentConfig,
       ChildKey("config", "human"): HumanConfig,
       ChildKey("config", "subgraph"): SubgraphConfig, ...}

AgentConfig.child_routes()
  └── {ChildKey("tooling[*]", "function"): FunctionToolConfig, ...}

EdgeConditionConfig.child_routes()
  └── {ChildKey("config", "function"): FunctionEdgeConditionConfig,
       ChildKey("config", "keyword"): KeywordEdgeConditionConfig}
```

**实现模式**（以 Node 为例，`node.py:142-146`）：
```python
@classmethod
def child_routes(cls):
    routes = {}
    for name, schema in iter_node_schemas().items():
        routes[ChildKey(field="config", value=name)] = schema.config_cls
    return routes
```

关键点：
- **注册驱动**：不硬编码映射表，而是从 Schema Registry 动态发现注册的类型
- **前端联动**：当用户选择 `type: agent` 时，前端 Schema API 查询 child_routes 找到 AgentConfig，渲染其 FIELD_SPECS
- **form_dict 解析**：Node.from_dict() 先读 `type` 字段确定 schema，再用 `schema.config_cls.from_dict()` 解析 config 子块

### 2.4 EnumOption：枚举值的富展示

```python
@dataclass(frozen=True)
class EnumOption:
    value: Any               # 枚举实际值
    label: str = None        # 前端展示名
    description: str = None  # Tooltip 说明

# 用法：枚举值 = "DEBUG"，label = "Debug"，description = "Detailed diagnostic output"
```

Node type 的自定义 enum_options 示例（`node.py:152-166`）：
```python
specs["type"] = replace(
    type_spec,
    enum=list(registrations.keys()),
    enum_options=[
        EnumOption(value=name, label=name, description=schema.summary)
        for name, schema in registrations.items()
    ],
)
```

### 2.5 RuntimeConstraint：条件必填

```python
@dataclass(frozen=True)
class RuntimeConstraint:
    when: Mapping[str, Any]    # 触发条件，如 {"memory": "*"}（memory 非空时）
    require: Sequence[str]     # 必须存在的字段
    message: str               # 错误消息
```

前端可根据 `when` 条件动态切换字段的 required 状态。

---

## 3. Schema Registry：全局类型发现

源码位置：`schema_registry/registry.py`

ChatDev 维护了 6 个独立注册表：

| 注册表 | Spec 类型 | 注册内容 |
|--------|----------|---------|
| `_node_schemas` | NodeSchemaSpec | agent, human, subgraph, python, passthrough, literal, loop_counter, loop_timer |
| `_edge_condition_schemas` | EdgeConditionSchemaSpec | function, keyword |
| `_edge_processor_schemas` | EdgeProcessorSchemaSpec | regex_extract, function |
| `_memory_store_schemas` | MemoryStoreSchemaSpec | simple, file, blackboard, mem0 |
| `_thinking_schemas` | ThinkingSchemaSpec | reflection |
| `_model_provider_schemas` | ModelProviderSchemaSpec | openai, gemini, anthropic, ... |

每个 Spec 格式统一：
```python
@dataclass
class NodeSchemaSpec:
    name: str                    # 注册名（对外 ID）
    config_cls: Type[BaseConfig]  # 对应配置 dataclass
    summary: str | None          # 简要说明（用于 enum_options.description）
    metadata: Dict[str, Any]     # 扩展元数据
```

**注册示例**（伪代码）：
```python
register_node_schema("agent", config_cls=AgentConfig, summary="LLM-backed agent node")
register_node_schema("human", config_cls=HumanConfig, summary="Human-in-the-loop input node")
register_edge_condition_schema("keyword", config_cls=KeywordEdgeConditionConfig)
register_edge_condition_schema("function", config_cls=FunctionEdgeConditionConfig)
```

**前端 Schema API**（`POST /api/config/schema`）：遍历所有注册表，对每个注册项调用 `config_cls.collect_schema()` 获取 fields + constraints，递归展开 child 类型，输出完整 JSON Schema。

---

## 4. Edge 条件路由与 Payload 处理器

### 4.1 EdgeConditionConfig：双层包装

```yaml
condition:
  type: keyword              # 条件类型
  config:                    # 类型特定配置（变体路由）
    any: ["<INFO> Finished"]  # 或 regex, none
    case_sensitive: true
```

**简化语法**（YAML 中的糖）：

| 写法 | 等价于 |
|------|--------|
| `condition: 'true'` | `{type: function, config: {name: "true"}}` |
| `condition: true` | `{type: function, config: {name: "true"}}` |
| `condition: false` | `{type: function, config: {name: "always_false"}}` |
| `condition: 'contains_keyword'` | `{type: function, config: {name: "contains_keyword"}}` |
| `condition: {type: keyword, config: {any: [...]}}` | 完整显式形式 |

**两种条件类型**：

| type | config class | 说明 |
|------|-------------|------|
| `keyword` | KeywordEdgeConditionConfig | 声明式：any 包含 / none 排除 / regex 匹配 |
| `function` | FunctionEdgeConditionConfig | 函数式：调用 `functions/edge_condition/` 中的 Python 函数 |

**Keyword 条件规则**：
```yaml
condition:
  type: keyword
  config:
    any: ["<INFO> Finished"]    # 任意一个命中 → True
    none: ["ERROR"]              # 任意一个命中 → False（最高优先级）
    regex: ["^OK$"]              # 正则命中 → True
    case_sensitive: true
```

**优先级**：none > any/regex。none 命中直接 False，不继续检查。any 和 regex 任一命中即为 True。

### 4.2 EdgeProcessorConfig：Payload 变换

```yaml
process:
  type: regex_extract
  config:
    pattern: '```(?P<lang>[a-zA-Z0-9_+-]*)?\s*\n(?P<code>.*?)```'
    group: code               # 可选，捕获组名或索引
    dotall: true
    on_no_match: pass         # pass | default | drop
    default_value: ""         # on_no_match=default 时的回退值
```

**三种 no-match 行为**：
- `pass`：保留原始 payload
- `default`：用 `default_value` 替换
- `drop`：丢弃整个 payload

**实战示例**（`demo_edge_transform.yaml`）：literal 节点输出含 ` ```python ... ``` ` 的文本，经过 edge process 后，human 节点只收到纯代码内容。

### 4.3 DynamicEdgeConfig：Map/Tree 动态分叉

```yaml
dynamic:
  type: map                   # map | tree
  split:                      # 分裂策略
    type: message             # 按消息拆分
  config:
    max_parallel: 10          # map 模式用
    group_size: 2             # tree 模式用（归并粒度）
```

**Map 模式**：将一条边的 payload 拆分为 N 个 execution unit，对目标节点创建 N 个并行实例，结果汇聚为列表。

**Tree 模式**：Map + 多层归并。split -> N 个 unit -> group_size 为单位并行执行 -> 结果再次分组 -> 直到只剩 1 个结果。适合需要逐步归并的大规模任务。

**split 类型**：
- `message`：按消息粒度（每个消息一个 unit）
- 自定义 splitter：JSON path、正则模式等

**实战示例**（`demo_dynamic.yaml`）：5 个 literal 节点产出不同主题的旅游规划请求 -> passthrough 汇聚 -> map 边分发给 agent Z 并行处理 -> tree 边分流给 agent Y 逐步归并最终输出。

---

## 5. Memory 系统：图级 Store + Agent 级 Attachment

### 5.1 Graph 级 Memory Store 定义

```yaml
memory:
  - name: code_index           # 唯一名称（agent 引用用）
    type: simple               # simple | file | blackboard | mem0
    config:
      memory_path: ./cache/code_index.json
      embedding:               # 可选，语义检索
        provider: openai
        model: text-embedding-3-small
        api_key: ${API_KEY}
        base_url: ${BASE_URL}
```

| type | 特点 |
|------|------|
| `simple` | 单 JSON 文件，可选 embedding 语义检索 |
| `file` | 索引本地文件目录，FAISS 向量检索 |
| `blackboard` | 共享黑板，JSON append-only，按时间裁剪 |
| `mem0` | Mem0 托管记忆服务（云端） |

### 5.2 Agent 级 Memory Attachment

```yaml
# 在 agent node 的 config 中：
memories:
  - name: code_index          # 引用 graph.memory 中的 store 名
    retrieve_stage: [gen]      # 在哪个阶段检索
    top_k: 3                   # 检索条数
    similarity_threshold: -1.0  # 相似度阈值（-1 = 不过滤）
    read: true                 # 允许读取
    write: true                # 执行后写回
```

**检索阶段枚举**（`AgentExecFlowStage`）：
- `pre_gen_thinking`：thinking 阶段前检索，注入 context
- `gen`：生成前检索，插入 conversation
- `post_gen_thinking`：生成后再次检索，用于 reflection
- `finished`：完成后汇总

---

## 6. 完整语法参考：设计模式分类

### 6.1 软件工程流水线（ChatDev_v1）

```
USER --[context]--> CEO + CPO + Coder + Reviewer + Tester
Literal(phase prompt) --> Agent(task) --> Literal(next phase prompt)
                                         |
                                    loop_counter(N) --> |-> continue loop
                                                        |-> advance to next phase
PSEUDO(passthrough) 用于汇聚多路输出
FINAL(passthrough) 作为出口节点
```

核心模式：**Phase Prompt 注入 + Loop Counter 收敛 + Passthrough 路由**

### 6.2 子图嵌套（Subgraph）

```yaml
# inline 子图
- id: Critic
  type: subgraph
  config:
    type: config
    config:
      id: paper_critique
      nodes: [...]
      edges: [...]

# file 引用子图
- id: ReAct Subgraph
  type: subgraph
  config:
    type: file
    config:
      path: "subgraphs/react_agent.yaml"
```

子图 YAML 是完整的 minified DesignConfig（有 version/graph/vars），挂载到父图作为子节点执行。子图有独立的 start/end，输出回传给父图。

### 6.3 ReAct 循环（Subgraph-wrapped）

```
Task Normalizer(agent)
  |
  +--> ReAct Agent Subgraph(subgraph: file)
  |      |
  |      +--> ReAct Brain(agent) --[condition: none=FINAL]--> Tool Executor(agent)
  |      |        ^                                                 |
  |      |        +-------------------------------------------------+
  |      |
  |      +--> [condition: any=FINAL] --> ReAct Answer Synthesizer(agent)
  |
  +--> Final QA Editor(agent) --[condition: any=TODO]--> ReAct Agent Subgraph (loop back)
```

### 6.4 Majority Voting

```yaml
graph:
  is_majority_voting: true
  start: [A1, A2, A3]
  end: A3
  nodes:
    - id: A1
      type: agent
      config:
        role: "Respond with 'Option A'"
    - id: A2
      type: agent
      config:
        role: "Respond with 'Option A'"
    - id: A3
      type: agent
      config:
        role: "Respond with 'Option B'"
```

三个 agent 并行执行，结果进行投票，多数决定最终输出。

### 6.5 条件路由 + 上下文清理

```yaml
edges:
  # Code Complete 完成 → 进入 Review 阶段
  - from: Programmer Code Complete
    to: Code Review Comment Phase Prompt
    condition:
      type: keyword
      config:
        any: ["<INFO> FINISHED"]

  # Reviewer 放行 → 进入 Test 阶段
  - from: Code Reviewer
    to: Test Error Summary Phase Prompt
    condition:
      type: keyword
      config:
        any: ["<INFO> Finished"]

  # 触发边（trigger: true）vs 数据边（trigger: false）
  - from: USER
    to: Code Reviewer
    trigger: false      # 仅传递上下文，不触发执行
    carry_data: true
    keep_message: true  # 消息持久保留，不被 context_window 清理
```

---

## 7. 对 AgentHub YAML Agent 配置的借鉴

### 7.1 直接复用的设计模式

#### A. FIELD_SPECS 驱动动态表单

AgentHub 的 Agent 配置、Runner 参数、Workspace 设置都可以采用同样的模式：

```python
# 建议的 AgentHub AgentConfig
@dataclass
class AgentConfig(BaseConfig):
    name: str
    provider: str           # claude-code | openai | custom
    system_prompt: str | None
    tools: List[ToolConfig]
    memories: List[MemoryAttachmentConfig]

    FIELD_SPECS = {
        "name": ConfigFieldSpec(name="name", display_name="Agent Name", type_hint="str", required=True),
        "provider": ConfigFieldSpec(name="provider", display_name="Provider", type_hint="str", required=True,
                                     enum=["claude-code", "openai", "custom"]),
        ...
    }
```

#### B. child_routes 变体配置

AgentHub 有多种 runner 类型（claude-code-direct, claude-code-subprocess, openai-api 等），可以用 child_routes 在 YAML 中通过 `type` 字段切换 schema：

```python
AgentConfig.child_routes()
  -> {ChildKey("runner", "claude-code"): ClaudeCodeRunnerConfig,
      ChildKey("runner", "openai"): OpenAIRunnerConfig}
```

#### C. YAML 是 SSOT + Canvas 是编辑器

ChatDev 的核心设计哲学：YAML 文件是单一事实来源（可 Git diff/merge），VueFlow 画布是编辑器。AgentHub 的 Agent 群聊配置应采用同样的策略：
- `agents.yaml` 定义 Agent 池
- `workspaces.yaml` 定义 workspace 绑定
- Canvas 编辑器读写 YAML

#### D. Edge 条件路由 -> AgentHub 消息路由

AgentHub 的 Agent 间消息传递可简化借鉴 Edge 系统：
- `condition: keyword` -> 群聊中 "@AgentName" 即路由条件
- `process: regex_extract` -> 消息预处理（提取代码块、格式化）
- `dynamic: map` -> 一对多并行分发（同时 @多个Agent）

#### E. Subgraph -> Agent 群聊

ChatDev 的 subgraph 嵌套机制直接映射到 AgentHub 的群聊模型：
- 单 Agent = leaf node
- Agent 群聊 = subgraph
- Threaded reply 链 = inline subgraph
- 外部群聊引用 = file subgraph ref

### 7.2 需要适配的差异

| ChatDev 特性 | AgentHub 适配方案 |
|-------------|-----------------|
| `trigger: true/false` 控制边是否触发 | 替换为 `trigger: @mention` / `trigger: auto_reply`（群聊语义） |
| `carry_data` 控制消息传递 | 替换为 `visibility: public | private | thread`（消息可见性） |
| `context_window` 整数控制保留条数 | 替换为 `context_strategy: sliding_window | summarize | infinite` |
| `loop_counter` 硬迭代限制 | 替换为 `max_turns` 会话轮次限制 + `timeout` 超时 |
| `passthrough` 节点用于路由 | 不需要（群聊中的消息天然多播） |
| `literal` 节点注入 phase prompt | 替换为群聊中的 "系统消息" / "公告" |

### 7.3 建议的 AgentHub AgentConfig YAML 语法草案

```yaml
# agenthub-agents.yaml
version: "0.1.0"

agents:
  - id: code-agent
    name: "Code Agent"
    provider: claude-code
    runner:
      type: claude-code-direct        # 变体路由 key
      config:
        executable: claude
        working_dir: /workspace
        tools: [read, write, bash, grep, glob]
    system_prompt: |
      You are a full-stack developer. Write clean, tested code.
    memory:
      - store: project_index
        retrieve_stage: gen
        top_k: 5
      - store: conversation_history
        retrieve_stage: pre_gen
        read: true
        write: true
    capabilities:
      - coding
      - debugging
      - code_review

  - id: review-agent
    name: "Review Agent"
    provider: claude-code
    runner:
      type: claude-code-direct
      config:
        executable: claude
        tools: [read, grep, glob]
    system_prompt: |
      You are a code reviewer. Focus on correctness, security, and clarity.
    capabilities:
      - code_review
      - security_audit

groups:
  - id: dev-team
    name: "Development Team"
    agents: [code-agent, review-agent]
    routing:
      strategy: supervisor        # supervisor | mention_only | round_robin
      supervisor_agent: null      # null = 群内第一个 agent 或外部专用
    context:
      visibility: full            # full | thread_only | private
      max_history_turns: 50

memory_stores:                    # 图级 Memory Store
  - name: project_index
    type: file
    config:
      index_path: /workspace/.agent_cache
      file_sources:
        - path: /workspace/src
          recursive: true

  - name: conversation_history
    type: blackboard
    config:
      max_items: 500
```

这一草案融合了：
- ChatDev 的 FIELD_SPECS + child_routes 变体配置（runner.type）
- ChatDev 的 Memory Store + Attachment 双层模型（memory_stores + agent.memory）
- ChatDev 的 Graph-level 配置 + Node-level 配置分层（groups + agents）
- AgentHub 特有的群聊语义（visibility, routing.strategy, capabilities）

---

## 8. 源码关键路径速查

| 关注的特性 | 源码位置 | 行号 |
|-----------|---------|------|
| ConfigFieldSpec 定义 | `entity/configs/base.py` | 78-120 |
| BaseConfig.child_routes 基类 | `entity/configs/base.py` | 166-175 |
| ChildKey 定义 | `entity/configs/base.py` | 35-58 |
| EnumOption 定义 | `entity/configs/base.py` | 61-75 |
| SchemaNode 收集 | `entity/configs/base.py` | 123-136, 184-186 |
| Node dataclass | `entity/configs/node/node.py` | 63-472 |
| Node.child_routes (动态发现) | `entity/configs/node/node.py` | 141-146 |
| Node.field_specs (动态enum填充) | `entity/configs/node/node.py` | 148-166 |
| Node.from_dict (YAML解析) | `entity/configs/node/node.py` | 168-230 |
| Edgelink dataclass | `entity/configs/node/node.py` | 37-59 |
| add_successor (边构建) | `entity/configs/node/node.py` | 356-437 |
| EdgeConfig dataclass | `entity/configs/edge/edge.py` | 19-151 |
| EdgeConditionConfig | `entity/configs/edge/edge_condition.py` | 213-302 |
| KeywordEdgeConditionConfig | `entity/configs/edge/edge_condition.py` | 121-208 |
| EdgeProcessorConfig | `entity/configs/edge/edge_processor.py` | 259-334 |
| RegexEdgeProcessorConfig | `entity/configs/edge/edge_processor.py` | 56-195 |
| DynamicEdgeConfig | `entity/configs/edge/dynamic_edge_config.py` | 54-183 |
| GraphDefinition.dataclass | `entity/configs/graph.py` | 27-130 |
| GraphDefinition.from_dict | `entity/configs/graph.py` | 140-229 |
| GraphDefinition.validate | `entity/configs/graph.py` | 231-268 |
| DesignConfig.dataclass | `entity/configs/graph.py` | 271-313 |
| Schema Registry 定义 | `schema_registry/registry.py` | 16-70 |
| AgentConfig (含 tooling/thinking/memory) | `entity/configs/node/agent.py` | 323+ |
| YAML 模板 | `yaml_template/design.yaml` | 全文件 |
