# AgentHub 架构文档

> 最后更新：2026-06-10 | 当前架构基准：Desktop/Web v4 shared workbench clean rebuild + 2026-06-10 数据流打通
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
2. `agenthub-design/index.html` 和 `agenthub-design/desktop/` 是 UI 壳子的权威参考；根 `index.html` 是设计系统入口，`desktop/` 是真正的 Desktop 壳子和交互原型，但实现必须落在 AgentHub 仓库内。当前验收口径是 **1:1 迁移设计原型的信息架构、DOM 结构、密度、token、交互和首屏视觉**，不是重新设计。
3. `app/shared` 是共享 UI、共享 transcript contract、共享 composer/inspector 的权威位置。
4. `app/desktop` 和 `app/web` 只提供 platform adapter、启动入口和平台专属能力。
5. 旧 Desktop/Web UI 文件是迁移素材，不是长期架构。
6. Tauri Host API 必须从巨石 command 文件拆成可测试、可审计的能力模块。
7. v4 目标消息合同是 shared `TranscriptBlock` / `EvidenceRef`；旧 `ChatView.types`、旧 `ChatMessage` 和旧 `FileDiff` 只能作为迁移输入或测试素材，不能继续作为 Desktop/Web 的目标跨端模型。
8. Desktop/Tauri 前端固定使用 `5173`，Web 前端固定使用 `5174`。Mobile 主线已切到 Expo + React Native，浏览器视觉预览固定使用 `5177`。

## 3. 五层架构

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
| Web adapter -> Hub | REST JSON + WebSocket |
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Edge lifecycle -> AgentAdapter | Go interface + process context |
| AgentAdapter -> Edge | typed runtime events |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS |

## 10. 旧系统清理策略

以下对象不得作为 v4 后的活跃主工作台：

- Desktop `ChatView` / `PromptInput` / `IMBlockRenderer` / `RunDetail` / `ThreadPanel`
- Desktop/Web 分叉 `viewRegistry`
- `useChatMessages` / `useIMChat` 千行 hooks
- Web 复制版 `ChatView` / `PromptInput` / `RunDetail` / `ThreadPanel`
- Tauri 巨石 `commands.rs`

迁移期间可以通过小 commit 做 adapter 或 compatibility shim，但最终验收必须证明旧入口不再承载 active route。

### 旧 UI 剩余债务分类

| 类别 | 对象 | 处理策略 |
|---|---|---|
| 已迁移到 shared 兼容层 | 旧 `ChatView.types` 中的 `ChatMessage`、`MessageBlock` 等 | 集中在 `app/shared/src/types/chat.ts`；只作为迁移兼容层 |
| 已删除组件本体 | Desktop/Web `ChatView`、`PromptInput`、`ThreadPanel` 等 | active import 已被扫描门禁阻断 |
| 暂缓但必须隔离 | Desktop/Web `DiffViewer`、`ArtifactBrowser`、Search/Dialog 类 | 保留为功能参考或迁移输入 |
| 已删除 active path | 旧 `viewRegistry`、旧 `MainView`、旧 `IMView` 等 | 由 `scripts/verify-v4-old-ui-active-paths.ps1` 持续阻断 |

完整清单见 [v4-legacy-client-inventory-2026-06-07.md](v4-legacy-client-inventory-2026-06-07.md)。

## 11. 验收门禁

| 门禁 | 要求 |
|---|---|
| Typecheck | shared、desktop、web 分别通过 |
| Unit tests | transcript normalization、composer state、inspector data、platform adapters |
| Tauri tests | Host API path validation、dangerous operations、Edge lifecycle |
| Visual QA | Desktop/Web 各 1440x920、1280x800、390x844 截图 |
| Browser QA | Playwright 验证无横向滚动、无遮挡、composer 不遮挡最后消息 |
| Legacy scan | active route/import 不依赖旧 UI |
| Docs sync | roadmap、architecture、README、governance 同步 |

## 12. 阶段划分

| 阶段 | 目标 | 状态 |
|---|---|---|
| D0 | 文档架构、问题清单、roadmap 对齐 | 进行中 |
| D1 | shared workbench contract 和文件结构 | 进行中 |
| D2 | shared transcript/composer/inspector | 进行中 |
| D3 | Desktop platform adapter + v4 shell | 进行中 |
| D4 | Web platform adapter + v4 shell | 进行中 |
| D5 | Tauri Host API 拆分 | 未开始 |
| D6 | 旧 UI 清理、视觉 QA、发布门禁 | 旧主路径已完成，剩余迁移债务和正式 Visual QA 继续 |

## 13. 文档权威

- 当前目标和优先级：[roadmap.md](roadmap.md)
- v4 实施计划：[desktop-web-v4-clean-rebuild-plan.md](desktop-web-v4-clean-rebuild-plan.md)
- 待确认问题：[v4-clean-rebuild-decision-questions.md](v4-clean-rebuild-decision-questions.md)
- 分支事实：[governance/branch-governance.md](governance/branch-governance.md)
- 历史材料：[archive/](archive/)
- **架构子文档**：[architecture/](architecture/)
