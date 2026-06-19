# AgentHub 架构文档

> 最后更新：2026-06-19 | ChatView 迁移 HARDENING (Round 6 完成)，37 commits，45 tests，0 TS errors。Phase 1-4 完成，Phase 5-7 推进中。
>
> **详细子文档**：[docs/architecture/](architecture/) 目录包含 6 份独立模块文档，本文档保留核心概览并链接到各子文档。

---

## 1. 产品定位

AgentHub 是 IM 形态的多 Agent 协作平台。用户像在飞书/微信里拉群协作一样，把 Builder、Reviewer、Researcher、Deployer、Orchestrator 等 Agent Profile 放进同一个项目会话，让它们围绕代码、文档、Diff、Preview、Approval、产物和部署结果协作。

```text
AgentHub = shared IM workbench + local/remote Agent execution + Hub collaboration network
```

Claude Code、Codex、OpenCode 是 Agent Runtime，不是用户直接管理的业务 Agent。用户选择的是 Agent Profile；Profile 再绑定 Runtime、模型、上下文、Skill/MCP、审批策略和 Execution Target。

## 2. 当前架构决策

1. Desktop/Web 使用同一套 v4 UI 工作台，不再维护两套主聊天界面。
2. `tokendance-design/index.html` 和 `tokendance-design/desktop/` 是 UI 壳子的权威参考；根 `index.html` 是设计系统入口，`desktop/` 是真正的 Desktop 壳子和交互原型，但实现必须落在 AgentHub 仓库内。当前验收口径是 **1:1 迁移设计原型的信息架构、DOM 结构、密度、token、交互和首屏视觉**，不是重新设计。
3. `app/shared` 是共享 UI、共享 transcript contract、共享 composer/inspector 的权威位置。
4. `app/desktop` 和 `app/web` 只提供 platform adapter、启动入口和平台专属能力。
5. 旧 Desktop/Web UI 文件是迁移素材，不是长期架构。
6. Tauri Host API 必须从巨石 command 文件拆成可测试、可审计的能力模块。
7. v4 目标消息合同是 shared `TranscriptBlock` / `EvidenceRef`；旧 `ChatMessage`（兼容层 `types/chat.ts`）和旧 `FileDiff` 只能作为迁移输入或测试素材，不能继续作为 Desktop/Web 的目标跨端模型。
8. Desktop/Tauri 前端固定使用 `5173`，Web 前端固定使用 `5174`。Mobile 主线已切到 Expo + React Native，浏览器视觉预览固定使用 `5177`。

## 3. 五层架构

```text
Desktop shared workbench
  -> Desktop platform adapter
  -> Local Edge Server   (执行：Thread / Run / Artifact / Agent Runtime)
  -> Hub Server          (认证 / 联系人 / 会话 / 消息 / AgentTeam)
  -> AgentAdapter
  -> Claude Code / Codex / OpenCode

Web shared workbench
  -> Web platform adapter
  -> Hub Server          (认证 / 联系人 / 会话 / 消息 / 项目 / 文档)
  -> Edge routing / relay (远程 Edge 接入)
  -> Edge Server
  -> AgentAdapter
```

| 层 | 组件 | 目录 | 职责 |
|---|---|---|---|
| Shared UI | Shared Workbench | `app/shared/` | v4 UI、transcript、composer、inspector、platform contracts |
| Desktop | Desktop App | `app/desktop/` | Desktop adapter、Tauri shell、Local Edge 本机能力 |
| Web | Web App | `app/web/` | Web adapter、Hub session、远程审批和查看 |
| Edge | Edge Server | `edge-server/` | 本地项目、Thread、Context Builder、Run lifecycle、Agent Runtime adapter、Artifact index |
| Hub | Hub Server | `hub-server/` | TokenDance ID relying party、Hub session、IM、AgentTeam、同步、中继、审计 |
| API | API Contract | `api/` | REST API 和 WebSocket event 契约 |

