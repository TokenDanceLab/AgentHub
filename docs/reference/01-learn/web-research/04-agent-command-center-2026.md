# 2026 Agent Command Center 补充调研

> 日期：2026-05-21  
> 目的：补齐 AgentHub 当前 M0 架构合同需要参考的仓库。  
> 说明：本文里的“唯一协议源头”指一套权威协议定义，Go 和 TypeScript 都从它生成或对齐，不再手写多套互相漂移的类型。

## 1. 本轮新增克隆仓库

这些仓库已浅克隆到 `reference/`，且 `reference/` 被 `.gitignore` 忽略，不会进入主项目提交。

| 仓库 | 本地路径 | 主要价值 | AgentHub 对应问题 |
|---|---|---|---|
| Charm Crush | `reference/crush/` | Go 写的本地 coding agent，SQLite、权限、hooks、MCP、LSP | Go 服务布局、审批、事件流 |
| Emdash | `reference/emdash/` | 多 CLI agent 并行，每个任务独立 worktree，支持 SSH 远程开发 | Desktop/remote Edge 工作台 |
| Orca | `reference/orca/` | worktree IDE，多 agent 并行、移动配对、remote worktree | 工作台 UX、移动控制台 |
| Jean | `reference/jean/` | Tauri 桌面工作台，worktree、diff、web/headless 访问 | Desktop/Web 统一命令通道 |
| Cline | `reference/cline/` | 审批卡片、工具预览、规则、skills、CLI loop | 审批 UX、规则/技能 |
| ECA | `reference/eca/` | 类 LSP 的 editor-agent 协议，JSON-RPC、SSE、工具审批状态机 | 协议与实时事件命名 |
| Aider | `reference/aider/` | repo map、git diff/undo、lint/test loop | 上下文构造、代码库地图 |
| Continue | `reference/continue/` | 代码检查以 Markdown 定义，CLI/CI 执行并给 PR 状态 | 本地/CI 检查产物 |
| Goose | `reference/goose/` | Desktop + CLI + API，生成协议 schema，权限路由，CLI 子进程适配 | 生成协议、Runner 适配 |
| Roo Code | `reference/Roo-Code/` | Mode 分类、自动审批、命令安全规则 | 模式与权限策略 |
| Ruflo | `reference/ruflo/` | Claude Code 多 agent 编排、插件、memory、federation | 直接竞品、编排上限 |
| Multica | `reference/multica/` | managed agents 平台，agent 作为团队成员，Go 后端、daemon | 直接竞品、团队模型 |

## 2. 总体判断

AgentHub 的方向仍然应该是：

```text
IM 群聊式多 Agent 协作
+ 本地 Agent 开发命令中心
+ Hub-Edge-Runner 远程/多端网络
+ Go 本地控制面
```

新增仓库验证了两件事：

1. **多 agent 产品正在从“聊天壳”转向“开发命令中心”**：Emdash、Orca、Jean 都把 worktree、diff、preview、PR、远程机器放到桌面工作台中。
2. **AgentHub 不能变成 Linear 克隆**：Multica 的核心对象是 Issue 和 Board，AgentHub 的核心对象应该是 Conversation / Thread / Artifact，即“像飞书/微信群聊一样组织 agent 协作”。

## 3. Go 与协议层参考

### 3.1 Crush：Go 本地 agent 的服务拆分

Crush 是 Go 项目，`reference/crush/AGENTS.md` 把核心模块拆得很清楚：

- `internal/app`：顶层装配。
- `internal/agent`：会话 agent。
- `internal/permission`：工具权限。
- `internal/hooks`：工具调用前的 hook。
- `internal/session` 和 `internal/db`：SQLite 持久化。
- `internal/pubsub`：组件间事件。

对 AgentHub 的启发：

- Go 服务不需要过早引入复杂框架，先用清楚的内部包和显式依赖。
- 权限可以先做得简单：请求、等待、允许/拒绝、持久允许列表。
- 事件通道不能直接当历史记录。Crush 的 pub/sub 适合实时通知，但 AgentHub 需要 SQLite/EventStore 做真正可重放历史。

落到 M0：

- `#2` 应该采用现有 `services/hub-server`、`services/edge-server`、`services/runner` 物理目录，不再混用根级 `hub/edge/runner`。
- `#3` 的 EventStore 必须是持久化事件日志，实时 WebSocket 只是投递层。

### 3.2 ECA：协议不要分裂成多套事件名

ECA 的核心价值不是语言栈，而是协议思路：用本地 server 连接 editor/client，并围绕 JSON-RPC、通知、SSE 做统一通信。

