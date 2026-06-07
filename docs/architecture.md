# AgentHub 架构文档

> 最后更新：2026-06-07 | 当前架构基准：Desktop/Web v4 shared workbench clean rebuild

## 1. 产品定位

AgentHub 是 IM 形态的多 Agent 协作平台。用户像在飞书/微信里拉群协作一样，把 Builder、Reviewer、Researcher、Deployer、Orchestrator 等 Agent Profile 放进同一个项目会话，让它们围绕代码、文档、Diff、Preview、Approval、产物和部署结果协作。

```text
AgentHub = shared IM workbench + local/remote Agent execution + Hub collaboration network
```

Claude Code、Codex、OpenCode 是 Agent Runtime，不是用户直接管理的业务 Agent。用户选择的是 Agent Profile；Profile 再绑定 Runtime、模型、上下文、Skill/MCP、审批策略和 Execution Target。

## 2. 当前架构决策

1. Desktop/Web 使用同一套 v4 UI 工作台，不再维护两套主聊天界面。
2. `agenthub-design/index.html` 和 `agenthub-design/desktop/` 是 UI 壳子的权威参考；根 `index.html` 是设计系统入口，`desktop/` 是真正的 Desktop 壳子和交互原型，但实现必须落在 AgentHub 仓库内。
3. `app/shared` 是共享 UI、共享 transcript contract、共享 composer/inspector 的权威位置。
4. `app/desktop` 和 `app/web` 只提供 platform adapter、启动入口和平台专属能力。
5. 旧 Desktop/Web UI 文件是迁移素材，不是长期架构。
6. Tauri Host API 必须从巨石 command 文件拆成可测试、可审计的能力模块。
7. v4 目标消息合同是 shared `TranscriptBlock` / `EvidenceRef`；旧 `ChatView.types`、旧 `ChatMessage` 和旧 `FileDiff` 只能作为迁移输入或测试素材，不能继续作为 Desktop/Web 的目标跨端模型。

## 3. v4 工作台信息架构

v4 第一屏是一个密集但清晰的 IM 工作台，不是营销页，也不是 IDE 皮肤。

### UI 壳子参考

实现时全面参考以下设计资产：

| 设计资产 | 用途 | 实现要求 |
|---|---|---|
| `agenthub-design/index.html` | 设计系统入口、主题和设计版本导航 | 用于确认设计系统方向，不作为生产 UI 代码来源 |
| `agenthub-design/desktop/index.html` | Desktop 壳子 DOM 结构 | 转译为 shared React workbench，不直接复制静态 HTML |
| `agenthub-design/desktop/styles.css` | v4 布局、密度、token、light/dark、rail/sidebar/workspace/inspector/composer 样式 | 提取 token 意图和布局规则，落到 shared CSS Modules/token 层 |
| `agenthub-design/desktop/app.js` | 原型交互：会话切换、inspector resize/collapse、profile popover、workbench pages、selection/context menu | 转成 typed state、React reducer/hooks 和 platform adapter 事件 |
| `agenthub-design/desktop/agenthub-desktop-prototype-single.html` | 单文件快照 | 只作视觉回归和离线对照 |

这些设计资产是 UI 壳子的参考权威；AgentHub 仓库内的 shared React 组件和测试是工程权威。

```text
Window Chrome
  Global Rail
  Conversation Sidebar
  Workspace
    Workspace Header
    Workspace Tabs
    Unified Transcript
    Unified Composer
  Right Inspector
```

| 区域 | 职责 | 规则 |
|---|---|---|
| Window Chrome | Desktop 窗口拖拽、标题、窗口按钮 | Web 不渲染 Tauri chrome；共享工作台不依赖窗口 API |
| Global Rail | 对话、联系人、云文档、Agent、任务、项目、设置 | 图标优先，必须有 tooltip/aria-label |
| Conversation Sidebar | 私聊、群聊、项目会话、未读、最近活动 | 展示 Agent Profile / Human / Project，不展示 Runtime 当联系人 |
| Workspace Header | 当前会话、Agent Profile、Runtime/model/thread 状态、动作入口 | 状态紧凑，不堆叠大卡片 |
| Unified Transcript | 用户消息、Agent 回复、Thinking、Tool、Diff、Approval、Artifact、Deploy | 所有来源投影到同一 `TranscriptBlock` 合同 |
| Unified Composer | @Agent、附件、mode、workdir、approval mode、发送状态 | Desktop/Web 共用交互语义 |
| Right Inspector | 运行证据、任务队列、tool timeline、changed files、preview/browser/file panes | 不是装饰栏，必须回答“做了什么、改了什么、产物在哪” |

