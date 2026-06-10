# Agent Memory — Filesystem Storage Design

> 状态：已实现（Phase A）
> 最后更新：2026-06-10

## 概述

Agent Memory 是 AgentHub 的持久化记忆系统，使用文件系统存储而非数据库。记忆文件存储在 workspace 的 `.agenthub/memory/` 目录下，以 Markdown + YAML frontmatter 格式保存。

## 设计决策

### 为什么用文件系统而不是数据库

1. **人类可读** — 用户可以直接用任何文本编辑器编辑记忆文件
2. **Git 可追踪** — 记忆变更可以纳入版本控制
3. **可移植** — 复制 `.agenthub/` 目录即可迁移全部状态
4. **Claude Code 原生** — Claude CLI 已经从文件系统读取 `CLAUDE.md`，记忆文件遵循相同模式
5. **无需 DB 迁移** — 不增加数据库 schema 复杂度

### 为什么用 Markdown + YAML frontmatter

- 与 `CLAUDE.md`/`AGENTS.md` 风格一致
- YAML frontmatter 保存结构化元数据（ID、时间戳、标签、来源）
- Markdown body 保存自由格式的记忆内容
- 无需额外解析器，纯文本处理

## 目录结构

```
{workspace}/
└── .agenthub/
    └── memory/
        ├── project.md            # 项目级记忆（所有线程共享）
        ├── thread_{threadId}.md  # 线程级记忆（每个会话一份）
        └── agent_{agentId}.md    # Agent 级记忆（每个 Agent 配置一份）
```

## 文件格式

每个记忆条目使用 YAML frontmatter + Markdown body：

```markdown
---
id: mem_abc123
created: 2026-06-10T12:00:00Z
updated: 2026-06-10T12:30:00Z
tags: [setup, preferences]
source: user
---

The user prefers dark theme and always wants Claude Sonnet for code reviews.
```

多条目文件中，条目之间用 `---` 分隔：

```markdown
---
id: mem_001
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
tags: [project, architecture]
source: agent
---

# Project Architecture

AgentHub uses a 5-layer architecture.

---
id: mem_002
created: 2026-06-10T09:00:00Z
updated: 2026-06-10T09:00:00Z
source: user
---

Always use TypeScript strict mode.
```

### Frontmatter 字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 唯一标识符，格式 `mem_{hex}_{ts36}` |
| `created` | 是 | ISO 8601 创建时间 |
| `updated` | 是 | ISO 8601 更新时间 |
| `tags` | 否 | 逗号分隔的标签列表 |
| `source` | 是 | `user`、`agent` 或 `system` |

## 三层记忆模型

### Project Memory (`project.md`)
- 项目级事实，所有线程共享
- 适合存储：项目架构、技术栈、编码规范、团队偏好
- 在每次 Run 中都会被读取

### Thread Memory (`thread_{threadId}.md`)
- 线程/会话级上下文
- 适合存储：本次对话的关键决策、用户要求、中间结论
- 只在对应线程的 Run 中被读取

### Agent Memory (`agent_{agentId}.md`)
- Agent Profile 级偏好
- 适合存储：模型偏好、审批策略、MCP 配置习惯
- 只在使用对应 Agent 的 Run 中被读取

## 系统集成

### Edge Server 集成

在 `handlers.go` 的 Run 创建流程中，`BuildMemoryPrompt()` 在 Skills prompt 注入之后被调用：

```go
// Inject AgentHub memory from .agenthub/memory/ files into the system prompt.
if memPrompt := runnerctx.BuildMemoryPrompt(req.WorkDir, req.ThreadID, req.AgentID); memPrompt != "" {
    if runCtx.SkillsPrompt != "" {
        runCtx.SkillsPrompt = memPrompt + "\n\n" + runCtx.SkillsPrompt
    } else {
        runCtx.SkillsPrompt = memPrompt
    }
}
```

记忆文本被注入到 `SkillsPrompt` 字段，最终通过 `--append-system-prompt` 传递给 Claude Code（和其他适配器）。

### 注入顺序

在 `--append-system-prompt` 中的拼接顺序（从上到下）：

1. **Context Preface** — 线程历史消息
2. **Memory Prompt** — `.agenthub/memory/` 记忆内容
3. **Skills Prompt** — SKILL.md 发现的技能上下文
4. **用户指定的 AppendSystemPrompt**

### Prompt 输出格式

```
[AgentHub Memory - project]
- [system (architecture)] This project uses React and TypeScript.
- [user (setup)] Always run tests before committing.

[AgentHub Memory - thread t_abc123]
- [agent] Decided to use CSS Modules for styling.

[AgentHub Memory - agent claude-code]
- [user (preferences)] Use Claude Sonnet for code reviews.

[End of AgentHub Memory]
```

## 关键文件

### Go（Edge Server）

| 文件 | 说明 |
|------|------|
| `edge-server/internal/runnerctx/memory.go` | 记忆读取、解析、prompt 格式化 |
| `edge-server/internal/runnerctx/memory_test.go` | 记忆解析测试 |
| `edge-server/internal/api/handlers.go` | Run 创建时注入记忆 |

### TypeScript（Shared）

| 文件 | 说明 |
|------|------|
| `app/shared/src/memory/types.ts` | 记忆类型定义 |
| `app/shared/src/memory/MemoryFileManager.ts` | 序列化/反序列化/验证/prompt 格式化 |
| `app/shared/src/memory/index.ts` | 模块入口 |

## 未来扩展

- **记忆写入 API** — `POST /v1/memory` 写入/更新记忆条目
- **记忆搜索** — 按标签、时间范围、关键词搜索
- **记忆过期** — TTL 策略，自动清理过时条目
- **记忆合并** — 多个 workspace 的记忆合并策略
- **UI 面板** — Inspector 中查看/编辑记忆的界面
- **记忆版本化** — Git 追踪记忆变更历史
