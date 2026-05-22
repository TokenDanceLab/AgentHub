# Codex App 对 AgentHub 的参考意义

日期：2026-05-21

## AgentHub 如何使用这份参考

Codex App 是本地 coding-agent 命令中心的产品和架构参考。

AgentHub 应学习：

- App Server 协议层。
- Thread / Turn / Item 流式模型。
- worktree 隔离。
- 可审查的 diff。
- 审批。
- skills / AGENTS.md / 上下文构造。

AgentHub 不应照抄：

- 单 agent 专属假设。
- OpenAI 专属生态假设。
- 纯本地的产品边界。

## 映射

```text
Codex App:
Project -> Thread -> Turn -> Item

AgentHub:
Project -> Conversation -> Thread -> Turn -> Item -> Artifact
             ^
             IM / group / @Agent
```

## 差异

AgentHub 增加：

- Claude Code / Codex / OpenCode adapter。
- IM 群组和 `@Agent` 交互。
- Orchestrator。
- Hub 同步和中继。
- Desktop / Cloud / Lab Edge 节点。
- `.agenthub/` 项目 memory。

## 运行时约束

虽然参考产品可能使用自己的 app-server 实现，但 AgentHub 使用 Go 实现 Hub、Edge 和 Runner。
