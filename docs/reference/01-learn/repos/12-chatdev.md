# ChatDev 深度调研报告

> 调研对象：`D:\Code\AgentHub\reference\ChatDev`（OpenBMB/ChatDev，commit `HEAD`）
> 调研时间：2026-05-21
> 项目名称：DevAll（ChatDev v2，graph-based 重写）
> 许可证：Apache-2.0
> Python 版本要求：>=3.12

---

## 1. 角色化多 Agent 协作模型

### 1.1 节点类型体系

ChatDev v2 不是硬编码 CEO/CTO/Programmer 角色，而是用 **可配置 Node 类型** 构建任意多 Agent 拓扑。核心节点类型定义在 `entity/configs/node/`：

| Node Type | 配置文件 | 用途 |
|-----------|----------|------|
| `agent` | `entity/configs/node/agent.py:323` | LLM-backed Agent，支持 tool/memory/thinking/skills |
| `human` | `entity/configs/node/human.py` | 暂停等待人类输入（Human-in-the-Loop） |
| `subgraph` | `entity/configs/node/subgraph.py:195` | 嵌套子图（inline YAML 或外部文件引用） |
| `python` | `entity/configs/node/python_runner.py` | 执行 Python 脚本 |
| `passthrough` | `entity/configs/node/passthrough.py` | 消息透传，用于路由/汇聚 |
| `literal` | `entity/configs/node/literal.py` | 固定文本输出，用于注入 phase prompt |
| `loop_counter` | `entity/configs/node/loop_counter.py` | 循环迭代上限守卫 |
| `loop_timer` | `entity/configs/node/loop_timer.py` | 循环时长上限守卫 |

### 1.2 AgentConfig 核心结构

`entity/configs/node/agent.py:323` -- `AgentConfig` dataclass：

```python
@dataclass
class AgentConfig(BaseConfig):
    provider: str           # openai / gemini / anthropic / ...
    base_url: str           # 覆盖默认 endpoint
    name: str               # 模型名 (gpt-4o, gemini-2.0-flash, ...)
    role: str | None        # system prompt（角色定义）
    api_key: str | None     # API key，支持 ${API_KEY} 占位
    params: Dict            # temperature, max_tokens 等
    retry: AgentRetryConfig # 自动重试策略
    input_mode: AgentInputMode  # prompt 或 messages
    tooling: List[ToolingConfig]  # function / mcp_remote / mcp_local
    thinking: ThinkingConfig     # reflection 等思考模式
    memories: List[MemoryAttachmentConfig]  # 挂载的 memory store
    skills: AgentSkillsConfig    # Agent Skills allowlist
```

**关键设计点**：
- **provider 注册表**：`schema_registry/registry.py` 动态发现 provider，前端下拉框自动填充
- **FIELD_SPECS 元数据**：每个字段自带 `ConfigFieldSpec`（display_name, type_hint, description, enum_options），驱动前端动态表单
- **child_routes**：`AgentConfig` 通过 `child_routes()` 声明 `type -> config_cls` 的变体路由，使 tooling/thinking/memory 配置自动解析为正确的 dataclass 子类

### 1.3 Node 与 Edge 的运行时模型

`entity/configs/node/node.py:62` -- `Node` dataclass：

```
Node
  id, type, description, context_window, log_output
  config: BaseConfig (variant by type)
  input: List[Message]    -- 上游累积的消息队列
  output: List[Message]   -- 执行产出的消息
  predecessors / successors  -- 图拓扑
  _outgoing_edges: List[EdgeLink]  -- 带条件的出边
```

`EdgeLink` (`entity/configs/node/node.py:38`) 包含：
- `trigger: bool` -- 是否触发下游执行
- `condition` / `condition_config` -- 条件路由（keyword 匹配 / function 判断）
- `carry_data: bool` -- 是否传递上游数据
- `keep_message: bool` -- 消息是否标记为持久（不被 context_window 清理）
- `clear_context` / `clear_kept_context` -- 控制上下文清理
- `process_config` -- 边级 payload 处理器（regex_extract / function）
- `dynamic_config` -- 动态边（Map 分叉 / Tree 归并）