## 4. 前端分层

```text
app/shared
  src/ui/            基础 UI primitives
  src/workbench/     v4 产品工作台 shell
  src/transcript/    统一消息/事件 block contract 和 renderer
  src/composer/      统一输入区状态和组件
  src/inspector/     统一证据面板和预览面板
  src/platform/      Desktop/Web platform adapter interface

app/desktop
  src/platform/      Tauri + Local Edge adapter
  src/main.tsx       Desktop 启动入口
  src-tauri/src/host Tauri host capability modules

app/web
  src/platform/      Hub + browser adapter
  src/main.tsx       Web 启动入口
```

### `app/shared/src/ui`

基础组件层只提供可复用 primitives 和小型业务卡片，例如 Button、Modal、MessageBubble、ToolTimeline、DiffReviewPanel、ArtifactCard、DeployCard。当前目录已有组件和测试基础，但 exports 不完整，v4 重构时必须明确 public API，删除未采用的半公开入口。

### `app/shared/src/workbench`

承载 v4 工作台产品结构：

- `AgentHubWorkbench`
- `GlobalRail`
- `ConversationSidebar`
- `WorkspaceHeader`
- `WorkspaceTabs`
- `WorkbenchRoutes`
- `WorkbenchLayout`

Workbench 只依赖 shared contracts 和 platform adapter，不直接调用 Tauri invoke、Hub client 或 Edge client。

### `app/shared/src/transcript`

统一消息流合同：

```text
Conversation -> Message -> TranscriptBlock -> EvidenceRef
```

目标 block 类型：

- `text`
- `thinking`
- `tool_call`
- `tool_result`
- `diff`
- `approval`
- `artifact`
- `deploy`
- `route_decision`
- `child_agent`
- `context_usage`
- `error`

Desktop Edge events、Hub IM messages、TeamRun events 和 Web remote task events 都必须 normalize 到该合同后再渲染。禁止新增 Markdown-only 第二消息流。

当前实现已落地 `text`、`tool_call`、`diff`、`approval`、`artifact` 和 `EvidenceRef` 聚合；剩余旧 `ChatView.types` 中的 `thinking`、`tool_result`、`deploy`、`route_decision`、`child_agent`、`context_usage`、`error` 等 block kind 必须先补进 shared contract 或映射为现有 `TranscriptBlock` 后，才能删除旧 Chat/IM 组件本体。

过渡规则：

- `app/shared/src/transcript/types.ts` 是 v4 渲染合同。
- `app/shared/src/types/chat.ts` 只保留兼容旧测试、搜索、Diff、artifact 提取和迁移工具需要的旧消息视图合同。
- 旧 `app/desktop/src/components/ChatView.types.ts` 和 `app/web/src/components/ChatView.types.ts` 不再新增字段；下一批实现应把引用迁到 shared 类型，再删除旧类型文件。
- Diff 类型应从旧 ChatView 类型中抽离到 shared diff contract，供 shared inspector、DiffReviewPanel、旧 DiffViewer 迁移期共用。

### `app/shared/src/composer`

Composer 负责输入体验和发送意图，不拥有平台执行细节：

- mode：Ask / Plan / Code / Review / Deploy
- mention：Agent Profile / Human / Project
- attachment：文件、目录、artifact、网页链接
- execution context：workspace、approval mode、target
- draft：per conversation draft persistence
- submit state：idle / pending / streaming / failed

### `app/shared/src/inspector`

Inspector 负责 evidence-first 工作面板：

- run progress
- active/done/warning queue
- tool timeline
- changed files
- artifacts
- approval requests
- browser preview
- file preview
- deploy status

窄屏可折叠，但入口必须明确。宽屏 Desktop/Web 默认优先保证 transcript 和 inspector 同屏可见。

## 5. Platform Adapter

共享 UI 通过 platform adapter 获取能力。

