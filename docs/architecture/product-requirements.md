# AgentHub 产品需求文档

## 1. 产品定位

AgentHub 是一个 IM 形态的多 Agent 协作平台。

用户像在飞书/微信里拉群协作一样，把 Reviewer、Builder、Orchestrator 等 Agent Profile 放进同一个项目会话，让它们围绕网页、代码、Diff、Preview 和部署结果协作。Claude Code、Codex、OpenCode 是这些 Profile 可选择的 Agent Runtime，不等同于一个完整业务 Agent。

一句话：

```text
AgentHub = 本地 Agent 工作台 + IM 式多 Agent 协作 + Hub 网络同步与中继
```

当前仓库已完成 P0-P3 全部任务，M3b 与 M4 均已交付。全链路已跑通：

```text
Desktop UI -> Local Edge -> Edge lifecycle -> Agent Runtime Adapter (Claude Code / OpenCode / Codex) -> WebSocket events -> UI
```

P0 完整闭环已实现：本地项目、Thread、真实 Agent Runtime adapter、Diff、Apply / Discard、Approval 和 Preview。旧文档中的 Runner 指 Edge lifecycle + AgentAdapter，不再是独立产品组件。

## 2. 目标用户和场景

| 用户 | 核心需求 | 场景级验收 |
|---|---|---|
| 学生/开发者 | 在本地项目里让 Agent 写代码、审查 Diff、启动预览 | 能选择本地项目，创建 Thread，启动一次 AgentRun，并看到日志、Diff 和 Preview |
| 小团队 | 像群聊一样组织多个 Agent Profile 协作完成任务 | 能在同一个 Thread 中 @Agent Profile，查看不同 Agent 的进度、产物和审查意见 |
| 比赛评审 | 快速看懂产品定位、技术路线、可演示流程和 AI 协作记录 | 能启动 Local Edge/Desktop，创建 AgentRun，看到 WebSocket 事件和 UI 实时更新，并理解 P0-P3 全部完成的状态 |
| 后续 Agent | 根据文档继续拆任务、补接口、写实现 | 能从 README、本文、系统架构、实现指南定位当前阶段和下一步任务 |

## 3. 核心体验

P0/P1 的第一屏不是普通聊天软件，而是 Agent 工作台：

```text
左侧：Project / Thread
中间：IM 消息流、Agent 进度、审批卡片
右侧：Changed Files / Diff / Preview / Logs / Artifact
底部：输入框，支持 @Agent Profile，详情显示 Runtime / Model / Execution Target
```

用户直接选择和管理的是 Agent Profile。Profile 由 Agent Runtime、模型、Agent Configuration、Workspace、Skill/MCP、审批策略和 Execution Target 组成。Agent Configuration 包含 `AGENTS.md`、Agent memory、上下文、聊天记录、工作目录、skills、MCP、模型参数和审批策略。Execution Target 必须能区分本地、远程 SSH/Tailscale、云端和 Hub relay。

### 当前可演示流

1. 启动 Local Edge。
2. 打开 Desktop Web UI。
3. UI 显示 Edge 在线状态、Agent 列表、项目列表。
4. 用户输入 prompt 并选择 Agent Profile；Profile 详情显示 Runtime（Claude Code / OpenCode / Codex）、模型和执行目标。
5. Edge lifecycle 按 Profile 配置启动真实 Agent CLI，实时流式输出。
6. UI 通过 WebSocket 接收事件流，显示 Markdown、Tool Call 卡片、Diff 内联。

### 完整 P0 演示流

1. 用户选择一个本地项目。
2. 新建 Thread，并 @Reviewer、@Builder 或其他 Agent Profile 提交任务。
3. Edge 创建 AgentRun。
4. Edge lifecycle 调用对应 Runtime adapter 启动真实 Agent CLI。
5. UI 实时显示日志、进度、审批请求。
6. Agent CLI 在隔离 workspace 或 worktree 中生成变更。
7. UI 展示 changed files、Diff 和 Artifact。
8. 用户 Apply 或 Discard。
9. Preview 展示结果。

## 4. 产品分层

| 层 | 阶段 | 说明 |
|---|---|---|
| Desktop Command Center | P0 | 本地项目、Thread、AgentRun、worktree、Diff、Approval、Preview |
| IM Collaboration | P1 | 单聊、群聊、@Agent Profile、Orchestrator、多 Agent 审查 |
| Hub Network | P2-P4 | TokenDance ID、账号、好友、群聊、多端同步、Edge 中继、Remote/Cloud Edge |
| Agent Platform | P2-P4 | Agent 市场、Skill/MCP 管理、模型配置、模型映射、cc-switch provider binding、安全审计 |

