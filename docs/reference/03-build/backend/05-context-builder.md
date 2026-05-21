# AgentHub Context Builder -- Final Design

> 基于 7 仓库深度对比（Kanna / LibreChat / Claude Code Viewer / OpenCode / ChatDev / design-eventstore-memory / design-protocol），为 AgentHub 的上下文引擎提供最终设计。
> 前置阅读：kanna.md, librechat.md, claude-code-viewer.md, opencode.md, design-eventstore-memory.md, chatdev.md, design-protocol.md

---

## 1. 上下文组装管道对比

### 1.1 Kanna -- Transcript 回放 + CLI 注入

```
输入: 用户 Prompt (ChatInput)
  │
  ├─ socket.command({type:"chat.send"})
  ├─ WSRouter.handleCommand → agent.send()
  ├─ EventStore.enqueueMessage (JSONL append)
  └─ AgentCoordinator.startTurnForChat
       │
       ├─ [必要时] 创建 Chat → 写 user_prompt entry
       ├─ [Fork 时] 复制 source transcript JSONL 到新 chat
       ├─ [Resume 时] 复用 chat.sessionToken
       │
       ├─ startClaudeSession / codexManager.startTurn
       │    ├─ sessionToken: chat.sessionToken ?? chat.pendingForkSessionToken
       │    ├─ forkSession: Boolean(chat.pendingForkSessionToken)
       │    └─ systemPrompt, model, thinking, permissionMode (CLI 参数一次性注入)
       │
       ├─ for await (event of stream)
       │    └─ normalizeClaudeStreamMessage(event) → TranscriptEntry
       │         ├─ system/init → system_init (model, tools, agents, mcpServers)
       │         ├─ assistant → assistant_text + tool_call
       │         ├─ user → tool_result + compact_summary
       │         ├─ result → result (duration, cost, error)
       │         └─ system/status → status
       │
       └─ EventStore.appendMessage(entry) → onStateChange → scheduleBroadcast(16ms)
            → deriveChatSnapshot → WebSocket push 到所有订阅客户端

关键特征:
- System Prompt 在 CLI 启动时一次性注入，不是每次 LLM 调用前注入
- Transcript JSONL 是唯一事实源，Fork 时完整复制
- Context 压缩由 Claude SDK 自身处理（compaction event）
- 不介入消息内容的转换/裁剪 — 完全透传给 SDK
```

### 1.2 LibreChat -- Summarization + Subagent Isolation

```
输入: messages[], summarizationConfig, initialSummary, agents[]
  │
  ├─ createRun({ agents, signal, messages, summarizationConfig, initialSummary })
  │
  ├─ [1] extractDiscoveredToolsFromHistory(messages)
  │
  ├─ [2] buildAgentInput = (agent, {isSubagent}) =>
  │    ├─ shapeSummarizationConfig()
  │    │    ├─ 解析 summarization.provider (可能是 custom endpoint)
  │    │    ├─ getOpenAIConfig → LLM client options
  │    │    └─ 返回 { enabled, config, reserveRatio, contextPruning }
  │    │
  │    ├─ computeEffectiveMaxContextTokens(reserveRatio, baseContextTokens, maxContextTokens)
  │    │    effectiveMax = maxContextTokens * (1.0 - reserveRatio)
  │    │
  │    ├─ normalizeAgentModelParameters()
  │    ├─ 构建 systemContent / additionalInstructions
  │    │
  │    ├─ [Subagent隔离] Clone toolRegistry Map + clone toolDefinitions
  │    │    ├─ Map clone: for [name, tool] of agent.toolRegistry → new Map
  │    │    └─ 浅拷贝每个 LCTool 对象（隔离 defer_loading flag）
  │    │
  │    └─ 构造 RunConfig {
  │         maxContextTokens: effectiveMaxContextTokens,
  │         summarizationEnabled, summarizationConfig,
  │         contextPruningConfig,
  │         initialSummary: isSubagent ? undefined : initialSummary,  // ← 子代理不继承父级摘要
  │         calibrationRatio,  // ← 前次运行的 contextMeta，初始化 pruner EMA
  │       }
  │
  ├─ [3] buildSubagentConfigs(agent, ...) → 递归展开子代理图
  │    ├─ Self-spawn: type: SELF_SUBAGENT_TYPE
  │    ├─ 循环检测: ancestors Set
  │    ├─ 深度断言: assertSubagentDepth(depth, MAX_SUBAGENT_DEPTH)
  │    └─ 递归: buildSubagentConfigs(child, ..., nextAncestors, childDepth)
  │
  └─ [4] 组装 graphConfig + runId → 交给 SDK 执行

关键特征:
- reserveRatio (0.05) 控制 token 预算预留
- EMA calibration: 从上一次运行的 contextMeta 透传 calibrationRatio
- Subagent 隔离: initialSummary 设为 undefined + toolRegistry 深度克隆
- Context pruning 由 SDK 在运行时自动触发（超出 maxContextTokens 时）
```

### 1.3 Claude Code Viewer -- JSONL 增量读取 + lastN

```
输入: ~/.claude/projects/{project}/*.jsonl
  │
  ├─ [1] SessionRepository.getSession(sessionId)
  │    ├─ 验证 sessionId 安全字符
  │    ├─ 验证 projectPath 在 claudeProjectsDirPath 内（路径遍历防护）
  │    └─ fs.readFileString → split("\n") → parseJsonl()
  │
  ├─ [2] parseJsonl(lines)
  │    ├─ 逐行 JSON.parse
  │    ├─ ConversationSchema.safeParse (Zod union, 15 entry types)
  │    ├─ 校验失败 → { type: "x-error", line, lineNumber }  ← 不抛异常，不阻塞
  │    └─ 返回 parsed entries 数组
  │
  ├─ [3] SessionMetaService.getSessionMeta()
  │    ├─ title: 从第一个有效用户消息提取
  │    ├─ tokenUsage: 聚合所有 assistant message 的 usage 字段
  │    └─ cost: 基于 model pricing 硬编码表计算
  │
  ├─ [4] FTS5 索引 (SQLite)
  │    ├─ session_messages_fts USING fts5(content, tokenize='porter unicode61')
  │    ├─ BM25 排序，用户消息权重 1.2x
  │    └─ snippet() 高亮
  │
  ├─ [5] 前端渲染
  │    ├─ shouldRenderConversation() 过滤元数据入口
  │    ├─ buildRenderableConversationRows() 构建渲染行
  │    └─ 按类型分发到 visualizer 组件（Markdown/Thinking/Tool/Sidechain）
  │
  └─ [6] 实时更新
       ├─ FileWatcher 监听 JSONL 变更 → EventBus → SSE → TanStack Query invalidateQueries
       └─ Agent Session 支持: agent-*.jsonl → useSidechain() hook

关键特征:
- 只读模式，不做任何上下文注入或修改
- lastN 分页限制消息数量
- Zod safeParse 容错：单行解析失败不影响整体
- JSONL 是唯一事实源，FTS5 仅存索引加速搜索
```

### 1.4 OpenCode -- Plugin Hook 双向修改

