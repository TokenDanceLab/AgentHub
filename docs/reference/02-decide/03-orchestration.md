# AgentHub Orchestrator 跨仓库综合分析

> 基于 `langflow.md`、`flowise.md`、`chatdev.md`、`librechat.md` 四份调研报告
> 分析日期：2026-05-21

---

## 1. 四种编排模型对比

### 1.1 模型总览

四种编排模型代表了 "谁来定义拓扑、何时决定路由、交互介质是什么" 三个维度的不同取舍：

| 维度 | Canvas 画布 | YAML 配置 | IM @mention | Supervisor |
|------|------------|-----------|-------------|------------|
| **代表项目** | Langflow, Flowise | ChatDev v2 | LibreChat (消息树) | Flowise Supervisor/Worker |
| **拓扑定义者** | 人类拖拽连线 | 人类编写 YAML | 用户 @mention + 群聊上下文 | LLM 动态路由 |
| **路由决策时机** | 设计时固定 | 设计时固定 | 运行时，用户逐个 @ | 运行时，LLM 每一步决策 |
| **交互介质** | 可视化画布 | 文本编辑器 | 聊天消息流 | 画布内 Supervisor 节点 |
| **可见性** | 拓扑一目了然 | 拓扑可读但需脑补 | 拓扑隐式，靠消息上下文推断 | 拓扑隐式，LLM 黑盒路由 |
| **学习曲线** | 低（拖拽直觉） | 中（需学 YAML schema） | 极低（人人会聊天） | 低（配置一个 Supervisor） |
| **表达能力** | 受限画布能力 | 图灵完备 | 受限于自然语言歧义 | 受限于 LLM 路由准确率 |
| **版本控制** | JSON 序列化（可 diff 不友好） | Git-native（YAML 可 diff/merge） | 消息历史（无拓扑版本化） | 节点参数（无拓扑版本化） |

### 1.2 各自的设计优势

#### Canvas 画布（Langflow / Flowise）

**Langflow 的核心优势**：
- ReactFlow 画布 + handle-based wiring，拖拽连线直观
- `tool_mode=True` 三级能力提升链：Canvas tool -> Agent tool -> MCP tool
- `Component -> ComponentToolkit -> StructuredTool` 自动转化，同样的 output 不加改动就能跨层暴露
- Auto-save + snapshot undo/redo + build 竞态防护 (`pendingNodeUpdates` Map)
- 170+ 预置组件，Sidebar 模糊搜索 (Fuse.js) + 分类折叠

**Flowise 的核心优势**：
- 三种画布模式共存演进：Chatflow V1 -> Agentflow V1 -> Agentflow V2
- `@flowiseai/agentflow` SDK 的 DDD 四层架构（atoms / features / core / infrastructure），features 间禁止相互导入
- AI 自动生成 Flow（`agentflowv2Generator`）：自然语言 -> Structured Output 拓扑 -> 节点映射 -> 工具选择，分阶段生成 + Zod Schema 校验
- Sequential Agents 的完整 10 节点 DAG（Start/Agent/State/Condition/LLMNode/ToolNode/Loop/End/CustomFunction/ExecuteFlow）
- Human-in-the-Loop 中断审批 + Agent Memory Checkpoint 持久化

**适用场景**：需要显式拓扑编辑、可视化调试、组件复用的低代码/无代码平台。

#### YAML 配置（ChatDev）

**核心优势**：
- YAML 是 SSOT（单一事实来源），Canvas 是编辑器（而非相反）。拓扑可 Git diff/merge/review
- `BaseConfig.child_routes()` 变体配置机制：`Node.type` 动态选择 Config Schema，类似 discriminated union
- `FIELD_SPECS` 元数据驱动前端动态表单，新增 Node 类型只需注册 dataclass，无需改前端代码
- Subgraph 嵌套复用：inline YAML 或外部文件引用，任意深度嵌套
- Edge-level 条件路由 + Payload Processor：`condition: keyword/function`、`process: regex_extract/function`、`dynamic: map/tree`
- 三种执行策略自动选择：DAG（无环并行）、Cycle（有环顺序）、MajorityVote（多节点投票）
- Schema Registry 提供全局类型发现，前端通过 `/api/config/schema` 动态渲染表单
- 30+ yaml_instance 实例覆盖软件工程、游戏开发、Deep Research、ReAct、Reflexion 等模式

