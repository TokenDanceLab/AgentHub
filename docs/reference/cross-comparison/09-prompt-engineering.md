# Prompt Engineering Patterns -- Cross-Repo Extraction

> 从 6 个仓库/设计文档提取的 Prompt 工程具体模式。
> 前置: `06-opencode.md`, `14-claude-code-sdk.md`, `12-chatdev.md`, `05-context-builder.md`, `05-context-compaction.md`
> 目标: 为 AgentHub 提供可复现的 Prompt 组织方法。

---

## 1. Prompt 分层注入机制

### 1.1 三层注入架构（AgentHub 综合方案）

```
Layer 1: Static (文件系统, Session 启动时加载)
  ~/.agenthub/memory/          → Global Memory (.md 文件)
  {project}/.agenthub/AGENTS.md → Project Memory
  {project}/.agenthub/agents/{name}/CLAUDE.md → Agent Memory
  特点: 人类可编辑, git diff/merge, 层级叠加

Layer 2: Dynamic (Hook, 每次 LLM 调用前触发)
  chat.params hook    → temperature, topP, topK, maxOutputTokens
  chat.headers hook   → 动态 API key, 租户隔离, rate limit 标记
  chat.system hook    → 追加 system prompt 片段 (string[])
  chat.messages hook  → 转换消息数组 (注入/重排/过滤)
  特点: 基于运行时状态动态决策, 多个 plugin 可追加

Layer 3: Compaction (Token Budget, 每次构建时计算)
  reserveRatio = 0.05 → 预留 5% 给模型输出
  EMA calibration     → α=0.1, 自适应 pruner
  maxTokens           → 用户配置硬上限
  特点: 自动裁剪 + 摘要压缩, 保上下文在预算内
```

### 1.2 System Prompt 来源优先级排序

所有仓库的共识：**优先级越高越靠后追加**（底层指令在上，上层覆盖在下）。AgentHub 定义如下：

| Priority | Source | 示例内容 | 来源 |
|----------|--------|---------|------|
| 0 | System | AgentHub 运行时指令 | AgentHub 系统级 |
| 10 | Plugin | Hook 注入的安全策略/路由规则 | OpenCode `chat.system.transform` |
| 20 | Global | 用户个人偏好、全局规则 | Claude Code `~/.claude/CLAUDE.md` |
| 30 | Project | 项目 AGENTS.md、编码规范 | Claude Code `{project}/AGENTS.md` |
| 40 | Memory | FTS5 检索到的记忆片段 | Claude Code Viewer BM25 |
| 50 | Agent | Agent 专属 CLAUDE.md | Claude Code Agent Memory |
| 60 | Conversation | 压缩后的对话摘要 | OpenCode `session.compacting` |

### 1.3 System Prompt 数组追加模式（OpenCode 精度）

OpenCode 的 `experimental.chat.system.transform` 独到设计：system prompt 是 **`string[]` 而非单 string**。

```
多个 plugin 各自追加片段:
  Plugin A → system.push("Security: do not read .env files")
  Plugin B → system.push("Style: use ES modules, not CommonJS")
  Plugin C → system.push("Context: current branch is feature/xxx")

最终组装:
  system.join("\n\n") → 发送给 LLM

优势:
  - 每个来源可独立追踪（知道谁注入了什么）
  - 不需要解析/合并已有文本
  - 出问题时容易定位注入源
```

AgentHub 的 `PromptSegment[]` 结构就是对此的增强：每个 segment 多带 `Source` / `Title` / `Priority` / `FilePath` 元数据。

### 1.4 (input, output) 双向修改模式

OpenCode 全部的 19 个 hook 遵循统一签名：

```typescript
// input: 只读上下文
// output: 可变输出，hook 原地修改
type HookFunc = (input: HookInput, output: HookOutput) => Promise<void>
```

这个模式的关键优势：
- **Input 只读**：防止 hook 间互相污染上游数据
- **Output 可变更**：后续 hook 可以看到前面 hook 的修改
- **按序执行**：先注册先执行，确定性高
- **不抛异常**：单个 hook 失败由 chain 统一处理

AgentHub 的 `ContextHookChain` 直接复现这一模式（`05-context-builder.md` 4.5 节）。

---

## 2. 文件系统 Prompt 约定对比

### 2.1 四大仓库对比