它也暴露了一个坑：远程 SSE 事件名和 JSON-RPC 事件名容易分裂。AgentHub 当前也已经出现类似问题：

- 前端文档写 `permission.requested`。
- 后端文档写 `approval.required`。
- 有的地方写 `run.status_changed`。
- 有的地方写 `run.status.changed`。

落到 M0：

- `#1` 必须定义唯一事件名表。
- `#5` 前端只能消费生成出来的 TypeScript 事件类型，不能自己造事件名。

建议冻结第一批事件名：

```text
message.created
thread.created
turn.started
run.started
run.output
run.status.changed
approval.required
approval.resolved
artifact.created
agent.event
edge.connection.changed
```

### 3.3 Goose：生成协议值得学

Goose 的强点是从后端类型生成 schema，再让 UI 使用明确的请求、通知、权限回调类型。

AgentHub 不一定照搬 Goose 的 ACP，但应该学它的原则：

```text
协议先定清楚
Go 和 TypeScript 都从同一份协议出来
UI 不手写另一套字段名
```

落到 M0：

- `#1` 建议直接定：`proto/agenthub/v1` 是唯一协议源头。
- `packages/protocol/go` 和 `packages/protocol/ts` 是生成代码或薄封装。
- JSON Schema / OpenAPI / AsyncAPI 如果需要，作为生成产物或补充文档，不再和 Protobuf 平级竞争。

## 4. 工作台、worktree、diff、preview

### 4.1 Emdash：最接近远程执行形态

Emdash 的 README 明确写：多 CLI agent 并行、每个 agent 独立 git worktree、本地或 SSH 远程机器。它还支持把 Linear/GitHub/Jira/Asana ticket 直接交给 agent，完成后 review diff、创建 PR、看 CI。

AgentHub 可以学：

- 每个 AgentRun 一个 worktree。
- 远程 SSH 和本地走同一套任务模型，只是传输不同。
- Diff / PR / CI 是 Agent 任务完成后的自然出口。

AgentHub 不应该照搬：

- 不要把 ticket/issue board 作为第一屏。
- 不要让任务系统盖过 IM 群聊体验。

### 4.2 Orca：worktree 删除和 remote worktree 的安全细节

Orca 的价值在于把 worktree 当一等对象。它删除 worktree 前会重新确认真实路径、检查是否干净、停止关联进程。

AgentHub 应该把这些写入 `#4`：

```text
删除 worktree 前必须重新解析 canonical path
不能删除主工作区
不能跟随 symlink 逃出 root
删除前要检查未提交变更
删除前要停止对应 Runner/preview 进程
```

### 4.3 Jean：Desktop + Headless Web 的双入口

Jean 的形态对 AgentHub 很有参考价值：桌面端是主入口，但也能 headless 运行并通过 HTTP/WebSocket 暴露 Web UI。

AgentHub 的对应设计：

```text
Desktop UI -> Local Edge
Web/Mobile -> Hub
Edge 可暴露本地 Web 控制台，但必须有 token
```

需要保留的规则：

- Web/Mobile 是控制台，不是执行端。
- 执行仍发生在 Edge/Runner。
- UI 不能直接读任意本地路径。

## 5. 审批、模式、规则、上下文

### 5.1 Cline：审批卡片要能预览风险

Cline 的审批不是一个纯文本弹窗，而是按工具类型展示不同内容：命令、文件读取、文件写入、diff 等。

AgentHub 当前 `ApprovalRequest.detail` 还偏泛。建议补充：

```text
ApprovalPreview
  command preview
  file read preview
  file write preview
  diff preview
  network/deploy preview
```

这样用户不是只看到“是否允许”，而是能判断“允许什么”。

### 5.2 Roo Code / Continue：模式是权限边界

Roo Code 的 Code / Architect / Ask / Debug / Custom Modes 值得参考。Continue 的 normal / plan / auto 也说明：模式不是 UI 标签，而是权限组合。

AgentHub 建议定义：

| Mode | 作用 | 默认权限 |
|---|---|---|
| Ask | 问答、解释、读上下文 | 只读 |
| Plan | 设计方案、拆任务 | 只读 + 可写计划文档 |
| Code | 实现代码 | 可写 worktree，需要审批命令 |
| Debug | 运行测试、读日志、定位问题 | 可执行受控命令 |
| Review | 看 diff、提修改建议 | 只读 diff / artifact |
| Orchestrator | 分派和汇总 | 不直接写文件，调度其他 agent |
| CI | 自动检查 | 无交互，禁止 ask 类操作 |