**适用场景**：需要版本化管理 workflow、团队协作编辑、CI/CD 集成、批量执行的企业级 Agent 编排。

#### IM @mention（LibreChat 消息树）

**核心优势**：
- 消息树而非线性列表：`buildTree()` 将消息组织为 `{message, children[]}`，每个节点可以有多个子分支（sibling）
- Fork 机制：四种模式（DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT），Git 风格视觉隐喻
- SiblingSwitch UI：左右箭头切换兄弟分支，`1/3` 导航指示器，仅在分支数 > 1 时渲染
- 会话虚拟化大列表（react-virtualized AutoSizer + CellMeasurer）
- Artifacts 渲染：Code/Preview 双 Tab，Sandpack 实时代码编辑，Mermaid 图表渲染
- 上下文 Summarization 引擎：`reserveRatio` 预留比例 + `calibrationRatio` EMA 校准 + Subagent 独立（不继承 initialSummary）

**适用场景**：以对话为主、需要分支探索、Artifact 展示的 ChatGPT-like 产品。

#### Supervisor（Flowise Supervisor/Worker）

**核心优势**：
- LLM 作为路由器：Supervisor 节点通过 Function Calling 输出 `{reasoning, next, instructions}`，`next` 为 FINISH 或 Worker 名称
- 多模型适配：OpenAI 用 `tool_choice: {type: "function", function: {name: "route"}}`，Anthropic 用用户提示注入 "Use the route tool"，Mistral 用 `tool_choice: "any"`
- Worker 自动继承：Worker 优先自己的 LLM，否则继承 Supervisor 的 LLM
- Worker 协作提示：自动注入 "Your other team members (and other teams) will collaborate with you"
- `recursionLimit` 硬上限（默认 100）
- Agent Memory Checkpoint 持久化整个会话状态

**适用场景**：任务类型不确定、需要 LLM 自主判断下一步、Worker 池动态变化的场景。

### 1.3 模型能力矩阵

```
                    拓扑可见性
                        ▲
                   YAML | Canvas
                       ╱ ╲
                      ╱   ╲
                     ╱     ╲
                    ╱       ╲
         Supervisor ╱─────────╲ IM @mention
                    ╱           ╲
                   ╱             ╲
                  ╱               ╲
                 ╱                 ╲
                └───────────────────► 交互自然度
              LLM 路由              人类 @mention
              （黑盒）              （直觉）
```

**核心张力**：拓扑可见性与交互自然度是负相关的。Canvas/YAML 让拓扑显式但割裂了聊天体验；IM @mention 让交互自然但拓扑隐式难调试。AgentHub 需要在这两个维度之间找到第三条路。

---

## 2. AgentHub Orchestrator 最优调度策略

### 2.1 设计前提

AgentHub 与四个参考项目的根本差异：

| 维度 | 四个参考项目 | AgentHub |
|------|-------------|----------|
| 交互形态 | Canvas + Chat 辅助 或 Chat-only | **IM 群聊为主**，Agent 是群成员 |
| 拓扑定义 | 人类预定义（拖拽/YAML） | **运行时涌现**：@mention 即拓扑边 |
| 生命周期 | Flow 一次执行 / 单会话 | **持续群聊**，Agent 长期驻留 |
| 多人参与 | 无或弱 | **核心需求**：多人 + 多 Agent 同群 |
| Claude Code | 通过 provider API 适配 | **原生 Claude Code adapter**（已在 runner 架构中） |

### 2.2 核心设计原则："拓扑涌现，而非预定义"

AgentHub 的 IM 群聊场景下，编排拓扑不应该由用户预先画图或写 YAML 来定义。拓扑应该从群聊交互中**自然涌现**：