P1 之后都是增强能力，不阻塞 P0 本地离线闭环。P0 必须做到不依赖 Hub 也能在本机完成 Agent 工作台体验。

## 5. P0 功能验收

| 能力 | 怎样算完成 |
|---|---|
| Project 列表 | UI 能列出并打开本地项目，Edge 能保存项目元数据 |
| Thread 列表 | 每个 Project 下能创建、读取和切换 Thread |
| AgentRun | 一个 Thread 能启动一次 AgentRun，并有 queued/running/done/failed/cancelled 状态 |
| Runtime adapter | Edge 能通过 AgentAdapter 启动 Claude Code / Codex / OpenCode 等真实 Agent Runtime |
| stdout/stderr | Agent Runtime 输出能以 Item 或 event 形式流式显示，并可回放 |
| workspace 隔离 | 每个 run 有独立 workspace 或 worktree，不污染主工作区 |
| changed files | run 结束后能检测文件变更列表 |
| Diff 查看 | UI 能展示文本 Diff，并关联到对应 run/artifact |
| Apply / Discard | 用户能把变更应用回主工作区，或丢弃本次 run |
| Approval 卡片 | 危险命令、文件写入或部署动作会生成审批请求，用户可接受或拒绝 |
| Preview 面板 | Agent Runtime 或 Edge 能启动预览，并通过 UI 打开 |
| `.agenthub/` 规则读取 | Edge Context Builder 能读取项目规则、Agent 说明和基础记忆 |

## 6. P0 非功能验收

| 要求 | 怎样算完成 |
|---|---|
| 本地优先 | 断网时 Desktop -> Local Edge -> Agent Runtime adapter 的主流程仍可运行 |
| 可审查 | Agent 产生的命令、输出、Diff、Approval、Apply/Discard 都有记录 |
| 可恢复 | Edge 重启后 Project、Thread、Run、Item、Artifact 的关键状态可恢复 |
| 安全 | 不打印 token、cookie、私钥、本机敏感路径或真实服务器隐私 |
| 路径保护 | Agent Runtime 只能在授权 workspace 内读写，不默认访问用户全盘 |
| adapter 可扩展 | Codex CLI、Claude Code、OpenCode 通过同一 AgentAdapter 模型接入 |
| 可测试 | Go tests、前端单测、Playwright e2e、client smoke 能覆盖 P0 高风险链路 |

## 7. P1-P4 规划

| 阶段 | 目标 | 能力 | 状态 |
|---|---|---|---|
| P1 | 多 Agent Thread | @Agent、Reviewer、Orchestrator、Thread fork、多 Agent 围绕同一 Artifact 讨论 | 已完成 |
| P2 | Identity + Edge-Hub Sync | TokenDance ID OIDC 登录、Hub session、Edge 注册、设备状态、消息/事件同步、Web/Mobile 查看状态和远程审批 | 规划中（Q3） |
| P3 | Relay / Remote / Cloud | Hub 中继、本地/远程 SSH/Tailscale/Cloud Execution Target、远程 Preview、Artifact Proxy、远控审批 | 规划中（Q3） |
| P4 | 团队 IM + Agent Platform | 用户、联系人、群组、团队空间、团队 Memory、Agent 市场、Skill/MCP 管理、模型配置、模型映射、cc-switch provider binding、安全审计 | 规划中 |

Hub Network、Web/Mobile、团队账号和多人 IM 都是 P1+ 能力，不作为本地 P0 的验收条件。

## 8. 非目标

- P0 不做完整好友系统。
- P0 不依赖 Hub 同步、中继或团队账号。
- P0 不做移动端原生执行。
- P0 不做完整 SaaS 多租户。
- P0 不做 Agent 市场和团队级 Skill/MCP 分发。
- AgentHub 不绑定单一 Agent 生态，Claude Code、Codex、OpenCode 都要保留适配空间。

## 9. 比赛交付对应

| 交付物 | 仓库位置 |
|---|---|
| 产品设计文档 | 本文 |
| 技术架构文档 | `docs/architecture/system-architecture.md` |
| 功能实现文档 | `docs/architecture/implementation-guide.md` |
| API 契约 | `api/` |
| 调研材料 | `docs/reference/` 为实现阶段主索引，`docs/archive/` 保存旧方案和历史补充 |

当前演示验收：

```text
启动 Local Edge
-> 打开 Desktop UI
-> 选择 Agent Profile（详情显示 Claude Code / OpenCode / Codex Runtime、模型和 Target）
-> 输入 prompt
-> 看到实时流式输出、Tool Call 卡片、Diff 内联
-> 三大 Agent E2E 各 5/5 通过
```
