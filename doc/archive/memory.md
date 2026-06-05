> 📦 已归档

# AgentHub Memory 和 Context

日期：2026-05-21

## 原则

AgentHub 使用 `.agenthub/` 作为人类可读的项目 memory 和上下文输入。

P0 使用确定性文件加载。检索和向量搜索可以后续再做。

## 项目布局

```text
.agenthub/
  PROJECT.md
  ARCHITECTURE.md
  RULES.md
  AGENTS.md
  DECISIONS.md
  SKILLS/
    frontend-review.md
    diff-review.md
    static-deploy.md
```

## Context Builder

在调用 Agent 之前，Edge 从以下来源构造上下文：

```text
System Prompt
+ Agent Profile
+ .agenthub/AGENTS.md
+ .agenthub/RULES.md
+ 相关 SKILLS
+ 当前 Project
+ 当前 Thread 摘要
+ 最近的 Items
+ 当前 workspace 状态
+ 当前用户请求
```

## P0 范围

P0 加载：

- `.agenthub/AGENTS.md`
- `.agenthub/RULES.md`
- 当前 Thread 的最近 Items
- 当前 diff / 变更文件（可用时）

P1 可以增加：

- Thread 摘要
- 置顶消息
- memory 更新建议
- skill 选择

## 写入规则

自动 memory 写入应先产生建议卡片。确认后的写入更新 Memory Authority 所有者。