1. **@mention 即边**：用户 `@CodeAgent 帮我写个 API` 创建了一条从用户到 CodeAgent 的任务边
2. **Agent 自发回应**：CodeAgent 完成编码后 `@ReviewAgent review 一下` 创建了 Agent-to-Agent 委派边
3. **群聊上下文即拓扑状态**：整个群聊的消息树就是当前编排拓扑的运行态快照

但这不意味着没有显式拓扑——用户应该能**看到**涌现出来的拓扑，并在需要时**手动调整**。

### 2.3 三层调度架构

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: Conversation Context (群聊消息树)            │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 消息树 = 编排拓扑的运行时表示                        │ │
│  │ - 每条消息有 parent/children 指针                  │ │
│  │ - @mention 消息自动创建 subtask 节点                │ │
│  │ - Agent 响应消息自动关联到发起消息的 children        │ │
│  │ - Fork branching 支持并行探索                      │ │
│  └──────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│  Layer 2: Agent Capability Registry (Agent 能力注册表) │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 静态配置 + 动态发现                                │ │
│  │ - 每个 Agent 声明：role, tools, subagents, skills  │ │
│  │ - Agent 入群时自动注册到群聊能力池                   │ │
│  │ - LLM 路由时查询能力池选择合适的 Agent               │ │
│  │ - 参考 ChatDev FIELD_SPECS 动态表单 + Schema API   │ │
│  └──────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│  Layer 3: Topology View (拓扑可视化，可选)              │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 事后可视化，非事前编排                              │ │
│  │ - 从消息树自动提取拓扑（类似 Langflow Flow-as-API）  │ │
│  │ - 支持拖拽调整 Agent 关系（修改后写回 Agent Config） │ │
│  │ - 支持保存为 YAML Template（参考 ChatDev 模式）      │ │
│  │ - 支持从 YAML Template 快速创建群聊                 │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 2.4 调度策略：混合模式

AgentHub 采用**混合调度**，在不同场景下自动切换：

#### 策略 A：@mention 直接委派（默认模式）

用户或 Agent 在群聊中 `@AgentName` 即创建任务。系统自动：
1. 在消息树中创建 subtask 节点
2. 将消息上下文 + 被 @ 的 Agent 的 Capability 注入 LLM
3. 被 @ Agent 在群聊中回复（所有人可见）或私聊回复（仅发起者可见）

**适用**：简单任务、单步委派、人类主导的工作流。

#### 策略 B：Supervisor 自动路由（多 Agent 协作模式）

当用户 `@Coordinator 帮我完成 X` 时，Coordinator Agent 以 Supervisor 模式运行：

1. Coordinator 分析任务，从群聊 Agent 能力池中选择 Worker
2. 通过 Function Calling 输出 `{next: "AgentName", instructions: "..."}`
3. Worker 完成后，Coordinator 评估结果，决定 FINISH 或 route 到下一个 Worker
4. 所有 Worker 的响应在群聊中可见，维护协作透明性

**参考**：Flowise Supervisor 的 RouteTool 机制 + 多模型适配策略。
**增强**：AgentHub 的 Supervisor 不只是 LLM 路由——它还可以参考群聊中 Agent 的实时状态（busy/idle/error）。

#### 策略 C：YAML Template 预定义（复杂工作流模式）

对于需要反复执行的复杂工作流，用户可以从群聊拓扑导出 YAML Template：

```yaml
# 从群聊自动提取的 workflow template
version: "1"
graph:
  id: code-review-workflow
  nodes:
    - id: code-agent
      type: agent
      role: "Full-stack developer"
      config:
        provider: anthropic
        name: claude-sonnet-4-20250514
        tools: [write, bash, read]
    - id: review-agent
      type: agent
      role: "Code reviewer"
      config:
        provider: anthropic
        name: claude-sonnet-4-20250514
        tools: [read, grep]
    - id: test-agent
      type: agent
      role: "Test engineer"
      config:
        provider: anthropic
        name: claude-haiku-4-20250514
  edges:
    - source: user
      target: code-agent
      trigger: "@CodeAgent"
    - source: code-agent
      target: review-agent
      condition: "code_ready"
    - source: review-agent
      target: code-agent
      condition: "changes_requested"
    - source: review-agent
      target: test-agent
      condition: "approved"
  max_iterations: 3  # review 循环上限
```

