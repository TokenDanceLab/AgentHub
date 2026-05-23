# Context Compaction -- Deep Dive: Claude Code 4-Layer + LibreChat + Kanna

> 分析日期: 2026-05-21
> 源码根: `D:\Code\Projects\study\ClaudeCode\claude-code-lite\src\services\compact\`
> AgentHub 输入: `design-context-builder.md`, `librechat.md`, `design-eventstore-memory.md`, `deep-dive-kanna-orchestrator-mapping.md`

---

## 1. Claude Code 4-Layer Compaction Pipeline

Claude Code 在每次 API 调用前按**固定顺序**执行一条压缩管道 (`query.ts:376-468`):

```
1. applyToolResultBudget (限额裁剪)
2. snipCompact         (工具结果替换为占位符)
3. microcompact        (缓存编辑删除过期工具结果)
4. contextCollapse     (折叠视图投影, ant-only)
5. autocompact         (LLM 摘要压缩)
```

失败后还有第 6 层:
```
6. reactiveCompact     (API 413 后应急压缩)
```

### 1.1 Layer 1: Microcompact -- 工具结果无损剪枝

**文件**: `src/services/compact/microCompact.ts` (530 lines)

**机制**:
- 目标是剪除**已无参考价值**的工具调用结果，为后续文本留出 token 空间
- 不调用 LLM，不生成摘要，**零信息丢失**对用户意图

**两条路径**:

#### A. Cached Microcompact (ant-only, `CACHED_MICROCOMPACT` gate)

使用 Anthropic 的 `cache_edits` API，在不破坏 prompt cache 前缀的前提下从服务端缓存中删除过期工具结果:

```
流程:
  1. collectCompactableToolIds(messages)         -- 收集所有可压缩工具 ID
  2. 按 user message 分组注册工具结果
  3. getToolResultsToDelete(state)               -- 判断哪些应删除
  4. createCacheEditsBlock(state, ids)            -- 生成 cache_edits 块
  5. API 层注入 cache_reference + cache_edits     -- 服务端处理删除
  6. 回到本地时不修改 messages 内容                -- cache 侧删除
```

**可压缩工具集** (9 种):
```
FILE_READ, SHELL, GREP, GLOB, WEB_SEARCH, WEB_FETCH, FILE_EDIT, FILE_WRITE
```

**配置来源**: GrowthBook `tengu_cached_mc_config`，包含 `triggerThreshold`(触发阈值) 和 `keepRecent`(保留数)。

**关键特性**: 不销毁 prompt cache 前缀。常规 autocompact 会重写整个上下文前缀导致 cache 全量重建(~98% cache miss)，cached MC 通过 cache_edits 只删除后端缓存中的指定块，前缀保留不变。

#### B. Time-Based Microcompact (all users)

当上一次 assistant 消息距今超过 `gapThresholdMinutes` 时触发:
- 认为服务端缓存已过期，直接内容替换旧工具结果
- 替换为 `[Old tool result content cleared]` 标记
- 参数可配: `gapThresholdMinutes`, `keepRecent`(最少保留数)

**触发条件**: 仅主线程 (`repl_main_thread` 前缀)，排除 fork/session_memory/prompt_suggestion 等子代理。

**令牌节省**: `calculateToolResultTokens()` 精确计算每个 tool_result 块的 token 数(文本按 `roughTokenCountEstimation`, 图像按 2000 token 固定值)。

### 1.2 Layer 2: Snip -- 工具结果文本替换

**文件**: `src/services/compact/snipCompact.ts` (stub in lite; full in internal build)

**机制**:
- Feature gate: `HISTORY_SNIP`
- `snipCompactIfNeeded(messages)` → `{ messages, tokensFreed }`
- 将旧工具结果文本替换为简短占位符，释放大量 token
- 不像 microcompact 那样依赖 cache_edits API，而是直接修改 message 内容
- `tokensFreed` 被传递给 `shouldAutoCompact()` 的 `snipTokensFreed` 参数，正确扣除已释放的 token 后重新计算是否需要 autocompact

**在管道中的位置**: 在 microcompact 之前执行 (`query.ts:401-410`)，因为 microcompact 的 cache_edits 可能不需要 snip 已处理的内容。

### 1.3 Layer 3: Autocompact -- LLM 摘要压缩

**文件**: `src/services/compact/autoCompact.ts` (351 lines) + `compact.ts` (1706 lines)

这是 Claude Code 最复杂的压缩层。

#### 触发阈值计算

```typescript
// autoCompact.ts:72-91
getAutoCompactThreshold(model) {
  effectiveContextWindow = getContextWindowForModel(model) - 20,000  // 预留输出
  threshold = effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS     // 13,000
  // 可通过 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE 环境变量按百分比覆盖
}

// autoCompact.ts:160-239
shouldAutoCompact(messages, model, querySource, snipTokensFreed) {
  // 递归守卫: session_memory/compact/marble_origami 源不触发
  // Reactive-only 模式: tengu_cobalt_raccoon flag 抑制 proactive
  // Context-collapse 模式: collapse 接管上下文管理，抑制 autocompact
  tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  return tokenCount >= autoCompactThreshold
}
```

**多层抑制逻辑**:
1. `DISABLE_COMPACT` / `DISABLE_AUTO_COMPACT` 环境变量
2. 用户设置 `autoCompactEnabled` (settings.json)
3. 递归守卫: `querySource` 为 `session_memory`/`compact`/`marble_origami` 时不触发(避免 fork deadlock)
4. Reactive-only 模式: `tengu_cobalt_raccoon` flag 抑制 proactive
5. Context-collapse 模式: collapse 接管上下文管理
6. Circuit breaker: `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`

**熔断器**: 连续 3 次 autocompact 失败后停止重试(避免 hammer API)。生产数据显示 1279 个 session 有 50+ 连续失败(最多 3272 次)，浪费 ~250K API 调用/天。重置: autocompact 成功后 `consecutiveFailures` 归零。

#### 压缩执行流程

```
autoCompactIfNeeded()
  │
  ├─ [1] trySessionMemoryCompaction()  ← 优先尝试 Session Memory
  │     │  成功 → 返回，跳过 LLM 压缩
  │     └  失败/未启用 → 继续
  │
  └─ [2] compactConversation()
        │
        ├─ executePreCompactHooks()       -- PreCompact hook (trigger: auto/manual)
        ├─ streamCompactSummary()
        │   │
        │   ├─ [优先] runForkedAgent()    -- 复用主对话 prompt cache
        │   │     (tengu_compact_cache_prefix, 3P default: true)
        │   │     优势: fork 继承父级 system/tools/model → cache 命中
        │   │     不设 maxOutputTokens → 避免 thinking config 失配
        │   │
        │   └─ [回退] queryModelWithStreaming()
        │         2 次 streaming 重试 (tengu_compact_streaming_retry)
        │         System prompt: "You are a helpful AI assistant tasked with summarizing conversations."
        │         Tools: FileReadTool only (或 + ToolSearchTool + MCP)
        │         thinking: disabled, maxOutputTokens: min(COMPACT_MAX, model_max)
        │         stripImagesFromMessages + stripReinjectedAttachments 预处理
        │
        ├─ PTL retry loop: MAX_PTL_RETRIES=3
        │     truncateHeadForPTLRetry(): 按 API-round group 从旧到新裁剪
        │     无法解析 tokenGap → fallback: 裁剪 20% groups
        │     保底: 至少保留 1 个 group
        │
        ├─ 清理: readFileState.clear(), loadedNestedMemoryPaths.clear()
        │
        ├─ Post-compact 恢复附件 (最大 50K token 预算):
        │   ├─ createPostCompactFileAttachments()  -- 最近 5 个文件, 每个最大 5K token
        │   ├─ createPlanAttachmentIfNeeded()       -- Plan 模式文件引用
        │   ├─ createSkillAttachmentIfNeeded()      -- 已调用 skill, 每 skill 最大 5K, 总预算 25K
        │   ├─ Deferred tools delta 全量重发
        │   ├─ Agent listing delta 全量重发
        │   └─ MCP instructions delta 全量重发
        │
        ├─ processSessionStartHooks('compact')    -- 恢复 CLAUDE.md 上下文
        ├─ createCompactBoundaryMessage()          -- 压缩边界标记
        ├─ createUserMessage(summary + isCompactSummary)  -- 摘要消息 (仅 transcript 可见)
        │
        ├─ logEvent('tengu_compact', {...})       -- 遥测
        ├─ notifyCompaction()                     -- Cache break 检测重置
        ├─ markPostCompaction()                   -- 全局状态标记
        ├─ reAppendSessionMetadata()             -- 保持 metadata 在 16KB 尾部窗口内
        │
        └─ executePostCompactHooks()              -- PostCompact hook