```ts
interface AgentHubPlatform {
  surface: "desktop" | "web";
  capabilities: PlatformCapabilities;
  conversations: ConversationPort;
  runs: RunPort;
  agents: AgentProfilePort;
  artifacts: ArtifactPort;
  approvals: ApprovalPort;
  host?: DesktopHostPort;
}
```

Desktop adapter：

- Local Edge status/start/stop
- Edge REST/WS
- Tauri file/dialog/window/keyring/notification
- local workspace allowlist
- TokenDance ID loopback callback

Web adapter：

- Hub REST/WS
- Hub session
- remote Edge/Cloud target routing
- browser-safe preview
- remote approval

UI 能根据 `capabilities` 隐藏或禁用不可用动作，但不能 fork 另一套组件。

## 6. Tauri Host API

`app/desktop/src-tauri/src/commands.rs` 当前承担过多职责。v4 后的目标结构：

```text
src-tauri/src/host/
  mod.rs
  edge.rs
  fs.rs
  dialog.rs
  auth.rs
  window.rs
  system.rs

src-tauri/src/commands.rs
  register_commands()
  compatibility shims during migration
```

| 模块 | 职责 |
|---|---|
| `edge.rs` | Edge start/stop/status/auth token |
| `fs.rs` | 文件树、读写、复制、移动、删除、路径 allowlist |
| `dialog.rs` | 文件/目录选择和保存路径 |
| `auth.rs` | OIDC loopback、session/keyring |
| `window.rs` | 窗口、托盘、通知、外链 |
| `system.rs` | 平台信息、诊断、路径发现 |

所有危险能力必须经过 typed request、allowlist、错误码和测试。UI 不拼接任意 shell 命令。

## 7. Runtime / Edge / Hub 总体架构

```text
Desktop shared workbench
  -> Desktop platform adapter
  -> Local Edge Server
  -> AgentAdapter
  -> Claude Code / Codex / OpenCode

Web shared workbench
  -> Web platform adapter
  -> Hub Server
  -> Edge routing / relay
  -> Edge Server
  -> AgentAdapter
```

| 组件 | 目录 | 职责 |
|---|---|---|
| Shared Workbench | `app/shared/` | v4 UI、transcript、composer、inspector、platform contracts |
| Desktop App | `app/desktop/` | Desktop adapter、Tauri shell、Local Edge 本机能力 |
| Web App | `app/web/` | Web adapter、Hub session、远程审批和查看 |
| Edge Server | `edge-server/` | 本地项目、Thread、Context Builder、Run lifecycle、Agent Runtime adapter、Artifact index |
| Hub Server | `hub-server/` | TokenDance ID relying party、Hub session、IM、AgentTeam、同步、中继、审计 |
| API Contract | `api/` | REST API 和 WebSocket event 契约 |

## 8. Agent 产品模型

| 概念 | 含义 | 权威来源 |
|---|---|---|
| Agent Runtime | 能启动和解析某类 Agent CLI/SDK 的执行适配器，回答“用什么运行” | Edge adapter registry |
| Agent Profile | 用户可选择的 Agent 实体，回答“谁来做事” | Hub profile store / Edge local profile |
| Agent Configuration | Profile 的配置集合：AGENTS.md、memory、上下文、Skill、MCP、模型参数、审批策略 | Edge Context Builder + Hub store |
| Execution Target | 一次 Run 的实际执行位置：local、remote、cloud、relay | Edge registration + Hub routing |
| Conversation | 用户可见的 IM 会话：私聊、群聊、项目会话 | Hub/Edge conversation store |
| Run Session | 一次执行的生命周期和事件序列 | Edge lifecycle + EventStore |
| Artifact | Agent 产物索引、预览、应用和版本 | Edge artifact index + workspace |

## 9. 通信方式

| 通信 | 方式 |
|---|---|
| Shared UI -> platform adapter | TypeScript interface |
| Desktop adapter -> Tauri host | typed invoke |
| Desktop adapter -> Local Edge | REST JSON + WebSocket |
| Web adapter -> Hub | REST JSON + WebSocket |
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Edge lifecycle -> AgentAdapter | Go interface + process context |
| AgentAdapter -> Edge | typed runtime events |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS |

安全边界：

- UI 不能直接启动 Agent CLI。
- Web 不能持有 TokenDance API key 或本机文件系统能力。
- Desktop 文件操作必须经过 allowlist 和 typed Host API。
- Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份。

## 10. 数据线

**控制线**