### 1.4 ChatDev_v1 经典角色编排

`yaml_instance/ChatDev_v1.yaml` 展示了经典的软件工程多 Agent 拓扑：

```
Role Nodes:
  Chief Executive Officer     (agent) -- 决策/管理
  Chief Product Officer       (agent) -- 产品设计/用户手册
  Programmer Coding           (agent) -- 初始编码
  Programmer Code Complete    (agent) -- 补全未实现方法
  Programmer Code Review      (agent) -- 响应 review 修改代码
  Programmer Test Modification(agent) -- 响应测试修复 bug
  Programmer Test Error Summary(agent) -- 分析测试报告
  Code Reviewer               (agent) -- 审查代码质量
  Software Test Engineer      (agent) -- 运行测试

Phase Nodes (literal):
  Coding Phase Prompt           -- 编码阶段提示
  Code Complete Phase Prompt    -- 补全阶段提示
  Code Review Comment Phase     -- Review 阶段提示
  Code Review Modification Phase-- 修改阶段提示
  Test Error Summary Phase      -- 测试分析提示
  Test Modification Phase       -- 测试修复提示
  Manual Phase Prompt           -- 用户手册阶段提示

Control Nodes:
  Code Complete All Phase Loop Counter  (max: 5)
  Code Review Phase Loop Counter        (max: 10)
  Test Phase Loop Counter               (max: 3)
  Test Modification Phase Loop Counter  (max: 5)
  Manual Phase Loop Counter             (max: 1)

Routing: PSEUDO, USER, FINAL (passthrough)
```

**执行流程**（`workflow/graph.py:260` `run()`）：
1. `GraphManager.build_graph_structure()` -- 解析 YAML -> Node 实例 + Edge 拓扑
2. `GraphTopologyBuilder` 检测环 -> DAG 分层 或 Cycle-aware 执行
3. 启动 `start_nodes`（USER + Coding Phase Prompt）
4. 按层/循环策略执行节点，消息沿边传递
5. 收集最终输出，归档结果

### 1.5 三种执行策略

`workflow/graph.py:301-326` -- Strategy Pattern：

| 策略 | 文件 | 触发条件 |
|------|------|----------|
| `DagExecutionStrategy` | `workflow/runtime/execution_strategy.py` | 无环图，按拓扑层并行 |
| `CycleExecutionStrategy` | 同上 | 有环图，按 cycle-aware 顺序 |
| `MajorityVoteStrategy` | 同上 | `is_majority_voting: true`，多节点并行投票 |

---

## 2. YAML Workflow 配置驱动架构

### 2.1 三层模型

```
DesignConfig (yaml_template/design.yaml, entity/configs/graph.py:271)
  ├── version: str
  ├── vars: Dict[str, Any]         -- 全局变量，${VAR} 引用
  └── graph: GraphDefinition
        ├── id / description / log_level / is_majority_voting
        ├── nodes: List[Node]
        │     └── config: variant by type
        ├── edges: List[EdgeConfig]
        │     ├── condition: keyword | function
        │     ├── process: regex_extract | function
        │     └── dynamic: map | tree (split config)
        ├── memory: List[MemoryStoreConfig]
        ├── start: List[str]        -- 入口节点
        └── end: List[str]          -- 出口节点（取第一个有输出的）
```

### 2.2 变体配置（Variant Config）机制

`entity/configs/base.py` -- `BaseConfig` 提供 `child_routes()` 方法，实现类似 discriminated union 的动态类型解析：

```python
# Node 通过 type 选择 config schema：
Node.child_routes() --> {ChildKey("config", "agent"): AgentConfig, ...}

# MemoryStoreConfig 通过 type 选择 store 实现：
MemoryStoreConfig.child_routes() --> {ChildKey("config", "simple"): SimpleMemoryConfig, ...}

# SubgraphConfig 通过 type 选择 source：
SubgraphConfig.child_routes() --> {ChildKey("config", "config"): SubgraphInlineConfig, ...}

# EdgeConditionConfig 通过 type 选择条件类型：
EdgeConditionConfig.child_routes() --> {ChildKey("config", "keyword"): KeywordConditionConfig, ...}
```