```

#### 压缩提示词工程 (`prompt.ts` 375 lines)

Core instruction:
```
NO_TOOLS_PREAMBLE: "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools."
  + "Tool calls will be REJECTED and will waste your only turn — you will fail the task."

<analysis>  → 草稿区, 提高摘要质量, 最终被 formatCompactSummary() strip

<summary> 9 节结构化输出:
  1. Primary Request and Intent
  2. Key Technical Concepts
  3. Files and Code Sections (含完整代码片段)
  4. Errors and fixes
  5. Problem Solving
  6. All user messages (非 tool result 的用户消息)
  7. Pending Tasks
  8. Current Work
  9. Optional Next Step (含原对话直接引用)
```

**三种变体**:
- `BASE_COMPACT_PROMPT`: 全量压缩
- `PARTIAL_COMPACT_PROMPT`: 方向 `from`(保留前缀, 压缩后缀)
- `PARTIAL_COMPACT_UP_TO_PROMPT`: 方向 `up_to`(压缩前缀, 保留后缀)

#### Post-compact 消息结构

```
buildPostCompactMessages(result):
  1. boundaryMarker       -- SystemCompactBoundaryMessage
  2. summaryMessages      -- UserMessage(isCompactSummary: true)
  3. messagesToKeep       -- 保留的最近消息 (partial compact 场景)
  4. attachments          -- 恢复的文件/skill/plan/agent/MCP 附件
  5. hookResults          -- SessionStart hooks 产出
```

### 1.4 Layer 4: Reactive Compact -- API 413 应急压缩

**文件**: `src/services/compact/reactiveCompact.ts` (stub; 内部实现)

**触发条件**: API 返回 `prompt-too-long` 错误 (HTTP 413 或特定错误消息)

**错误恢复管道** (`query.ts:1085-1183`):
```
isWithheld413 → 
  [1] collapse drain (contextCollapse.recoverFromOverflow)
        → 成功 → 重试 continue
        → 失败 → 
  [2] reactiveCompact.tryReactiveCompact()
        → 成功 → 重试 continue  
        → 失败 → 
  [3] 暴露错误, return { reason: 'prompt_too_long' }
```

**机制**: 从消息尾部开始逐步裁剪 tool result 内容，每次裁剪后重试。比 autocompact 更激进，因为此时 API 调用已失败，需要立即恢复。

**扣押模式**: API 流式响应中的 413 错误消息被 `isWithheldPromptTooLong()` 捕获并扣押(不 yield 给用户)，直到恢复尝试成功或穷尽。

### 1.5 Layer 0: Session Memory Compact -- 外部记忆压缩

**文件**: `src/services/compact/sessionMemoryCompact.ts` (630 lines)

这是一个实验性功能(`tengu_session_memory` + `tengu_sm_compact` flags)，在 autocompact 前尝试:

**机制**:
- Session Memory 是一个外部维护的结构化记忆文件
- `lastSummarizedMessageId` 追踪上次压缩边界
- `calculateMessagesToKeepIndex()` 确保保留的消息满足最低 token 和文本块数
- **不调用 LLM** 做压缩 -- 直接用已有的 session memory 内容作为摘要

**保留策略**:
```
minTokens = 10,000        -- 最少保留 token 数
minTextBlockMessages = 5  -- 最少保留含文本的消息数
maxTokens = 40,000        -- 硬上限, 触发则停止扩展
```

**工具对完整性保证**: `adjustIndexToPreserveAPIInvariants()` 处理两种边界情况:
1. Tool pair: 不能把 tool_use 和 tool_result 切到不同区间
2. Thinking block: 同一 `message.id` 的多个 streaming chunks 不能被截断

**阈值回退**: SM compact 后如果 `postCompactTokenCount >= autoCompactThreshold`，丢弃 SM compact 结果，回退到传统 autocompact。

---

## 2. 四层压缩对照表

```
┌─────────────────┬──────────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┐
│ 层级            │ 触发条件             │ 算法              │ 数据破坏性               │ AgentHub 对应           │
├─────────────────┼──────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
│ Microcompact    │ 工具结果计数超阈值    │ Cache edits /     │ 零信息丢失               │ CompactionTokenBudget   │
│                 │ 或空闲时间超阈值      │ Content clear     │ (只删缓存，不删原文)     │ (预请求, 轻量)          │
├─────────────────┼──────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
│ Snip            │ HISTORY_SNIP gate    │ 工具结果→占位符   │ 低丢失                   │ CompactionTokenBudget   │
│                 │ + 总 token 持续增长  │ 保留结构信息      │ (原文不可恢复)           │ (可并行 Microcompact)   │
├─────────────────┼──────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
│ Autocompact     │ token >= threshold   │ LLM Fork 生成摘要 │ 中丢失                   │ CompactionBackground    │
│                 │ (context-33K)        │ + Post-compact    │ (摘要替代原文,            │ (后台自动, 摘要+PBC)    │
│                 │                      │   附件重建        │  文件/MCP/Skill 恢复)    │                         │
├─────────────────┼──────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
│ Reactive        │ API 413 错误         │ 尾部 tool result  │ 中-高丢失                │ CompactionEmergency     │
│ Compact         │ 或 media size error  │ 逐步激进裁剪      │ (应急场景, 可恢复重试)   │ (紧急超限, 层层回退)    │
├─────────────────┼──────────────────────┼──────────────────┼──────────────────────────┼─────────────────────────┤
│ Session Memory  │ Feature gate +       │ 外部记忆文件      │ 低丢失                   │ CompactionBackground    │
│ Compact         │ SM 文件存在且非空    │ (无 LLM 调用)     │ (保留近期消息 + 结构化摘要)│ (SM 一级, 失败回退 LLM) │
└─────────────────┴──────────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

---

## 3. LibreChat reserveRatio + EMA 压缩

### 3.1 reserveRatio 机制

**来源**: `librechat.md` Section 4.2 + `design-eventstore-memory.md` Section 4.3