```text
Workbench -> Platform Adapter -> Edge/Hub -> AgentAdapter -> Agent Runtime
```

**事件线**

```text
Agent Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript
```

**证据线**

```text
RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview
```

**同步线**

```text
Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers
```

## 11. 旧系统清理策略

以下对象不得作为 v4 后的活跃主工作台：

- Desktop `ChatView`
- Desktop `PromptInput`
- Desktop `IMBlockRenderer`
- Desktop `RunDetail`
- Desktop `ThreadPanel`
- Desktop/Web 分叉 `viewRegistry`
- `useChatMessages` / `useIMChat` 千行 hooks
- Web 复制版 `ChatView` / `PromptInput` / `RunDetail` / `ThreadPanel`
- Tauri 巨石 `commands.rs`

迁移期间可以通过小 commit 做 adapter 或 compatibility shim，但最终验收必须证明旧入口不再承载 active route。

### 旧 UI 剩余债务分类

| 类别 | 对象 | 处理策略 |
|---|---|---|
| 必须先迁入 shared contract | `ChatView.types` 中的 `ChatMessage`、`MessageBlock`、`ToolResultBlock`、`FileDiff`、`DiffHunk`、`DiffLine`、Web `ReplyTarget` | 先补齐 `app/shared/src/types/chat.ts` 和 shared diff contract，再把 Desktop/Web active/test 类型引用迁走 |
| 可删除组件本体 | Desktop/Web `ChatView`、`PromptInput`、`ThreadPanel`、Web `RunDetail`、Desktop IM `IMBlockRenderer`、旧 hooks | active import 已被扫描门禁阻断；等类型引用迁完后删除组件、CSS 和旧测试 |
| 暂缓但必须隔离 | Desktop `DiffViewer`、`ArtifactBrowser`、Search/Dialog 类旧视图工具、Web `hubAdapters` 的旧 IM 转换路径 | 保留为功能参考或迁移输入；不得重新接回 v4 active route |
| 已删除 active path | 旧 Desktop/Web `viewRegistry`、旧 `MainView`、旧 `IMView`、Desktop 旧 `RunDetail/RightInspector/PermissionDialog`、Web 孤儿 `PermissionDialog` | 由 `scripts/verify-v4-old-ui-active-paths.ps1` 持续阻断回归 |

下一批最小安全切片是“类型合同迁移”，不是直接删组件：先把旧 `ChatMessage/FileDiff` 类型和缺失 block kind 放到 shared contract，更新 import，再用 typecheck 证明没有行为改动；之后再删旧组件本体和旧测试。

## 12. 验收门禁

| 门禁 | 要求 |
|---|---|
| Typecheck | shared、desktop、web 分别通过 |
| Unit tests | transcript normalization、composer state、inspector data、platform adapters 覆盖核心路径 |
| Tauri tests | Host API path validation、dangerous operations、Edge lifecycle 覆盖 |
| Visual QA | Desktop/Web 各 1440x920、1280x800、390x844 截图 |
| Browser QA | Playwright 验证无横向滚动、无遮挡、composer 不遮挡最后消息 |
| Legacy scan | 旧 UI 名称不再出现在 active route 或 active docs |
| Docs sync | roadmap、architecture、README、governance 同步 |

## 13. 阶段划分

| 阶段 | 目标 | 状态 |
|---|---|---|
| D0 | 文档架构、问题清单、roadmap 对齐 | 进行中 |
| D1 | shared workbench contract 和文件结构 | 进行中 |
| D2 | shared transcript/composer/inspector | 进行中 |
| D3 | Desktop platform adapter + v4 shell | 进行中 |
| D4 | Web platform adapter + v4 shell | 进行中 |
| D5 | Tauri Host API 拆分 | 未开始 |
| D6 | 旧 UI 清理、视觉 QA、发布门禁 | 未开始 |

## 14. 文档权威

- 当前目标和优先级：[roadmap.md](roadmap.md)
- v4 实施计划：[desktop-web-v4-clean-rebuild-plan.md](desktop-web-v4-clean-rebuild-plan.md)
- 待确认问题：[v4-clean-rebuild-decision-questions.md](v4-clean-rebuild-decision-questions.md)
- 分支事实：[governance/branch-governance.md](governance/branch-governance.md)
- 历史材料：[archive/](archive/)
