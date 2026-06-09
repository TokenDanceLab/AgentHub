# AgentHub 产品路线图

本文只写未来路线、优先级、模块拆分和产品边界。当前分支状态、
已合入提交、工作区治理和临时派工写在仓库根目录 `STATE.md`。

## 产品北极星

AgentHub 要成为 IM 形态的多 Agent 协作工作台。用户面对的是联系人、
群聊、项目会话、Agent 队友、审批、Diff、Preview 和产物，而不是一组
Runtime 下拉框。

```text
Web / Desktop / Mobile / IM
  -> Hub 身份、会话、联系人、群聊、权限、路由、回放
  -> Execution Target: Local Edge / Remote Edge / Cloud Edge / Hub Relay
  -> Edge Runtime adapter: Claude Code / Codex / OpenCode / SDK / Custom
  -> 类型化事件、审批、Diff、Preview、Artifact、执行记录
  -> 同一条 IM 任务流渲染和控制
```

产品判断标准：

- Agent Profile 回答“谁来做事”，Agent Runtime 回答“用什么执行”。
- IM 是核心体验：单聊、群聊、`@Agent`、Orchestrator 分派和上下文连续必须在同一条任务流里成立。
- 产物必须内联：代码 Diff、网页预览、文件附件、审批、部署状态和生成资产不应散落在日志或后台页面。
- Web 远控、Desktop 本地执行、Mobile/IM 审批查看使用同一 Hub/Edge 事件合同。
- mock、fixture、observed、approved-real、production 必须显式区分；真实登录、真实 CLI/model/API、部署、签名、公证和 release upload 都需要明确审批。

## 近期收敛目标

近期优先把“可讲清、可操作、可复验”的主链收紧。路线图只写产品路线、
优先级和边界；当前事实写入 `STATE.md`。

### P0：一屏远控主链可用

目标：用户在 Web 或 Desktop 的 IM 工作台里选择 Agent 和目标设备，发送任务，
看到路由、执行、审批、Diff、Preview、Artifact 和完成状态回放。没有真实
Hub/Target/Task 数据时必须显式空态或错误态，不能静默回 demo。

| 方向 | 路线项 | 完成标准 |
|---|---|---|
| IM / @Agent 主链 | 单聊、项目群、`@Agent`、Orchestrator route decision、消息 pin、目标选择和启动按钮收敛到一屏主链 | 用户不用理解 Runtime 术语，也能知道当前 Agent、Target、Task 是否可启动、排队、执行或失败。 |
| Web real-mode Workbench | Web 只通过 Hub 消费 `agent-tasks`、target、approval、artifact、diff 和 replay 合同 | real mode 下没有 Hub/target/task 数据时显示清楚的 empty/error；demo/mock/fixture 标识明确。 |
| Desktop Local Edge 目标 | Desktop 能展示 Local Edge、device、target 注册/同步、sidecar readiness、SQLite app-data 路径和诊断 | Web 远控前能判断目标是否在线、是否匹配当前 Desktop、是否缺 sidecar 或登录。 |
| Hub 单任务合同 | 单任务 approval decision、artifact list、file-change diff metadata、owner scope、exact target/device control 稳定 | Web/IM/Mobile 后续不需要为 TeamRun 和单任务维护两套控制语义。 |
| Edge 执行事件 | CLI/SDK/fixture adapter 输出统一映射到 typed transcript event、approval、file-change、artifact、result | 不执行真实模型也能复验协议形状；真实 CLI/model/API 进入 approved-real 之后再开。 |
| Artifact / Diff / Preview | inspector 能展示 artifact、file-change diff、edit/review/apply/revert metadata 和 preview 入口 | 用户能在聊天上下文内检查产物和差异；近期只做只读投影，不承诺真实 apply/revert 写文件。 |
| Approval Loop | approval request、decide、resume/abort 语义贯通到 UI 和 Hub/Edge 事件 | 高风险动作前可远程 approve/deny，决策进入 transcript/replay。 |
| No-secret readiness | 真实登录或真实 CLI 前先跑无密 readiness/preflight gate | 输出只包含脱敏 manifest、环境缺口和审批状态，不记录 token、密码、client secret、cookie 或生产路径。 |

### P1：演示稳定和 dogfood 可用

目标：把 P0 主链从“能看懂”推进到“能日常试用”，重点补持久化、健康、
本地服务组合和 Agent 配置能力。