```
effectiveMaxContextTokens = maxContextTokens * (1.0 - reserveRatio)

reserveRatio = 0.05  (默认预留 5% 给新生成的输出)

示例: model context = 200K → effectiveMax = 200K * 0.95 = 190K
      其中 10K 留给模型新生成的文本
```

**数学含义**: `reserveRatio` 是**防护缓冲区**。它不是压缩比例，而是从模型的总上下文窗口中预留出一部分(5%)给当前 turn 的输出。剩余 95% 用于 prompt(历史消息 + system prompt + tools + memory)。

### 3.2 EMA 校准

```
calibrationRatio = 上次运行的 contextMeta.calibrationRatio
  用途: 初始化 pruner 的指数移动平均 (EMA)
  使 token 估计更准确，避免触发不必要的压缩或压缩不足

contextPruning 触发条件:
  tokenCounter 实时跟踪 → 超出 effectiveMaxContextTokens → 自动触发 summarization/pruning
```

**与其他库的区别**: LibreChat 的 `calibrationRatio` 是一个**跨 turn 持久化的校准值**。Claude Code 的 autocompact 没有类似机制(每次按绝对 token 数判断)，LibreChat 额外维护了一个 self-calibrating 的比例参数。

### 3.3 Subagent 上下文隔离

```
isSubagent ? undefined : initialSummary  -- 子代理不继承父级摘要
ToolRegistry Map clone + 每个 LCTool 浅拷贝   -- 工具隔离
```

子代理完全独立: 不继承父级的摘要记忆，工具注册表深度克隆防止父级 mutation 污染子代理。

---

## 4. Kanna Snapshot Compaction

### 4.1 触发机制

**来源**: `deep-dive-kanna-orchestrator-mapping.md` Section 6.1 + `design-eventstore-memory.md` Section 3.4

```
触发条件: 5 个 JSONL 文件总大小 >= 2MB

文件清单:
  - projects.jsonl
  - chats.jsonl
  - messages.jsonl
  - queued-messages.jsonl
  - turns.jsonl
  (transcripts/<chatId>.jsonl 不计入)
```

### 4.2 Compaction 流程

```
createSnapshot():
  1. 序列化当前内存 state → SnapshotFile{
       v: 2,
       generated_at: timestamp,
       seq: current_sequence,
       projects: ProjectRecord[],
       threads: ThreadRecord[],
       turns: TurnRecord[],
       pendingTurns: PendingTurn[]
     }
  2. Bun.write(snapshot.json)   -- 写入 snapshot 文件
  3. 清空所有 JSONL 文件         -- Truncate to 0
  4. 追加 snapshot_created 事件  -- 新 JSONL 首行

启动恢复:
  loadSnapshot() → replayLogs() → shouldCompact()
  1. 加载 snapshot.json
  2. 重放 snapshot 之后的 JSONL 事件
  3. 检查是否需要再次 compact
```

### 4.3 Snapshot 格式

**全量序列化**: Snapshot 是**完整 state 镜像**，不是增量。这意味着:
- 单次 compact 后 JSONL 归零，snapshot.json 包含所有历史
- 下次 compact 时覆盖 snapshot.json
- 恢复时从 snapshot 开始重放 JSONL → 最终 state = snapshot + delta

### 4.4 Fork 时的 Snapshot 复制

```
forkChat():
  1. 创建新 Chat
  2. 复制 source transcript JSONL → transcripts/<newChatId>.jsonl
  3. 设 pendingForkSessionToken = sourceChat.sessionToken
  4. 下个 turn 传给 SDK: forkSession: true
```

Fork 只复制 transcript(对话历史)，不复制其他 event 日志。Snapshot 不受影响。

### 4.5 对 AgentHub 的 2MB 阈值适用性

AgentHub 使用 JSONL + SQLite FTS5 混合存储。2MB 阈值对单机场景合理:
- 足够小: 保证 compact 低延迟(JSON 序列化 < 100ms)
- 足够大: 避免频繁 compact(每 ~2000 条消息触发一次)
- Go 实现: 使用 `zstd` level 3 压缩 snapshot (Opcode 借鉴)

---

## 5. 各层机制深度对比

### 5.1 压缩触发维度

```
           ┌──────────────┬──────────────┬──────────────┬──────────────┐
           │ Pre-Request  │ In-Request   │ Post-Error   │ Background   │
           │ (预算预测)   │ (API 自主)   │ (应急恢复)   │ (存储/索引)  │
───────────┼──────────────┼──────────────┼──────────────┼──────────────┤
CC         │ Microcompact │    N/A       │ Reactive     │ Autocompact  │
           │ Snip         │   (SDK own)  │ Compact      │ (proactive)  │
           │ Autocompact  │              │              │              │
───────────┼──────────────┼──────────────┼──────────────┼──────────────┤
LibreChat  │ reserveRatio │ SDK Context  │  N/A         │ N/A          │
           │ + EMA calib  │ Pruning      │              │              │
───────────┼──────────────┼──────────────┼──────────────┼──────────────┤
Kanna      │ N/A          │ SDK own      │ N/A          │ Snapshot     │
           │              │ compact      │              │ 2MB+        │
───────────┼──────────────┼──────────────┼──────────────┼──────────────┤
AgentHub   │ Compaction   │ Compaction   │ Compaction   │ Compaction   │
(proposed) │ TokenBudget  │ Background   │ Emergency    │ Background   │
           │ (micro/snip) │ (auto-LLM)   │ (reactive)   │ (snapshot)   │
└───────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

### 5.2 信息保真度光谱

```
高保真 <──────────────────────────────────────────────> 低保真

Microcompact    Snip      SessionMemory   Autocompact    Reactive
(Cache delete)  (占位符)  (SM 文件)       (LLM 摘要)     (激进裁剪)
                                    ↑                 ↑
                              可配置保留        API 已失败
                              10K-40K          = 必须成功
```

### 5.3 每层的退化策略

```
Microcompact 失败 → Snip           (仍然可用)
Snip 失败       → Autocompact     (释放 token 更少)
Autocompact 失败 → Circuit breaker (连续 3 次→停止)
Autocompact + SM 失败 → 传统 Autocompact
Reactive 失败   → Collapse drain  → 最终暴露错误
```

---

## 6. AgentHub 3-Layer Compaction Strategy

基于以上分析，为 AgentHub Context Builder 设计 3 层压缩:

### 6.1 类型定义

```go
// packages/context-engine/compaction/types.go

package compaction

import (
    "context"
    "time"
)

// ============================================================================
// CompactionStrategy -- 三层压缩策略
// ============================================================================

// CompactionLevel 定义压缩层级。
type CompactionLevel int

const (
    // CompactionTokenBudget: 预算不足时的轻量预请求压缩。
    // 对应 Claude Code 的 Microcompact + Snip。
    // 目标: 释放 token 空间但不损失信息。
    CompactionTokenBudget CompactionLevel = iota

    // CompactionBackground: 后台自动 LLM 摘要压缩。
    // 对应 Claude Code 的 Autocompact + Session Memory Compact。
    // 目标: 在用户无感知的情况下维持上下文在预算内。
    CompactionBackground

    // CompactionEmergency: 紧急超限恢复压缩。
    // 对应 Claude Code 的 Reactive Compact。
    // 目标: 在 API 已报 413 后立即恢复。
    CompactionEmergency
)

func (l CompactionLevel) String() string {
    switch l {
    case CompactionTokenBudget:
        return "token_budget"
    case CompactionBackground:
        return "background"
    case CompactionEmergency:
        return "emergency"
    default:
        return "unknown"
    }
}