| 维度 | Claude Code | OpenCode | ChatDev | AgentHub (target) |
|------|------------|----------|---------|-------------------|
| **层级数** | 6 层 | 无文件约定 | 2 层 (config + yaml) | 4 层 |
| **文件格式** | `.md` (Markdown) | N/A (全代码) | `.yaml` (YAML) | `.md` (Markdown) |
| **加载时机** | Session 启动时扫描 | N/A | Workflow 加载时解析 | ContextSpec.Build() 时读取 |
| **运行时修改** | 不可 (启动后固定) | 每次 LLM 调用前 Hook | 不可 (YAML 一次解析) | Layer 1 不可, Layer 2 可 |
| **Git 友好** | 是 (纯文本 .md) | N/A | 是 (YAML) | 是 (纯文本 .md) |
| **人可编辑** | 是 | 仅开发者 | 是 (YAML Editor) | 是 |
| **多人协作** | .md 文件 git merge | N/A | YAML merge | .md 文件 git merge |
| **覆盖规则** | 下层被上层覆盖 | 数组追加, 无覆盖 | YAML 字段覆盖 | Priority 排序, 高优先级靠后 |
| **Skills** | `~/.claude/skills/*/SKILL.md` | N/A | `.agents/skills/*.md` (frontmatter) | 借鉴 Claude Code: `skills/{name}/SKILL.md` |
| **Memory** | CODEBUDDY.md + Memory files | Plugin Hook 注入 | Simple/File/Blackboard/Mem0 | 4 层: Global/Project/Agent/Conversation |

### 2.2 CLAUDE.md / AGENTS.md / SKILL.md 分工

这是 Claude Code 生态的实际约定（AgentHub 直接复用）：

```
CLAUDE.md (个人/全局)          → "我是谁，我偏好什么"
  ~/.claude/CLAUDE.md          → 用户级全局指令
  {project}/CLAUDE.md           → 项目级覆盖 (优先级高于全局)

AGENTS.md (项目/共享)          → "这个项目怎么做"
  {project}/AGENTS.md           → 项目级共享指令 (全团队可见)

SKILL.md (技能/专项)           → "如何完成某类任务"
  ~/.claude/skills/{name}/SKILL.md  → 可复用的专项能力定义
  {project}/.claude/skills/{name}/SKILL.md → 项目级技能

分工原则:
  - CLAUDE.md: "偏好"——个人工作流、工具选择、风格
  - AGENTS.md: "规则"——编码规范、目录结构、必守流程
  - SKILL.md:  "方法"——特定任务的完成流程和领域知识
```

### 2.3 ChatDev 的 YAML 驱动 vs Claude Code 的 .md 驱动

两种范式在 AgentHub 中都适用，但场景不同：

| 维度 | YAML 驱动 (ChatDev) | .md 驱动 (Claude Code) |
|------|---------------------|------------------------|
| **适用** | Workflow 定义（节点+边+条件） | Agent 行为指令（偏好+规则+记忆） |
| **结构化** | 强（schema validated） | 弱（自然语言） |
| **可编程** | 字段驱动表单 | 人手工编辑 |
| **变更频率** | 低（workflow 稳定） | 高（随项目演进） |
| **AgentHub 用法** | Workflow 编排 | Agent Memory 文件 |

结论：**Workflow = YAML, Memory = .md**。两种文件格式互补而非竞争。

---

## 3. Prompt 模板化

### 3.1 模板化模式总览

六仓库中出现的四种模板化手段：

```
1. 文本拼接 (Claude Code)
   fetchSystemPromptParts() → 按层级拼接 .md 文件内容 → 单一 systemPrompt 字符串
   无变量替换，无条件渲染

2. Hook 数组追加 (OpenCode)
   chat.system.transform → output.system.push(fragment)
   多个 plugin 的片段合为 string[] → 最终 join

3. YAML 变量插值 (ChatDev)
   YAML 中 ${VAR} 占位 → 运行时从 vars dict 解析
   Phase prompt (literal node) 作为固定模板注入

4. PromptSegment 排序 (AgentHub, 综合方案)
   Segment[] 按 Priority 排序 → 拼接 FullText
   每个 Segment 带 Source/Title/FilePath 元数据
```

### 3.2 变量替换设计 (借鉴 ChatDev + OpenCode)

ChatDev 的 `vars` 机制经增强后可用于 AgentHub：

```yaml
# AgentHub Workflow YAML (未来设计)
vars:
  project_name: "AgentHub"
  language: "Go"
  framework: "Gin"

nodes:
  - type: agent
    config:
      role: |
        You are building ${project_name}.
        Primary language: ${language}.
        Web framework: ${framework}.
```

Hook 层面的动态变量（OpenCode 模式下更灵活）：

