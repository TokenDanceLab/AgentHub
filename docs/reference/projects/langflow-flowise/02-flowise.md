# Flowise 深度调研报告

> 调研范围：Flowise v3.1.2，`packages/server`、`packages/ui`、`packages/components`、`packages/agentflow`
> 报告日期：2026-05-21

---

## 1. Chatflow / Agentflow 产品设计

### 1.1 三种画布模式的演进

Flowise 目前共存三种画布模式，通过前端路由区分：

| 路由 | 画布组件 | 节点类型 | 说明 |
|---|---|---|---|
| `/canvas/:id` | `views/canvas/index.jsx` | `customNode`, `stickyNote` | Chatflow V1（经典） |
| `/agentcanvas/:id` | `views/canvas/index.jsx` | 同 Chatflow V1 | Agentflow V1，与 Chatflow 共用组件 |
| `/v2/agentcanvas/:id` | `views/agentflowsv2/Canvas.jsx` | `agentFlow`, `stickyNote`, `iteration` | Agentflow V2（全新画布） |

关键实现细节：

- **V1 画布**（`views/canvas/index.jsx:74`）：通过 `URLpath.includes('agentcanvas')` 判断 `isAgentCanvas` 标志，决定顶部标题为 "Agent" 还是 "Chatflow"。Chatflow 和 Agentflow V1 本质是**同一套 ReactFlow 画布**，仅通过后台数据标记区分流程类型。
- **V2 画布**（`views/agentflowsv2/Canvas.jsx:64`）：全新 ReactFlow 实现，使用独立的节点类型 `agentFlow`、`iteration` 和边类型 `agentFlow`。引入了 `isValidConnectionAgentflowV2` 连接约束（`views/agentflowsv2/Canvas.jsx:56`），支持 IterationNode 子画布。
- **路由设计**（`routes/CanvasRoutes.jsx`）：V1 画布权限为 `chatflows:view` / `agentflows:view`，V2 画布权限统一为 `agentflows:view`，路由前缀 `/v2/agentcanvas`。

### 1.2 列表页双入口

列表页分离为两个独立视图（`routes/MainRoutes.jsx`）：

- **Chatflows 列表**（`views/chatflows/index.jsx`）：卡片/表格视图切换，使用 `chatflowsApi.getAllChatflows`
- **Agentflows 列表**（`views/agentflows/index.jsx:50`）：支持 V1/V2 版本切换 `agentflowVersion`（默认 `v2`），同时展示废弃提示横幅。使用 `chatflowsApi.getAllAgentflows`。

### 1.3 节点配置面板设计

节点参数通过 `INodeParams` 接口定义（`packages/components/src/Interface.ts`），支持丰富参数类型：

- **基础类型**：`string`、`number`、`boolean`、`json`、`code`、`password`
- **复合类型**：
  - `datagrid`：可编辑表格（State 节点、Agent Update State）
  - `tabs`：标签页切换（State 节点的 Table/Code 双模式）
  - `asyncSingleSelect`：异步加载的下拉选择（如 State Key 选择）
  - `freeSolo`：带预设选项的可自由输入下拉
- **特殊控件**：`Moderation`（内容审核）、`Tool`（工具列表）、`BaseChatModel`（模型选择）、`BaseCheckpointSaver`（记忆后端）
- **条件显隐**：通过 `show`/`hide` 字段控制参数可见性，支持嵌套路径和数组匹配（`agentflowv2Generator.ts:577-673`）

### 1.4 Agentflow SDK（@flowiseai/agentflow）

Flowise 正在将画布能力抽取为独立的 npm 包 `@flowiseai/agentflow`（v0.0.0-dev.14），采用 **Domain-Driven Modular Architecture**：