这一机制使 **YAML 模板自描述**，`yaml_template/design.yaml` 由 `tools/export_design_template.py` 从 dataclass FIELD_SPECS 自动生成。

### 2.3 yaml_instance 设计模式

`yaml_instance/` 目录包含 30+ 实例，展示了多种编排模式：

| 模式 | 示例文件 | 特点 |
|------|----------|------|
| 软件工程 | `ChatDev_v1.yaml` | 角色分工 + loop 迭代 |
| 游戏开发 | `GameDev_with_manager.yaml` | 带 manager 节点 |
| 通用团队 | `general_problem_solving_team.yaml` | 可适配多种任务 |
| Deep Research | `deep_research_v1.yaml` | 调研子图 |
| MACNet | `MACNet_v1.yaml` | 优化子图嵌套 |
| ReAct | `react.yaml` | 单节点 ReAct 循环 |
| Reflexion | `reflexion_product.yaml` | 反思循环 |
| 动态边 Demo | `demo_dynamic.yaml`, `demo_dynamic_tree.yaml` | Map/Tree 分叉 |
| Memory Demo | `demo_simple_memory.yaml`, `demo_mem0_memory.yaml` | 多种 Memory |
| MCP Demo | `demo_mcp.yaml` | MCP 工具集成 |
| Human-in-the-Loop | `demo_human.yaml` | 人类审批节点 |
| Skills | `skills.yaml` | Agent Skills 机制 |
| 3D/Blender | `blender_3d_builder_hub.yaml` | 3D 构建 |
| 教学视频 | `teach_video.yaml` | 视频生成 |

### 2.4 动态边执行（Dynamic Edge）

`workflow/executor/dynamic_edge_executor.py:18` -- 当边配置 `dynamic: {type: map, split: ...}` 时：

- **Map 模式**：将 payload 拆分为 N 个 execution unit，并行执行目标节点，结果汇总
- **Tree 模式**：Map + group + reduce 多层归并（`max_parallel` 控制并行度，`group_size` 控制归并粒度）

`entity/configs/edge/dynamic_edge_config.py` 定义分裂方式：按 JSON path、正则模式、或自定义 splitter。

### 2.5 Schema Registry

`schema_registry/registry.py` -- 全局注册表，提供：
- `get_node_schema(type)` -> 返回 `(config_cls, summary)` 
- `get_memory_store_schema(type)` -> 返回对应的 memory config class
- `iter_model_provider_schemas()` -> 前端 provider 下拉框数据源
- Schema API：`POST /api/config/schema` 返回完整 JSON Schema，驱动前端动态表单

---

## 3. Web Console 产品设计

### 3.1 技术栈

| 层 | 技术 | 关键文件 |
|----|------|----------|
| 前端框架 | Vue 3 + Vite | `frontend/vite.config.js` |
| 可视化画布 | @vue-flow/core | `frontend/src/pages/WorkflowView.vue` |
| UI 组件 | 自定义暗色主题 + RichTooltip | `frontend/src/components/` |
| 路由 | vue-router | `frontend/src/router/index.js` |
| 国际化 | vue-i18n (en/zh) | `frontend/src/locales/` |
| 后端 | FastAPI + WebSocket | `server/app.py`, `server/routes/websocket.py` |
| 实时日志 | WebSocket push | `server/services/websocket_logger.py` |

### 3.2 WorkflowWorkbench -- 主工作台

`frontend/src/pages/WorkflowWorkbench.vue`：

- **左侧可折叠 Sidebar**（400px，带滑入动画）：WorkflowList 组件，列出 `yaml_instance/*.yaml` 文件
- **右侧主画布**：WorkflowView 组件，包含两个 Tab：
  - **YAML Editor Tab**：只读 YAML 文本视图
  - **VueFlow Graph Tab**：交互式可视化图编辑器