**参考**：ChatDev 的 YAML + GraphManager 架构 + Edge condition 路由。

#### 策略 D：Fork 并行探索（多方案对比模式）

用户可以从群聊的任意消息点 Fork 出新的分支：
- 不同 Agent 并行处理同一任务，比较结果
- 同一 Agent 用不同参数重试
- 分支结果在 SiblingSwitch UI 中对比

**参考**：LibreChat 的四种 Fork 模式 + SiblingSwitch。

### 2.5 调度决策流程

```
用户消息到达
    │
    ├─ 含 @AgentName？
    │   ├─ 是 → 策略 A：直接委派给指定 Agent
    │   └─ 否
    │       ├─ 检测到活跃 Supervisor Agent 在群中？
    │       │   └─ 是 → 策略 B：Supervisor 路由（LLM 选择 Worker）
    │       └─ 否
    │           ├─ 消息匹配已注册的 trigger condition？
    │           │   └─ 是 → 策略 C：YAML template 匹配，按预定义边路由
    │           └─ 否
    │               ├─ 用户主动 Fork 当前上下文？
    │               │   └─ 是 → 策略 D：Fork 分支 + 并行 Agent
    │               └─ 否 → 等待用户明确 @ 或继续对话
```

### 2.6 IM 群聊特有的调度能力

四个参考项目都没有的原生能力：

1. **Agent 可见的群聊上下文**：所有 Agent 能 "看到" 群聊中的所有消息（除非显式隔离）。这使 Agent 可以自发参与讨论，而非被动等待被 @。

2. **多人类 + 多 Agent 混排**：消息流中人类和 Agent 消息交替出现。某 Agent 的响应可能触发另一个人类的后续提问，形成人机混合协作流。

3. **Agent 状态在群聊中可见**：Agent 的在线/忙碌/错误状态对群成员可见（类似 Discord bot status）。如果 Agent 正在执行长任务，群聊中显示进度指示。

4. **基于消息树的权限隔离**：虽然 Agent 能 "看到" 全局上下文，但某些子树可以标记为 "仅 @CodeAgent 和 @UserA 可见"，实现分组讨论。

5. **Threaded 子讨论**：从群聊主 timeline 分叉出 threaded reply 链，形成天然的 subgraph 隔离（类似 Flowise IterationNode 子画布）。

---

## 3. Subagent 递归委派的防循环机制

### 3.1 循环产生的场景

在 AgentHub 的群聊场景中，subagent 循环可能以多种形式出现：

| 场景 | 示例 | 危险等级 |
|------|------|---------|
| 直接自委派 | CodeAgent `@CodeAgent 再检查一遍` | 高（无限自循环） |
| 相互委派 | CodeAgent `@ReviewAgent review` -> ReviewAgent `@CodeAgent 修改` -> ... | 高（review-revise 死循环） |
| 环形委派 | A -> B -> C -> A | 中（深度 > 2 时难以发现） |
| Supervisor 误路由 | Supervisor 反复 route 到同一 Worker | 中（LLM 路由不稳定） |
| Fork 嵌套爆炸 | 从每个分支再 Fork，指数增长 | 中（资源耗尽） |
| 嵌套 Subgraph 循环 | Subgraph A 包含 Subgraph B，B 又引用 A | 低（YAML template 场景更可控） |

### 3.2 综合防循环方案（四层防护）

#### 第一层：预执行静态检测（Graph-level）

**来源**：Langflow lfx Graph 的 cycle 检测 + Flowise Sequential Agents 的 DAG 校验

在 Agent 配置加载时（新 Agent 入群时、YAML Template 加载时）执行：