```
src/
├── atoms/          # UI 原语（"What it looks like"）- 无状态原子组件
├── features/       # 领域功能（"What it does"）
│   ├── canvas/     # ReactFlow 画布核心
│   ├── node-palette/  # 节点面板
│   ├── generator/  # AI 流程生成
│   └── node-editor/   # 节点属性编辑
├── core/           # 业务逻辑层 - 纯 TypeScript，无 React
│   ├── types/      # 全局类型（FlowNode, FlowEdge, NodeData, InputParam）
│   ├── validation/ # 流程验证
│   ├── theme/      # 设计 Token
│   ├── primitives/ # 领域无关工具函数（可被 atoms 导入）
│   └── utils/      # 领域感知工具函数（仅 features/infrastructure 可用）
└── infrastructure/ # 外部服务层（API Client, Store）
```

**关键设计约束**（`ARCHITECTURE.md:187-228`）：
- 依赖仅向下流动：`features -> {atoms, infrastructure} -> core`
- Features 之间禁止相互导入
- Core 是叶子节点，不依赖任何层
- 严格的 Gatekeeper 模式：每个目录通过 `index.ts` 暴露公共 API

---

## 2. Agentflow V2 多 Agent 架构

Flowise 提供两套完整的多 Agent 范式，代码位于 `packages/components/nodes/`：

### 2.1 Multi Agents（Supervisor/Worker 模式）

**Supervisor 节点**（`nodes/multiagents/Supervisor/Supervisor.ts`）：

- **路由机制**：定义 `RouteTool`（`Supervisor.ts:714-729`），要求 LLM 使用 Function Calling 输出 `{reasoning, next, instructions}`，其中 `next` 为 `FINISH` 或 Worker 名称。
- **强制 Tool Use**：针对不同模型采用不同策略（`Supervisor.ts:127-370`）：
  - OpenAI/Azure：`tool_choice: { type: 'function', function: { name: 'route' } }`
  - Anthropic：用户提示中追加 "Use the route tool in your response"
  - Mistral：`tool_choice: 'any'`
  - Gemini：`bindTools([tool])`
  - 通用 Fallback：`bindTools + ToolCallingAgentOutputParser`
- **可配置参数**：
  - `supervisorName`：自定义名称
  - `supervisorPrompt`：系统提示（必须包含 `{team_members}` 占位符）
  - `agentMemory`：`BaseCheckpointSaver` 类型，保存整个会话状态
  - `summarization`：布尔值，是否输出对话摘要
  - `recursionLimit`：最大递归次数（默认 100）
- **返回值**：`IMultiAgentNode`，包含 `node`（执行函数）、`name`、`workers`（Worker 名称数组）、`checkpointMemory`

**Worker 节点**（`nodes/multiagents/Worker/Worker.ts`）：

- 通过 `supervisor` 输入字段与 Supervisor 绑定（`Worker.ts:59-62`）
- 采用 LLM：优先使用自己的模型，否则继承 Supervisor 的 LLM（`Worker.ts:111`）
- **Agent 创建逻辑**（`Worker.ts:161-266`）：
  - 有工具：`RunnableSequence` + `AgentExecutor.fromAgentAndTools`，使用 `ToolCallingAgentOutputParser`
  - 无工具：简单 `RunnableSequence`，`prompt -> llm -> createTextOnlyOutputParser`
- **协作提示**：Worker 提示中注入 "Your other team members (and other teams) will collaborate with you with their own specialties"（`Worker.ts:174`）
- 输出类型：`type: 'worker'`，记录 `parentSupervisorName`

### 2.2 Sequential Agents（LangGraph DAG 模式）

基于 LangGraph 的 `StateGraph`，支持有向无环图（DAG）编排，节点类型完整：