### 3.3 VueFlow 交互式图编辑器

`frontend/src/pages/WorkflowView.vue`：

- **节点渲染**：每种 Node type 有独特颜色和 sprite 动画（执行中节点有行走动画，`WorkflowNode.vue:32`）
- **右键菜单**：Pane 右键 -> 创建节点；Node 右键 -> 复制/删除节点；Edge 右键 -> 删除边
- **拖拽**：节点可拖拽重排，边自动重绘
- **上下文感知**：`RichTooltip` 组件在 hover 时显示帮助文本（从 `helpContent.js` 配置）
- **边标签**：`WorkflowEdge.vue` 在边上显示 condition/process 摘要

### 3.4 配置表单生成器

`frontend/src/components/FormGenerator.vue` + `InlineConfigRenderer.vue` + `DynamicFormField.vue`：

- 从后端 Schema API 获取 FIELD_SPECS，动态生成表单
- 支持嵌套对象、列表、枚举下拉、text 类型
- `RichTooltip` 在每个字段旁显示 FIELD_SPECS.description
- **变体路由**：根据 type 字段切换显示对应的 config form（如 node.type=agent 时显示 AgentConfig 表单）

### 3.5 Tutorial 系统

`frontend/src/pages/TutorialView.vue` + `frontend/public/tutorial-en.md`：

- Markdown 渲染教程，带 anchor 导航和代码块复制按钮
- 教程涵盖：创建 Graph -> 创建节点 -> 建立边 -> 执行逻辑 -> Review 循环 -> Human-in-the-Loop
- 中英文双语（`tutorial-zh.md` / `tutorial-en.md`）

### 3.6 Launch & Batch 执行

- `frontend/src/pages/LaunchView.vue` -- 单 workflow 执行启动页：选 YAML 文件、填写任务 prompt、附件上传、WebSocket 实时日志流
- `frontend/src/pages/BatchRunView.vue` -- 批量执行：CSV 驱动的批量任务

### 3.7 WebSocket 实时执行

`server/services/websocket_executor.py` -- `WebSocketGraphExecutor`：

- 继承 `GraphExecutor`，重写 `_create_logger()` 为 `WebSocketLogger`
- `WorkspaceArtifactHook`：监听 workspace 文件变更，通过 WebSocket 推送 artifact 事件
- `WebPromptChannel`：Human-in-the-Loop 场景下通过 WebSocket 推送 prompt 给前端，等待用户输入
- `ArtifactDispatcher`：将生成的文件（代码、图片等）通过 WebSocket 推送到前端展示

### 3.8 Server API 全景

`server/routes/` 包含：

| 路由 | 功能 |
|------|------|
| `GET /api/workflows` | 列出所有 YAML workflow |
| `GET /api/workflows/{name}/get` | 获取原始 YAML 内容 |
| `POST /api/workflows/upload/content` | 上传新 workflow |
| `PUT /api/workflows/{name}/update` | 更新 workflow |
| `DELETE /api/workflows/{name}/delete` | 删除 workflow |
| `POST /api/workflows/{name}/rename` | 重命名 |
| `POST /api/workflows/{name}/copy` | 复制 |
| `GET /api/workflows/{name}/args` | 获取 workflow 参数 schema |
| `GET /api/workflows/{name}/desc` | 获取 workflow 描述 |
| `POST /api/execute` | 执行 workflow（异步） |
| `POST /api/execute/sync` | 同步执行并返回结果 |
| `POST /api/batch` | 批量执行 |
| `GET /api/sessions` | 列出活跃 sessions |
| `DELETE /api/sessions/{id}` | 取消 session |
| `WS /ws` | WebSocket 实时通信 |
| `GET /api/config/schema` | JSON Schema 端点 |
| `GET /api/tools` | 工具列表 |
| `POST /api/upload` | 文件上传 |
| `GET /api/artifacts/{session_id}` | 获取执行产物 |
| `GET /api/health` | 健康检查 |