详细子文档：
- **Hub Server（路由、中间件、WebSocket 事件、Chat Actions）** → [architecture/01-hub-server.md](architecture/01-hub-server.md)
- **Edge Server（adapter registry、process lifecycle、EventStore）** → [architecture/02-edge-server.md](architecture/02-edge-server.md)
- **Runtime Adapters（全部 adapter、事件映射、Preflight）** → [architecture/03-runtime-adapters.md](architecture/03-runtime-adapters.md)
- **Frontend Data Flow（Platform adapter、React Query、Settings 回退、Profile 合并）** → [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)
- **Deployment（hk2、Docker Compose、Nginx、SSL）** → [architecture/05-deployment.md](architecture/05-deployment.md)
- **Auth & Identity（OIDC PKCE、JWT、TokenDance ID、设备注册）** → [architecture/06-auth-identity.md](architecture/06-auth-identity.md)

## 4. 数据流

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

## 5. Platform Adapter Interface

共享 UI 通过 platform adapter 获取能力：

```ts
interface AgentHubPlatform {
  surface: AgentHubSurface;           // "desktop" | "web"
  capabilities: SurfaceCapabilities;  // { localEdge, localFiles, browserPreview }
  conversations: ConversationPort;
  runs: RunPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  settings?: SettingsPort;
}
```

- **Desktop adapter**：Local Edge、Tauri file/dialog/window/keyring、local workspace allowlist、TokenDance ID loopback callback
- **Web adapter**：Hub REST/WS、Hub session、remote Edge/Cloud routing、browser-safe preview、remote approval

UI 能根据 `capabilities` 隐藏或禁用不可用动作，但不能 fork 另一套组件。

前端数据流详情 → [architecture/04-frontend-data-flow.md](architecture/04-frontend-data-flow.md)

## 6. 非协商边界

- UI 不能直接启动 Agent CLI
- Web 不能持有 TokenDance API key 或本机文件系统能力
- Desktop 文件操作必须经过 allowlist 和 typed Host API
- Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份
- 所有 adapter 必须将事件 normalize 到统一 `RunEvent` -> `TranscriptBlock` 合同
- 禁止新增 Markdown-only 第二消息流

## 7. Agent 产品模型

| 概念 | 含义 | 权威来源 |
|---|---|---|
| Agent Runtime | 能启动和解析某类 Agent CLI/SDK 的执行适配器，回答"用什么运行" | Edge adapter registry |
| Agent Profile | 用户可选择的 Agent 实体，回答"谁来做事" | Hub profile store / Edge local profile |
| Agent Configuration | Profile 的配置集合：AGENTS.md、memory、上下文、Skill、MCP、模型参数、审批策略 | Edge Context Builder + Hub store |
| Execution Target | 一次 Run 的实际执行位置：local、remote、cloud、relay | Edge registration + Hub routing |
| Conversation | 用户可见的 IM 会话：私聊、群聊、项目会话 | Hub/Edge conversation store |
| Run Session | 一次执行的生命周期和事件序列 | Edge lifecycle + EventStore |
| Artifact | Agent 产物索引、预览、应用和版本 | Edge artifact index + workspace |

## 8. 前端分层

```text
app/shared
  src/ui/            基础 UI primitives
  src/workbench/     v4 产品工作台 shell
  src/transcript/    统一消息/事件 block contract 和 renderer
  src/composer/      统一输入区状态和组件
  src/inspector/     统一证据面板和预览面板
  src/platform/      Desktop/Web platform adapter interface
  src/demo/          数据模式 (auto/mock/fixture/observed/approved-real)

app/desktop
  src/platform/      Tauri + Local Edge adapter
  src/api/           Desktop query hooks 和 transport 层
  src/main.tsx       Desktop 启动入口
  src-tauri/src/host Tauri host capability modules

app/web
  src/platform/      Hub + browser adapter
  src/api/           Web query hooks 和 transport 层
  src/main.tsx       Web 启动入口
```