| 节点 | 文件 | 关键能力 |
|---|---|---|
| **Start** | `sequentialagents/Start/Start.ts:6` | 入口节点，配置 LLM + Agent Memory + State 定义 + Input Moderation |
| **Agent** | `sequentialagents/Agent/Agent.ts:198` | 核心执行节点（v4.1），支持工具调用、人工审批中断、状态更新 |
| **State** | `sequentialagents/State/State.ts:31` | 自定义状态 Schema，支持 Replace/Append 操作，Table UI + Code 双模式 |
| **Condition** | `sequentialagents/Condition/Condition.ts` | 条件分支，Table UI 或 JS Sandbox 模式，返回下一个节点名称 |
| **LLMNode** | `sequentialagents/LLMNode/` | 纯 LLM 调用节点（无工具） |
| **ToolNode** | `sequentialagents/ToolNode/` | 纯工具执行节点 |
| **Loop** | `sequentialagents/Loop/` | 循环控制 |
| **End** | `sequentialagents/End/` | 终止节点 |
| **CustomFunction** | `sequentialagents/CustomFunction/` | 自定义 JS 函数节点 |
| **ExecuteFlow** | `sequentialagents/ExecuteFlow/` | 嵌套子流程执行 |

**顺序 Agent 的关键能力**（`Agent.ts:465-617`）：

1. **中断审批**（`interrupt` 参数）：工具执行前暂停，要求用户确认。使用 `ToolNode`（`Agent.ts:965-1088`），自定义 `approveButtonText`/`rejectButtonText`
2. **状态更新**：支持 UI 表格和 JS Code 两种方式更新 LangGraph 状态
   - UI 表格：配置 Key/Value，Value 可使用 `$flow.output.content`、`$flow.output.usedTools[0].toolOutput` 等模板变量
   - JS Code：沙箱执行，拿到 `$flow` 对象（含 input/state/output/sessionId 等），返回 Key-Value 对象
3. **会话历史**：支持 4 种模式选择（User Question / Last Message / All Messages / Empty）
4. **消息历史前置**：支持在 System Prompt 和 Human Prompt 间插入示例消息

### 2.3 Agent Memory 机制

**Agent Memory 节点**（`nodes/memory/AgentMemory/AgentMemory.ts`）：

- 实现 `BaseCheckpointSaver` 接口（LangGraph 的 Checkpoint 序列化协议）
- 三种存储后端：
  - SQLite（默认）：本地文件或默认路径 `.flowise/database.sqlite`
  - PostgreSQL：通过 credential 配置连接
  - MySQL：通过 credential 配置连接，强制 `utf8mb4` 字符集
- **核心接口**（`interface.ts`）：`CheckerTuple = { config, checkpoint, metadata, parentConfig }` — 支持父子 Checkpoint 链，实现分支/回滚
- 标记为 `DEPRECATING`（`AgentMemory.ts:32`），说明 Flowise 正在向新的记忆架构迁移
- 分别在 Supervisor 的 `agentMemory` 输入和 Sequential Start 的 `agentMemory` 输入中使用

### 2.4 AI 自动生成 Flow（agentflowv2Generator）

`packages/components/src/agentflowv2Generator.ts` 实现了一项关键差异化能力——**通过自然语言描述自动生成 Agentflow V2 流程**：

1. **Nodes+Edges 生成**（`generateNodesEdges`, 行 356-410）：
   - 使用 LLM + StructuredOutputParser 生成符合 Zod Schema 的 `{description, nodes[], edges[]}` 结构
   - Node Schema 包含：`id`, `type: 'agentFlow'`, `position{x,y}`, `width`, `height`, `data`
2. **节点数据初始化**（`generateNodesData`, 行 412-454）：将 LLM 生成的节点映射到 Flowise 组件目录，调用 `initNode` 填充 `inputParams`, `inputAnchors`, `outputAnchors`, 默认值
3. **工具自动选择**（`generateSelectedTools`, 行 232-298）：为 Agent 节点和 Tool 节点分别使用专门的 System Prompt 从可用工具列表中自动选择合适的工具

---

## 3. Monorepo 模块拆分设计

### 3.1 总体架构

Flowise 使用 **pnpm Workspaces + Turborepo** 管理 6 个包：