// ============================================================================
// Trigger -- 压缩触发条件
// ============================================================================

// CompactionTrigger 描述什么条件触发压缩。
type CompactionTrigger struct {
    // 触发层
    Level CompactionLevel `json:"level"`

    // --- TokenBudget 专用 ---

    // ToolResultCount 触发: 累计工具结果数超过此值
    ToolResultThreshold int `json:"toolResultThreshold,omitempty"`
    // IdleTimeThreshold 触发: 距上次 assistant 消息超过此时间
    IdleTimeThreshold time.Duration `json:"idleTimeThreshold,omitempty"`
    // KeepRecentTools: 至少保留最近 N 个工具结果
    KeepRecentTools int `json:"keepRecentTools,omitempty"`

    // --- Background 专用 ---

    // TokenUsageFraction: 当前 token 使用 / 有效上下文窗口 >= 此值触发
    // 对应 Claude Code: (contextWindow - 33K) / contextWindow ≈ 0.835 (200K window)
    TokenUsageFraction float64 `json:"tokenUsageFraction,omitempty"`
    // AbsoluteTokenThreshold: 绝对 token 阈值 (覆盖 fraction)
    AbsoluteTokenThreshold int `json:"absoluteTokenThreshold,omitempty"`
    // ReserveRatio: 预留比例 (对应 LibreChat reserveRatio)
    ReserveRatio float64 `json:"reserveRatio,omitempty"`
    // MaxConsecutiveFailures: 连续失败熔断器 (对应 CC circuit breaker)
    MaxConsecutiveFailures int `json:"maxConsecutiveFailures,omitempty"`
    // MinTurnsBetweenCompactions: 两次压缩间最少轮数
    MinTurnsBetweenCompactions int `json:"minTurnsBetweenCompactions,omitempty"`

    // --- Emergency 专用 ---

    // 无额外配置 -- 由 API 错误信号触发
}

// DefaultTrigger 返回各层的默认触发条件。
func DefaultTrigger(level CompactionLevel) CompactionTrigger {
    switch level {
    case CompactionTokenBudget:
        return CompactionTrigger{
            Level:              CompactionTokenBudget,
            ToolResultThreshold: 30,
            IdleTimeThreshold:   5 * time.Minute,
            KeepRecentTools:     3,
        }
    case CompactionBackground:
        return CompactionTrigger{
            Level:                      CompactionBackground,
            TokenUsageFraction:         0.85,
            ReserveRatio:               0.05,
            MaxConsecutiveFailures:     3,
            MinTurnsBetweenCompactions: 2,
        }
    case CompactionEmergency:
        return CompactionTrigger{
            Level: CompactionEmergency,
        }
    default:
        return CompactionTrigger{}
    }
}

// ============================================================================
// Executor -- 压缩执行器
// ============================================================================

// CompactionExecutor 定义如何执行压缩。
type CompactionExecutor struct {
    // Strategy: 压缩算法
    // "cache_delete" → 删除缓存中的过期工具结果 (Microcompact)
    // "placeholder"  → 工具结果替换为占位符 (Snip)
    // "llm_summary"  → LLM 生成摘要 (Autocompact)
    // "session_memory" → 使用外部 Session Memory (SM Compact)
    // "tail_truncate" → 尾部逐步裁剪 (Reactive Compact)
    // "head_truncate" → 头部按 API-round 裁剪 (PTL retry)
    Strategy string `json:"strategy"`

    // PostCompact 配置
    KeepRecentMessages  int  `json:"keepRecentMessages"`   // 保留最近 N 条完整消息
    MaxSummaryTokens    int  `json:"maxSummaryTokens"`      // 摘要最大 token 数
    RestoreFiles        bool `json:"restoreFiles"`          // 是否恢复最近文件附件
    RestoreSkills       bool `json:"restoreSkills"`         // 是否恢复已调用 skills
    RestoreAgents       bool `json:"restoreAgents"`         // 是否恢复 agent listing
    RestoreMCP          bool `json:"restoreMCP"`            // 是否恢复 MCP 指令

    // 文件恢复预算
    MaxFilesToRestore     int `json:"maxFilesToRestore"`     // 最大恢复文件数 (CC: 5)
    MaxTokensPerFile      int `json:"maxTokensPerFile"`      // 每文件最大 token (CC: 5000)
    PostCompactionBudget  int `json:"postCompactionBudget"`   // 恢复附件总预算 (CC: 50000)
    MaxTokensPerSkill     int `json:"maxTokensPerSkill"`     // 每 skill 最大 token (CC: 5000)
    SkillsBudget          int `json:"skillsBudget"`          // Skills 总预算 (CC: 25000)

    // EMA 校准 (LibreChat 借鉴)
    UseEMACalibration bool    `json:"useEMACalibration"` // 是否使用 EMA 校准
    CalibrationRatio  float64 `json:"calibrationRatio"`  // 当前 EMA 校准比

    // 摘要提示词模板
    SummaryPromptTemplate string `json:"summaryPromptTemplate,omitempty"`

    // Hooks (OpenCode 借鉴)
    PreCompactHook  CompactionHook `json:"-"`
    PostCompactHook CompactionHook `json:"-"`
}

// DefaultExecutor 返回各策略的默认执行器。
func DefaultExecutor(strategy string) CompactionExecutor {
    switch strategy {
    case "cache_delete":
        return CompactionExecutor{
            Strategy:         "cache_delete",
            KeepRecentTools:  3,
            MaxTokensPerFile: 5000,
        }
    case "placeholder":
        return CompactionExecutor{
            Strategy: "placeholder",
        }
    case "llm_summary":
        return CompactionExecutor{
            Strategy:              "llm_summary",
            KeepRecentMessages:    5,
            MaxSummaryTokens:      20000,
            RestoreFiles:          true,
            RestoreSkills:         true,
            RestoreAgents:         true,
            RestoreMCP:            true,
            MaxFilesToRestore:     5,
            MaxTokensPerFile:      5000,
            PostCompactionBudget:  50000,
            MaxTokensPerSkill:     5000,
            SkillsBudget:          25000,
            UseEMACalibration:     true,
        }
    case "session_memory":
        return CompactionExecutor{
            Strategy:            "session_memory",
            KeepRecentMessages:  5,
            MaxSummaryTokens:    40000,
            RestoreFiles:        false,
            RestoreSkills:       false,
            RestoreAgents:       false,
            RestoreMCP:          false,
        }
    case "tail_truncate":
        return CompactionExecutor{
            Strategy:           "tail_truncate",
            MaxSummaryTokens:   0,
            RestoreFiles:       false,
            RestoreSkills:      false,
        }
    default:
        return CompactionExecutor{}
    }
}

// ============================================================================
// CompactionHook -- 压缩生命期钩子 (OpenCode 借鉴)
// ============================================================================

// CompactionHook 是 (input, output) => error 双向修改模式。
type CompactionHook func(input *CompactionHookInput, output *CompactionHookOutput) error

// CompactionHookInput 只读输入。
type CompactionHookInput struct {
    SessionID   string          `json:"sessionId"`
    ThreadID    string          `json:"threadId"`
    AgentName   string          `json:"agentName"`
    Model       string          `json:"model"`
    Trigger     string          `json:"trigger"` // "auto" | "manual"
    Level       CompactionLevel `json:"level"`
    TokenUsage  int             `json:"tokenUsage"`
    Threshold   int             `json:"threshold"`
}