---

## 4. Memory 模块设计

### 4.1 Memory 类型体系

`entity/configs/node/memory.py` -- 四种 Memory Store：

| Store | 类 | 用途 |
|-------|-----|------|
| `simple` | `SimpleMemoryConfig:159` | 单文件 JSON 存储，可选 embedding 语义检索 |
| `file` | `FileMemoryConfig:193` | 索引本地文件目录，FAISS 向量检索 |
| `blackboard` | `BlackboardMemoryConfig:247` | 共享黑板，JSON append-only，按时间裁剪 |
| `mem0` | `Mem0MemoryConfig:283` | Mem0 托管记忆服务（云端） |

**Embedding 层**（`EmbeddingConfig:29`）：
- provider / model / api_key / base_url / params
- 默认 `openai` + `text-embedding-3-small`
- 可独立于 Agent provider 配置

### 4.2 Memory 挂载到 Agent

`entity/configs/node/memory.py:426` -- `MemoryAttachmentConfig`：

```yaml
memories:
  - name: code_index          # 引用 graph.memory 中定义的 store
    retrieve_stage: [gen]     # 在哪个阶段检索
    top_k: 3                  # 检索条数
    similarity_threshold: -1.0  # 相似度阈值（-1 不过滤）
    read: true                # 允许读取
    write: true               # 执行后写回
```

### 4.3 Memory 运行时

`workflow/graph.py:150` -- `_build_global_memories()`：
1. 从 `graph.memory` 解析 MemoryStoreConfig
2. 通过 `MemoryFactory.create_memory(store)` 创建 Memory 实例
3. 调用 `.load()` 加载已有数据

`workflow/graph.py:191` -- `_build_agent_memories()`：
- 为每个 agent node 创建 `MemoryManager`，关联其 `memories` 到全局 store

`runtime/node/agent/memory/` -- Memory 执行生命周期：
1. **Pre-Gen Retrieval**：thinking 阶段前检索相关记忆，注入 context
2. **Gen Stage Retrieval**：生成前检索，插入到 conversation
3. **Post-Gen Retrieval**：生成后再次检索，用于 reflection
4. **Update**：节点执行完成后，将 (input, output) 写入 memory

### 4.4 Memory 检索流程

`runtime/node/executor/agent_executor.py:522` -- `_retrieve_memory()`：
- 构建 `MemoryContentSnapshot` (text + message blocks + attachment references)
- 调用 `MemoryManager.retrieve(agent_role, query, current_stage)`
- 返回 `MemoryRetrievalResult`（formatted_text + items + attachment_overview）
- 结果注入 conversation：在 messages 模式插入 USER message，prompt 模式合并到最后一个 USER 消息

---

## 5. 对 AgentHub 的具体建议

### 5.1 应借鉴的设计

**A. 变体配置 + FIELD_SPECS 驱动的动态表单**
ChatDev 的 `BaseConfig.child_routes()` + `ConfigFieldSpec` 机制非常适合 AgentHub：
- 每种 Node type 自带 form schema，前端无需硬编码组件
- 新增 Node 类型只需注册 config class + FIELD_SPECS
- AgentHub 的 adapter 定义、workspace 配置、runner 参数都可以用同样的模式

**B. YAML 配置驱动 + Visual Canvas**
ChatDev 证明了一个关键设计：**YAML 是唯一事实源，Canvas 是编辑器**。AgentHub 可以采用同样的策略：
- `docs/reference/chatdev.md` 类似 `yaml_instance/` -- 存储 workflow 定义
- 前端 VueFlow 画布读取 YAML，编辑后写回 YAML
- 这与 AgentHub 已有设计报告中的方向一致

**C. Subgraph 嵌套复用**
ChatDev 的 `subgraph` node 支持两种模式（inline / file reference），AgentHub 的 "多 Agent 群聊" 场景可以用同样的嵌套机制实现：
- 单个 agent 是叶子节点
- Agent 群聊是 subgraph
- Subgraph 可嵌套，形成任意深度的协作拓扑