```
Flowise/
├── packages/
│   ├── server/          # flowise (npm: flowise) - 后端服务
│   ├── ui/              # flowise-ui - 前端管理界面
│   ├── components/      # flowise-components - 节点定义 + 运行态
│   ├── agentflow/       # @flowiseai/agentflow - 可嵌入画布 SDK
│   ├── api-documentation/ # @flowiseai/api-documentation
│   └── observe/         # @flowiseai/observe - 可观测性
├── pnpm-workspace.yaml  # packages: ['packages/*']
├── turbo.json           # 构建管道：build -> test
└── package.json         # 版本 3.1.2, engines: node^20, pnpm^10.26
```

**构建系统**（`turbo.json`）：`build` pipeline 的 `dependsOn: ["^build"]` 确保组件包先于消费包构建。

### 3.2 各包详细分析

#### 3.2.1 `packages/server`（flowise）

- **技术栈**：Express + TypeORM + Oclif CLI + BullMQ（队列）
- **架构模式**：MVC（controllers/routes）+ 服务层
- **核心入口**（`src/index.ts`）：`App` 类，持有所有服务实例
  - `NodesPool`：节点注册与缓存
  - `AbortControllerPool`：请求中断管理
  - `CachePool`：运行时缓存
  - `QueueManager`：异步任务队列（BullMQ + Redis）
  - `SSEStreamer`：Server-Sent Events 流式输出
  - `UsageCacheManager`：用量缓存
  - `ScheduleBeat`：定时任务调度
  - `IdentityManager`：多租户身份管理
- **路由结构**（40+ 路由模块）：按功能垂直拆分——`chatflows`、`agentflowv2-generator`、`predictions`、`credentials`、`variables`、`vectors`、`evaluations` 等
- **数据库**：TypeORM 支持的多种后端（entities 类目录 `src/database/entities/`）
- **企业版**：`src/enterprise/` 包含组织（Organization）、工作空间（Workspace）、RBAC

#### 3.2.2 `packages/ui`（flowise-ui）

- **技术栈**：React 18 + MUI 5.15 + Redux Toolkit + React Router + Vite
- **UI 组件库**：自建 30+ 原子组件（`ui-component/`），含 Array、Button、Cards、Dialog、Editor、Grid、Table、Tabs 等
- **视图结构**（`views/`）：30+ 独立视图，按功能分类——chatflows、agentflows、agentflowsv2、canvas、credentials、variables、docstore、evaluations、tools、assistants、settings 等
- **状态管理**：Redux store + React Context（`ReactFlowContext`）
- **权限控制**：`<RequireAuth permission="...">` 包装路由组件

#### 3.2.3 `packages/components`（flowise-components）—— 核心包

这是 Flowise 最重的包，承载**所有节点定义 + 运行态逻辑**：

- **双入口导出**（`package.json`）：
  - `"."` -> `dist/src/index.js`：核心基础设施（handler, utils, Interface, validator, agentflowv2Generator）
  - `"./nodes"` -> `dist/nodes/index.js`：所有 200+ 节点定义
- **节点组织**（`nodes/`）：按类别分目录
  - `agents/`：经典单 Agent 节点（ReActAgentChat/LLM, ToolAgent, OpenAIAssistant 等，10+ 种）
  - `agentflow/`：Agentflow V2 画布节点（Agent, Condition, LLM, Loop, Start, Tool, Retriever, Iteration 等）
  - `multiagents/`：多 Agent 协调（Supervisor, Worker）
  - `sequentialagents/`：顺序 Agent 编排（Start, Agent, Condition, LLMNode, ToolNode, Loop, End, State, CustomFunction, ExecuteFlow）
  - `chatmodels/`：30+ 模型集成（OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Ollama 等）
  - `tools/`：50+ 工具节点
  - `memory/`：12 种记忆后端
  - `vectorstores/`：20+ 向量数据库
  - `embeddings/`、`documentloaders/`、`textsplitters/`、`outputparsers/` 等