这应该进入 `docs/approvals.md` 或新增 `docs/modes.md`。

### 5.3 Aider：repo map 应作为 P1 上下文能力

Aider 的 repo map 证明：大仓库里不能只塞最近聊天记录，需要一个便宜的代码结构摘要。

AgentHub 建议分两级：

1. P0：读 `.agenthub/AGENTS.md`、`RULES.md`、最近 Thread Items、当前 diff。
2. P1：加入 repo map，也就是“代码库地图”。
3. P2：可选向量索引，不要一开始强依赖。

### 5.4 Continue：检查应该是产物

Continue 把检查写成 Markdown 文件，运行后变成 PR 状态和建议 diff。AgentHub 可以把检查建模为 Artifact：

```text
CheckRun
  input: diff / branch / artifact
  output: pass/fail + findings + suggested patch
```

这对比赛交付很有用：能展示 AI 协作不仅能写代码，还能自动 review 和验证。

## 6. 直接竞品：Multica 与 Ruflo

### 6.1 Multica：最强“项目管理式 agent 平台”

Multica 的强点：

- Agent 是一等团队成员。
- 可以被分配 issue。
- 会报告进度和 blocker。
- 有 cloud/self-host/daemon/runtime。
- Go 后端 + WebSocket + daemon 模型和 AgentHub 有相似处。

AgentHub 应该学：

- actor 字段要能表示 human / agent。
- agent profile、状态、技能、运行中任务要可见。
- daemon/runtime 注册模型。

AgentHub 不应该学：

- 不要把 Issue/Board 放成第一屏。
- 不要弱化聊天流和群聊协作。

差异化表述：

```text
Multica = 把 agent 变成 issue board 上的队友
AgentHub = 把 Claude Code / Codex / OpenCode 拉进 IM 群聊一起完成产物
```

### 6.2 Ruflo：编排很强，但表面复杂

Ruflo 的强点：

- 多 agent swarm。
- 插件。
- memory。
- federation。
- hooks。

AgentHub 应该学：

- 插件/技能分层。
- Planner / Worker / Judge 这类结构化调度。
- 信任边界、预算、熔断。

AgentHub 不应该学：

- 不要把大量命令和工具暴露给普通用户。
- 不要把 federation 作为人类用户要理解的核心概念。

差异化表述：

```text
Ruflo = Claude Code 的复杂编排层
AgentHub = 人能看懂、能审批、能协作的 IM 工作台
```

## 7. 对当前 M0 issues 的影响

### #1 协议

建议：

- 采用 `proto/agenthub/v1` 作为唯一协议源头。
- 事件名一次冻结。
- 删除核心事件里的 `*_json`。
- Go 和 TypeScript 都从协议生成。

### #2 Go 服务布局

建议：

- 使用现有 `services/*` 结构。
- 一个根 Go module 更适合当前阶段。
- `checkpoint-core` 和 `tool-core` 要么正式新增，要么职责并入已有包。

### #3 Authority / EventStore / Data Plane

建议：

- WebSocket 只是投递，不是历史。
- EventStore 必须能重放、去重、断线恢复。
- artifact metadata 和 artifact bytes 分开管。

### #4 Approval / Workspace

建议：

- 审批卡片需要结构化 preview。
- 模式要绑定权限。
- worktree 删除、apply、discard 都要有路径保护和冲突事件。
- Windows PowerShell 命令也要有安全解析规则。

### #5 Frontend realtime

建议：

- 前端只用生成事件类型。
- 一个对象只归一个 store 管，其他 store 做派生视图。
- 每个实时事件必须有 `eventId`、`seq`、`sentAt`。

### #6 Research / Competition

建议：

- 把本轮 12 个仓库加入参考索引。
- 单独写 ByteDance 交付矩阵。
- 竞品对比里补 Multica / Ruflo 的真实定位差异。

## 8. 后续建议

接下来不要继续扩展仓库数量。更有价值的是关 M0 的前两个问题：

1. 统一协议源头。
2. 统一 Go 服务布局。

然后再把工作台闭环写成 M1：

```text
Project -> Thread -> AgentRun -> Worktree -> Logs -> Diff -> Approval -> Preview -> Apply/Discard
```

这条线能同时满足：

- ByteDance 的 IM 核心体验。
- 多 Agent 协作。
- 产物预览与编辑。
- 可运行 Demo。
- 后续 Hub/Remote/Cloud 扩展。