**D. Edge-level 条件路由 + Payload Processor**
AgentHub 的 Agent 间消息传递可以直接借鉴 Edge 系统：
- `condition: keyword` -- 根据消息内容路由到不同下游 Agent
- `process: regex_extract` -- 提取结构化数据传递给下一个 Agent
- `dynamic: map` -- 一对多并行分发（如一个消息同时分发给多个 Agent）

**E. Memory 分层设计**
AgentHub 可以直接复用 ChatDev 的 Memory 架构：
- Graph-level Memory Store（跨 Agent 共享上下文）
- Agent-level Memory Attachment（每个 Agent 挂载哪些 store）
- Stage-level Retrieval（在 thinking 不同阶段检索不同记忆）

### 5.2 不建议照搬的设计

**A. ChatDev 的 role 机制过于简单**
ChatDev 的 Agent "角色" 只是一个 system prompt 字符串。AgentHub 如果要做更复杂的 Agent 行为（如 Claude Code 的 full agent loop），需要更强的 Agent 运行时状态管理。

**B. 执行模型是同步 loop，不是事件驱动**
ChatDev 的 `GraphExecutor.run()` 是同步阻塞执行（虽然有 WebSocket 日志推送和 cancel 机制）。AgentHub 如果要做真正的 IM 式聊天，需要异步事件驱动架构：Agent 可以随时发言、随时被 @。

**C. 前端不是 IM 形态**
ChatDev 的 Web Console 是 workflow designer + executor monitor，不是聊天界面。AgentHub 需要的是左侧会话列表 + 中间消息流 + 右侧 artifact 面板的 IM 布局。ChatDev 的可视化画布更适合做 AgentHub 的 "Workflow 编辑视图" 而非主聊天视图。

### 5.3 推荐复用优先级

| 模块 | 复用价值 | 说明 |
|------|---------|------|
| FIELD_SPECS + child_routes 表单系统 | **高** | 直接用于 AgentHub 的 adapter/runtime/config 表单 |
| YAML -> dataclass 解析 + 验证 | **高** | 用于 AgentHub workflow 定义 |
| Schema Registry + Schema API | **高** | 前端驱动动态 UI |
| Memory Store 分层设计 | **高** | SimpleMemory / FileMemory / BlackboardMemory 可直接参考 |
| Edge 条件路由 + Payload Processor | **中** | 简化为 AgentHub 的消息路由 |
| VueFlow 画布 + WorkflowNode | **中** | 作为 AgentHub 的 Workflow Editor 视图 |
| WebSocket 实时日志推送 | **低-中** | 参考实现，但 AgentHub 需要更细粒度的流式 token push |
| Agent Skills 机制 | **中** | `.agents/skills/` 目录 + SKILL.md frontmatter 格式值得借鉴 |
| Dynamic Edge (Map/Tree) | **低** | AgentHub 的 parallel dispatch 可以参考但需简化 |
| 同步 loop 执行模型 | **低** | 与 AgentHub 的异步 IM 模型不兼容 |

### 5.4 关键架构差异总结

| 维度 | ChatDev v2 | AgentHub 目标 |
|------|-----------|---------------|
| 执行模型 | 同步 DAG/Cycle 图执行 | 异步事件驱动，IM 式聊天 |
| 节点粒度 | Workflow Node（单次执行） | Agent Session（持续会话） |
| 交互形态 | Workflow Editor + Monitor | Chat UI + Artifact Panel |
| 生命周期 | 输入 -> 执行 -> 输出（一次性） | 创建 -> 持续对话 -> 归档 |
| 多人/群聊 | 不支持 | 核心需求 |
| Claude Code 接入 | 通过 provider 适配（非原生） | 原生 Claude Code adapter |
| 前端 | Vue 3 + VueFlow | React/Vue (待定) + assistant-ui |