```
chat.params hook → 读取 session 状态 → 动态设定 temperature:
  if (session.totalCost > budget * 0.9) → temperature = 0 (保守)
  if (session.toolErrors > threshold) → temperature = 0.3 (降低随机性)
```

### 3.3 条件渲染（BuildStage 驱动）

AgentHub 根据 `BuildStage` 决定哪些 prompt 内容出现在当前调用中：

```
PreGen (规划前):
  Include: Global Memory + Project Memory + Agent Memory
  Exclude: Conversation History + FTS5 Memory

Gen (生成, 默认):
  Include: 所有来源

PostGen (反思):
  Include: Conversation History + Memory (用于对比检查)
  Exclude: Global Memory (不是规划阶段)

Compact (压缩):
  Include: 仅压缩后的摘要 + 不可丢弃的关键上下文
```

这借鉴了 ChatDev 的三阶段检索 (Pre-Gen / Gen / Post-Gen)，但将其从 Memory 检索泛化到整个 Prompt 组装。

---

## 4. 压缩 Prompt 工程

### 4.1 Claude Code Autocompact 提示词结构

Claude Code 的 compaction prompt 经过大量工程迭代，是最成熟的压缩提示词设计。AgentHub 直接借鉴其结构：

```
NO_TOOLS_PREAMBLE:
  "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
   Tool calls will be REJECTED and will waste your only turn."

<analysis> 区块 (草稿区):
  自由文本, 帮助推理但最终被 strip

<summary> 9 节结构化输出:
  1. Primary Request and Intent       — 用户原始意图
  2. Key Technical Concepts            — 核心技术概念
  3. Files and Code Sections           — 含完整代码片段
  4. Errors and fixes                  — 错误与修复
  5. Problem Solving                   — 问题解决过程
  6. All user messages                 — 非 tool result 的用户消息
  7. Pending Tasks                     — 未完成任务
  8. Current Work                      — 当前正在进行的工作
  9. Optional Next Step                — 直接引用原对话中的下一步
```

### 4.2 三种压缩变体

```
BASE_COMPACT_PROMPT:
  压缩全部消息 → 单一摘要

PARTIAL_COMPACT_PROMPT (方向: from):
  保留前缀 (recent), 压缩后缀 (older)
  使用场景: 近期对话仍需完整保留

PARTIAL_COMPACT_UP_TO_PROMPT (方向: up_to):
  压缩前缀 (older), 保留后缀 (recent)
  使用场景: 早期对话已不重要, 近期是关键
```

### 4.3 PTL Retry 截断策略

压缩提示词过大时 (prompt-too-long) 的退让：

```
Max 3 retries:
  Retry 1: 裁剪 20% 最旧的消息组 (按 API-round 分组)
  Retry 2: 裁剪 40%
  Retry 3: 裁剪 60%
  保底: 至少保留 1 个 group

无法解析 tokenGap → fallback: 裁剪 20% groups
```

---

## 5. AgentHub Prompt 组织最佳实践

### 5.1 核心原则

1. **来源可追踪**：每个 prompt 片段标注 `PromptSource` + `FilePath`，出问题时秒级定位注入源
2. **层级可覆盖**：用 `Priority` 控制叠加顺序，而非硬编码先后
3. **阶段自适应**：`BuildStage` 决定当前回合需要哪些内容
4. **Token 预算先行**：`reserveRatio` 预留输出空间，避免 API 413
5. **Hook 可扩展**：`(input, output)` 双向修改模式，Plugin 参与每次 LLM 调用的 prompt 组装

### 5.2 文件组织

```
~/.agenthub/
  memory/
    preferences.md       → "我偏好 ES modules, pnpm, tab-width=2"
    conventions.md       → "错误信息用英文, 日志用结构化 JSON"
  skills/
    web-scraper/
      SKILL.md           → "网页抓取的完整 SOP"

{project}/
  .agenthub/
    AGENTS.md            → "本项目用 Go 1.22+, 目录结构: cmd/internal/pkg"
    memory/
      decisions.md       → "为什么选了 Gin 而非 Echo (2026-03-15)"
      architecture.md    → "服务间通信全部走 gRPC"
    agents/
      backend-dev/
        CLAUDE.md        → "后台开发 agent 专属: 优先用 context.Context, 错误用 fmt.Errorf wrap"
```

### 5.3 Assembly 管道