### Transcript 合同

```text
Conversation -> Message -> TranscriptBlock -> EvidenceRef
```

目标 block 类型：`text`、`thinking`、`tool_call`、`tool_result`、`diff`、`approval`、`artifact`、`deploy`、`route_decision`、`child_agent`、`context_usage`、`error`

`app/shared/src/transcript/types.ts` 是 v4 渲染合同。所有来源必须 normalize 到该合同后再渲染。

### Tauri Host API

目标结构（从巨石 commands.rs 拆分）：

```text
src-tauri/src/host/
  mod.rs       edge.rs      fs.rs        dialog.rs    auth.rs      window.rs    system.rs
```

| 模块 | 职责 |
|---|---|
| `edge.rs` | Edge start/stop/status/auth token |
| `fs.rs` | 文件树、读写、复制、移动、删除、路径 allowlist |
| `dialog.rs` | 文件/目录选择和保存路径 |
| `auth.rs` | OIDC loopback、session/keyring |
| `window.rs` | 窗口、托盘、通知、外链 |
| `system.rs` | 平台信息、诊断、路径发现 |

所有危险能力必须经过 typed request、allowlist、错误码和测试。

## 9. 通信方式

| 通信 | 方式 |
|---|---|
| Shared UI -> platform adapter | TypeScript interface |
| Desktop adapter -> Tauri host | typed invoke |
| Desktop adapter -> Local Edge | REST JSON + WebSocket |
| Desktop adapter -> Hub Server | REST JSON + WebSocket（认证/联系人/会话/消息） |
| Web adapter -> Hub | REST JSON + WebSocket |
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Edge lifecycle -> AgentAdapter | Go interface + process context |
| AgentAdapter -> Edge | typed runtime events |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS |

## 10. 旧主工作台退役清单

以下对象不得作为 v4 后的活跃主工作台：

- Desktop `ChatView` / `PromptInput` / `IMBlockRenderer` / `RunDetail` / `ThreadPanel`
- Desktop/Web 分叉 `viewRegistry`
- `useChatMessages` / `useIMChat` 千行 hooks
- Web 复制版 `ChatView` / `PromptInput` / `RunDetail` / `ThreadPanel`
- Tauri 巨石 `commands.rs`

迁移期间可以通过小 commit 做 adapter 或 compatibility shim，但最终验收必须证明旧入口不再承载 active route。

## 11. ChatView 卡片渲染系统（替代 TranscriptView）

`app/shared/src/chatview/` 是唯一的卡片渲染系统，替代了旧的 `TranscriptView` + 20+ block renderers。

```
chatview/
  index.ts                   ChatViewTranscript, adapter public API
  adapter.ts                  TranscriptBlock[] → TranscriptItem[] 映射
  types.ts                   RowItem, RowType, AgentRole 共享类型
  transcript-item.ts         TranscriptItem, TranscriptUserItem, TranscriptAgentItem
  components/
    ChatViewTranscript.tsx    TranscriptBlock[] 入口 + <div className="chatview"> 包裹
    RowItem.tsx               Card renderer（状态感知，collapsible/content/diff/code/approval）
    RowItem.css               Card 样式：.row-item / .row-hd / .row-bd / .result-row
    OrchestratorCard.tsx      编排 DAG 拓扑布局 SVG（buildLayers 拓扑排序）
    Transcript.tsx            TranscriptItem[] → UserMsg / AgentGroup 分发
    Transcript.css            grp-row 对称布局 + bubbles + avatars
    AgentGroup.tsx            头像 + card-stack（rows + standaloneRows）+ bubbles
    UserMsg.tsx               用户消息气泡
    Icons.tsx                 20+ SVG 图标组件
  design/
    tokens.css                .chatview 作用域 CSS 变量（零全局污染，亮/暗双主题）
    global.css                全局 chatview 样式（非作用域部分）
    labels.ts                 cardLabelKey() / toolKey() / isToolResult()
    roles.ts                  AgentRole SSOT + roleColor/roleInitial 映射
  i18n/
    resources.ts              中英双语 ~120 键（card.* 状态感知 + sim + sidebar + code）
  data/
    mock.ts                   模拟 TranscriptBlock[] 数据
  streaming.test.ts           流式增量更新测试
  adapter.test.ts             Adapter 映射测试
```