```
检测项：
1. 直接自引用：Agent.subagents.children 中包含自己的 id → 拒绝（除非 allowSelf: true）
2. 环形引用：对 subagent 声明图做 DFS cycle detection
3. 深度预检：计算最大声明深度，超过 MAX_DECLARED_DEPTH → 警告
4. 广度预检：计算总 subagent 配置数，超过 MAX_DECLARED_CONFIGS → 警告
```

**实现参考**：Langflow `graph/graph/base.py` 的 `build_graph_maps()` + predecessor_map / successor_map / in_degree_map。

#### 第二层：运行时祖先追踪（Path-level）

**来源**：LibreChat `buildSubagentConfigs` 的 `ancestors: Set<string>` + ChatDev Loop Counter 节点

每次 subagent 委派发生时，维护委派路径：

```typescript
// Subagent 委派上下文
interface DelegationContext {
  path: string[];           // 委派链：["user", "CodeAgent", "ReviewAgent"]
  depth: number;            // 当前深度
  startTime: number;        // 委派链起始时间
  maxDepth: number;         // 配置的最大深度（默认 5）
  maxDuration: number;      // 配置的最大时间预算（默认 300s）
  breadcrumb: string;       // 委派原因摘要（用于审计和可视化）
}

// 每次委派前检查
function validateDelegation(context: DelegationContext, targetId: string): void {
  // 检查 1：循环检测
  if (context.path.includes(targetId)) {
    throw new CycleDetectedError(
      `Delegation cycle: ${context.path.join(" -> ")} -> ${targetId}`
    );
  }

  // 检查 2：深度限制
  if (context.depth >= context.maxDepth) {
    throw new MaxDepthExceededError(
      `Subagent depth ${context.depth} exceeds max ${context.maxDepth}`
    );
  }

  // 检查 3：时间预算
  if (Date.now() - context.startTime > context.maxDuration) {
    throw new TimeBudgetExceededError(
      `Delegation chain exceeded time budget of ${context.maxDuration}ms`
    );
  }
}
```

**与 LibreChat 的差异**：
- LibreChat 的 `ancestors` 只在 `buildSubagentConfigs` 时生效（配置时），AgentHub 需要扩展到运行时（每次 @mention 委派）
- 增加时间预算维度（LibreChat 只有深度和总数限制）
- 增加 breadcrumb 审计追踪（LibreChat 无）

#### 第三层：LLM 路由安全网（Supervisor-level）

**来源**：Flowise Supervisor 的 `recursionLimit` + ChatDev Loop Counter 节点

当 Supervisor Agent 做 LLM 路由决策时：

1. **Worker 历史黑名单**：Supervisor 维护本 session 中已调用过的 Worker 列表。如果 LLM 连续 3 次 route 到同一 Worker，强制 FINISH 或升级给人类。
2. **recursionLimit 硬上限**：Supervisor 的 `max_iterations`（参考 Flowise 默认 100，AgentHub 建议更保守的 15-25）。
3. **Loop Counter 节点**（参考 ChatDev）：特定 subgraph 可插入显式 loop_counter 节点，限制特定步骤的迭代次数（如 code-review 循环最多 3 次）。
4. **LLM 提示注入**：在 Supervisor 的 system prompt 中注入已路由历史：
   ```
   You have already routed to: CodeAgent (completed), ReviewAgent (completed).
   Do NOT route to the same worker more than 2 times in this session.
   ```

#### 第四层：全局资源限流（System-level）

**来源**：LibreChat `MAX_SUBAGENT_RUN_CONFIGS` + `MAX_PRIMED_SKILLS_PER_TURN`

跨群聊的全局保护：

| 限制项 | 建议值 | 触发动作 |
|--------|--------|---------|
| `MAX_ACTIVE_SUBAGENTS_PER_GROUP` | 10 | 拒绝新委派，队列等待 |
| `MAX_TOTAL_SUBAGENTS_GLOBAL` | 100 | 拒绝新委派，告警 |
| `MAX_DELEGATION_DEPTH` | 5 | 拒绝新委派，返回深度错误 |
| `MAX_DELEGATION_CHAIN_DURATION` | 300s | 强制终止最深层的 subagent |
| `MAX_FORK_BRANCHES_PER_MESSAGE` | 5 | 拒绝新 Fork |
| `RATE_LIMIT_DELEGATIONS_PER_AGENT` | 20/min | 429 限流 |