// CompactionHookOutput 可变输出。
type CompactionHookOutput struct {
    // 追加到摘要提示词的指令
    CustomInstructions string `json:"customInstructions,omitempty"`
    // 是否压缩后自动继续 (OpenCode autocontinue)
    AutoContinue bool `json:"autoContinue"`
    // 压缩时注入的不可丢弃上下文
    PreserveContext string `json:"preserveContext,omitempty"`
    // 用户可见的显示消息
    UserDisplayMessage string `json:"userDisplayMessage,omitempty"`
}

// ============================================================================
// CompactionResult -- 压缩产出
// ============================================================================

// CompactionResult 是一次压缩的完整产出。
type CompactionResult struct {
    Level         CompactionLevel `json:"level"`
    Strategy      string          `json:"strategy"`
    WasCompacted  bool            `json:"wasCompacted"`

    // 压缩后的消息
    Messages      []ContextMessage `json:"messages"`

    // 摘要 (if strategy == "llm_summary")
    Summary       string           `json:"summary,omitempty"`
    SummaryTokens int              `json:"summaryTokens,omitempty"`

    // Token 统计
    PreCompactTokens  int `json:"preCompactTokens"`
    PostCompactTokens int `json:"postCompactTokens"`
    TokensFreed       int `json:"tokensFreed"`

    // 保留的消息数 / 丢弃的消息数
    MessagesKept     int `json:"messagesKept"`
    MessagesDropped  int `json:"messagesDropped"`

    // 边界标记 (对应 CC boundaryMarker)
    BoundarySeq      int    `json:"boundarySeq"`
    BoundaryUUID     string `json:"boundaryUuid"`

    // 连续失败计数 (CC circuit breaker)
    ConsecutiveFailures int `json:"consecutiveFailures,omitempty"`

    // Hook 产出
    HookMessages     []ContextMessage `json:"hookMessages,omitempty"`
    AutoContinue     bool            `json:"autoContinue"`

    // EMA 校准值 (下一轮透传)
    CalibrationRatio float64 `json:"calibrationRatio,omitempty"`

    // 耗时
    DurationMs       int64  `json:"durationMs"`
    Error            string `json:"error,omitempty"`
}
```

### 6.2 三层压缩编排器

```go
// packages/context-engine/compaction/orchestrator.go

package compaction

import (
    "context"
    "fmt"
    "log"
    "math"
    "sync"
    "time"
)

// ============================================================================
// ContextMessage -- 压缩使用的消息类型 (简化)
// ============================================================================

type ContextMessage struct {
    Role       string    `json:"role"`
    Content    string    `json:"content"`
    ToolCallID string    `json:"toolCallId,omitempty"`
    ToolName   string    `json:"toolName,omitempty"`
    IsToolResult bool    `json:"isToolResult"`
    Seq        int64     `json:"seq"`
    UUID       string    `json:"uuid"`
    Timestamp  time.Time `json:"timestamp"`
    IsSummary  bool      `json:"isSummary"`
}

// ============================================================================
// CompactionOrchestrator -- 三层编排
// ============================================================================

// CompactionOrchestrator 管理三层压缩的触发和执行。
type CompactionOrchestrator struct {
    mu sync.Mutex

    // 各层配置
    budgetTrigger    CompactionTrigger
    budgetExecutor   CompactionExecutor
    backgroundTrigger CompactionTrigger
    backgroundExecutor CompactionExecutor
    emergencyExecutor  CompactionExecutor

    // 状态追踪 (对应 CC AutoCompactTrackingState)
    lastCompactTurnID   string
    turnsSinceCompact   int
    consecutiveFailures int

    // EMA 校准 (LibreChat 借鉴)
    calibrationRatio float64

    // Hook 链
    preCompactHooks  []CompactionHook
    postCompactHooks []CompactionHook

    // 日志
    logger *log.Logger
}

// CompactionOrchestratorConfig 构造配置。
type CompactionOrchestratorConfig struct {
    BudgetTrigger      CompactionTrigger
    BudgetExecutor     CompactionExecutor
    BackgroundTrigger  CompactionTrigger
    BackgroundExecutor CompactionExecutor
    EmergencyExecutor  CompactionExecutor
    CalibrationRatio   float64
    PreCompactHooks    []CompactionHook
    PostCompactHooks   []CompactionHook
}

// NewCompactionOrchestrator 创建编排器。
func NewCompactionOrchestrator(cfg CompactionOrchestratorConfig) *CompactionOrchestrator {
    return &CompactionOrchestrator{
        budgetTrigger:     cfg.BudgetTrigger,
        budgetExecutor:    cfg.BudgetExecutor,
        backgroundTrigger: cfg.BackgroundTrigger,
        backgroundExecutor: cfg.BackgroundExecutor,
        emergencyExecutor:  cfg.EmergencyExecutor,
        calibrationRatio:   cfg.CalibrationRatio,
        preCompactHooks:    cfg.PreCompactHooks,
        postCompactHooks:   cfg.PostCompactHooks,
        logger:             log.Default(),
    }
}

// ============================================================================
// Evaluate -- 评估是否需要压缩
// ============================================================================

// NeedsCompaction 返回当前 token 使用量下需要执行的压缩层级列表。
func (o *CompactionOrchestrator) NeedsCompaction(
    messages []ContextMessage,
    modelContextWindow int,
    systemPromptTokens int,
) []CompactionLevel {
    o.mu.Lock()
    defer o.mu.Unlock()

    totalTokens := estimateTotalTokens(messages, systemPromptTokens)
    effectiveWindow := o.computeEffectiveWindow(modelContextWindow)

    var levels []CompactionLevel

    // 1. TokenBudget: 工具结果过多 或 空闲时间过长
    if o.shouldTokenBudgetCompact(messages) {
        levels = append(levels, CompactionTokenBudget)
    }

    // 2. Background: token 使用超过阈值
    fraction := float64(totalTokens) / float64(effectiveWindow)
    if o.backgroundTrigger.AbsoluteTokenThreshold > 0 {
        if totalTokens >= o.backgroundTrigger.AbsoluteTokenThreshold {
            // 熔断器检查
            if o.consecutiveFailures < o.backgroundTrigger.MaxConsecutiveFailures {
                levels = append(levels, CompactionBackground)
            }
        }
    } else if o.backgroundTrigger.TokenUsageFraction > 0 {
        if fraction >= o.backgroundTrigger.TokenUsageFraction {
            if o.consecutiveFailures < o.backgroundTrigger.MaxConsecutiveFailures {
                levels = append(levels, CompactionBackground)
            }
        }
    }

    return levels
}

// NeedsEmergencyCompact 检查是否需要应急压缩 (由 API 错误触发)。
func (o *CompactionOrchestrator) NeedsEmergencyCompact() bool {
    return true // 由外部 API 错误信号调用，这里总是返回 true
}

// shouldTokenBudgetCompact 检查 TokenBudget 层触发条件。
func (o *CompactionOrchestrator) shouldTokenBudgetCompact(messages []ContextMessage) bool {
    // Tool result count 触发
    if o.budgetTrigger.ToolResultThreshold > 0 {
        compactableCount := countCompactableTools(messages)
        if compactableCount > o.budgetTrigger.ToolResultThreshold {
            return true
        }
    }

    // Idle time 触发
    if o.budgetTrigger.IdleTimeThreshold > 0 {
        lastAssistant := findLastAssistantTime(messages)
        if !lastAssistant.IsZero() {
            if time.Since(lastAssistant) > o.budgetTrigger.IdleTimeThreshold {
                return true
            }
        }
    }

    return false
}