```
ContextBuilder.Build(spec)
  │
  ├─ Fetch (并行)
  │   ├─ MemoryFetcher: 读 Global/Project/Agent .md 文件
  │   ├─ MemorySearcher: FTS5 BM25 检索 conversation memory
  │   ├─ MessageFetcher: 读历史消息
  │   └─ ContextHook.Execute: 执行 Plugin hook 链
  │
  ├─ Filter (按 BuildStage 过滤)
  │   PreGen → 去 conversation/memory
  │   Gen    → 全保留
  │
  ├─ Summarize (超出 token 预算时)
  │   旧消息 → LLM 生成摘要 → 保留最近 N 条完整
  │
  ├─ Tokenize + Truncate
  │   systemTokens + memoryTokens + messagesTokens ≤ effectiveBudget
  │
  └─ Assemble
      Segment[] 按 Priority 排序 → 拼接 FullText
      输出: AssembledContext { SystemPrompt, Messages, MemoryEntries, Params, Headers, TokenUsage }
```

### 5.4 PromptSource 与 PromptSegment 类型定义

```go
type PromptSource string
const (
    PromptSourceSystem       = "system"
    PromptSourcePlugin       = "plugin"
    PromptSourceGlobal       = "global"
    PromptSourceProject      = "project"
    PromptSourceAgent        = "agent"
    PromptSourceMemory       = "memory"
    PromptSourceConversation = "conversation"
    PromptSourceUserOverride = "user_override"
)

type PromptSegment struct {
    Source   PromptSource  // 来源层级
    Title    string        // 如 "AGENTS.md"
    Content  string        // 片段文本
    Priority int           // 越小越靠前
    FilePath string        // 来源文件绝对路径
}
```

### 5.5 与其他设计文档的衔接

```
本文件 (11-prompt-engineering-patterns.md)
  │
  ├─ 综合 06-opencode.md
  │   ├─ (input, output) 双向修改模式
  │   ├─ string[] 数组追加 (非单 string)
  │   └─ chat.params / chat.headers / chat.system hooks
  │
  ├─ 综合 14-claude-code-sdk.md
  │   ├─ 6-layer 文件系统 loading
  │   ├─ --system-prompt / --append-system-prompt CLI
  │   └─ setting_sources 优先级
  │
  ├─ 综合 12-chatdev.md
  │   ├─ YAML ${VAR} 变量插值
  │   ├─ Phase prompt (literal node)
  │   └─ prompt vs messages 注入模式
  │
  ├─ 综合 05-context-builder.md
  │   ├─ 3 层注入架构 (Static/Dynamic/Compaction)
  │   ├─ PromptSegment + PromptSource 类型
  │   ├─ ContextHook 链
  │   └─ BuildStage 条件渲染
  │
  └─ 综合 05-context-compaction.md
      ├─ 9 节 structured compaction prompt
      ├─ 3 种 partial compact 方向
      └─ PTL retry 截断策略
```

---

## 6. 跨仓库 Prompt 模式速查

| 模式 | 仓库来源 | AgentHub 采纳 |
|------|---------|--------------|
| System prompt 是 string[] (数组追加) | OpenCode | PromptSegment[] 增强版 |
| (input, output) 双向修改 Hook | OpenCode | ContextHookFunc 签名 |
| 每次 LLM 调用前触发 Hook | OpenCode | Layer 2 Dynamic 层 |
| 6 层文件系统 .md 加载 | Claude Code | 4 层 Memory 模型 |
| `--system-prompt` / `--append-system-prompt` CLI | Claude Code | ContextSpec.SystemPromptAppend |
| `setting_sources` 优先级 (user/project/local/...) | Claude Code | PromptSource 枚举 + Priority 排序 |
| YAML `${VAR}` 变量插值 | ChatDev | AgentHub Workflow YAML |
| `input_mode: prompt | messages` 双模式 | ChatDev | ContextSpec.Stage 控制注入方式 |
| Phase prompt (literal node) | ChatDev | 特殊 case: BuildStage 注入 |
| `reserveRatio = 0.05` token 预留 | LibreChat | ContextSpec.ReserveRatio |
| `calibrationRatio` EMA 自适应 | LibreChat | TokenUsage.CalibrationRatio |
| 9 节 structured compaction prompt | Claude Code | Summarizer 实现 |
| `<analysis>` + `<summary>` 双块输出 | Claude Code | Summarizer prompt template |
| FTS5 BM25 Memory 检索 | Claude Code Viewer | MemorySearcher |
| `safeParse` 容错不阻塞 | Claude Code Viewer | Meta.Errors 收集 |

---

*分析完成: 2026-05-21 | 覆盖 6 份源文档, 提取 14 种可复现的 Prompt 工程模式*