```
输入: Plugin Hooks (19 lifecycle hooks)
  │
  ├─ [启动时] Plugin 加载
  │    ├─ 内置插件 import + 调用
  │    ├─ 外部插件 PluginLoader.loadExternal() 并行加载
  │    ├─ resolve → 兼容性检查 → dynamic import → 执行 plugin function
  │    └─ config(cfg) 配置通知
  │
  ├─ [每次 LLM 调用前] 关键注入 hooks:
  │    │
  │    ├─ chat.params (input={sessionID, agent, model, provider}, output={temperature, topP, topK, maxOutputTokens, options})
  │    │    └─ Hook 修改 output 对象 → 影响当次 LLM 调用参数
  │    │
  │    ├─ chat.headers (input={sessionID, agent, model, provider}, output={headers})
  │    │    └─ Hook 追加 HTTP 头 → 影响当次 HTTP 请求
  │    │
  │    ├─ experimental.chat.system.transform (input={sessionID, model}, output={system: string[]})
  │    │    └─ Hook 追加/修改 system prompt 字符串数组
  │    │
  │    └─ experimental.chat.messages.transform (input={}, output={messages[]})
  │         └─ Hook 转换消息数组（注入/重排/过滤）
  │
  ├─ [会话压缩时]
  │    ├─ experimental.session.compacting (input={sessionID}, output={context, prompt})
  │    │    └─ Hook 注入额外上下文 或 替换压缩提示词
  │    │
  │    └─ experimental.compaction.autocontinue (input={sessionID, agent, model, overflow}, output={enabled})
  │         └─ Hook 控制压缩后是否自动继续
  │
  └─ [Tool 执行]
       ├─ tool.execute.before → 修改 args
       ├─ tool.execute.after → 修改 title/output/metadata
       └─ tool.definition → 修改 description/parameters

关键特征:
- (input, output) => Promise<void> 双向修改模式 — input 只读，output 可变更
- 每次 LLM 调用前触发，而非仅启动时注入
- System prompt 是数组形式，多个 plugin 可追加
- 同一生命周期有多个 hook，按注册顺序执行
```

### 1.5 ChatDev -- Stage-level Retrieval + Write-back

```
输入: YAML workflow + project files + memory stores
  │
  ├─ [1] Graph 构建
  │    ├─ DesignConfig (YAML) → Node 实例 + Edge 拓扑
  │    ├─ GraphTopologyBuilder 检测环 → DAG/Cycle-aware
  │    └─ MemoryFactory.create_memory(store) → 加载已有数据
  │
  ├─ [2] Agent 节点执行
  │    ├─ MemoryManager 关联 node 的 memories[] 到全局 store
  │    │
  │    ├─ [Pre-Gen Retrieval] thinking 阶段前检索
  │    │    └─ MemoryManager.retrieve(agent_role, query, "pre")
  │    │         → MemoryContentSnapshot → MemoryRetrievalResult
  │    │
  │    ├─ [Gen Stage Retrieval] 生成前检索，注入 conversation
  │    │    └─ 结果注入: messages 模式 → 插入 USER message
  │    │                  prompt 模式 → 合并到最后一个 USER 消息
  │    │
  │    ├─ [Post-Gen Retrieval] 生成后再次检索（reflection）
  │    │    └─ 二次检索，提供补充上下文
  │    │
  │    └─ [Update] 节点执行完成后
  │         └─ 将 (input, output) 写入 memory → .write() 或 blackboard append
  │
  └─ [3] 消息传递
       ├─ 边级 condition (keyword 匹配路由)
       ├─ 边级 process (regex_extract 提取结构化数据)
       └─ 边级 dynamic (Map 分叉 / Tree 归并)

关键特征:
- 三个阶段检索: Pre-Gen / Gen / Post-Gen
- stage-level retrieval: 不同阶段检索不同记忆
- write-back: 执行后将 (input, output) 持久化到 memory
- Blackboard: JSON append-only，多 Agent 共享上下文
```

### 1.6 对比总结

| 维度 | Kanna | LibreChat | CC Viewer | OpenCode | ChatDev |
|------|-------|-----------|-----------|----------|---------|
| **组装时机** | CLI 启动时一次性 | Run 启动时组装 RunConfig | 只读，不组装 | 每次 LLM 调用前 | 图执行前 + 节点执行时 |
| **System Prompt 注入** | CLI 参数 | systemContent 字段组装 | 无（只读） | `chat.system.transform` hook | `role` 字段 + phase prompt |
| **消息裁剪** | SDK 自主 compaction | reserveRatio + EMA pruning | lastN 分页 | `session.compacting` hook | context_window 限制 |
| **Memory 注入** | 无（SDK 自主管理） | initialSummary + indexTokenCountMap | FTS5 搜索（UI 层） | `chat.system.transform` hook | Pre/Gen/Post 三阶段检索 |
| **Subagent 隔离** | forkSession 原生支持 | initialSummary=undefined + toolRegistry clone | 无 | 无独立机制 | Subgraph 嵌套 + 隔离配置 |
| **容错性** | JSONL append-only | N/A (MongoDB) | Zod safeParse 不抛异常 | Effect error channel | Python exception |
| **适用场景** | 单 Agent CLIs | 多 Agent 图执行 | 会话回放 UI | 通用 Plugin 系统 | 多 Agent 工作流 |

---

## 2. 上下文压缩策略对比

### 2.1 策略总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        上下文压缩策略全景                                  │
├──────────────┬─────────────────────┬──────────────┬──────────────────────┤
│ 策略          │ 来源                │ 适用阶段      │ 核心机制              │
├──────────────┼─────────────────────┼──────────────┼──────────────────────┤
│ reserveRatio  │ LibreChat           │ 上下文组装    │ 预留比例控制 token 预算 │
│ EMA校准      │ LibreChat           │ 运行时调整    │ 上次运行的 contextMeta   │
│ JSONL lastN  │ CC Viewer           │ 读取时限制    │ 只取最后 N 条消息       │
│ Compaction   │ Kanna / LibreChat   │ 运行时触发    │ SDK 自动摘要压缩        │
│ Stage Retrieval│ ChatDev           │ 多阶段注入    │ 不同阶段检索不同内容    │
│ Fork Copy    │ Kanna               │ 分支时复制    │ 完整 transcript JSONL   │
│ FTS5检索     │ CC Viewer / AgentHub│ 搜索加速      │ BM25 + porter tokenizer │
│ Content Pool │ AgentHub (Opcode)   │ 文件快照      │ SHA-256 + zstd 去重压缩 │
└──────────────┴─────────────────────┴──────────────┴──────────────────────┘
```

### 2.2 LibreChat reserveRatio + EMA 详解

```
effectiveMaxContextTokens = maxContextTokens × (1.0 - reserveRatio)

reserveRatio = 0.05  (默认预留 5% token 给新生成的输出)

EMA校准:
  calibrationRatio = 上次运行的 contextMeta.calibrationRatio
  用途: 初始化 pruner 的指数移动平均，使 token 估计更准确

contextPruning 触发条件:
  tokenCounter 实时跟踪 → 超出 effectiveMaxContextTokens → 自动触发 summarization/pruning

子代理:
  isSubagent ? undefined : initialSummary  (子代理不继承父级摘要)
```

### 2.3 Claude Code Viewer JSONL lastN

```
lastN 分页:
  - 前端请求: getMessages(sessionId, { limit: 50, offset: 0 })
  - 后端: 从 JSONL 读取全部 → 按行解析 → 取 lastN
  - 不修改原始数据，只是视图层限制

搜索:
  - FTS5: session_messages_fts USING fts5(content, tokenize='porter unicode61')
  - BM25 排序: 用户消息权重 1.2x
  - 搜索结果直接导航到具体消息位置

不主动压缩:
  - 所有消息完整保留在 JSONL
  - FTS5 仅存索引，不替代 JSONL
  - 前端 progressive disclosure 控制显示密度