### 11.1 状态机（RowItem Status State Machine）

所有 10 种卡片类型共享 4 个状态变体。RowItem.type 决定卡片形状，RowItem.status 决定卡片颜色/动画/交互行为。

| type | running | ok | fail | waiting |
|------|---------|----|------|---------|
| **think** | 思考中（蓝 pulsate，auto-open，content 流式追加） | 思考完成（auto-collapse，可展开） | 思考失败（红，显示 reason） | -- |
| **tool** | 工具执行中（蓝 pulsate，label: "正在{tool}..."） | 工具完成（绿，result-row 合并） | 工具失败（红，可 retry） | -- |
| **file** | 文件操作中（蓝，label: "正在{cr/mod/del}..."） | 文件完成（绿，cr=蓝/mod=橙/del=红 色标，diffLines 展开） | 文件失败（红） | -- |
| **sub** | 子Agent工作中（蓝，label: "Agent · {name} 工作中"） | 子Agent完成（绿） | 子Agent失败（红） | -- |
| **approval** | -- | 权限通过（绿） | 审批拒绝（红） | 等待审批（黄，show approve/deny 按钮） |
| **route** | -- | 分派完成（DAG SVG 拓扑图） | 分派失败（红） | -- |
| **deploy** | 部署中（蓝） | 部署就绪（绿，show url + deployMeta） | 部署失败（红） | -- |
| **attachment** | -- | 附件可用（绿，show fileName + fileSize） | 附件失败（红） | -- |
| **ctx** | -- | 上下文正常（ctx-bar 填充，show ctxStats） | 上下文耗尽（红） | -- |
| **session** | -- | 会话完成（绿，show sessionTags） | 会话失败（红） | -- |

**状态来源映射（adapter.ts）：**

- `statusNorm()` — EvidenceRefStatus → RowItem.status：`running/pending` → `running`，`failed` → `fail`，`completed` → `ok`
- `deployStatusNorm()` — deploy 专用：`pending/deploying` → `running`，`ready/deployed` → `ok`，`failed` → `fail`
- `permission_request` 块固定为 `waiting`
- `thinking` 块的 `isThinking` 标志 → `running`，否则 → `ok`
- `tool_call` 块检查 `evidenceRefs` 是否包含 `completed`，合并后 `tool_result` 覆盖

**渲染行为（RowItem.tsx）：**

- `status === 'running'`：row-item 加 `.running` class（CSS pulsate 动画），think 卡片 auto-open
- `status === 'fail'`：row-item 加 `.fail` class（红色左边框），show "重试" 按钮
- `status === 'waiting'`：approval 卡片 show "批准"/"拒绝" action 按钮
- `status === 'ok'`：正常显示，无特殊动画

### 11.2 组件抽象层级

```
┌─────────────────────────────────────────────────────┐
│  Workbench (.transcriptRegion)                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ ChatViewTranscript (<div className="chatview">)  │
│  │  ┌──────────────────────────────────────┐   │    │
│  │  │ Transcript (TranscriptItem[] → type dispatch)│   │
│  │  │  ┌─────────────┐  ┌──────────────┐   │   │    │
│  │  │  │ UserMsg      │  │ AgentGroup    │   │   │    │
│  │  │  │ (user-bubble)│  │ (grp-row)    │   │   │    │
│  │  │  └─────────────┘  │  ┌─────────┐  │   │   │    │
│  │  │                    │  │ RowItem  │  │   │   │    │
│  │  │                    │  │ ×N rows  │  │   │   │    │
│  │  │                    │  ├─────────┤  │   │   │    │
│  │  │                    │  │ RowItem  │  │   │   │    │
│  │  │                    │  │ ×N stand │  │   │   │    │
│  │  │                    │  ├─────────┤  │   │   │    │
│  │  │                    │  │OrchCard  │  │   │   │    │
│  │  │                    │  │(SVG DAG) │  │   │   │    │
│  │  │                    │  └─────────┘  │   │   │    │
│  │  │                    │  bubbles[]     │   │   │    │
│  │  │                    └──────────────┘   │   │    │
│  │  └──────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────┘    │
│  Composer / Inspector / Sidebar ...                  │
└─────────────────────────────────────────────────────┘
```

