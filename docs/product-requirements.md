# AgentHub 产品需求文档

## 1. 产品定位

AgentHub 是一个 IM 形态的多 Agent 协作平台。

用户像在飞书/微信里拉群协作一样，把 Claude Code、Codex、OpenCode、Reviewer、Orchestrator 等 Agent 放进同一个项目会话，让它们围绕网页、代码、Diff、Preview 和部署结果协作。

一句话：

```text
AgentHub = 本地 Agent 工作台 + IM 式多 Agent 协作 + Hub 网络同步与中继
```

## 2. 目标用户

| 用户 | 需求 |
|---|---|
| 学生/开发者 | 在本地项目里让 Agent 写代码、审查 Diff、启动预览 |
| 小团队 | 像群聊一样组织多个 Agent 协作完成任务 |
| 比赛评审 | 快速看懂产品定位、技术路线、可演示流程和 AI 协作记录 |
| 后续 Agent | 根据文档继续拆任务、补接口、写实现 |

## 3. 核心体验

P0/P1 的第一屏不是普通聊天软件，而是 Agent 工作台：

```text
左侧：Project / Thread
中间：IM 消息流、Agent 进度、审批卡片
右侧：Changed Files / Diff / Preview / Logs / Artifact
底部：输入框，支持 @ClaudeCode / @Codex / @OpenCode
```

核心演示流：

1. 用户选择一个本地项目。
2. 新建 Thread，并 @ClaudeCode 提交任务。
3. Edge 创建 AgentRun。
4. Runner 启动 Agent CLI。
5. UI 实时显示日志、进度、审批请求。
6. Runner 生成 Diff 和 Artifact。
7. 用户查看 Diff、Apply 或 Discard。
8. Preview 展示结果。

## 4. 产品分层

| 层 | 阶段 | 说明 |
|---|---|---|
| Desktop Command Center | P0 | 本地项目、Thread、AgentRun、worktree、Diff、Approval、Preview |
| IM Collaboration | P1 | 单聊、群聊、@Agent、Orchestrator、多 Agent 审查 |
| Hub Network | P2-P4 | 账号、好友、群聊、多端同步、Edge 中继、Cloud Runner |

## 5. P0 必须具备

- Project 列表。
- Thread 列表。
- 一个 Thread 启动一个 AgentRun。
- Runner 启动 Claude Code 或 Codex CLI。
- stdout/stderr 以 Item 形式流式显示。
- git worktree 或等价隔离机制。
- 文件变更检测。
- Diff 查看。
- Apply / Discard。
- Approval 卡片。
- Preview 面板。
- `.agenthub/` 项目规则读取。

## 6. P1-P4 规划

| 阶段 | 目标 | 能力 |
|---|---|---|
| P1 | 多 Agent Thread | @Agent、Reviewer、Orchestrator、Thread fork、多 Agent 围绕同一 Artifact 讨论 |
| P2 | Edge-Hub Sync | Edge 注册、设备状态、消息/事件同步、Web/Mobile 查看状态和远程审批 |
| P3 | Relay / Cloud | Hub 中继、Cloud Edge、Cloud Runner、远程 Preview、Artifact Proxy |
| P4 | 团队 IM | 用户、联系人、群组、团队空间、团队 Memory、组织权限 |

## 7. 非目标

- P0 不做完整好友系统。
- P0 不做移动端原生执行。
- P0 不做完整 SaaS 多租户。
- P0 不做插件市场。
- AgentHub 不绑定单一 Agent 生态，Claude Code、Codex、OpenCode 都要保留适配空间。

## 8. 比赛交付对应

| 交付物 | 仓库位置 |
|---|---|
| 产品设计文档 | 本文 |
| 技术架构文档 | `docs/system-architecture.md` |
| 功能实现文档 | `docs/implementation-guide.md` |
| API 契约 | `api/` |
| 调研材料 | `docs/reference/`、`docs/research/`、`docs/archive/` |