```

### 2.4 ChatDev stage-level retrieval

```
三个阶段:

  Pre-Gen Retrieval (thinking 阶段前)
    ├─ 用途: 提供规划/思考所需的背景知识
    ├─ 查询: agent_role + current_task
    └─ 结果: 注入到 agent 的思考上下文

  Gen Stage Retrieval (生成前)
    ├─ 用途: 提供代码生成/回答问题所需的具体信息
    ├─ 查询: 当前对话 + 任务描述
    ├─ 结果注入 messages 模式: 插入 USER message
    └─ 结果注入 prompt 模式: 合并到最后一个 USER 消息

  Post-Gen Retrieval (生成后, reflection)
    ├─ 用途: 验证生成结果的正确性/完整性
    ├─ 查询: 生成结果 + 任务要求
    └─ 结果: 提供补充或修正信息

write-back:
  执行完成后将 (input, output) 写入 memory:
  - simple → 覆盖 JSON
  - blackboard → JSON append-only
  - mem0 → API 调用
  - file → FAISS 索引更新
```

### 2.5 Kanna Fork + Compaction

```
Fork (会话分叉):
  1. 创建新 Chat
  2. 复制 source transcript JSONL 到新 chat 的 transcripts/<chatId>.jsonl
  3. 设 pendingForkSessionToken = sourceChat.sessionToken
  4. 下一个 turn 时传 forkSession: true 给 SDK
  5. SDK 原生 forkSession → 创建分支 session

Compaction (由 SDK 触发):
  - Claude Agent SDK 内部触发 compaction
  - 事件: compact_summary entry → normalized to TranscriptEntry
  - 不干预 SDK 的 compaction 逻辑

Snapshot Compaction (EventStore 层):
  - 5 个 JSONL 文件总大小 >= 2MB 时触发
  - createSnapshot() → Bun.write(snapshot.json) → 清空 JSONL
  - 启动恢复: loadSnapshot() → replayLogs() → shouldCompact()
```

---

## 3. System Prompt 注入机制对比

### 3.1 机制对比矩阵

```
┌─────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
│                     │  OpenCode             │  Kanna                │  Claude Code           │
├─────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤
│ 注入时机            │ 每次 LLM 调用前       │ CLI 启动时一次性      │ Session 启动时自动加载 │
│ 注入方式            │ Plugin Hook 双向修改  │ CLI 参数传递          │ 文件系统扫描 + 注入    │
│ 可修改性            │ 高度可编程            │ 启动后不可变          │ 启动后不可变           │
│ 多源合并            │ 数组追加              │ 单一 systemPrompt     │ 层级叠加               │
│ 动态上下文          │ chat.params + headers │ 无                    │ Memory + Skills        │
│ AgentHub 适用度     │ ⭐⭐⭐ (最灵活)       │ ⭐⭐ (简单可靠)      │ ⭐⭐⭐ (文件系统友好)  │
└─────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘
```

### 3.2 OpenCode Plugin Hook 机制

```
chat.params hook (L246-255):
  签名: (input: { sessionID, agent, model, provider, message },
         output: { temperature, topP, topK, maxOutputTokens, options }) => Promise<void>
  特点: 每次 LLM 调用前触发，可以基于 session 状态动态调整参数
  应用: 根据用户偏好/agent 类型/历史行为调整 temperature 和 token 预算

chat.headers hook (L256-259):
  签名: (input: { sessionID, agent, model, provider, message },
         output: { headers: Record<string, string> }) => Promise<void>
  特点: 每次 HTTP 请求前注入自定义 header
  应用: 动态 API key 切换、租户隔离、rate limit 标记

experimental.chat.system.transform (L290-295):
  签名: (input: { sessionID, model }, output: { system: string[] }) => Promise<void>
  特点: System prompt 是字符串数组，多个插件可追加
  应用: 注入项目规则、安全策略、用户偏好、Memory

experimental.chat.messages.transform (L281-289):
  签名: (input: {}, output: { messages: array }) => Promise<void>
  特点: 在消息发送前转换整个消息数组
  应用: 注入历史摘要、插入检索到的 Memory 上下文

experimental.session.compacting (L303-306):
  签名: (input: { sessionID }, output: { context, prompt }) => Promise<void>
  特点: 会话压缩前注入额外上下文或替换压缩提示词
  应用: 在压缩时插入不可丢弃的关键信息
```

### 3.3 Kanna AgentCoordinator 注入

```
CLI 启动时一次性注入 (agent.ts):
  startClaudeSession({
    systemPrompt,          // 完整 system prompt 字符串
    sessionToken,          // 复用已有 session
    forkSession,           // 是否 fork
    model,                 // 模型名
    thinking: { type, budget },
    permissionMode,        // "default" | "bypassPermissions" | "plan" | "acceptEdits"
    maxTurns,
    maxBudgetUSD,
    allowedTools / deniedTools,
    workingDir,
    includeThinking,
    includePartialEvents,
    mcpServers,
    commands,
    agents,                // sub-agent definitions
  })

特点:
  - 所有参数在 CLI 启动时一次性传递
  - 启动后无法动态修改 system prompt
  - SDK 自身处理 compaction/reasoning
  - 简单可靠，但缺乏运行时动态注入能力
```

### 3.4 Claude Code 文件系统级注入

```
层级（从底到顶）:
  Layer 1: settings.json          → 全局配置（权限、模型、tools）
  Layer 2: CLAUDE.md (global)     → ~/.claude/CLAUDE.md 个人指令
  Layer 3: AGENTS.md (project)    → {project}/AGENTS.md 项目指令
  Layer 4: CLAUDE.md (project)    → {project}/CLAUDE.md 项目特定覆盖
  Layer 5: Skills                 → ~/.claude/skills/ → SKILL.md
  Layer 6: Memory                 → CODEBUDDY.md / memory files

特点:
  - 文件系统层级叠加，下层被上层覆盖
  - Session 启动时自动扫描并加载
  - 无运行时动态修改能力
  - 人可直接编辑 .md 文件，git 可 diff/merge
```

### 3.5 AgentHub 应采用：组合模式

```
AgentHub = OpenCode Plugin Hook 动态注入
         + Claude Code 文件系统层级
         + LibreChat reserveRatio token 预算

