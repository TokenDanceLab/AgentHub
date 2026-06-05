> 📦 已归档

# AgentHub 实现计划

日期：2026-05-21

## 运行时约束

Hub Server、Edge Server 和 Runner 从 P0 起使用 Go 实现。

没有 Node.js 后端原型计划。TypeScript 只用于 UI 和生成的协议类型。

## P0：Desktop 本地命令中心

目标：

```text
Desktop UI -> Local Edge Server -> Local Runner -> Claude Code / Codex
```

必须演示：

- 项目列表。
- Thread 列表。
- 一个 Thread 启动一个 AgentRun。
- Agent profile 和 runtime 状态在 run 开始前可见。
- Runner 启动 Claude Code 或 Codex CLI。
- stdout/stderr 作为 Item 流式输出。
- git worktree 隔离。
- 文件变更检测。
- Diff 查看器。
- Apply / Discard patch。
- Approval 卡片。
- Thread 中展示进度、blocker 和错误卡片。
- `.agenthub/AGENTS.md` 上下文。

不在 P0：

- 好友。
- 完整群聊。
- 移动客户端。
- Hub Relay。
- Cloud Edge。
- 多租户权限。
- Plugin marketplace。

## P1：多 Agent Thread

目标：

```text
一个 Thread，多个 Agent Turn。
```

增加：

- `@ClaudeCode` 实现。
- `@Codex` 审查。
- `@OpenCode` 替代方案。
- Orchestrator 摘要。
- Reviewer 读取 diff artifact。

## P2：Edge-Hub 同步

目标：

```text
Edge <-> Hub
Web/Mobile -> Hub 状态查看
```

增加：

- Hub Server。
- Edge 注册。
- 设备在线/离线。
- EdgeEvent 同步。
- Artifact 元数据同步。
- 会话摘要同步。
- 从 Web/Mobile 远程审批。

## P3：Hub Relay 和 Cloud Edge

目标：

```text
Web/Mobile -> Hub -> Desktop/Cloud Edge -> Runner
```

增加：

- Hub Relay。
- Cloud Edge。
- Cloud Runner。
- 权限审计。
- 远程 run 启动。
- Preview Hub Proxy。

## P4：完整 IM 协作

目标：

```text
团队 IM + 多 Agent 协作
```

增加：

- 用户。
- 好友。
- 群组。
- 团队空间。
- agent 联系人。
- 完整多端同步。
- 团队 memory。
- 组织权限。