| 方向 | 路线项 | 完成标准 |
|---|---|---|
| Product-loop E2E | Web -> Hub -> Desktop -> Local Edge -> adapter -> replay -> Web 的 observed/fixture gate 变成常用 smoke | 一条命令能复跑主链，明确 `real_tested`、mock adapter 和 no-spend 边界。 |
| Localhost service runner | Web dev server、Hub、Local Edge mock/SQLite、service probe、health manifest 可组合启动或探测 | 本地真实服务子集可逐步替换 fixture；失败时能定位是 Web、Hub、Edge、target 还是 adapter。 |
| Edge SQLite durable | SQLite store readiness、迁移、row-first restore、per-write reopen 和 replay projection 持续硬化 | runs、items、pins、approvals、artifacts、replay state 重启后可靠，且仍标明 alpha/durable 边界。 |
| Agent Profile / Builder | AgentSpec、Profile、market fixture、runtime/model/provider、Skill、MCP、tool allowlist、memory、approval policy、target preference 形成配置闭环 | 用户看到的是可管理 Agent 队友；Hub 持久化、安装/发布 mutation 和头像资产管线作为下一批后端合同。 |
| Runtime / SDK 扩展 | Claude/OpenAI SDK-like、OpenAI-compatible/custom、Codex、Claude Code、OpenCode 都进入统一 capability matrix | 新 runtime 通过 manifest、capabilities、icon、approval policy、event mapper 接入，不把 provider 规则写死在产品层。 |
| Target Health | Hub、Desktop、Web 统一 ready/offline/degraded/missing/signed-out/pagination-limited 等状态 | 用户能知道是缺登录、缺 Desktop、缺 Edge、缺 runtime、target mismatch 还是 Hub inventory 不完整。 |
| Windows package smoke | unsigned/dev package、sidecar placement、dry package gate、Windows 启动诊断可复验 | 不签名、不上传 release；只证明本地打包前置条件和失败边界。 |
| 文档收敛 | Roadmap 只写路线，STATE 只写当前事实，architecture 只写结构边界 | 评审、开发者和 Agent 不再被多套状态叙事误导。 |

### P2：发布前置和多端入口

目标：为可控 beta 做准备，但不抢在主链稳定前承诺生产发布。

| 方向 | 路线项 | 完成标准 |
|---|---|---|
| TokenDanceID 登录 | Web/Desktop OIDC readiness、callback、Hub session、logout/refresh 缺口清单和无密 gate | 真实账号、真实 client 和录屏范围经审批后再测；文档只保留公开配置名和脱敏结论。 |
| Mobile 协议对齐 | Mobile 只消费 Hub target/run/approval/replay 合同，不分叉 runtime 或登录语义 | Mobile 可作为轻量查看、审批、预览入口；不抢 Desktop/Web v4 主线端口。 |
| Feishu / IM 入口 | 飞书/Lark bot、事件、卡片、工作台/H5 只作为协作入口 | 飞书 OAuth/account binding 仍归 TokenDanceID；卡片回调快返，慢任务异步入队。 |
| Web deployment readiness | 环境变量、OIDC callback、静态构建、Hub API route、rollback gate 明确 | 只在审批后部署；不把生产 endpoint、secret 或私有路径写入仓库。 |
| macOS package path | sidecar 命名、app data、unsigned DMG smoke、entitlements、notarization plan 拆清 | 不假设 Windows 结果自动覆盖 macOS。 |
| Release governance | rc tag、changelog、artifact、gate、rollback policy 和 open blocker 状态一致 | `dev`、`master`、rc tag 的含义稳定且可审计。 |

## 长期路线

### Phase A：IM 多 Agent 产品闭环

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Conversation Model | 单聊、群聊、项目会话、联系人、群成员、置顶、归档、搜索、最近活动 | IM 列表和消息流可承载真实日常工作，而不是 demo fixture。 |
| Orchestrator | 复杂任务拆解、子 Agent 分派、并行/串行策略、失败降级、聚合回复 | 群聊里多个 Agent 像队友一样协作，route decision 可解释、可回放。 |
| Context Continuity | 会话历史、pinned messages、workspace context、memory、AGENTS.md、Skill/MCP 输入统一 | Agent 能基于历史迭代，不靠用户重复粘贴上下文。 |
| Message Actions | 回复、引用、重新生成、复制、pin、一键检查 Diff、打开预览 | 常用 IM 操作和开发操作在同一消息模型下成立。 |