三层注入架构:

  Layer 1: Static (文件系统)
    ~/.agenthub/memory/preferences/*.md    → Global Memory
    {project}/.agenthub/AGENTS.md          → Project Memory
    {project}/.agenthub/agents/{name}/CLAUDE.md → Agent Memory
    加载时机: ContextSpec.Build() 时读取文件系统
    特点: 人类可编辑，git 可 diff，层级叠加

  Layer 2: Dynamic (Hook)
    chat.params hook    → 每次 LLM 调用前调整参数
    chat.headers hook   → 每次 HTTP 请求前注入 headers
    chat.system hook    → 每次调用前追加 system prompt 片段
    加载时机: 每次 LLM 调用前（借鉴 OpenCode）
    特点: 基于运行时状态动态决策

  Layer 3: Compaction (Token Budget)
    reserveRatio        → 默认 0.05
    EMA calibration     → 从上次运行校准
    maxTokens           → 用户配置上限
    加载时机: ContextSpec.Build() 时计算
    特点: 自动裁剪 + 摘要压缩
```

---

## 4. AgentHub Context Builder 最终设计

### 4.1 核心数据结构

```go
// packages/context-engine/types.go

package contextengine

import (
    "time"
)

// ============================================================================
// ContextSpec -- 上下文构建请求
// 来源: design-eventstore-memory.md Section 4.2
// 增强: LibreChat reserveRatio + OpenCode hook 注入点 + ChatDev stage 标记
// ============================================================================

// ContextSpec 定义需要构建上下文的参数。
// 这是 ContextBuilder.Build() 的唯一输入。
type ContextSpec struct {
    // --- 身份标识 ---
    ThreadID    string `json:"threadId"`    // 当前 Thread
    ProjectPath string `json:"projectPath"` // 项目根路径（读取 .agenthub/）
    AgentName   string `json:"agentName"`   // Agent 名称（读取 Agent Memory）

    // --- Token 预算 ---
    MaxTokens      int     `json:"maxTokens"`      // 最大 token 预算
    ReserveRatio   float64 `json:"reserveRatio"`   // 预留比例（默认 0.05）
    // 参考 LibreChat: effectiveMaxContextTokens = maxTokens × (1.0 - reserveRatio)

    // --- 压缩策略 ---
    CompactionMode CompactionMode `json:"compactionMode"`
    // 参考 LibreChat: summarizationConfig + contextPruningConfig
    KeepRecent     int  `json:"keepRecent"`     // 保留最近 N 条完整消息
    SummarizeOlder bool `json:"summarizeOlder"` // 是否压缩早期消息

    // --- Memory 包含策略 ---
    IncludeMemories []MemoryLayer `json:"includeMemories"`
    // ["global", "project", "agent", "conversation"]
    MemoryTopK int    `json:"memoryTopK"` // FTS5 检索 top_k (默认 5)
    MemoryQuery string `json:"memoryQuery"` // 检索查询（通常为当前 prompt）

    // --- 注入策略 ---
    SystemPromptAppend []string `json:"systemPromptAppend,omitempty"`
    // 动态追加的 system prompt 片段（来自 Plugin Hook）
    // 参考 OpenCode: experimental.chat.system.transform

    OverrideParams *ParamOverrides `json:"overrideParams,omitempty"`
    // 动态覆盖的 LLM 参数（来自 Plugin Hook）
    // 参考 OpenCode: chat.params

    CustomHeaders map[string]string `json:"customHeaders,omitempty"`
    // 动态 HTTP 头（来自 Plugin Hook）
    // 参考 OpenCode: chat.headers

    // --- Stage 控制 ---
    Stage BuildStage `json:"stage"`
    // 构建阶段标记
    // 参考 ChatDev: Pre-Gen / Gen / Post-Gen
    // "pre_gen"   → 只加载 Global + Project Memory (不加载 conversation 历史)
    // "gen"       → 全量加载（默认）
    // "post_gen"  → 加载 conversation 历史 + Memory (用于 reflection)
    // "compact"   → 只加载摘要版本的 conversation 历史

    // --- 来源追踪 ---
    CalibrationRatio float64 `json:"calibrationRatio,omitempty"`
    // 上次运行的 EMA 校准
    // 参考 LibreChat: contextMeta.calibrationRatio → seed pruner EMA

    SourceTurnID string `json:"sourceTurnId,omitempty"`
    // Fork 来源 Turn ID
    // 参考 Kanna: forkSession + pendingForkSessionToken
}

// CompactionMode 定义历史消息压缩模式。
type CompactionMode string

const (
    CompactionNone      CompactionMode = "none"      // 不压缩，超出则截断
    CompactionSummarize CompactionMode = "summarize"  // 旧消息生成摘要替代原文
    CompactionPrune     CompactionMode = "prune"      // 删除最旧消息
    CompactionAuto      CompactionMode = "auto"       // 由 SDK 自主管理（透传模式）
)

// MemoryLayer 标识 Memory 层级。
type MemoryLayer string

const (
    MemoryLayerGlobal       MemoryLayer = "global"       // ~/.agenthub/memory/
    MemoryLayerProject      MemoryLayer = "project"      // {project}/.agenthub/
    MemoryLayerAgent        MemoryLayer = "agent"        // {project}/.agenthub/agents/{name}/
    MemoryLayerConversation MemoryLayer = "conversation" // SQLite FTS5 索引
)

// BuildStage 标记上下文构建的阶段。
type BuildStage string

const (
    BuildStagePreGen  BuildStage = "pre_gen"  // 规划前
    BuildStageGen     BuildStage = "gen"      // 生成前（默认）
    BuildStagePostGen BuildStage = "post_gen" // 生成后（reflection）
    BuildStageCompact BuildStage = "compact"  // 压缩时
)

// ParamOverrides 动态覆盖 LLM 参数。
// 参考 OpenCode: chat.params hook output
type ParamOverrides struct {
    Temperature     *float64 `json:"temperature,omitempty"`
    TopP            *float64 `json:"topP,omitempty"`
    TopK            *int     `json:"topK,omitempty"`
    MaxOutputTokens *int     `json:"maxOutputTokens,omitempty"`
    StopSequences   []string `json:"stopSequences,omitempty"`
    Extra           map[string]any `json:"extra,omitempty"`
}

// ============================================================================
// AssembledContext -- 上下文构建输出
// 来源: design-eventstore-memory.md Section 4.2
// 增强: OpenCode 分离 system/messages/params/headers + ChatDev stage 元数据
// ============================================================================

// AssembledContext 是构建完成的上下文。
// 这是 ContextBuilder.Build() 的唯一输出。
type AssembledContext struct {
    // System Prompt（组装后的完整 system prompt）
    SystemPrompt *SystemPrompt `json:"systemPrompt"`

    // Messages（历史消息，可能被 compacted）
    Messages []ContextMessage `json:"messages"`

    // Memory（检索到的 Memory 条目）
    MemoryEntries []ContextMemoryEntry `json:"memoryEntries"`

    // LLM 参数
    Params *ResolvedParams `json:"params"`

    // HTTP 头
    Headers map[string]string `json:"headers,omitempty"`

    // Token 统计
    TokenUsage *TokenUsage `json:"tokenUsage"`

    // 元数据
    Meta *BuildMeta `json:"meta"`
}

// SystemPrompt 结构化的 system prompt。
// 参考 OpenCode: system 是字符串数组，多个来源可独立追踪
type SystemPrompt struct {
    // 完整组装后的 system prompt 文本
    FullText string `json:"fullText"`

    // 分来源的片段（便于调试/追踪）
    Segments []PromptSegment `json:"segments"`
}

// PromptSegment 是 system prompt 的一个来源片段。
type PromptSegment struct {
    Source PromptSource `json:"source"`  // 来源层级
    Title  string       `json:"title"`   // 片段标题（如 "AGENTS.md"）
    Content string      `json:"content"` // 片段文本
    Priority int        `json:"priority"` // 排序优先级（越小越靠前）
    FilePath string     `json:"filePath,omitempty"` // 来源文件路径
}

// PromptSource 标识 system prompt 来源。
type PromptSource string

const (
    PromptSourceGlobal       PromptSource = "global"       // Global Memory .md 文件
    PromptSourceProject      PromptSource = "project"      // 项目 AGENTS.md
    PromptSourceAgent        PromptSource = "agent"        // Agent CLAUDE.md
    PromptSourceMemory       PromptSource = "memory"       // FTS5 检索到的 Memory
    PromptSourceConversation PromptSource = "conversation" // 会话摘要
    PromptSourcePlugin       PromptSource = "plugin"       // Plugin Hook 注入
    PromptSourceSystem       PromptSource = "system"       // AgentHub 系统级
    PromptSourceUserOverride PromptSource = "user_override" // 用户手动覆盖
)

// ContextMessage 是上下文中的一条消息。
// 参考 design-protocol.md Message 类型
type ContextMessage struct {
    Role       string    `json:"role"`       // "user" | "assistant" | "system" | "tool"
    Content    string    `json:"content"`
    Name       string    `json:"name,omitempty"`        // agent name / user name
    ToolCallID string    `json:"toolCallId,omitempty"`  // tool result 关联
    IsSummary  bool      `json:"isSummary"`             // 是否为摘要替代原文
    OriginalSeq int     `json:"originalSeq,omitempty"`  // 原始消息序号
    TurnID     string    `json:"turnId,omitempty"`
    Timestamp  time.Time `json:"timestamp,omitempty"`
}

// ContextMemoryEntry 是检索到的 Memory 条目。
type ContextMemoryEntry struct {
    ID         string      `json:"id"`
    Scope      MemoryLayer `json:"scope"`
    Category   string      `json:"category"`   // preference / convention / checklist / fact / decision
    Key        string      `json:"key"`
    Content    string      `json:"content"`
    Score      float64     `json:"score"`      // FTS5 BM25 分数
    Snippet    string      `json:"snippet"`    // FTS5 snippet() 高亮片段
    SourceFile string      `json:"sourceFile"` // 来源 .md 文件路径
}

// ResolvedParams 解析后的 LLM 调用参数。
// 参考 OpenCode: chat.params hook output
type ResolvedParams struct {
    Temperature     float64           `json:"temperature"`
    TopP            float64           `json:"topP"`
    TopK            int               `json:"topK"`
    MaxOutputTokens int               `json:"maxOutputTokens"`
    MaxContextTokens int              `json:"maxContextTokens"` // 有效最大上下文 token 数
    StopSequences   []string          `json:"stopSequences,omitempty"`
    Extra           map[string]any    `json:"extra,omitempty"`
}

// TokenUsage 追踪 token 使用情况。
type TokenUsage struct {
    SystemPromptTokens int `json:"systemPromptTokens"` // system prompt token 数
    MessagesTokens     int `json:"messagesTokens"`     // 历史消息 token 数
    MemoryTokens       int `json:"memoryTokens"`       // Memory 条目 token 数
    TotalTokens        int `json:"totalTokens"`        // 总 token 数
    AllocatedBudget    int `json:"allocatedBudget"`    // 分配的 token 预算
    ReserveBudget      int `json:"reserveBudget"`      // 预留的 token 预算
    TruncatedMessages  int `json:"truncatedMessages"`  // 被截断的消息数
    TruncatedFrom      int `json:"truncatedFrom"`      // 截断起始索引
}

// BuildMeta 构建元数据。
type BuildMeta struct {
    Stage          BuildStage `json:"stage"`
    BuiltAt        time.Time  `json:"builtAt"`
    DurationMs     int64      `json:"durationMs"`
    MemoryHitCount int        `json:"memoryHitCount"`  // FTS5 命中数
    FilesRead      int        `json:"filesRead"`       // 读取的 .md 文件数
    Errors         []string   `json:"errors,omitempty"` // 非致命错误
}
```

### 4.2 ContextBuilder 接口

```go
// packages/context-engine/builder.go

package contextengine

import "context"

// ============================================================================
// ContextBuilder -- 上下文组装核心接口
// ============================================================================

// ContextBuilder 负责从多个来源组装完整的 LLM 调用上下文。
//
// 管道: Fetch → Filter → Summarize → Tokenize → Assemble
//
// 来源:
//   1. Global Memory (~/.agenthub/memory/ 下的 .md 文件)
//   2. Project Memory ({project}/.agenthub/ 下的 AGENTS.md + memory/*.md)
//   3. Agent Memory ({project}/.agenthub/agents/{name}/ 下的 CLAUDE.md)
//   4. Conversation Memory (SQLite FTS5 全文检索)
//   5. Conversation History (JSONL events 重放)
//   6. Plugin Hooks (动态 injected 的 system prompt / params / headers)
//
// 参考:
//   - Kanna: transcript JSONL 重放 + fork 复制
//   - LibreChat: reserveRatio + summarizationConfig + contextPruningConfig
//   - Claude Code Viewer: FTS5 BM25 搜索 + lastN 限制
//   - OpenCode: chat.params/chat.headers/chat.system.transform hooks
//   - ChatDev: Pre-Gen / Gen / Post-Gen stage-level retrieval
//   - design-eventstore-memory.md: 4 层 Memory 模型
type ContextBuilder interface {
    // Build 执行完整的上下文组装管道。
    Build(ctx context.Context, spec ContextSpec) (*AssembledContext, error)
}

// ============================================================================
// 管道步骤接口（可独立替换）
// ============================================================================

// MemoryFetcher 负责从各层 Memory 读取原文。
type MemoryFetcher interface {
    // FetchGlobalMemory 读取 ~/.agenthub/memory/ 下的所有 .md 文件。
    FetchGlobalMemory(ctx context.Context) ([]PromptSegment, error)

    // FetchProjectMemory 读取 {project}/.agenthub/ 下的文件。
    FetchProjectMemory(ctx context.Context, projectPath string) ([]PromptSegment, error)

    // FetchAgentMemory 读取 {project}/.agenthub/agents/{name}/ 下的文件。
    FetchAgentMemory(ctx context.Context, projectPath, agentName string) ([]PromptSegment, error)
}

// MessageFetcher 负责从 EventStore 读取历史消息。
type MessageFetcher interface {
    // FetchMessages 读取 thread 的历史消息，支持分页。
    FetchMessages(ctx context.Context, threadID string, opts FetchMessagesOpts) ([]ContextMessage, error)
}

type FetchMessagesOpts struct {
    Limit  int   `json:"limit"`
    Offset int   `json:"offset"`
    Since  *int64 `json:"since,omitempty"` // since seq
}

// MemorySearcher 负责 FTS5 全文检索 Memory。
type MemorySearcher interface {
    // SearchMemory 在指定 project 的 Memory 中检索。
    SearchMemory(ctx context.Context, projectID, query string, limit int) ([]ContextMemoryEntry, error)
}

// Summarizer 负责将早期消息压缩为摘要。
type Summarizer interface {
    // Summarize 对消息列表生成摘要。
    Summarize(ctx context.Context, messages []ContextMessage) (*ContextMessage, error)
}

// TokenCounter 负责估算 token 数量。
type TokenCounter interface {
    // CountTokens 估算文本的 token 数。
    CountTokens(text string) int

    // CountMessagesTokens 估算消息列表的 token 数。
    CountMessagesTokens(messages []ContextMessage) int
}
```

### 4.3 完整构建管道

```
ContextBuilder.Build(spec ContextSpec) → AssembledContext

管道:
┌─────────────────────────────────────────────────────────────────────────┐
│  1. VALIDATE                                                            │
│     ├─ 参数校验: spec 必填字段检查                                       │
│     ├─ 默认值填充: ReserveRatio=0.05, MemoryTopK=5, KeepRecent=20        │
│     └─ 计算 token 预算: effectiveBudget = MaxTokens × (1 - ReserveRatio) │
├─────────────────────────────────────────────────────────────────────────┤
│  2. FETCH -- 并行读取所有来源                                           │
│     ┌─────────────────────┐  ┌─────────────────────┐                    │
│     │ MemoryFetcher       │  │ MemorySearcher      │                    │
│     │ ├─ Global Memory    │  │ FTS5 BM25 检索      │                    │
│     │ ├─ Project Memory   │  │ query=spec.MemoryQuery                     │
│     │ └─ Agent Memory     │  │ limit=spec.MemoryTopK                     │
│     └──────────┬──────────┘  └──────────┬──────────┘                    │
│                │                        │                                │
│     ┌──────────┴────────────────────────┴──────────┐                    │
│     │ MessageFetcher                                │                    │
│     │ FetchMessages(threadID, since=, limit=)       │                    │
│     └──────────────────────┬───────────────────────┘                    │
│                            │                                            │
│     ┌──────────────────────┴───────────────────────┐                    │
│     │ Plugin Hooks (if any)                        │                    │
│     │ SystemPromptAppend + OverrideParams + Headers │                    │
│     └──────────────────────┬───────────────────────┘                    │
├────────────────────────────┼────────────────────────────────────────────┤
│  3. FILTER -- 减枝，按 Stage 过滤                                      │
│     ├─ PreGen: 只保留 Global + Project + Agent Memory + Plugin 注入     │
│     └─ PostGen: 保留 Memory + 完整 conversation history                 │
├─────────────────────────────────────────────────────────────────────────┤
│  4. SUMMARIZE -- 必要时压缩历史消息                                      │
│     ├─ 如果 SummarizeOlder:                                               │
│     │   older = messages[len - KeepRecent:]                              │
│     │   summary = Summarizer.Summarize(older)                            │
│     │   compacted = [summary] + messages[KeepRecent:]                    │
│     └─ 否则: 保留全部消息                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  5. TOKENIZE -- 计算 token + 必要时截断                                  │
│     ├─ systemTokens = TokenCounter.CountTokens(systemPrompt.FullText)    │
│     ├─ memoryTokens = TokenCounter.CountTokens(所有 MemoryEntry)         │
│     ├─ availableForMessages = effectiveBudget - systemTokens - memoryTokens │
│     └─ 从最早消息开始截断，直到 fit availableForMessages                   │
├─────────────────────────────────────────────────────────────────────────┤
│  6. ASSEMBLE -- 组装最终输出                                             │
│     ├─ SystemPrompt: 按优先级排序 PromptSegment → 拼接 FullText           │
│     │   Priority: System(0) > Plugin(10) > Global(20) > Project(30)      │
│     │           > Memory(40) > Agent(50) > Conversation(60)              │
│     ├─ Messages: compacted 后的消息列表                                  │
│     ├─ MemoryEntries: FTS5 检索结果                                      │
│     ├─ Params: 合并 spec.OverrideParams                                  │
│     ├─ Headers: spec.CustomHeaders                                       │
│     ├─ TokenUsage: 完整的 token 统计                                     │
│     └─ Meta: 构建阶段 + 耗时 + 错误列表                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Go 实现骨架

```go
// packages/context-engine/builder_impl.go

package contextengine

import (
    "context"
    "fmt"
    "sort"
    "sync"
    "time"
)

// contextBuilderImpl 是 ContextBuilder 的默认实现。
type contextBuilderImpl struct {
    memoryFetcher  MemoryFetcher
    messageFetcher MessageFetcher
    memorySearcher MemorySearcher
    summarizer     Summarizer
    tokenCounter   TokenCounter
}

// NewContextBuilder 创建默认的 ContextBuilder。
func NewContextBuilder(opts ContextBuilderOptions) ContextBuilder {
    return &contextBuilderImpl{
        memoryFetcher:  opts.MemoryFetcher,
        messageFetcher: opts.MessageFetcher,
        memorySearcher: opts.MemorySearcher,
        summarizer:     opts.Summarizer,
        tokenCounter:   opts.TokenCounter,
    }
}

type ContextBuilderOptions struct {
    MemoryFetcher  MemoryFetcher
    MessageFetcher MessageFetcher
    MemorySearcher MemorySearcher
    Summarizer     Summarizer
    TokenCounter   TokenCounter
}

// ============================================================================
// Build -- 主入口
// ============================================================================

func (b *contextBuilderImpl) Build(ctx context.Context, spec ContextSpec) (*AssembledContext, error) {
    startTime := time.Now()
    meta := &BuildMeta{
        Stage:  spec.Stage,
        Errors: []string{},
    }

    // 1. VALIDATE
    spec = b.applyDefaults(spec)
    effectiveBudget := b.computeEffectiveBudget(spec)

    // 2. FETCH (并行)
    segments, memoryEntries, messages, fetchErrs := b.fetchAll(ctx, spec)
    for _, err := range fetchErrs {
        meta.Errors = append(meta.Errors, err.Error())
    }
    meta.MemoryHitCount = len(memoryEntries)
    meta.FilesRead = len(segments)

    // 3. FILTER
    segments = b.filterByStage(segments, spec.Stage)
    messages = b.filterMessagesByStage(messages, spec.Stage)

    // 4. SUMMARIZE
    if spec.SummarizeOlder && len(messages) > spec.KeepRecent {
        older := messages[:len(messages)-spec.KeepRecent]
        summary, err := b.summarizer.Summarize(ctx, older)
        if err != nil {
            meta.Errors = append(meta.Errors, fmt.Sprintf("summarize: %v", err))
        } else {
            recent := messages[len(messages)-spec.KeepRecent:]
            messages = append([]ContextMessage{*summary}, recent...)
        }
    }

    // 5. TOKENIZE + TRUNCATE
    systemPrompt := b.assembleSystemPrompt(segments, spec.SystemPromptAppend)
    systemTokens := b.tokenCounter.CountTokens(systemPrompt.FullText)

    var memoryTokens int
    for _, entry := range memoryEntries {
        memoryTokens += b.tokenCounter.CountTokens(entry.Content)
    }

    availableForMessages := effectiveBudget - systemTokens - memoryTokens
    messages, truncatedFrom := b.truncateMessages(messages, availableForMessages)

    // 6. ASSEMBLE
    params := b.resolveParams(spec)
    params.MaxContextTokens = effectiveBudget

    tokenUsage := &TokenUsage{
        SystemPromptTokens: systemTokens,
        MessagesTokens:     b.tokenCounter.CountMessagesTokens(messages),
        MemoryTokens:       memoryTokens,
        TotalTokens:        systemTokens + b.tokenCounter.CountMessagesTokens(messages) + memoryTokens,
        AllocatedBudget:    effectiveBudget,
        ReserveBudget:      spec.MaxTokens - effectiveBudget,
        TruncatedMessages:  truncatedFrom,
        TruncatedFrom:      truncatedFrom,
    }

    meta.BuiltAt = time.Now()
    meta.DurationMs = time.Since(startTime).Milliseconds()

    return &AssembledContext{
        SystemPrompt:  systemPrompt,
        Messages:      messages,
        MemoryEntries: memoryEntries,
        Params:        params,
        Headers:       spec.CustomHeaders,
        TokenUsage:    tokenUsage,
        Meta:          meta,
    }, nil
}

// ============================================================================
// 内部方法
// ============================================================================

// applyDefaults 填充未设置的默认值。
func (b *contextBuilderImpl) applyDefaults(spec ContextSpec) ContextSpec {
    if spec.ReserveRatio == 0 {
        spec.ReserveRatio = 0.05 // 参考 LibreChat
    }
    if spec.MemoryTopK == 0 {
        spec.MemoryTopK = 5
    }
    if spec.KeepRecent == 0 {
        spec.KeepRecent = 20
    }
    if spec.CompactionMode == "" {
        spec.CompactionMode = CompactionSummarize
    }
    if spec.Stage == "" {
        spec.Stage = BuildStageGen
    }
    return spec
}

// computeEffectiveBudget 计算有效 token 预算。
// 参考 LibreChat: computeEffectiveMaxContextTokens
func (b *contextBuilderImpl) computeEffectiveBudget(spec ContextSpec) int {
    effective := int(float64(spec.MaxTokens) * (1.0 - spec.ReserveRatio))
    // 至少保留 1000 tokens
    if effective < 1000 {
        return 1000
    }
    return effective
}

// fetchAll 并行获取所有上下文来源。
func (b *contextBuilderImpl) fetchAll(
    ctx context.Context, spec ContextSpec,
) ([]PromptSegment, []ContextMemoryEntry, []ContextMessage, []error) {
    var (
        wg            sync.WaitGroup
        mu            sync.Mutex
        allSegments   []PromptSegment
        allMemories   []ContextMemoryEntry
        allMessages   []ContextMessage
        allErrs       []error
    )

    // 并行 fetch Memory 文件
    if b.shouldIncludeMemory(spec, MemoryLayerGlobal) {
        wg.Add(1)
        go func() {
            defer wg.Done()
            segs, err := b.memoryFetcher.FetchGlobalMemory(ctx)
            mu.Lock()
            if err != nil {
                allErrs = append(allErrs, err)
            } else {
                allSegments = append(allSegments, segs...)
            }
            mu.Unlock()
        }()
    }

    if b.shouldIncludeMemory(spec, MemoryLayerProject) {
        wg.Add(1)
        go func() {
            defer wg.Done()
            segs, err := b.memoryFetcher.FetchProjectMemory(ctx, spec.ProjectPath)
            mu.Lock()
            if err != nil {
                allErrs = append(allErrs, err)
            } else {
                allSegments = append(allSegments, segs...)
            }
            mu.Unlock()
        }()
    }

    if b.shouldIncludeMemory(spec, MemoryLayerAgent) && spec.AgentName != "" {
        wg.Add(1)
        go func() {
            defer wg.Done()
            segs, err := b.memoryFetcher.FetchAgentMemory(ctx, spec.ProjectPath, spec.AgentName)
            mu.Lock()
            if err != nil {
                allErrs = append(allErrs, err)
            } else {
                allSegments = append(allSegments, segs...)
            }
            mu.Unlock()
        }()
    }

    // 并行 FTS5 检索
    if b.shouldIncludeMemory(spec, MemoryLayerConversation) && spec.MemoryQuery != "" {
        wg.Add(1)
        go func() {
            defer wg.Done()
            entries, err := b.memorySearcher.SearchMemory(ctx, "", spec.MemoryQuery, spec.MemoryTopK)
            mu.Lock()
            if err != nil {
                allErrs = append(allErrs, err)
            } else {
                allMemories = entries
            }
            mu.Unlock()
        }()
    }

    // 并行 Fetch 历史消息
    if spec.Stage != BuildStagePreGen {
        wg.Add(1)
        go func() {
            defer wg.Done()
            msgs, err := b.messageFetcher.FetchMessages(ctx, spec.ThreadID, FetchMessagesOpts{
                Limit: 200, // 初始拉取上限
            })
            mu.Lock()
            if err != nil {
                allErrs = append(allErrs, err)
            } else {
                allMessages = msgs
            }
            mu.Unlock()
        }()
    }

    wg.Wait()

    return allSegments, allMemories, allMessages, allErrs
}

// shouldIncludeMemory 检查是否应包含指定 Memory 层。
func (b *contextBuilderImpl) shouldIncludeMemory(spec ContextSpec, layer MemoryLayer) bool {
    for _, l := range spec.IncludeMemories {
        if l == layer {
            return true
        }
    }
    return false
}

// filterByStage 按构建阶段过滤 prompt 片段。
func (b *contextBuilderImpl) filterByStage(segments []PromptSegment, stage BuildStage) []PromptSegment {
    if stage == BuildStagePreGen {
        // PreGen: 只保留 global/project/agent memory，去掉 conversation 相关内容
        filtered := make([]PromptSegment, 0, len(segments))
        for _, s := range segments {
            if s.Source != PromptSourceConversation && s.Source != PromptSourceMemory {
                filtered = append(filtered, s)
            }
        }
        return filtered
    }
    // Gen / PostGen / Compact: 全部保留
    return segments
}

// filterMessagesByStage 按构建阶段过滤消息。
func (b *contextBuilderImpl) filterMessagesByStage(messages []ContextMessage, stage BuildStage) []ContextMessage {
    if stage == BuildStagePreGen {
        return nil // PreGen 不需要历史消息
    }
    if stage == BuildStageCompact {
        // Compact: 只保留摘要消息和最近 N 条
        return messages
    }
    return messages
}

// assembleSystemPrompt 组装 system prompt。
// 按优先级排序 PromptSegment，然后拼接。
func (b *contextBuilderImpl) assembleSystemPrompt(
    segments []PromptSegment,
    appends []string,
) *SystemPrompt {
    // 排序：优先级小的在前
    sort.Slice(segments, func(i, j int) bool {
        return segments[i].Priority < segments[j].Priority
    })

    // 追加 Plugin Hook 注入的片段
    for i, appendText := range appends {
        segments = append(segments, PromptSegment{
            Source:   PromptSourcePlugin,
            Title:    fmt.Sprintf("plugin_append_%d", i),
            Content:  appendText,
            Priority: 10, // Plugin 优先级仅低于 System
        })
    }

    // 拼接 FullText
    var fullText string
    for _, s := range segments {
        if fullText != "" {
            fullText += "\n\n"
        }
        fullText += fmt.Sprintf("<!-- SOURCE: %s (%s) -->\n%s", s.Source, s.Title, s.Content)
    }

    return &SystemPrompt{
        FullText: fullText,
        Segments: segments,
    }
}

// truncateMessages 截断消息以适应 token 预算。
func (b *contextBuilderImpl) truncateMessages(
    messages []ContextMessage,
    budget int,
) ([]ContextMessage, int) {
    if budget <= 0 || len(messages) == 0 {
        return nil, len(messages)
    }

    // 从最早的消息开始弃掉
    truncatedFrom := 0
    totalTokens := b.tokenCounter.CountMessagesTokens(messages)
    for totalTokens > budget && truncatedFrom < len(messages) {
        totalTokens -= b.tokenCounter.CountTokens(messages[truncatedFrom].Content)
        truncatedFrom++
    }

    if truncatedFrom >= len(messages) {
        return nil, truncatedFrom
    }

    return messages[truncatedFrom:], truncatedFrom
}

// resolveParams 解析 LLM 调用参数。
func (b *contextBuilderImpl) resolveParams(spec ContextSpec) *ResolvedParams {
    params := &ResolvedParams{
        Temperature:    0.7,
        TopP:           0.9,
        TopK:           40,
        MaxOutputTokens: 4096,
        MaxContextTokens: b.computeEffectiveBudget(spec),
    }

    if spec.OverrideParams != nil {
        if spec.OverrideParams.Temperature != nil {
            params.Temperature = *spec.OverrideParams.Temperature
        }
        if spec.OverrideParams.TopP != nil {
            params.TopP = *spec.OverrideParams.TopP
        }
        if spec.OverrideParams.TopK != nil {
            params.TopK = *spec.OverrideParams.TopK
        }
        if spec.OverrideParams.MaxOutputTokens != nil {
            params.MaxOutputTokens = *spec.OverrideParams.MaxOutputTokens
        }
        params.Extra = spec.OverrideParams.Extra
    }

    return params
}
```

### 4.5 Plugin Hook 集成点

```go
// packages/context-engine/hooks.go

package contextengine

import "context"

// ============================================================================
// Context Hook -- 借鉴 OpenCode Plugin Hook 模式
// ============================================================================

// ContextHook 是上下文构建的生命周期钩子。
// 借鉴 OpenCode: (input, output) => Promise<void> 双向修改模式
// input 只读，output 可变更。

// ContextHookFunc 是单个 Hook 函数签名。
type ContextHookFunc func(input *ContextHookInput, output *ContextHookOutput) error

// ContextHookInput 是 Hook 的只读输入。
type ContextHookInput struct {
    SessionID    string           `json:"sessionId"`
    AgentName    string           `json:"agentName"`
    Model        string           `json:"model"`
    Provider     string           `json:"provider"`
    ThreadID     string           `json:"threadId"`
    TurnID       string           `json:"turnId"`
    ProjectPath  string           `json:"projectPath"`
    Stage        BuildStage       `json:"stage"`
    Spec         ContextSpec      `json:"spec"` // 原始 ContextSpec（只读）
}

// ContextHookOutput 是 Hook 的可变更输出。
type ContextHookOutput struct {
    // System prompt 追加片段
    // 参考 OpenCode: experimental.chat.system.transform
    SystemPromptAppend []string

    // LLM 参数覆盖
    // 参考 OpenCode: chat.params
    Params *ParamOverrides

    // HTTP 头注入
    // 参考 OpenCode: chat.headers
    Headers map[string]string

    // 消息转换
    // 参考 OpenCode: experimental.chat.messages.transform
    MessagesTransform func([]ContextMessage) []ContextMessage

    // 压缩时注入的上下文
    // 参考 OpenCode: experimental.session.compacting
    CompactionContext string
}

// ContextHookChain 管理多个 Hook 的有序执行。
type ContextHookChain struct {
    hooks []ContextHookFunc
}

// NewContextHookChain 创建 Hook 链。
func NewContextHookChain(hooks ...ContextHookFunc) *ContextHookChain {
    return &ContextHookChain{hooks: hooks}
}

// Execute 按注册顺序执行所有 Hook。
// 后续 Hook 可以看到前面 Hook 的 output 修改。
func (c *ContextHookChain) Execute(input *ContextHookInput) (*ContextHookOutput, error) {
    output := &ContextHookOutput{
        SystemPromptAppend: []string{},
        Headers:            map[string]string{},
    }

    for _, hook := range c.hooks {
        if err := hook(input, output); err != nil {
            return output, err
        }
    }

    return output, nil
}
```

### 4.6 设计决策汇总

| 决策 | 选择 | 借鉴来源 | 理由 |
|------|------|----------|------|
| **管道模型** | Fetch → Filter → Summarize → Tokenize → Assemble | design-eventstore-memory.md | 清晰、可测试、每步可独立替换 |
| **Token 预算** | `MaxTokens * (1 - ReserveRatio)` | LibreChat | 简单有效，5% 预留足够 |
| **EMA 校准** | `CalibrationRatio` 字段透传 | LibreChat | 使 pruner 自适应，减少 token 估计偏差 |
| **System Prompt 来源** | `PromptSegment[]` 按 Priority 排序 | OpenCode (数组追加) + Claude Code (层级叠加) | 多来源可追踪、可调试 |
| **System Prompt 动态注入** | `ContextHook` 链 | OpenCode Plugin Hook | 每次 LLM 调用前可动态追加 |
| **消息压缩** | `SummarizeOlder` + `KeepRecent` | LibreChat summarization | 旧消息生成摘要替代原文，保留最近 N 条完整 |
| **Memory 检索** | FTS5 BM25 (porter tokenizer) | Claude Code Viewer | 轻量、无外部依赖、结果可追溯 |
| **Memory 注入阶段** | `BuildStage` 控制 | ChatDev (Pre/Gen/Post) | 不同阶段需要不同 Memory |
| **并行 Fetch** | goroutine + WaitGroup | N/A (Go 原生) | Memory/Message/FTS5 互不依赖，可并行 |
| **容错** | 非致命错误收集到 `Meta.Errors` | Claude Code Viewer (safeParse) | 单个来源失败不阻塞整体构建 |
| **Fork 支持** | `SourceTurnID` + Fork 时复制 transcript | Kanna | 分支会话的上下文构建 |
| **Subagent 隔离** | `Stage=PreGen` 时不加载历史消息 | LibreChat (initialSummary=undefined) | 子代理不继承父级 conversation 历史 |
| **LLM 参数注入** | `OverrideParams` 字段 | OpenCode (chat.params) | 动态调整 temperature/maxTokens 等 |
| **HTTP Header 注入** | `CustomHeaders` 字段 | OpenCode (chat.headers) | 动态切换 API key / 路由 |
| **输出可追踪** | `TokenUsage` + `BuildMeta` | design-eventstore-memory.md | 完整的 token 使用和构建过程信息 |

### 4.7 与已有设计的衔接

```
本设计文件与其他 AgentHub 设计文档的关系:

  design-context-builder.md (本文件)
    ├─ 引用 design-eventstore-memory.md
    │   ├─ ContextSpec / AssembledContext 基础类型
    │   ├─ 4 层 Memory 模型
    │   └─ reserveRatio / EMA / ContextSummary
    │
    ├─ 引用 design-protocol.md
    │   ├─ MemoryDocument / MemoryChunk / ContextSummary
    │   └─ Project / Thread / Turn / Message 类型
    │
    ├─ 扩展 kanna.md
    │   ├─ Fork: SourceTurnID + transcript 复制
    │   └─ TranscriptEntry → ContextMessage 规范化
    │
    ├─ 扩展 librechat.md
    │   ├─ reserveRatio + EMA 校准
    │   └─ Subagent 隔离: PreGen stage 不加载历史
    │
    ├─ 扩展 claude-code-viewer.md
    │   ├─ FTS5 BM25 检索
    │   └─ 容错: 非致命错误不阻塞
    │
    ├─ 扩展 opencode.md
    │   ├─ ContextHook 链模式
    │   ├─ chat.params / chat.headers / chat.system 注入
    │   └─ (input, output) 双向修改签名
    │
    └─ 扩展 chatdev.md
        ├─ BuildStage: PreGen / Gen / PostGen / Compact
        └─ Stage-level 过滤逻辑
```

---

## 附录：7 仓库贡献度矩阵

| 仓库 | Context Pipeline 贡献 | Compression 贡献 | System Prompt 贡献 | 可复用模式 |
|------|:---:|:---:|:---:|------|
| **Kanna** | transcript 回放 + fork 复制 | SDK 自主 compaction | CLI 启动时一次性注入 | Fork transcript copy, AsyncMessageQueue, writeChain |
| **LibreChat** | RunConfig 组装 + subagent 隔离 | reserveRatio + EMA + contextPruning | systemContent 字段组装 | shapeSummarizationConfig, initialSummary=undefined for subagents |
| **CC Viewer** | JSONL 增量读取 + lastN | lastN 分页 | 无（只读） | FTS5 BM25, Zod safeParse 容错, porter tokenizer |
| **OpenCode** | Plugin Hook 双向修改 | `session.compacting` hook | `chat.system.transform` 数组追加 | (input, output) => Promise<void>, Hook 链 |
| **ChatDev** | stage-level retrieval + write-back | context_window 限制 | role 字段 + phase prompt | Pre/Gen/Post 三阶段, Blackboard append-only |
| **design-eventstore-memory** | 4 层 Memory + ContextBuilder | reserveRatio + CompactHistory | AGENTS.md 文件系统层级 | ContextSpec, AssembledContext, ContextBuilder 接口 |
| **design-protocol** | N/A（类型定义） | ContextSummary 类型 | Memory types | Typed ID aliases, discriminated unions |