**层级职责：**

| 层级 | 组件 | 输入 | 输出 | 职责 |
|------|------|------|------|------|
| L0 Shell | Workbench `.transcriptRegion` | -- | DOM wrapper | `flex:1; overflow-y:auto; min-height:0`，单滚动条容器 |
| L1 Scope | `ChatViewTranscript` | `TranscriptBlock[]` | `<div.chatview>` | 调用 `blocksToTranscriptItems()`，包裹 chatview CSS 作用域 |
| L2 List | `Transcript` | `TranscriptItem[]` | `UserMsg \| AgentGroup` | `type` 分发，DM/Group 传参 |
| L3 Group | `AgentGroup` | `TranscriptAgentItem` | grp-row + avatar + card-stack + bubbles | 头像、rows、standaloneRows、bubbles 布局 |
| L3 Leaf | `UserMsg` | `TranscriptUserItem` | user-bubble | 用户消息气泡（右对齐，primary 背景） |
| L4 Card | `RowItem` | `RowItem` | .row-item | 状态感知渲染（collapsible/content/diff/code/approval/deploy/ctx/session） |
| L4 DAG | `OrchestratorCard` | `RowItem` (type=route, orchAgents) | SVG DAG | 拓扑排序 → layers → SVG 节点+边 |

### 11.3 数据流：TranscriptBlock -> RowItem

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Upstream     │     │ adapter.ts   │     │ transcript-  │     │ Transcript   │
│ Source       │ ──> │ blocksTo     │ ──> │ item.ts      │ ──> │ Component    │
│ (Hub/Edge/   │     │ Transcript   │     │ Transcript   │     │ Tree         │
│  Mock)       │     │ Items()      │     │ Item[]       │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
   25 kinds               grouping              2 union               dispatch
   TranscriptBlock        + mapping              types                 render
