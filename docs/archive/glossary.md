> 📦 已归档

# AgentHub 术语表

日期：2026-05-21

本文用白话解释 AgentHub 里的常用词，避免同学和后续 Agent 被缩写和工程黑话卡住。

| 术语 | 白话解释 |
|---|---|
| UI | 人使用的界面，包括 Desktop、Web、Mobile。负责展示聊天、运行状态、审批、Diff 和预览。 |
| Hub Server | 中心服务器。负责账号、联系人、群聊、多端同步和中继，不直接运行用户代码。 |
| Edge Server | 靠近项目文件的本地或远程控制节点。负责项目、上下文、Runner 选择、产物元数据和审批决策。 |
| Runner | 执行器。启动 Claude Code、Codex 或 OpenCode，管理 worktree，流式输出日志，生成 Diff 和预览。 |
| CLI Agent | 外部编程 Agent，例如 Claude Code、Codex、OpenCode。AgentHub 负责启动和观察它们。 |
| Edge Node | 能运行 Edge Server 和 Runner 的机器。笔记本、实验室机器、云服务器都可以是 Edge Node。 |
| Desktop Edge | 用户本机运行 UI + Edge Server + Runner 的形态。 |
| Cloud Edge | 云端机器运行 headless Edge Server + Runner 的形态。 |
| Conversation | 聊天容器，可以是单聊或群聊。 |
| Thread | Conversation 里的任务分支。一个 Conversation 可以有多个 Thread。 |
| Turn | Thread 里的一轮用户或 Agent 动作。 |
| AgentRun | 一次真实 Agent 执行。常见状态包括 queued、running、awaiting approval、done、failed、cancelled。 |
| Item | Thread 时间线里的一条记录：消息、日志片段、命令、审批请求、Diff、预览或错误。 |
| Artifact | Agent 产出的对象，例如 Diff、文件快照、日志、截图、预览地址或部署结果。 |
| Approval | 用户在高风险动作前做的决定，例如运行命令、写敏感路径或部署。 |
| Worktree | 一次 AgentRun 专用的隔离 git 工作目录，避免多个 Agent 互相覆盖修改。 |
| Context Builder | Edge 里的上下文组装组件。Runner 启动 Agent 前，由它把规则、记忆、Thread 历史和当前任务整理成输入。 |
| API 契约 | `api/openapi.yaml` 中定义的 REST endpoint、request、response 和错误格式。 |
| 事件契约 | `api/events.schema.json` 中定义的 WebSocket event envelope 和 payload。 |
| Typed Event | 有固定 `type`、`id`、`seq`、`payload` schema 的事件。它不是随便传 JSON，而是有结构、有版本、可回放的事件。 |
| Route Resolver | 连接路径选择器。它决定走本地、SSH/Tailscale 直连，还是 Hub 中继。 |
| 数据通道 | 传输大数据或高频数据的路径，例如日志、文件、Diff、预览和 artifact 下载。英文文档里可写 `Data Plane`。 |
| 控制通道 | 传输命令和状态的路径，例如 start run、stop run、approve command、update status。英文文档里可写 `Control Plane`。 |
| 同步通道 | Edge 和 Hub 之间复制事件和元数据的路径。英文文档里可写 `Sync Plane`。 |
| Local Fast Path | 只在本机模式下使用的快捷路径。Desktop 可凭短期权限从本地 Edge/Runner 读取日志、Diff 和预览。 |
| Hub Relay | UI 或 NAT 后机器无法直连 Edge Node 时，经 Hub 转发控制和数据流。 |
| Agent Profile | Agent 的可见身份：名字、provider、runtime、状态、skills 和当前任务。 |
| Agent Group | 聊天里的 Agent 组合，通常由 Orchestrator 协调。它参考 Multica squads，但 AgentHub 保持 chat-first。 |

## 推荐叫法

- 写“API 契约”和“事件契约”，不要写未解释的英文缩写。
- 谈执行排队时写 `AgentRun queue`。
- 只有在指持久事件历史时写 `EventStore`；WebSocket 只是投递通道。
- 不把 Hub Server、Edge Server、Runner 随意改叫 LocalServer、Daemon 或 Worker。