// computeEffectiveWindow 计算有效上下文窗口 (对应 LibreChat reserveRatio)。
func (o *CompactionOrchestrator) computeEffectiveWindow(modelContextWindow int) int {
    reserveRatio := o.backgroundTrigger.ReserveRatio
    if reserveRatio == 0 {
        reserveRatio = 0.05
    }
    effective := int(float64(modelContextWindow) * (1.0 - reserveRatio))
    return effective
}

// ============================================================================
// Compact -- 执行压缩
// ============================================================================

// Compact 执行指定层级的压缩。
func (o *CompactionOrchestrator) Compact(
    ctx context.Context,
    level CompactionLevel,
    messages []ContextMessage,
    systemPromptTokens int,
) (*CompactionResult, error) {
    o.mu.Lock()
    o.turnsSinceCompact = 0
    o.mu.Unlock()

    startTime := time.Now()

    // 执行 PreCompact hooks
    hookInput := &CompactionHookInput{
        Trigger:   "auto",
        Level:     level,
    }
    hookOutput := &CompactionHookOutput{}
    for _, hook := range o.preCompactHooks {
        if err := hook(hookInput, hookOutput); err != nil {
            return nil, fmt.Errorf("pre-compact hook: %w", err)
        }
    }

    var result *CompactionResult
    var err error

    switch level {
    case CompactionTokenBudget:
        result, err = o.compactTokenBudget(ctx, messages)
    case CompactionBackground:
        result, err = o.compactBackground(ctx, messages, systemPromptTokens)
    case CompactionEmergency:
        result, err = o.compactEmergency(ctx, messages)
    default:
        return nil, fmt.Errorf("unknown compaction level: %v", level)
    }

    if err != nil {
        o.mu.Lock()
        o.consecutiveFailures++
        o.mu.Unlock()
        return result, err
    }

    o.mu.Lock()
    o.consecutiveFailures = 0
    if result != nil {
        o.lastCompactTurnID = result.BoundaryUUID
        o.calibrationRatio = result.CalibrationRatio
    }
    o.mu.Unlock()

    result.DurationMs = time.Since(startTime).Milliseconds()
    result.Level = level

    // 注入 hook 产出
    if hookOutput.UserDisplayMessage != "" {
        // 追加到结果
    }

    // 执行 PostCompact hooks
    for _, hook := range o.postCompactHooks {
        _ = hook(hookInput, hookOutput) // 非致命错误
    }

    return result, nil
}

// ============================================================================
// compactTokenBudget -- 轻量 Token Budget 压缩
// ============================================================================

func (o *CompactionOrchestrator) compactTokenBudget(
    ctx context.Context,
    messages []ContextMessage,
) (*CompactionResult, error) {
    strategy := o.budgetExecutor.Strategy
    if strategy == "" {
        strategy = "cache_delete"
    }

    switch strategy {
    case "cache_delete":
        return o.microcompactMessages(ctx, messages)
    case "placeholder":
        return o.snipCompactMessages(ctx, messages)
    default:
        return o.microcompactMessages(ctx, messages)
    }
}

// microcompactMessages: 删除过期工具结果 (对应 CC Cached/Time-based Microcompact)
func (o *CompactionOrchestrator) microcompactMessages(
    _ context.Context,
    messages []ContextMessage,
) (*CompactionResult, error) {
    keepRecent := o.budgetTrigger.KeepRecentTools
    if keepRecent == 0 {
        keepRecent = 3
    }
    compactable := filterCompactableTools(messages)

    if len(compactable) <= keepRecent {
        return &CompactionResult{WasCompacted: false, Messages: messages}, nil
    }

    // 保留最近 N 个，删除其余
    keepSet := make(map[string]bool)
    for i := len(compactable) - keepRecent; i < len(compactable); i++ {
        keepSet[compactable[i].ToolCallID] = true
    }

    tokensFreed := 0
    result := make([]ContextMessage, len(messages))
    copy(result, messages)
    for i, msg := range result {
        if msg.IsToolResult && !keepSet[msg.ToolCallID] {
            tokensFreed += estimateTokens(msg.Content)
            result[i].Content = "[Old tool result content cleared]"
        }
    }

    preTokens := estimateTotalTokens(messages, 0)
    postTokens := estimateTotalTokens(result, 0)

    return &CompactionResult{
        Strategy:         "cache_delete",
        WasCompacted:     true,
        Messages:         result,
        PreCompactTokens: preTokens,
        PostCompactTokens: postTokens,
        TokensFreed:      tokensFreed,
        MessagesKept:     len(messages),
        MessagesDropped:  0,
    }, nil
}

// snipCompactMessages: 工具结果替换为占位符 (对应 CC Snip)
func (o *CompactionOrchestrator) snipCompactMessages(
    _ context.Context,
    messages []ContextMessage,
) (*CompactionResult, error) {
    tokensFreed := 0
    result := make([]ContextMessage, len(messages))
    copy(result, messages)

    threshold := len(messages) / 2 // 只处理前半部分消息

    for i := 0; i < threshold && i < len(result); i++ {
        if result[i].IsToolResult {
            tokensFreed += estimateTokens(result[i].Content)
            result[i].Content = fmt.Sprintf("[Tool result from %s truncated]",
                result[i].ToolName)
        }
    }

    preTokens := estimateTotalTokens(messages, 0)
    postTokens := estimateTotalTokens(result, 0)

    return &CompactionResult{
        Strategy:         "placeholder",
        WasCompacted:     tokensFreed > 0,
        Messages:         result,
        PreCompactTokens: preTokens,
        PostCompactTokens: postTokens,
        TokensFreed:      tokensFreed,
        MessagesKept:     len(messages),
        MessagesDropped:  0,
    }, nil
}

// ============================================================================
// compactBackground -- 后台 LLM 摘要压缩
// ============================================================================

func (o *CompactionOrchestrator) compactBackground(
    ctx context.Context,
    messages []ContextMessage,
    systemPromptTokens int,
) (*CompactionResult, error) {
    strategy := o.backgroundExecutor.Strategy
    if strategy == "" {
        strategy = "llm_summary"
    }
    // 第一步: 尝试 Session Memory Compact (如果启用)
    // 第二步: 回退到 LLM Summary Compact
    switch strategy {
    case "session_memory":
        return o.sessionMemoryCompact(ctx, messages, systemPromptTokens)
    case "llm_summary":
        return o.llmSummaryCompact(ctx, messages, systemPromptTokens)
    default:
        return o.llmSummaryCompact(ctx, messages, systemPromptTokens)
    }
}