```

**Step 1: mapBlock (TranscriptBlock → RowItem | null)**

25 种 TranscriptBlock `kind` → 15 种映射到 RowItem，5 种递归/展平（`run_step_group` children 递归 → RowItem[]，`agent_timeline` items → think RowItem[]），5 种显式跳过（`result`/`finished`/`replay_gap`/`preview`/`agent_timeline`/`run_step_group` 块级）。

| TranscriptBlock kind | RowItem.type | 说明 |
|----------------------|-------------|------|
| `thinking` | `think` | isThinking → running，否则 ok |
| `tool_call` | `tool` | 检查 evidenceRefs 完成状态 |
| `tool_result` | `tool` (isResult: true) | 与同 toolName 的 tool_call 合并 |
| `file_change` | `file` | fileOp: cr/mod/del |
| `artifact` | `file` | 同上，从 path/title 推断 |
| `diff` | `file` | diffLines 从 patch 生成 |
| `approval` / `permission_request` / `permission_result` | `approval` | standalone；permission_request → waiting |
| `run_session` | `session` | standalone；sessionTags 显示 |
| `subagent` / `subtask` / `child_agent` | `sub` | label: "Agent · {name}" |
| `route_decision` | `route` | standalone；non-collapsible |
| `context_usage` | `ctx` | standalone；ctxPct + ctxStats |
| `deploy` | `deploy` | standalone；deployStatusNorm 映射 |
| `attachment` | `attachment` | standalone；fileName + fileSize |
| `failure` | `think` (fail) | 错误包装为 fail think 卡片 |

**Step 2: blocksToTranscriptItems (TranscriptBlock[] → TranscriptItem[]) 分组规则：**

1. `human` + `text` blocks → `TranscriptUserItem`（终结当前 agent group）
2. `agent`/`system` + `text` blocks → 追加到当前 AgentGroup 的 `bubbles[]`
3. `agent_timeline` blocks → 展平 items 为 think RowItem[] → 追加到当前 AgentGroup 的 `rows[]`
4. `run_step_group` blocks → 递归 children 为 RowItem[] → 追加到 `rows[]`
5. 其他 agent/system blocks → `mapBlock()` → RowItem → 分流：
   - standalone 类型（route/deploy/ctx/approval/session/attachment）→ `standaloneRows[]`
   - tool_result（isResult: true）→ 找到同 toolName 的 tool_call 并替换（保持 React key 稳定）
   - 其他 → `rows[]`
6. 作者切换时 flush 当前 AgentGroup 并新建

### 11.4 i18n 架构

单层 react-i18next，**不嵌套 Provider**。ChatView 使用 `'chatview'` namespace，与 AgentHub 的 `'sharedWorkbench'` namespace 在同一个 `I18nextProvider` 下共存。

```
┌─────────────────────────────────────────────────┐
│ I18nextProvider (AgentHub root)                  │
│  resources:                                      │
│    sharedWorkbench → sharedWorkbenchResources    │
│    chatview        → chatviewResources           │
│                                                  │
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ Workbench UI     │  │ ChatViewTranscript    │  │
│  │ useTranslation   │  │ useTranslation(       │  │
│  │ ('sharedWB')     │  │   'chatview')         │  │
│  └─────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**关键设计决策：**

- **单 Provider**：ChatView 不内嵌自己的 `I18nextProvider`，直接使用消费方的 root Provider。消费方必须在初始化时将 `chatviewResources` 注册到 `resources.chatview`。
- **Namespace 隔离**：`CHATVIEW_I18N_NAMESPACE = 'chatview'`，组件内 `useTranslation('chatview')`，与 workbench 的 `'sharedWorkbench'` 互不冲突。
- **Key 格式**：扁平 dot-separated：`card.think.running`、`card.tool.read`、`code.copy`。
- **TransKey 类型安全**：`type TransKey = keyof typeof chatviewResources.en`——编译期检查所有 key。
- **状态感知标签**：`cardLabelKey(item)` 根据 `type + status + toolName` 返回 `{key, params?}`，组件调用 `t(key, params)` 得到显示字符串。详见 `design/labels.ts`。
- **双语覆盖**：zh/en 各 ~120 键，覆盖 card.*（状态感知）、sim.*（模拟控制）、sidebar.*（概览面板）、code.*（代码块）、app.*（DM/Group 标题）、transcript.*（空状态）。

### 11.5 滚动与布局：.transcriptRegion 包装器

ChatView 卡片树不自己管理滚动。滚动由外层 Workbench 的 `.transcriptRegion` 包装器统一控制。

```
.workbench-shell
  .transcriptRegion          ← 唯一滚动容器
    ChatViewTranscript       ← <div.chatview>：display:flex; flex-direction:column; height:100%; overflow:hidden
      .transcript            ← display:flex; flex-direction:column; overflow-y:auto; flex:1
        .grp-row             ← 每条消息行
        .grp-row
        ...
  .composer                  ← 固定在底部，不参与滚动
```

**CSS 关键规则：**