- **核心 handler**（`src/handler.ts`，2049 行）：流程构建与执行的核心引擎，负责按边关系串联节点构建 LangChain Runnable
- **节点注册模式**：每个节点文件 `module.exports = { nodeClass: XXX }` 自注册，Node 类实现 `INode` 接口（`label`, `name`, `version`, `type`, `icon`, `category`, `inputs[]`, `init()`）

#### 3.2.4 `packages/agentflow`（@flowiseai/agentflow）

- **定位**：可嵌入 npm 包，允许第三方应用集成 Flowise 画布
- **版本状态**：`0.0.0-dev.14`（孵化期），Apache-2.0 许可
- **DDD 架构**：atoms / features / core / infrastructure 四层（详见 1.4 节）
- **公共 API**：`Agentflow`, `AgentflowProvider`, `useAgentflow`, 类型导出
- **独立构建**：Vite + TSC，输出 UMD + ESM 双格式

### 3.3 依赖关系图

```
server (flowise)
  ├── 依赖 components (运行时动态 import 节点类)
  ├── 依赖 TypeORM + Express + BullMQ
  └── 被 ui 通过 REST API 调用

ui (flowise-ui)
  ├── 依赖 MUI 5 + React 18 + Redux
  ├── 调用 server REST API
  └── 可选嵌入 agentflow SDK

components (flowise-components)
  ├── 依赖 @langchain/core, @langchain/langgraph
  ├── 被 server 运行时消费
  └── 无前端依赖

agentflow (@flowiseai/agentflow)
  ├── 独立 React 组件库
  ├── 不依赖 server/components
  └── 待成熟后可替代 ui 中的画布部分

observe (@flowiseai/observe)
  └── 独立可观测 SDK，与 agentflow 同级设计
```

### 3.4 关键技术决策

1. **Node DLL 模式**：节点代码在第 3 方处（components），不在 server 内。Server 通过 `NodesPool` 按需 `import()` 加载，每节点自注册。这允许社区贡献节点而不修改 server。
2. **Monorepo 共享**：server 和 components 共享 LangChain 类型，类型定义集中在 `components/src/Interface.ts`（496 行）。
3. **Enterprise 分层**：`packages/server/src/enterprise/` 包含 RBAC、Organizations、Workspaces、SSO 等企业功能，与开源核心分离。
4. **构建隔离**：`build:docker` 排除 agentflow 和 observe 包（`turbo.json` 的 filter），因为它们是可选组件。
5. **依赖版本锁定**：使用 pnpm `overrides` 和 `resolutions` 双重锁定关键依赖（axios, uuid, openai, @langchain/core 等），解决兼容性问题。

---

## 4. 对 AgentHub 的具体建议

### 4.1 画布架构：建议参考 @flowiseai/agentflow 的 DDD 分层

AgentHub 的 Canvas UI 应参考 `@flowiseai/agentflow` 的四层架构：