### 3.3 循环恢复机制

即使防循环机制生效，被中断的委派链需要优雅恢复：

1. **Graceful Degradation**：subagent 被拒绝委派时，不是静默失败，而是在群聊中发送消息说明原因：
   > "无法委派给 @ReviewAgent：已达到最大委派深度 (5)。建议直接 @ReviewAgent 开始新的审查。"

2. **Partial Result Return**：被终止的 subagent 返回已完成的部分结果，而非空响应。

3. **Human Escalation**：当自动化防循环机制触发时，群聊中 @ 人类管理员，附带委派链 breadcrumb 和终止原因。

4. **Break Glass**：管理员可以通过 `@AgentHub force delegate ...` 绕过深度/循环限制（需要显式确认）。

### 3.4 防循环机制总览

```
                    ┌──────────────────────────┐
                    │  Layer 4: System Limits   │
                    │  - 全局 subagent 数/率限制  │
                    │  - Fork 分支数上限          │
                    │  - 跨群聊资源配额           │
                    ├──────────────────────────┤
                    │  Layer 3: LLM Guardrails  │
                    │  - Worker 历史黑名单       │
                    │  - recursionLimit 硬上限   │
                    │  - Loop Counter 节点       │
                    │  - System prompt 注入      │
                    ├──────────────────────────┤
                    │  Layer 2: Runtime Tracker  │
                    │  - ancestors Set 循环检测  │
                    │  - depth 深度限制           │
                    │  - time budget 时间预算     │
                    │  - breadcrumb 审计追踪      │
                    ├──────────────────────────┤
                    │  Layer 1: Static Analysis  │
                    │  - Subgraph cycle detection│
                    │  - 声明阶段深度/广度检查     │
                    │  - allowSelf 白名单         │
                    └──────────────────────────┘
```

### 3.5 与各参考项目的机制对比

| 机制 | Langflow | Flowise | ChatDev | LibreChat | **AgentHub 建议** |
|------|----------|---------|---------|-----------|-------------------|
| 图级别 cycle 检测 | DAG 拓扑排序检测 | DAG 校验 | GraphTopologyBuilder | 无 | **采用**（Layer 1） |
| 祖先集合追踪 | 无（组件不递归委派） | 无 | 无 | `ancestors: Set` | **采用 + 扩展**（Layer 2） |
| 深度限制 | 无 | `recursionLimit` (100) | Loop Counter 节点 | `MAX_SUBAGENT_DEPTH` | **采用**（Layer 2 + Layer 3） |
| 时间预算 | 无 | 无 | Loop Timer 节点 | 无 | **新增**（Layer 2） |
| Worker 历史去重 | 无 | 无 | 无 | 无 | **新增**（Layer 3） |
| 全局资源限流 | 无 | 无 | 无 | `MAX_SUBAGENT_RUN_CONFIGS` | **采用 + 扩展**（Layer 4） |
| 循环恢复/降级 | 无 | 无 | 无 | 无 | **新增** |
| Breadcrumb 审计 | 无 | 无 | 无 | 无 | **新增** |

---

## 4. 架构差异与 AgentHub 定位

### 4.1 四个项目的架构约束

| 项目 | 核心约束 | 对 AgentHub 的启示 |
|------|---------|-------------------|
| **Langflow** | lfx 不能 import langflow（单向依赖），~13 个已知违规待修复 | AgentHub 从第一天用 Go interface 做依赖注入 |
| **Flowise** | V1/V2 画布共存，三路由碎片化 `/canvas`/`/agentcanvas`/`/v2/agentcanvas` | AgentHub 用单一 Conversation View，flow type 参数区分模式 |
| **ChatDev** | 同步 loop 执行模型，不是事件驱动 | AgentHub 必须用异步事件驱动，Agent 可随时发言 |
| **LibreChat** | Recoil 状态管理（已停维护），CJS/ESM 双模块历史包袱 | AgentHub 用 Zustand/Jotai，全 ESM |

