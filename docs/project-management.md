# AgentHub 项目管理

日期：2026-05-21

本文记录 GitHub issue、milestone、label 和分支流程的统一规则。项目只有三个人，所以流程要轻，但要能保护 `master` 和关键架构契约。

## Milestones

| Milestone | 含义 |
|---|---|
| M0 architecture contracts | 冻结实现要依赖的架构契约：协议、Go 服务布局、权威边界、数据通道、审批和 workspace 安全、前端实时模型、调研溯源。 |
| M1 desktop command center | 打通本地 Desktop -> Edge -> Runner 主循环，包括 project、thread、AgentRun、worktree、logs、diff、approval、preview。 |
| M2 multi-agent collaboration | 增加 `@Agent`、Orchestrator、reviewer flow，以及多个 Agent 围绕同一个 artifact 协作。 |
| M3 edge-hub sync and remote control | 增加 Edge 注册、同步回放、Web/Mobile 状态查看和远程审批。 |
| M4 relay and cloud execution | 增加 Hub relay、Cloud Edge、Cloud Runner、artifact/preview proxy 和 audit。 |
| M5 team IM and ecosystem | 增加完整用户、联系人、群聊、团队空间、团队 memory 和扩展生态。 |

当前 GitHub milestone：

- `M0 architecture contracts`

## Labels

Labels 按维度组合，不用一个 label 表达所有信息。

| Prefix | 含义 | 示例 |
|---|---|---|
| `kind:` | 工作类型 | `kind:contract`, `kind:docs` |
| `area:` | 影响区域 | `area:protocol`, `area:go-services`, `area:sync`, `area:ui` |
| `priority:` | 对架构或实现的阻塞程度 | `priority:critical`, `priority:high`, `priority:medium` |
| `risk:` | 忽略后可能出的问题 | `risk:protocol-drift`, `risk:sync-conflict`, `risk:security` |

每个 issue 应该有：

- 一个 milestone
- 一个 `kind:` label
- 一个或多个 `area:` label
- 一个 `priority:` label
- 可选 `risk:` label

## Issue 聚合规则

Issue 围绕“架构契约”聚合，不围绕单个 markdown 小修改拆分。

合适的 issue：

- 一个清楚的契约边界
- 明确影响区域
- 可验收的完成标准
- 链接相关文档
- 不混入无关实现任务

避免：

- 每个错别字一个 issue
- 每个未来想法一个 issue
- 同一个协议问题分别给 Hub、Edge、Runner 开重复 issue
- 只有 label，没有验收标准

## Issue / PR 语言和标题

后续新开的 commit、GitHub issue 和 PR 中文为主，标题开头保留规范前缀。

Commit 标题：

```text
docs: 中文化项目入口和文档规范
feat(edge): 实现 WebSocket Hub
fix(runner): 处理子进程超时
```

Issue 标题：

```text
M0: 中文任务名
M1: 中文任务名
```

PR 标题：

```text
docs: 中文变更说明
feat(edge): 中文变更说明
fix(runner): 中文变更说明
```

正文规则：

- 背景、问题、改动、验收标准用中文。
- 代码标识、路径、协议字段、CLI 命令、branch 名保持英文。
- 不写大段聊天过程，只写结论和可执行事项。
- 如果 PR 使用 squash merge，最终 squash commit 标题也使用 `type(scope): 中文摘要`。
- 旧 issue 标题不强制改名；新 issue / PR 按本规则执行。

GitHub 模板：

- `.github/ISSUE_TEMPLATE/task.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

## 分支流程

团队使用轻量 trunk-based workflow。

| 分支 | 规则 |
|---|---|
| `master` | 受保护稳定主线。保持可读、可演示、方便继续开发。 |
| 短工作分支 | 用于代码、协议、服务结构、UI 和有风险文档变更。 |
| 长期个人分支 | 不使用。长期分支会隐藏集成问题。 |

分支命名：

```text
<type>/<short-topic>
```

允许类型：

- `feat/`
- `fix/`
- `docs/`
- `chore/`
- `refactor/`
- `spike/`
- `codex/`

合并策略：

- 代码、协议、服务结构变更走 PR
- 有相关 issue 时链接 issue
- 短分支优先 squash merge
- 合并后删除分支
- 低风险文档和流程清理可由维护者直接处理，但不确定时走 PR

当前 `master` 保护：

- 要求 Pull Request 路径
- required approving reviews: `0`
- required status checks: none
- admins 可紧急绕过
- 禁止 force push
- 禁止删除分支

## 当前 M0 Issues

| # | Issue | 目的 |
|---|---|---|
| 1 | M0: 冻结唯一协议源头、事件分类和类型信封 | 防止 Go 服务和 TypeScript UI 的协议漂移。 |
| 2 | M0: 对齐 Go 服务布局、module 策略和包归属 | 让 `services/` 和 `packages/` 的 Go 导入关系可落地。 |
| 3 | M0: 锁定 authority、EventStore 和数据通道契约 | 分清消息、运行、产物和大数据路径的归属。 |
| 4 | M0: 定义审批策略循环和 workspace 隔离契约 | 让危险命令、路径保护、worktree、apply/discard 可控。 |
| 5 | M0: 对齐前端实时 store 模型和后端协议 | 让 WebSocket events、stores 和生成类型一致。 |
| 6 | M0: 更新调研索引、竞品覆盖和 ByteDance 溯源 | 保持调研、比赛材料和 Multica/Ruflo/Paperclip 定位最新。 |
| 7 | M0: 采用轻量分支和 PR 流程 | 固化轻量分支、PR 和 `master` 保护规则。 |
| 8 | M0: 中文化 AgentHub 自有文档 | 按路线图分批中文化自有文档，供 DeepSeek 等低成本模型执行。 |

## 用词规则

写 issue 和文档时优先用白话：

- 写“唯一协议源头”，不要只写没有解释的缩写。
- 谈执行调度时写 `AgentRun queue`。
- 只有在指持久事件历史时才写 `EventStore`；WebSocket 只是投递通道。
- 只有在 Hub 帮 UI 和 Edge 转发流量时才写 `relay`。
- 只有在讨论 logs、files、diffs、previews、artifact downloads 时才写“数据通道”或 `data plane`。