### Phase B：Runtime / Agent 平台化

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Runtime Registry | Claude Code、Codex、OpenCode、OpenAI Agents SDK、Claude Agent SDK、OpenAI-compatible/custom runtime | 每个 runtime 有 metadata、capability、icon、adapter strategy、approval policy 和健康检查。 |
| Agent Profile Store | Hub 持久化 Profile、模板、市场安装、团队可见性、版本和审计 | Agent 是可管理实体，不只是 fixture 卡片或 runtime alias。 |
| Custom Agent Builder | 名称、头像、system prompt、runtime/model、skills、MCP、tools、memory、approval、target preference | 用户可以创建自己的 Agent 队友并在 IM 中使用。 |
| MCP / Tool Registry | tool schema、权限、icon、审计、运行时兼容矩阵 | 工具调用类型化、可审查、可跨 runtime 复用。 |

### Phase C：远程执行和协作网络

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Target Routing | Local Edge、Remote Edge、Cloud Edge、Hub Relay target 的注册、心跳、exact-device dispatch 和降级 | Web/Mobile/IM 能稳定控制正确目标，失败时给出可操作修复建议。 |
| Hub Replay / Sync | run、route、subtask、approval、artifact、preview、file、failure 事件统一同步 | Web、Desktop、Mobile、IM 用同一事件契约渲染。 |
| Permissions / Audit | Hub-local org/project membership、resource/action check、device proof、审批审计 | TokenDance ID 只证明身份；AgentHub 自己决定能做什么。 |
| Remote Approval | Mobile/IM/Web 远程 approve/deny、watch、pause、abort | 用户离开 Desktop 也能控制关键执行节点。 |

### Phase D：产物、预览和交付

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Artifact Store | 文件、网页、文档、报告、图片、包、日志摘要统一索引 | 产物能按项目、会话、run、Agent 查找和预览。 |
| Diff / Apply | 只读 diff、review、apply/revert、冲突提示、版本历史 | 用户能安全检查并应用 Agent 修改。 |
| Preview Providers | 本地网页、静态站、文档、PPT、图片、代码、外部 provider 只读预览 | 产物内联可看、可追溯，编辑能力按 provider 分层实现。 |
| Deployment | 预览 URL、静态站、容器化、源码包、状态卡片 | 部署是可审批的产物动作，不是隐藏脚本。 |

### Phase E：发布、观测和企业治理

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Cross-platform Release | Windows installer、macOS package、Web deploy、Mobile beta、updater 和 rollback | 每个平台都有独立 smoke、签名/公证策略和发布门禁。 |
| Observability | correlation id、event search、run diagnostics、logs、metrics、health dashboard | Web、Hub、Desktop、Edge、Runtime 的失败能串起来排查。 |
| Multi-tenant | org、role、quota、workspace ownership、audit export、deployment boundary | 从单用户本地 setup 扩展到团队和组织。 |
| Evidence Consumption | 从 product gates 输出可复验、脱敏、可引用的开发证据 | 后续演示或验收流程消费这些输出；路线图不记录明细。 |

## 依赖顺序

1. 稳定 Hub/Edge event、approval、artifact、target health 和 Agent Profile 合同。
2. Web/Desktop shared workbench 按合同实现一屏 IM 主链。
3. Desktop Local Edge 启动、诊断、sidecar、SQLite app-data 和 exact target 绑定硬化。
4. Edge CLI/SDK/custom runtime adapter 统一输出 typed events。
5. Product-loop observed/fixture E2E 覆盖 Web -> Hub -> Desktop -> Edge -> adapter -> replay。
6. 经审批后推进真实 TokenDanceID 登录、真实 CLI/model/API、部署、签名、公证和 release。
7. 扩展 Mobile/IM、Agent marketplace、MCP/tool registry、TeamRun 编排和企业治理。

## 非协商边界

- Web 只和 Hub 通信，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Local Edge 负责本地执行、adapter 调用、runtime policy、日志和证据。
- Hub 负责账号、IM、同步、路由、权限、审计和远程控制面。
- Agent Profile、Agent Configuration、Agent Runtime 和 Execution Target 必须保持术语分离。
- Mock 和 fixture 模式必须显式；real mode 不能静默降级。
- 真实登录、真实模型消耗、部署、签名、公证、updater、release upload 都需要明确审批。
- Roadmap 只写路线；当前事实写在 `STATE.md`。
