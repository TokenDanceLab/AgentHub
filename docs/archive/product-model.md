> 📦 已归档

# AgentHub 产品模型

日期：2026-05-21

## 定位

AgentHub 整合了以下产品形态：

```text
Codex-App 风格的本地 agent 命令中心
+ Multica 风格的 managed agent 生命周期
+ IM 风格的多 Agent 协作
+ Hub-Edge-Runner 网络拓扑
```

Codex App 是本地 coding-agent 产品机制的参考：project threads、turn、item、worktree 隔离、diff review、approval 和上下文构造。Multica 是 agent 身份、runtime 注册、任务生命周期、进度上报、blocker 上报、skills 和团队协作的最高优先级参考。AgentHub 保留本地命令中心的体验，增加 managed agent 生命周期，然后把主要交互放入多 Agent IM 和 Hub 网络。

## 参考优先级

| 参考 | 用途 | 边界 |
|---|---|---|
| ByteDance 简报 | 产品需求权威：IM、群聊、`@Agent`、Orchestrator 和交付物记录 | 比赛材料是产品场景的权威 |
| Multica | Agent 作为队友、agent profile、runtime/daemon 生命周期、任务队列、进度/blocker 上报、skills、前端结构 | 不要变成 Issue/Board 优先；AgentHub 以 Conversation / Thread / Artifact 为起点 |
| Codex App | 本地命令中心机制：thread、turn、item、worktree、diff、approval、context | 不要锁定单一 agent 生态 |
| Emdash / Orca / Jean | Desktop 工作台、worktree、远程机器、diff/preview、移动控制 | 用作工作流参考，不是产品定位 |

## 产品分层

### 1. Desktop Command Center

P0/P1 核心。

职责：

- 本地项目管理
- 项目 thread
- AgentRun 生命周期
- agent profile 和 runtime 状态
- Runner 执行
- worktree 隔离
- diff review
- apply / discard
- approval 卡片
- preview
- `.agenthub/AGENTS.md` 和项目规则

### 2. IM Collaboration

P1/P2 增强。

职责：

- 单聊
- 群聊
- `@Agent`
- Orchestrator
- 多 Agent 审查
- 会话中的进度/blocker 卡片
- 同一 thread 中的多轮对话
- 多个 Agent 围绕同一 artifact 讨论

### 3. Hub Network

P2/P3/P4 长期层。

职责：

- 认证
- 好友
- 群组
- 多端同步
- Edge 中继
- Cloud Edge
- 团队 memory
- 权限审计

## 产品声明

```text
AgentHub Desktop 是基于 Go 的本地多 Agent 命令中心。
AgentHub Hub 是 IM、同步、中继和团队协作扩展。
```

P0 应该给人成熟本地 coding-agent 工作站的体验，而不只是聊天机器人。