- **atoms/**（UI 原语层）：定义不可再分的原子组件（NodeHandle、ConfigInput、ToolbarButton），无业务逻辑
- **features/**（领域功能层）：Canvas、NodeEditor、NodePalette、Generator 四个独立 silo，features 间禁止相互导入
- **core/**（业务逻辑层）：纯 TypeScript 类型和校验逻辑，与框架解耦，可独立测试
- **infrastructure/**（外部服务层）：API Client、State Store，集中管理副作用

**具体做法**：AgentHub 的 `AgentFlowCanvas` 组件应拆分为 `atoms` + `features/canvas`，避免当前 Flowise V1 canvas 中把所有逻辑塞进一个 1000+ 行 JSX 文件的问题。

### 4.2 多 Agent 编排：Sequential Agents (LangGraph DAG) 优于 Supervisor/Worker

Flowise 的实践表明：

- **Supervisor/Worker** 适合简单的线性路由（Choose next -> Execute -> Choose next），但缺乏显式拓扑可见性
- **Sequential Agents (LangGraph StateGraph)** 提供显式 DAG 结构，节点和边在画布上一目了然，支持条件分支、循环、子流程嵌套，更适合复杂工作流

**建议 AgentHub 主推 Sequential Agents 模式**，对简单场景降级到 Supervisor/Worker 的自动路由模式。两种模式共享同一套 Agent Memory 基础（`BaseCheckpointSaver` 接口）。

### 4.3 Monorepo 模块拆分：建议采用 components/server/ui 三层

Flowise 的三包核心架构值得 AgentHub 参考：

- **`packages/nodes`**（类比 components）：所有 Agent 节点定义 + 运行态引擎，与 UI 框架完全解耦
- **`packages/server`**：Express API + 数据库 + 队列，消费 nodes 包
- **`packages/ui`**：前端管理界面，通过 REST API 调用 server

额外建议：
- 新增 **`packages/sdk`**（类比 agentflow）：可嵌入的 React/Vue Canvas 组件，允许第三方集成
- 使用 pnpm workspaces + Turborepo，构建顺序依赖 `dependsOn: ["^build"]`
- 关键共享类型集中到 `packages/nodes/src/Interface.ts`，避免 server 和 ui 各自定义重复类型

### 4.4 Agent Memory：LangGraph Checkpoint 是正确方向

Flowise 使用 LangGraph 的 `BaseCheckpointSaver` 作为 Agent Memory 抽象，这是一种简单而强大的设计：

- 在 Sequential Agent 的 Start 节点配置一次 Memory，整个 DAG 中所有节点自动获得持久化能力
- 支持 SQLite（开发）/ PostgreSQL（生产）/ MySQL（生产）三级部署
- 支持 Checkpoint 链式父子关系，实现对话分支和回滚

AgentHub 如果基于 LangGraph 构建，应复用此模式。如自行实现 Agent 运行时，也应提供类似的 Checkpoint 抽象。

### 4.5 AI 流程自动生成：agentflowv2Generator 的三种生成策略值得学习

`agentflowv2Generator.ts` 展示的 "自然语言 -> 流程结构 + 参数填充" 分步生成策略：

1. 先用 Structured Output 生成拓扑（nodes/edges）
2. 再将节点映射到组件目录填充默认参数
3. 最后为 Agent/Tool 节点选择合适的工具

AgentHub 如要实现 "描述需求自动生成 Agent" 的魔法功能，应采用相同的分阶段生成 + Zod Schema 校验方案，避免一次性生成全部细节导致的不稳定。

### 4.6 安全审批：Human-in-the-Loop 中断模式

Sequential Agent 的 `interrupt` 机制（`Agent.ts:318-326`）——在工具执行前暂停并等待用户批准——是生产环境 Agent 的关键安全能力。AgentHub 应原生支持：

- 可配置的审批提示词（`approvalPrompt`）
- 自定义的通过/拒绝按钮文案
- 中断状态通过 Agent Memory 持久化，支持页面刷新后恢复

### 4.7 避免的陷阱

1. **Flowise V1 Canvas 的单文件巨石**：`canvas/index.jsx` 把所有画布逻辑塞进一个文件，导致维护困难。AgentHub 应从起点就用 DDD 分层。
2. **Agent Memory DEPRECATING 标记**：Flowise 正在迁移记忆架构，AgentHub 应从一开始就设计稳定的 Memory 接口，避免 V1/V2 并发维护的负担。
3. **路由碎片化**：`/canvas`、`/agentcanvas`、`/v2/agentcanvas` 三条路径暴露了历史包袱。AgentHub 应设计单一画布路由，通过 flow type 参数区分模式。
4. **节点版本管理**：Flowise 节点有 `version` 字段但未见自动迁移工具。AgentHub 应从一开始设计节点 Schema 的向前兼容策略。