| 选择器 | 关键属性 | 职责 |
|--------|---------|------|
| `.transcriptRegion` | `flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scroll-padding-bottom: var(--composer-scroll-gap)` | 唯一滚动容器，预留 composer 间隙 |
| `.chatview` | `display: flex; flex-direction: column; height: 100%; overflow: hidden` | CSS 作用域入口，禁止自身滚动 |
| `.transcript` | `display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; scroll-behavior: smooth` | 消息列表，flex: 1 填满可用空间 |
| `.grp-row` | `display: flex; gap: var(--sp-md); align-items: flex-start; margin-bottom: var(--sp-lg)` | 对称三列：[avatar-l] [content flex:1] [spacer] |

**设计理由：**
- **单一滚动源**：`.transcriptRegion` 是唯一的 `overflow-y: auto` 容器，避免嵌套滚动冲突。
- **Composer 不遮挡**：`.transcriptRegion:last-child` 设置 `scroll-margin-bottom` 确保最后一条消息滚动到 composer 上方可见。
- **chatview 零溢出**：`.chatview` 设 `overflow: hidden`，所有滚动委托给外层。ChatView 内部的 `.transcript` 也设 `overflow-y: auto` 作为 fallback（独立测试场景），但集成到 Workbench 后由外层接管。
- **Pinned announcement**：`.pinnedAnnouncementWrap` 在 `.transcriptRegion` 内 `position: absolute`，浮于消息列表上方。

**已退役：** `TranscriptView.tsx`、`workbench/blocks/`（20+ 渲染器）、旧 `ChatView` 组件

## 12. 旧 UI 剩余债务分类

| 类别 | 对象 | 处理策略 |
|---|---|---|
| 已迁移到 shared 兼容层 | 旧 `ChatMessage`、`MessageBlock`、`FileDiff` 等 | 集中在 `app/shared/src/types/chat.ts`；只作为迁移兼容层，不承载新功能 |
| 已删除组件本体 | Desktop/Web `ChatView`、`PromptInput`、`ThreadPanel` 等 | active import 已被扫描门禁阻断 |
| 暂缓但必须隔离 | Desktop/Web `DiffViewer`、`ArtifactBrowser`、Search/Dialog 类 | 保留为功能参考或迁移输入 |
| 已删除 active path | 旧 `viewRegistry`、旧 `MainView`、旧 `IMView` 等 | 由 `scripts/verify-v4-old-ui-active-paths.ps1` 持续阻断 |

完整清单见 `scripts/verify-v4-old-ui-active-paths.ps1` 的持续扫描输出。

## 13. 验收门禁

| 门禁 | 要求 |
|---|---|
| Typecheck | shared、desktop、web 分别通过 |
| Unit tests | transcript normalization、composer state、inspector data、platform adapters |
| Tauri tests | Host API path validation、dangerous operations、Edge lifecycle |
| Visual QA | Desktop/Web 各 1440x920、1280x800、390x844 截图 |
| Browser QA | Playwright 验证无横向滚动、无遮挡、composer 不遮挡最后消息 |
| Legacy scan | active route/import 不依赖旧 UI |
| Docs sync | roadmap、architecture、README、governance 同步 |

## 14. 阶段划分

| 阶段 | 目标 | 状态 |
|---|---|---|
| Phase 1-2 | 审计、P0 阻塞修复（attachment block、adapter 测试、fixtures） | 已完成 |
| Phase 3 | P1 高优先级修复（空状态、rich fixtures、CSS/i18n 去重、死代码） | 已完成 |
| Phase 4 | P2 中优先级（adapter 字段透传、streaming harness、normalization 测试） | 已完成 |
| Phase 5 | P3 低优先级（stale docs 清理、命名一致性、Desktop 验证） | 进行中 |
| Phase 6 | HARDENING Round 6（dark mode、i18n 统一、CSS 打磨、React key 去重） | 已完成 |
| Phase 7 | Edge Runtime 集成（WS streaming、真实 agent 数据、roundtrip 验证） | 未开始 |

## 15. 文档权威

- 当前目标和优先级：[roadmap.md](roadmap.md)
- 分支事实：[governance/branch-governance.md](governance/branch-governance.md)
- **架构子文档**：[architecture/](architecture/)
