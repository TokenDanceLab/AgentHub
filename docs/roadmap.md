# AgentHub 产品路线图

本文只写未来路线、优先级、模块拆分和产品边界。当前分支状态、
提交 SHA、工作区治理、具体派工任务写在仓库根目录 `STATE.md`。

## 产品北极星

AgentHub 要成为跨平台 AI 编码 Agent 的远程控制工作台：

```text
Web / Mobile / IM
  -> Hub 身份、路由、回放、权限
  -> 已注册 Desktop 目标
  -> 本地 Edge sidecar
  -> CLI / Agent SDK / 自定义 Runtime
  -> 类型化事件、产物、审批、执行记录
  -> Web / Mobile / IM 渲染和控制
```

用户体验目标不是“选择运行时下拉框”，而是“在联系人、群聊或工作台
线程里和 Agent 队友协作”。目标健康、运行时、权限、执行计划、差异、
预览和产物都应该出现在同一条任务流里。

## P0：可用远程控制主链

目标：用户可以通过 Web 控制一台 Desktop 目标，由本地 Edge 调用
CLI/SDK Runtime，并把结果回放到 Web。

状态同步：P0 fixture-only 证据门禁固定链路为 Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI/SDK adapter；真实登录、真实 CLI/model、部署、签名和公证仍需审批。

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| IM / @Agent 主链 | Agent/联系人式入口、目标选择、任务输入、启动运行、路由状态、回放面板 | 用户能从一个 Web 页面启动任务，不需要理解后端运行时术语。 |
| Target Health | Hub、Desktop、Web 统一展示目标、运行时、Profile、Workspace 健康 | Web/Desktop 能清楚展示 ready/offline/degraded/missing/signed-out，并给出下一步。 |
| Transcript Blocks | 路由、子任务、权限请求、工具调用、文件变更、产物、预览、失败、完成等类型化时间线 | 用户看到的是结构化工作记录，不是原始 JSON 或控制台噪声。 |
| Approval Loop | Edge 发起权限请求，Web 通过 Hub approve/deny，Edge resume/abort，回放记录决策 | 远程执行危险动作或用户可见动作前可以被控制。 |
| Desktop Local Edge | Desktop 登录、注册目标、启动/诊断 Local Edge、保留日志和 app data、Windows 打包 | Desktop 可以作为本地执行锚点使用，不依赖用户手动开终端。 |
| Mock / Real 分离 | mock、fixture、observed、approved-real、production 模式在 UI 和 gate 中显式标记 | real mode 不能静默降级到 mock。 |
| Product-loop E2E | 本地可复现 E2E 覆盖 Web -> Hub -> Desktop -> Edge -> adapter -> replay -> Web | 发布前有一个聚焦 smoke gate 证明核心产品链路。 |

## P1：真实开发可用性

目标：让远程控制链路足够支撑日常 dogfood，而不是只跑通演示。

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Artifact / Diff / Preview | Transcript 内一等公民的 artifact、diff、preview、file-change 卡片 | 用户可以在任务上下文里检查输出、拟议修改、预览和生成资产。 |
| Edge SQLite 持久化 | Edge Store 从 alpha 进入有迁移保护的 durable 模式 | runs、items、pins、approvals、artifacts、replay state 重启后仍可靠。 |
| Agent SDK / 自定义 Runtime | OpenAI Agents SDK、Claude Agent SDK、OpenCode、CLI Adapter、自定义 Agent 纳入统一 Runtime Registry | 新运行时可注册 metadata、capabilities、icon、approval policy、adapter strategy，不把 provider 规则写死在产品层。 |
| Hub Replay / Event Contract | 稳定 run、route、subtask、approval、artifact、preview、file、failure 事件分类 | Web/Mobile/IM 使用同一事件契约渲染。 |
| Web Real-mode Workbench | Projects、Agents、Targets、Runs、Transcripts、Approvals、Artifacts 全部接 Hub | Web 不再主要依赖 mock 工作台。 |
| Desktop Workspace Control | Workspace picker、trusted boundary、recent projects、sidecar logs、runtime diagnostics、package readiness | Desktop 用户能理解并恢复本地运行状态。 |
| Runtime / Model Icons | 基于 LobeHub 的 provider/model/runtime/tool logo 和稳健 fallback | 模型和运行时界面更专业、更易扫描。 |