### 4.2 AgentHub 的差异化定位

```
Langflow/Flowise  ─── 画布优先 ─── 适合 "先设计拓扑再运行"
ChatDev            ─── YAML 优先 ─── 适合 "版本化 + 批量执行"
LibreChat          ─── 对话优先 ─── 适合 "单人 + 单 Agent 聊天"
                                    
AgentHub           ─── 群聊优先 ─── 适合 "多人 + 多 Agent 持续协作"
                    拓扑从聊天中涌现，事后可查看和模板化
```

### 4.3 直接复用的设计模式

| 来源 | 模式 | 在 AgentHub 中的落点 |
|------|------|---------------------|
| Langflow | `tool_mode=True` 三级能力提升链 | Agent Capability 的输出自动暴露为 MCP tool |
| Langflow | Component -> StructuredTool 自动转化 | Agent output 自动转为群聊中其他 Agent 可调用的工具 |
| Flowise | DDD 四层架构 (atoms/features/core/infra) | AgentHub 前端 Canvas 组件的分层参考 |
| Flowise | AI 自动生成 Flow (分阶段 + Zod Schema) | "描述需求自动创建 Agent 群聊" 功能 |
| ChatDev | YAML + FIELD_SPECS 动态表单 | Agent Config 和 Workflow Template 的 schema 驱动 |
| ChatDev | Subgraph 嵌套复用 | 群聊中的 threaded reply = subgraph |
| ChatDev | Edge 条件路由 + Payload Processor | Agent 间消息路由的核心机制 |
| LibreChat | 消息树 + Fork + SiblingSwitch | AgentHub Conversation Authority 的分支模型 |
| LibreChat | Subagent ancestors Set 循环检测 | 运行时委派防循环的核心实现 |
| LibreChat | Summarization reserveRatio + EMA 校准 | Hub 端 context compaction |
| LibreChat | MCPManager singleton + Registry | AgentHub 的 MCP 集成层 |

---

## 5. 实施优先级建议

### P0：必须在 MVP 中实现

1. **消息树数据模型**：`{message, children[], parent}` 结构，支持 branching
2. **@mention 直接委派**：策略 A 的完整实现，含 Agent 响应在群聊中可见
3. **祖先集合循环检测**（Layer 2）：`ancestors: Set<string>` + depth 限制
4. **Agent Capability Registry**：Agent 入群注册能力，供 Supervisor 路由查询
5. **全局资源限流**（Layer 4）：至少 `MAX_ACTIVE_SUBAGENTS_PER_GROUP` + `MAX_DELEGATION_DEPTH`

### P1：第一版迭代加入

1. **Supervisor 自动路由**（策略 B）：Coordinator Agent + Worker 历史黑名单
2. **Fork 并行探索**（策略 D）：LibreChat 风格的四种 Fork 模式 + SiblingSwitch
3. **YAML Template 导出/导入**（策略 C）：从群聊拓扑导出 + 从 YAML 快速创建群聊
4. **LLM 路由安全网**（Layer 3）：Worker 历史去重 + recursionLimit
5. **Graph-level 静态检测**（Layer 1）：Subgraph cycle detection
6. **Human-in-the-Loop 中断审批**（参考 Flowise Sequential Agent）

### P2：后续迭代

1. **拓扑可视化视图**（Layer 3）：从消息树自动提取拓扑 + 拖拽编辑
2. **AI 自动生成 Agent 群聊**（参考 Flowise agentflowv2Generator）：自然语言 -> 选择 Agent -> 配置关系
3. **Subgraph/Threaded reply 嵌套**：群聊中的 threaded discussion = subgraph 执行上下文
4. **时间预算** + **Graceful Degradation** + **Human Escalation**
5. **Portable Workflow Template 市场**：YAML Template 的分享/导入/版本化