// sessionMemoryCompact: 使用外部 Session Memory 做压缩 (对应 CC SM Compact)
func (o *CompactionOrchestrator) sessionMemoryCompact(
    _ context.Context,
    messages []ContextMessage,
    systemPromptTokens int,
) (*CompactionResult, error) {
    keepRecent := o.backgroundExecutor.KeepRecentMessages
    if keepRecent == 0 {
        keepRecent = 5
    }
    maxTokens := o.backgroundExecutor.MaxSummaryTokens
    if maxTokens == 0 {
        maxTokens = 40000
    }

    // 从 Session Memory 中读取内容 (外部接口)
    // sessionMemory := loadSessionMemory(sessionID)
    // if empty → fallback to llmSummaryCompact

    // 计算保留边界 (对应 CC calculateMessagesToKeepIndex)
    startIdx := len(messages) - keepRecent
    if startIdx < 0 {
        startIdx = 0
    }
    // expandToMeetMinimums(messages, startIdx, minTokens=10000, minTextBlocks=5, maxTokens)

    kept := messages[startIdx:]
    dropped := messages[:startIdx]

    preTokens := estimateTotalTokens(messages, systemPromptTokens)
    postTokens := estimateTotalTokens(kept, systemPromptTokens)

    return &CompactionResult{
        Strategy:         "session_memory",
        WasCompacted:     len(dropped) > 0,
        Messages:         kept,
        PreCompactTokens: preTokens,
        PostCompactTokens: postTokens,
        TokensFreed:      preTokens - postTokens,
        MessagesKept:     len(kept),
        MessagesDropped:  len(dropped),
    }, nil
}

// llmSummaryCompact: LLM 生成摘要压缩 (对应 CC Autocompact)
func (o *CompactionOrchestrator) llmSummaryCompact(
    _ context.Context,
    messages []ContextMessage,
    systemPromptTokens int,
) (*CompactionResult, error) {
    keepRecent := o.backgroundExecutor.KeepRecentMessages
    if keepRecent == 0 {
        keepRecent = 5
    }

    if len(messages) <= keepRecent {
        return &CompactionResult{WasCompacted: false, Messages: messages}, nil
    }

    // 1. 分离 older (待摘要) 和 recent (保留原文)
    older := messages[:len(messages)-keepRecent]
    recent := messages[len(messages)-keepRecent:]

    // 2. 调用 LLM 生成摘要
    // summary, err := callSummarizer(ctx, older, o.backgroundExecutor)
    // if err → PTL retry with truncateHead → max 3 retries
    summary := "[LLM-generated conversation summary would be here]"

    // 3. 创建边界标记
    boundaryMsg := ContextMessage{
        Role: "system",
        Content: fmt.Sprintf(
            "[Conversation compressed at seq=%d. %d messages summarized into %d tokens.]",
            messages[len(messages)-1].Seq,
            len(older),
            estimateTokens(summary),
        ),
        IsSummary: true,
    }

    // 4. 组装结果: boundary + summary + recent + restored attachments
    result := []ContextMessage{boundaryMsg}
    result = append(result, ContextMessage{
        Role:       "user",
        Content:    summary,
        IsSummary:  true,
    })
    result = append(result, recent...)

    preTokens := estimateTotalTokens(messages, systemPromptTokens)
    postTokens := estimateTotalTokens(result, systemPromptTokens)

    calRatio := o.calibrationRatio
    if o.backgroundExecutor.UseEMACalibration {
        // EMA update: α=0.1, new = actual post/pre ratio
        newRatio := float64(postTokens) / float64(preTokens)
        calRatio = calRatio*0.9 + newRatio*0.1
    }

    return &CompactionResult{
        Strategy:          "llm_summary",
        WasCompacted:      true,
        Messages:          result,
        Summary:           summary,
        SummaryTokens:     estimateTokens(summary),
        PreCompactTokens:  preTokens,
        PostCompactTokens: postTokens,
        TokensFreed:       preTokens - postTokens,
        MessagesKept:      keepRecent,
        MessagesDropped:   len(older),
        CalibrationRatio:  calRatio,
    }, nil
}

// ============================================================================
// compactEmergency -- 应急压缩 (对应 CC Reactive Compact)
// ============================================================================

func (o *CompactionOrchestrator) compactEmergency(
    _ context.Context,
    messages []ContextMessage,
) (*CompactionResult, error) {
    // 从尾部逐步裁剪 tool result 内容，每次裁剪 20%
    // 对应 CC reactiveCompact.tryReactiveCompact()

    for cutFraction := 0.2; cutFraction <= 0.9; cutFraction += 0.2 {
        cutIdx := int(float64(len(messages)) * (1 - cutFraction))
        if cutIdx >= len(messages) {
            cutIdx = len(messages) - 1
        }
        if cutIdx <= 0 {
            cutIdx = 1
        }

        trimmed := messages[cutIdx:]
        // 清理孤立 tool result (tool_use 在裁剪部分)
        cleaned := cleanupOrphanedToolResults(trimmed)

        preTokens := estimateTotalTokens(messages, 0)
        postTokens := estimateTotalTokens(cleaned, 0)

        return &CompactionResult{
            Strategy:         "tail_truncate",
            WasCompacted:     true,
            Messages:         cleaned,
            PreCompactTokens: preTokens,
            PostCompactTokens: postTokens,
            TokensFreed:      preTokens - postTokens,
            MessagesKept:     len(cleaned),
            MessagesDropped:  cutIdx,
        }, nil
    }

    return nil, fmt.Errorf("emergency compaction exhausted all cut fractions")
}

// ============================================================================
// 辅助函数
// ============================================================================

// compactableToolNames 可压缩的工具名称集 (对应 CC COMPACTABLE_TOOLS)。
var compactableToolNames = map[string]bool{
    "read":       true,
    "bash":       true,
    "grep":       true,
    "glob":       true,
    "web_search": true,
    "web_fetch":  true,
    "edit":       true,
    "write":      true,
}

func filterCompactableTools(messages []ContextMessage) []ContextMessage {
    var result []ContextMessage
    for _, msg := range messages {
        if msg.IsToolResult && compactableToolNames[msg.ToolName] {
            result = append(result, msg)
        }
    }
    return result
}

func countCompactableTools(messages []ContextMessage) int {
    return len(filterCompactableTools(messages))
}

func findLastAssistantTime(messages []ContextMessage) time.Time {
    for i := len(messages) - 1; i >= 0; i-- {
        if messages[i].Role == "assistant" {
            return messages[i].Timestamp
        }
    }
    return time.Time{}
}

func estimateTokens(text string) int {
    // 简化估算: 4 chars ≈ 1 token
    return int(math.Ceil(float64(len(text)) / 4.0))
}

func estimateTotalTokens(messages []ContextMessage, sysPromptTokens int) int {
    total := sysPromptTokens
    for _, msg := range messages {
        total += estimateTokens(msg.Content)
    }
    return total
}

func cleanupOrphanedToolResults(messages []ContextMessage) []ContextMessage {
    // 收集所有已存在的 tool_use ID
    toolUseIDs := make(map[string]bool)
    for _, msg := range messages {
        if msg.Role == "assistant" && msg.ToolCallID != "" {
            toolUseIDs[msg.ToolCallID] = true
        }
    }

    // 清理孤立的 tool_result
    var result []ContextMessage
    for _, msg := range messages {
        if msg.IsToolResult && !toolUseIDs[msg.ToolCallID] {
            continue // 跳过孤立 tool_result
        }
        result = append(result, msg)
    }
    return result
}
```

### 6.3 三层压缩流程图

```
AgentHub Context Builder 调用压缩:

ContextBuilder.Build(spec)
  │
  ├─ [Stage 1: ASSEMBLE] 组装完整上下文
  │    systemPrompt + messages + memory + params
  │
  ├─ [Stage 2: EVALUATE] 评估 token 预算
  │    effectiveBudget = maxTokens * (1 - reserveRatio)
  │    totalTokens = systemPrompt + messages + memory
  │
  ├─ [Stage 3: COMPACT] 必要时执行压缩
  │    │
  │    ├─ Level 1: CompactionTokenBudget
  │    │   │
  │    │   ├─ Microcompact: 删除过期工具结果 (cache_delete)
  │    │   │   条件: ToolResultCount > threshold OR idleTime > threshold
  │    │   │   行动: 保留最近 N 个工具结果, 其余标记为 [cleared]
  │    │   │   特点: 零信息丢失, 不影响 prompt cache
  │    │   │
  │    │   └─ Snip: 旧工具结果替换为占位符 (placeholder)
  │    │       条件: 消息数超过阈值
  │    │       行动: 前半部分消息的工具结果→占位符
  │    │       特点: 低信息丢失, 保留结构
  │    │
  │    ├─ Level 2: CompactionBackground
  │    │   │
  │    │   ├─ 熔断器检查: 连续失败 >= 3 → 跳过
  │    │   │
  │    │   ├─ [优先] Session Memory Compact
  │    │   │   条件: SM enabled + SM file 存在且非空
  │    │   │   行动: 用外部 SM 替代 LLM 摘要
  │    │   │   保留: minTokens=10K + minTextBlocks=5 + 工具对完整性
  │    │   │
  │    │   └─ [回退] LLM Summary Compact
  │    │       条件: SM 不可用或失败
  │    │       行动: Fork-agent LLM 生成结构化摘要
  │    │       提示词: 9 节结构化输出 (同 Claude Code)
  │    │       PTL retry: Max 3 次, truncateHeadForPTLRetry
  │    │       Post-compact 恢复: Files(5) + Skills(25K) + Agents + MCP
  │    │       EMA 校准更新: α=0.1
  │    │
  │    └─ Level 3: CompactionEmergency
  │        条件: API 返回 413 错误
  │        行动: 从尾部逐步裁剪 (20%→40%→60%→80%)
  │        策略: tail_truncate + cleanupOrphanedToolResults
  │        特点: 不断重试直到 fit
  │
  └─ [Stage 4: OUTPUT] 返回 AssembledContext
       TokenUsage 包含预/后压缩 token 统计
```

### 6.4 与现有设计的对接

```
本文件 (deep-dive-context-compaction.md)
  │
  ├─ 扩展 design-context-builder.md
  │   ├─ Section 2 (上下文压缩策略对比) → 深化为 4 层详解
  │   ├─ Section 4.3 (构建管道) → 增加 Compaction 阶段
  │   └─ ContextSpec → 增加 CompactionTrigger/Executor 字段
  │
  ├─ 扩展 design-eventstore-memory.md
  │   ├─ Section 3.4 (Compaction 机制) → 深化 Kanna 2MB 触发
  │   ├─ Section 4.3 (Context Compaction) → 深化 reserveRatio + EMA
  │   └─ Layer 4 Conversation Memory → 增加 compaction metadata 表
  │
  ├─ 扩展 librechat.md
  │   ├─ Section 4.2 (Summarization) → EMA 校准数学模型
  │   └─ reserveRatio 0.05 的数学证明
  │
  └─ 扩展 deep-dive-kanna-orchestrator-mapping.md
      └─ Section 6.1 (Snapshot Compaction) → 完整流程 + Fork 复制策略
```

### 6.5 设计决策汇总

```
┌────────────────────────┬─────────────────────────────┬─────────────────────────────┐
│ 决策                   │ 选择                        │ 依据                        │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ 压缩分层               │ 3 层 (TokenBudget/          │ Claude Code 4层 + LibreChat │
│                        │ Background/Emergency)       │ 1层 + Kanna 1层 → 统一 3 层 │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ TokenBudget 触发       │ Tool count 30 + Idle 5min   │ CC microcompact 的           │
│                        │                             │ triggerThreshold +           │
│                        │                             │ gapThresholdMinutes          │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Background 触发        │ TokenUsageFraction 0.85     │ CC autocompact:              │
│                        │                             │ (window - 33K) / window       │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ ReserveRatio           │ 0.05 (5%)                   │ LibreChat 验证, 简单有效     │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ 熔断器                 │ MaxConsecutiveFailures = 3  │ CC circuit breaker 生产验证  │
│                        │                             │ (节省 ~250K API 调用/天)     │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ EMA 校准               │ α=0.1, EMA(post/pre ratio) │ LibreChat calibrationRatio   │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ LLM 摘要提示词         │ 9 节结构化 + NO_TOOLS       │ CC compact prompt 工程验证   │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Post-compact 恢复      │ Files(5)+Skill(25K)+        │ CC post-compact 附件预算      │
│                        │ Agents+MCP                  │ (total 50K + 25K skills)     │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Session Memory 优先    │ SM → 失败回退 LLM           │ CC SM compact 实验功能       │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Fork-agent 缓存复用    │ 继承父级 system+tools+model │ CC cache-sharing fork path   │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ PTL retry              │ Max 3 次 + head truncate    │ CC PTL retry loop            │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Emergency 策略         │ 尾部 20%-80% 渐进裁剪        │ CC reactive compact 分步重试 │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Hook 集成              │ Pre/Post Compact Hook       │ OpenCode (input,output) 模式 │
├────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Snapshot Compaction    │ 2MB JSONL → zstd snapshot   │ Kanna 验证 + Opcode zstd     │
│ (EventStore 层)        │ (独立于 Context 层)          │                              │
└────────────────────────┴─────────────────────────────┴─────────────────────────────┘
```

---

## 7. 关键发现

### 7.1 Claude Code 压缩层的演进轨迹

Claude Code 的压缩系统经历了明显的演进:
1. **Legacy Microcompact** (已移除) → 简单的工具结果内容清除
2. **Cached Microcompact** (ant) → 使用 Anthropic cache_edits API, 不破坏 prompt cache
3. **Time-based Microcompact** (all) → 根据空闲时间清除, cache 已过期无需保留
4. **Session Memory Compact** (实验) → 外部记忆文件, 零 LLM 调用压缩
5. **Snip** → 工具结果→占位符, 独立于 cache_edits 路径
6. **Autocompact** → 核心 LLM 摘要压缩, cache-sharing fork 路径
7. **Reactive Compact** → 413 应急, 由 feature gate `REACTIVE_COMPACT` 控制
8. **Context Collapse** (ant-only) → 重叠的上下文管理系统, 抑制 autocompact

关键洞察: **prompt cache 保护**是 microcompact 设计的首要目标。cached MC 路径通过 cache_edits 在服务端删除内容而不触发 cache break。这是 AgentHub 需要考虑的维度(如果底层 provider 支持 cache_edits)。

### 7.2 LibreChat reserveRatio 的简洁性优势

LibreChat 用 3 行代码解决了 token 预算问题:
```go
effectiveMax = maxContextTokens * (1.0 - reserveRatio)  // 0.95
```
比 Claude Code 的多阈值系统(autocompact/warning/error/blocking 4 层阈值)更简洁。但缺点是没有渐进式压缩(要么不压缩, 要么直接触发 SDK 压缩)。AgentHub 应同时支持两种策略。

### 7.3 Kanna Snapshot 的强制 Compaction 触发

Kanna 的 2MB 阈值是**强制**的 -- 超过就 compact, 不可配置跳过。这保证了 EventStore 不会无限膨胀。AgentHub 的 EventStore 层应实现相同的强制 compaction, 但阈值可以根据实际数据量调整(Go 的 JSON 序列化比 Bun 快, 可能支持更大的阈值如 5-10MB)。