## P2：发布和多平台扩展

目标：让 Web、Desktop、Mobile、IM 进入可控 beta。

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Web 部署 | 生产环境变量、OIDC callback、静态构建、Hub API 路由、部署 gate | Web 可以在审批后部署，并有回滚路径。 |
| Windows 安装器 | 先有 unsigned beta package，再进入签名、updater metadata、release upload | Windows 用户可以正常安装和启动 Desktop。 |
| macOS 打包 | sidecar 命名、entitlements、app data 路径、notarization、签名、smoke plan | macOS 不是默认假设兼容，而是有单独验证路径。 |
| TokenDanceID 登录 | Web/Desktop 真实 OIDC 登录、登出、session refresh | 使用 disposable 账号完成真实登录证明，不泄露 secret。 |
| Mobile 协议对齐 | Mobile 消费同一套 Hub target、run、approval、replay 合同 | Mobile 能远程监控和控制，不分叉产品语义。 |
| Feishu / IM 入口 | Feishu/Lark bot 或工作台卡片可以启动/跟随 Hub 任务 | IM 是协作入口，不是第二套登录或 runtime 系统。 |
| Release Governance | 版本号、tag、changelog、artifact、gate、rollback policy | `dev`、`master`、rc tag 都有稳定且可审计的含义。 |

## P3：平台化和生态

目标：让 AgentHub 从单机远控产品扩展为可治理、可扩展的平台。

| 模块 | 路线项 | 完成标准 |
|---|---|---|
| Multi-agent Orchestration | TeamRun plan、worker split、parallel steps、review loops、trace visualization | 用户能观察和控制多 Agent 协作，而不只是看单次运行日志。 |
| Runtime Marketplace | 发布、安装、共享 AgentProfile、Runtime Adapter、Tools、Prompts、Skills | 团队能复用并治理 Agent 能力。 |
| MCP / Tool Registry | 工具 schema、权限、icon、审计行为统一注册 | 工具调用类型化、可审查、可跨 runtime 复用。 |
| Sandbox / Policy | Workspace trust、文件系统边界、approval policy、网络/runtime 约束 | 本地执行能力强但可控。 |
| Observability | correlation id、event search、run diagnostics、logs、metrics、health dashboards | Web、Hub、Desktop、Edge、Runtime 的失败能串起来排查。 |
| Enterprise / Multi-tenant | org、role、audit、quota、workspace ownership、deployment boundary | AgentHub 能从单用户本地 setup 扩到团队和组织。 |

## 负责人模型

| 负责人 | 产品区域 |
|---|---|
| Controller Codex | 总路线图、分支集成、Desktop/Tauri/Local Edge 路径、发布 gate、最终验证 |
| Trump | Web、Mobile 和 shared 前端产品体验 |
| Johnny | Hub、Edge、事件合同、后端路由、持久化 |
| Mobile 执行线程 | 作为 Trump 下属执行线程推进 Mobile app，通过共享 Hub 合同对齐 |
| Evidence/docs 负责人 | 比赛材料、截图、demo、外部报告、提交包 |

## 依赖顺序

1. 冻结干净 baseline 和分支拓扑。
2. 稳定 Hub/Edge event contract 和 approval contract。
3. Web 按合同实现一屏主链。
4. Desktop Local Edge 启动、诊断和打包硬化。
5. 对组合后的栈运行 product-loop E2E。
6. 扩展持久化、SDK/custom runtime、artifact、部署、Mobile/IM 集成。

## 非协商边界

- Web 只和 Hub 通信，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Local Edge 负责本地执行、adapter 调用、runtime policy、日志和证据。
- Mock 和 fixture 模式必须显式；real mode 不能静默降级。
- 真实登录、真实模型消耗、部署、签名、公证、updater、release upload 都需要明确审批。
- Roadmap 只写未来路线；当前事实写在 `STATE.md`。
