# AgentHub Desktop/Web v4 Clean Rebuild 实施计划

> 最后更新：2026-06-07

> **给执行 Agent 的要求**：实现本计划时按任务逐项打勾，优先使用独立实现分支；每个阶段必须提交 focused tests、typecheck、截图或明确的未完成风险。不要把旧 UI 继续扩写成长期 fallback。

**目标**：全面参考 `agenthub-design/index.html` 和 `agenthub-design/desktop/` 里的真实 UI 壳子，重建 AgentHub Desktop/Web 通用工作台，让 Desktop 和 Web 共用同一套 UI 架构、消息流合同、composer、inspector 和设计系统。

**架构**：`app/shared` 承载 shared workbench、transcript、composer、inspector、platform contracts；`app/desktop` 和 `app/web` 只提供 platform adapter 与启动入口。Tauri Host API 从巨石 command 文件拆为能力模块，UI 只通过 typed adapter 使用平台能力。

**技术栈**：React 19、TypeScript、Vite、CSS Modules、Vitest、Playwright、Tauri 2、Go Edge/Hub、WebSocket typed events。

---

## 1. 已确认事实

| 事实 | 证据 | 影响 |
|---|---|---|
| Desktop 主 UI 已巨石化 | `ChatView.tsx` 1805 行、`PromptInput.tsx` 1458 行、`useChatMessages.ts` 1487 行、`useIMChat.ts` 1372 行、`App.tsx` 1045 行 | 不适合继续补丁式迭代 |
| Web 仍有复制版 UI | `app/web/src/components/ChatView.tsx` 832 行，Web 也有 PromptInput/RunDetail/ThreadPanel | Desktop/Web 必须统一 |
| shared UI 已有基础 | `app/shared/src/ui/` 已有 MessageBubble、ToolTimeline、DiffReviewPanel、ArtifactCard、DeployCard 等 | 应升级为真正 public UI 系统 |
| shared UI exports 不完整 | `app/shared/src/ui/index.ts` 仍有大量组件被注释为 internal | v4 前必须明确 public API |
| Tauri command 巨石化 | `src-tauri/src/commands.rs` 945 行，混合 Edge、文件、路径、系统能力 | Host API 必须拆分 |
| design v4 壳子已成型 | `agenthub-design/index.html` 是设计系统入口；`agenthub-design/desktop/` 包含 `index.html`、`styles.css`、`app.js`、single-file prototype 和 logo | 作为 UI 壳子、视觉密度和交互基准 |

## 2. UI 壳子参考边界

| 设计资产 | 必须参考的内容 | 不做的事 |
|---|---|---|
| `agenthub-design/index.html` | 设计系统入口、主题切换、设计版本导航、整体视觉语言 | 不把入口页当生产工作台 |
| `agenthub-design/desktop/index.html` | Window chrome、Global Rail、Sidebar、Workspace Header、Transcript、Composer、Inspector 的结构 | 不直接复制静态 HTML 到 React |
| `agenthub-design/desktop/styles.css` | token、布局密度、响应式、inspector resize/collapse、message/tool/diff/approval/deploy 样式 | 不机械搬运全局 CSS 造成样式泄漏 |
| `agenthub-design/desktop/app.js` | 会话切换、profile popover、inspector tab/preview、workbench pages、multi-select/context menu 等原型交互 | 不把原型 DOM 操作作为生产逻辑 |
| `agenthub-design/desktop/agenthub-desktop-prototype-single.html` | 单文件视觉快照和回归对照 | 不作为生产 bundle |
| `agenthub-design/desktop/agenthub-logo.svg` | 壳子内品牌入口 | 不在本轮重做品牌 |

## 3. 设计原则

- **一个工作台**：Desktop/Web 不再各自维护主 UI。
- **一个 transcript contract**：Edge events、Hub messages、TeamRun events 都 normalize 到同一 block 模型。
- **一个 composer**：发送、草稿、@Agent、附件、workdir、approval mode 的语义一致。
- **一个 inspector**：run evidence、tool timeline、changed files、artifact、preview 的组件一致。
- **平台差异只进 adapter**：Desktop 的 Tauri/Local Edge 和 Web 的 Hub/browser 差异不进入共享 UI。
- **清理优先于兼容**：允许实现分支短期破坏旧 UI，最终不保留双主路径。

## 4. 目标文件结构

```text
app/shared/src/
  ui/
    index.ts
    tokens.css
    primitives...
  workbench/
    AgentHubWorkbench.tsx
    WorkbenchLayout.tsx
    GlobalRail.tsx
    ConversationSidebar.tsx
    WorkspaceHeader.tsx
    WorkspaceTabs.tsx
    WorkbenchRoutes.tsx
  transcript/
    types.ts
    normalizeEdgeEvents.ts
    normalizeHubMessage.ts
    TranscriptView.tsx
    TranscriptBlockRenderer.tsx
  composer/
    types.ts
    composerReducer.ts
    UnifiedComposer.tsx
  inspector/
    types.ts
    InspectorPanel.tsx
    ToolTimelinePanel.tsx
    ChangedFilesPanel.tsx
    PreviewPanel.tsx
  platform/
    types.ts
    createMockPlatform.ts

app/desktop/src/
  main.tsx
  platform/desktopPlatform.ts
  platform/tauriHost.ts
  platform/localEdgeClient.ts

app/web/src/
  main.tsx
  platform/webPlatform.ts
  platform/hubClient.ts

app/desktop/src-tauri/src/
  host/
    mod.rs
    edge.rs
    fs.rs
    dialog.rs
    auth.rs
    window.rs
    system.rs
  commands.rs
```

## 5. 任务分解

### Task 1: 文档和合同冻结

**Files:**

- Modify: `docs/roadmap.md`
- Modify: `docs/architecture.md`
- Create: `docs/desktop-web-v4-clean-rebuild-plan.md`
- Create: `docs/v4-clean-rebuild-decision-questions.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/governance/document-standards.md`
- Modify: `docs/governance/branch-governance.md`
- Modify: `AGENTS.md`

- [ ] 写明 v4 shared workbench 是当前主线。
- [ ] 写明 `agenthub-design/index.html` 和 `agenthub-design/desktop/` 是 UI 壳子权威参考。
- [ ] 写明 Desktop/Web 不再分阶段迁移，而是同源实现。
- [ ] 写明旧 UI 文件是清理对象。
- [ ] 写明 design 仓库只读，AgentHub 内实现。
- [ ] 写明分支保留事实和清理结果。
- [ ] 运行 `git diff --check`。
- [ ] 运行 active docs 关键词扫描，确认没有旧主线冲突。

### Task 2: shared UI public API 清理

**Files:**

- Modify: `app/shared/src/ui/index.ts`
- Modify/Create: `app/shared/src/ui/tokens.css`
- Test: `app/shared/src/ui/*.test.tsx`

- [ ] 列出 v4 必需 primitives：Button、Icon、Tooltip、Modal、SegmentedControl、SearchInput、Avatar、Pill、ProgressBar。
- [ ] 列出 v4 必需业务卡片：MessageBubble、ToolTimeline、DiffReviewPanel、ArtifactCard、DeployCard、PermissionModePicker。
- [ ] 删除或继续隐藏未采用 exports，不让半成品成为 public API。
- [ ] 为 public exports 补 smoke tests。
- [ ] 运行 `cd app/shared; corepack.cmd pnpm test`。
- [ ] 运行 `cd app/shared; corepack.cmd pnpm lint`。

### Task 3: shared workbench shell

**Files:**

- Create: `app/shared/src/workbench/AgentHubWorkbench.tsx`
- Create: `app/shared/src/workbench/WorkbenchLayout.tsx`
- Create: `app/shared/src/workbench/GlobalRail.tsx`
- Create: `app/shared/src/workbench/ConversationSidebar.tsx`
- Create: `app/shared/src/workbench/WorkspaceHeader.tsx`
- Create: `app/shared/src/workbench/WorkbenchRoutes.tsx`
- Create: `app/shared/src/workbench/index.ts`
- Test: `app/shared/src/workbench/*.test.tsx`

- [ ] 写 `PlatformCapabilities` 驱动的 shell props。
- [ ] 按 `agenthub-design/desktop/index.html` 实现 v4 rail/sidebar/header/workspace/inspector 基础布局。
- [ ] 按 `agenthub-design/desktop/styles.css` 抽取 token 意图、密度、间距、圆角、边框和 focus 状态。
- [ ] 按 `agenthub-design/desktop/app.js` 把原型交互转成 React state/reducer，不保留 DOM query 操作。
- [ ] 保证 1180px 以上三栏稳定，窄屏收起 inspector。
- [ ] 不直接依赖 Desktop/Web 私有模块。
- [ ] 加 keyboard/aria 基础测试。
- [ ] 加 1440/1280/390 截图场景。

### Task 4: transcript contract 和 renderer

**Files:**

- Create: `app/shared/src/transcript/types.ts`
- Create: `app/shared/src/transcript/normalizeEdgeEvents.ts`
- Create: `app/shared/src/transcript/normalizeHubMessage.ts`
- Create: `app/shared/src/transcript/TranscriptView.tsx`
- Create: `app/shared/src/transcript/TranscriptBlockRenderer.tsx`
- Test: `app/shared/src/transcript/*.test.tsx`

- [ ] 定义 `TranscriptBlock` discriminated union。
- [ ] 定义 `EvidenceRef`，供 inspector 聚合。
- [x] 从 Edge runtime events 归一化 text/tool/diff/approval/artifact；首片已支持 persisted thread items 和 live WebSocket events。
- [ ] 从 Hub message 归一化 IM text/agent/status/team events；首片已支持 Hub session message -> shared text transcript，Web Hub WS 已接 query invalidation，Hub `agent.stream` runtime event 已直接 projection，Web Hub message submit 已有 optimistic cache；后续补 team runtime events 和更完整 renderer。
- [ ] renderer 复用 shared UI 卡片，不复制 Desktop 旧 renderer。
- [ ] 覆盖 null/畸形 tool input、长输出截断、未知 block fallback。

合同边界：

- `TranscriptBlock` 是 v4 渲染目标合同；Desktop/Web 新工作台不得继续以旧 `ChatView.types` 作为跨端目标模型。
- `app/shared/src/types/chat.ts` 只作为旧消息视图兼容合同，服务 Search、Diff、artifact 提取、旧测试迁移和旧组件删除前的过渡。
- 下一批实现先补齐 shared `ChatMessage/MessageBlock/FileDiff` 兼容类型和缺失 block kind，再把 Desktop/Web 的 `import type { ... } from '@/components/ChatView.types'` 迁到 shared 类型。
- 旧 `ChatView.types.ts` 不新增字段、不作为 fallback 根；类型迁移完成后与旧组件本体一起删除。

执行记录：
- 2026-06-07：新增 `app/shared/src/transcript/normalizeThreadItems.ts` 和测试，把 Edge persisted thread items 映射为 shared `TranscriptBlock`，并为 `runId` 生成 `EvidenceRef(kind="run")`。
- 2026-06-07：新增 `app/shared/src/transcript/normalizeEdgeEvents.ts` 和测试，把 live Edge `run.*`、`run.agent.*`、`artifact.created` 事件映射为 shared `TranscriptBlock` 与 run/tool/file/artifact evidence；focused shared tests 更新为 6 个文件 / 14 个测试通过。
- 2026-06-07：新增 `app/shared/src/transcript/normalizeHubMessages.ts` 和测试，把 Hub session messages 映射为 shared `TranscriptBlock`，Web v4 不再依赖旧 `ChatView` 消息转换；focused shared tests 中相关 4 个文件 / 15 个测试通过。
- 2026-06-07：新增 `normalizeHubRuntimeEventsToTranscript`，复用 Edge runtime normalizer，把 Hub WS `agent.stream` payload 的 `event_type/payload/edge_run_id/session_id` 投影成 shared transcript blocks，并保留 run/tool/artifact preview evidence；focused shared tests 更新为 11 个文件 / 36 个测试通过。
- 2026-06-07：shared `types/chat.ts` 升级为旧 `ChatView.types` 迁移兼容合同，新增 `ReplyTarget`、显式 `undefined` 兼容字段和 `chat.test.ts`；Desktop/Web/shared 的旧 `ChatView.types` 类型 import 已迁到 shared，`verify-v4-old-ui-active-paths.ps1` 已新增旧 `ChatView.types` active import 回归检查。验证：shared `src\types\chat.test.ts` + `src\ui\MessageSearchPanel.test.tsx` 2 文件 / 13 测试通过；Desktop typecheck 通过；Web typecheck 通过；Web Diff/MessageTime focused tests 2 文件 / 4 测试通过；Desktop Diff/Search focused tests 2 文件 / 25 测试通过；v4 old UI active path boundary 17/17 通过。

### Task 5: composer 收敛

**Files:**

- Create: `app/shared/src/composer/types.ts`
- Create: `app/shared/src/composer/composerReducer.ts`
- Create: `app/shared/src/composer/UnifiedComposer.tsx`
- Test: `app/shared/src/composer/*.test.tsx`

- [ ] 实现 mode：Ask / Plan / Code / Review / Deploy。
- [ ] 实现 @Agent mention、附件、workdir、approval mode；首片已实现 approval mode、workDir 控件、浏览器文件附件、Desktop 原生文件附件和结构化 @Agent mention，并写入 `ComposerIntent`。
- [ ] 实现 per conversation draft persistence interface。
- [ ] 实现 Enter 发送、Shift+Enter 换行、disabled/loading/error；首片已覆盖平台提交失败时保留草稿并退出 submitting 状态。
- [x] submit 只发出 intent，由 platform adapter 执行；Desktop 首片已把 intent 转成当前 Edge thread 的 `startRun` 请求。

执行记录：
- 2026-06-07：shared `AgentHubWorkbench` 在 platform submit 失败时保留 composer 草稿并恢复可编辑状态；focused shared tests 更新为 6 个文件 / 15 个测试通过。
- 2026-06-07：shared `UnifiedComposer` 增加 approval mode 下拉和 workDir 输入；`buildComposerIntent` 会输出 trim 后的 `workDir`，但不会把空 workDir 写入 intent；focused shared tests 更新为 7 个文件 / 19 个测试通过。
- 2026-06-07：新增 shared `composer/attachments.ts`，支持浏览器文件转附件、文本预览截断、附件上下文格式化和 attachment-only prompt；`UnifiedComposer` 已显示附件入口/chip/删除动作，focused shared tests 更新为 8 个文件 / 23 个测试通过。
- 2026-06-07：新增 shared `composer/mentions.ts`，`UnifiedComposer` 已支持 @Agent 菜单、mention chip、移除动作和结构化 mention intent；Desktop submit 会把 mention 名称、id、模型、runtime 拼进 Edge prompt；focused shared tests 更新为 9 个文件 / 26 个测试通过。
- 2026-06-07：shared platform 新增 `attachments.pickFiles()` port；Desktop `UnifiedComposer` 的附件按钮在有 platform picker 时走 Tauri 原生文件选择，并把本机路径和文本预览写入 `ComposerIntent.attachments`；focused shared tests 更新为 9 个文件 / 30 个测试通过。

### Task 6: inspector 收敛

**Files:**

- Create: `app/shared/src/inspector/types.ts`
- Create: `app/shared/src/inspector/InspectorPanel.tsx`
- Create: `app/shared/src/inspector/ToolTimelinePanel.tsx`
- Create: `app/shared/src/inspector/ChangedFilesPanel.tsx`
- Create: `app/shared/src/inspector/PreviewPanel.tsx`
- Test: `app/shared/src/inspector/*.test.tsx`

- [ ] 聚合 `EvidenceRef` 为 progress、tool timeline、changed files、artifacts；首片已新增 `buildInspectorEvidenceModel`，把 evidence 分组为 run/tool/file/artifact 并统计 status。
- [x] 支持 overview/browser/files 三种 v4 inspector tab。
- [ ] 支持 collapse/resize 状态由 workbench 控制。
- [x] 文件/浏览器预览通过 platform capability 决定可用性；已显示 changed files list/empty state 和 browser preview capability 状态，并通过 `preview.openEvidence()` 把 file/artifact evidence 打开动作交给 platform adapter。
- [ ] 覆盖空状态、失败状态、长文件名、窄屏。

执行记录：
- 2026-06-07：新增 `app/shared/src/inspector/inspectorEvidence.ts`、`app/shared/src/inspector/index.ts` 和 focused tests；`RightInspector` 已从占位文本升级为 overview summary、run/tool/artifact evidence sections、changed files tab 和 browser capability card。
- 2026-06-07：`collectTranscriptEvidence` 保持首次出现顺序，同时用后续同 ID evidence 更新最新 status，避免 live Edge run 状态被早期 pending/running evidence 卡住；shared focused tests 更新为 7 个文件 / 19 个测试通过。
- 2026-06-07：`EvidenceRef` 新增 `path/uri/mimeType` preview 元数据，`RightInspector` files/browser tabs 已渲染可点击 file/artifact 行并调用 platform `preview.openEvidence()`；shared focused tests 更新为 9 个文件 / 31 个测试通过。

### Task 7: Desktop platform adapter

**Files:**

- Create: `app/desktop/src/platform/desktopPlatform.ts`
- Create: `app/desktop/src/platform/tauriHost.ts`
- Create: `app/desktop/src/platform/localEdgeClient.ts`
- Modify: `app/desktop/src/App.tsx`
- Modify: `app/desktop/src/main.tsx`
- Test: `app/desktop/src/platform/*.test.ts`

- [ ] 把 Local Edge status/start/stop 包装成 `RunPort` / `HostPort`。
- [ ] 把 Tauri invoke 包装成 typed `DesktopHostPort`。
- [x] Desktop `App.tsx` 只装配平台 adapter 和 `AgentHubWorkbench`。
- [x] 保留真实 Edge 数据接入，不用 mock 冒充完成；首片已通过 `useThreads` / `useThreadMessages` 接入真实 Edge thread list 和 persisted items，并通过 `createEventStream` 接入当前 thread live run/tool/file/approval/artifact events。
- [x] v4 composer submit 通过 Desktop platform adapter 调用真实 Edge `startRun`，并传递 `permissionMode/workDir`，@Agent mention、浏览器文件附件和 Desktop 原生文件附件通过 prompt 上下文传递。
- [x] Desktop `preview.openEvidence()` 通过 Tauri shell open 打开 shared inspector 传入的 file/artifact evidence target。
- [x] 跑 Desktop typecheck 和 focused tests。

执行记录：
- 2026-06-07：已建立 `app/desktop/src/platform/desktopPlatform.ts` 首片 adapter，先声明 Desktop capability 并提供 active route smoke transcript；真实 Edge event/message/run normalize 仍是后续任务，不把静态首片当完成。
- 2026-06-07：`app/desktop/src/App.tsx` 已替换为 shared `AgentHubWorkbench` 装配入口。
- 2026-06-07：Desktop v4 focused test、Desktop typecheck/build、1440x920 Playwright visual smoke 均通过。
- 2026-06-07：新增 `app/desktop/src/platform/useDesktopWorkbenchModel.ts`，Desktop root 已在有 Edge thread 数据时显示真实会话和 persisted transcript；fallback transcript 只在没有 Edge thread 数据时使用。
- 2026-06-07：新增 `app/desktop/src/platform/useDesktopEdgeEvents.ts`，Desktop root 已订阅 live Edge event stream，过滤当前 thread 并把 live blocks 合并进 shared v4 transcript；Desktop App focused tests 更新为 1 个文件 / 3 个测试通过。
- 2026-06-07：`app/desktop/src/App.tsx` 通过 `useCreateRun` 把真实 Edge run mutation 注入 `desktopPlatform`；v4 composer submit 会提交 `{ projectId, threadId, prompt }` 到 active Edge thread，没有真实 Edge thread 时不再假成功；Desktop App focused tests 更新为 1 个文件 / 4 个测试通过。
- 2026-06-07：`desktopPlatform` 将 shared composer 的 `workspace-write/read-only/suggest` 映射为 Edge `acceptEdits/plan/默认`，并把非空 `workDir` 传入 `startRun`；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop typecheck/build 通过。
- 2026-06-07：`desktopPlatform` 使用 shared `formatComposerPromptWithContext`，把 @Agent mention 的名称、id、模型、runtime 和浏览器文件附件上下文拼进 Edge prompt；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop typecheck/build 通过。
- 2026-06-07：新增 `app/desktop/src/platform/desktopAttachments.ts`，使用 Tauri dialog 选择多文件，并通过既有 `read_file` command 为文本类本机附件生成 preview；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop/Web typecheck/build 通过。
- 2026-06-07：新增 `app/desktop/src/platform/desktopPreview.ts`，`desktopPlatform` 已注入 preview port；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop/Web typecheck/build 通过，Desktop 1440x920 Playwright visual smoke 通过。

### Task 8: Web platform adapter

**Files:**

- Create: `app/web/src/platform/webPlatform.ts`
- Create: `app/web/src/platform/hubClient.ts`
- Modify: `app/web/src/App.tsx`
- Modify: `app/web/src/main.tsx`
- Test: `app/web/src/platform/*.test.ts`

- [ ] 把 Hub session、conversation、message、remote run 包装为 shared ports；首片已把 Hub `GET /web/agent-profiles` 接入 v4 workbench @Agent 列表，并已把 Hub `/client/sessions`、`/client/sessions/{id}/messages` 接入 shared conversations/transcript；已接 Hub WS query invalidation、Web remote submit（Hub message + optional `/web/agent-tasks`）、Hub runtime event live projection、optimistic message cache 和 Agent Profile -> exact AgentInstance dispatch；下一步进入旧 UI active path 清理门禁。
- [ ] Web `App.tsx` 只装配平台 adapter 和 `AgentHubWorkbench`；首片已渲染 shared workbench，Web adapter 已提供浏览器 `preview.openEvidence()` port，`App` 已在 `QueryClientProvider` 内读取 Hub Agent Profiles，并补齐 `lucide-react` alias 防止 shared workbench 图标在 Web Vitest 中加载到第二份 React。
- [ ] Web 不引入 Tauri 或 Local Edge 私有能力。
- [ ] 跑 Web typecheck/build/focused tests。

执行记录：
- 2026-06-07：新增 `resolveWebWorkbenchAgents()` / `agentInfoToWorkbenchAgent()`，Web `App` 通过 `useAgentList(true)` 读取 Hub Agent Profiles 并映射为 shared `WorkbenchAgent`；未登录或 Hub 无 profile 数据时保留 preview fallback；恢复 `app/web/src/api/edgeClient.ts` Hub-only/stubbed 兼容面，保持 Web 不直连 Local Edge；`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\api\agentQueries.test.ts --reporter=dot`，3 个文件 / 7 个测试通过，Web typecheck 通过，`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过。
- 2026-06-07：新增 `useWebWorkbenchModel()`，Web `App` 在 Hub 登录态读取 Hub sessions/messages 并映射到 shared `WorkbenchConversation` / `TranscriptBlock`；登录但暂无会话时显示 Hub 空态，未登录才使用 preview fallback；`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\api\agentQueries.test.ts --reporter=dot`，3 个文件 / 9 个测试通过，Web typecheck/build 通过，`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过。
- 2026-06-07：新增 `app/web/src/platform/webHubRealtime.ts`，Web v4 在 Hub 登录态通过 `/client/ws` 监听 `message.*`、`session.*` 和 `agent.*`，并失效 `web-v4` sessions/messages queries；`createWebPlatform().runs.submitComposerIntent` 改为真实 Hub submit：先写入 `/client/sessions/{id}/messages`，选择 @Agent 时触发 `/web/agent-tasks`，并通过 `model_params` 携带 v4 mode、approval、workDir、mentions 和 attachments 元数据；没有 runtimeId 的 @Agent 会在发 Hub 消息前失败并保留草稿。首片先按 runtime 触发，没有把 profile id 冒充为 agent instance；后续已补 exact AgentInstance dispatch。验证：`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\platform\webHubRealtime.test.ts src\api\agentQueries.test.ts src\api\hubClient.test.ts --reporter=dot`，5 个文件 / 22 个测试通过；Web typecheck/build 通过；`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过；Web 1440x920 Playwright smoke 通过，截图 `app/web/.tmp/web-v4-hub-realtime-submit-smoke.png` 大小 49494 bytes。
- 2026-06-07：`useWebHubRealtime()` 已把当前 Hub session 的 `agent.stream` runtime event 交给 `useWebWorkbenchModel()`，后者追加到 shared transcript 并按 event id 去重；Web 不再只能等待 Hub 把 runtime stream 投影成 `message.new` 后 refetch。验证：`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\platform\webHubRealtime.test.ts src\platform\useWebWorkbenchModel.test.ts src\api\agentQueries.test.ts src\api\hubClient.test.ts --reporter=dot`，6 个文件 / 27 个测试通过；Web build 通过；`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过；Web 1440x920 Playwright smoke 通过，截图 `app/web/.tmp/web-v4-hub-runtime-smoke.png` 大小 49507 bytes。
- 2026-06-07：`createWebPlatform().runs.submitComposerIntent` 已接 optimistic Hub message cache：submit 开始时先写入 `web-v4/hub-messages` query，Hub `sendMessage` 成功后用 `message_id/seq_id/created_at` 确认，send 失败时回滚；如果 message 已发送但 `/web/agent-tasks` 失败，保留已确认 Hub 消息并让 composer 进入 error 状态。验证：`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\platform\webHubRealtime.test.ts src\platform\useWebWorkbenchModel.test.ts src\api\agentQueries.test.ts src\api\hubClient.test.ts --reporter=dot`，6 个文件 / 30 个测试通过；Web typecheck/build 通过；`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过；Web 1440x920 Playwright smoke 通过，截图 `app/web/.tmp/web-v4-optimistic-message-smoke.png` 大小 49489 bytes。
- 2026-06-07：Hub `AddAgentToSession` 改为返回创建后的 `AgentInstance`；Web v4 @Agent submit 会按 session/profile/runtime 创建并缓存 exact session agent instance，再用 `agent_instance_id` 触发 `/web/agent-tasks`，不再用 `agent_type` 作为 task dispatch fallback。验证：Web focused tests 6 个文件 / 32 个测试通过；Web typecheck/build 通过；Hub handler/service focused tests 通过；OpenAPI YAML 解析通过；Web Hub-only boundary 12/12 通过；Web 1440x920 Playwright smoke 通过，截图 `app/web/.tmp/visual-smoke-web.png`。

### Task 9: Tauri Host API 拆分

**Files:**

- Create: `app/desktop/src-tauri/src/host/mod.rs`
- Create: `app/desktop/src-tauri/src/host/edge.rs`
- Create: `app/desktop/src-tauri/src/host/fs.rs`
- Create: `app/desktop/src-tauri/src/host/dialog.rs`
- Create: `app/desktop/src-tauri/src/host/auth.rs`
- Create: `app/desktop/src-tauri/src/host/window.rs`
- Create: `app/desktop/src-tauri/src/host/system.rs`
- Modify: `app/desktop/src-tauri/src/commands.rs`
- Test: `app/desktop/src-tauri/src/host/*_tests.rs` 或模块内 tests

- [ ] 先迁移纯函数和 path validation 测试。
- [ ] 再迁移文件能力，保证 allowlist 负测。
- [ ] 再迁移 Edge lifecycle command。
- [ ] `commands.rs` 只保留注册和兼容 shim。
- [ ] 跑 `cargo test` 或 Tauri crate focused tests。

### Task 10: 旧 UI 清理

**Files:**

- Delete or retire active imports:
  - `app/desktop/src/components/ChatView.tsx`
  - `app/desktop/src/components/PromptInput.tsx`
  - `app/desktop/src/components/RunDetail.tsx`
  - `app/desktop/src/components/ThreadPanel.tsx`
  - `app/desktop/src/hooks/useChatMessages.ts`
  - `app/desktop/src/hooks/useIMChat.ts`
  - Web duplicate Chat/Prompt/Run/Thread files

- [x] 先确认没有 active route/import；首片已删除 Desktop/Web 旧 `viewRegistry`、旧 `MainView` 和旧 `IMView`。
- [ ] 删除旧测试或重写为 shared tests；首片已删除 Desktop 旧 `MainView/IMView/RunDetail/RightInspector/PermissionDialog` tests，剩余旧 Chat/Prompt/Thread/IM hook tests 后续随类型迁移处理。
- [ ] 删除旧 CSS modules 或迁移必要 token；首片已删除旧 `IMView`、Desktop `RunDetail/RightInspector/PermissionDialog` 和 Web `PermissionDialog` CSS。
- [x] 运行旧入口扫描；新增 `scripts/verify-v4-old-ui-active-paths.ps1`。
- [x] 跑 full Desktop/Web typecheck。

下一批安全顺序：

1. **类型合同迁移**：补齐 `app/shared/src/types/chat.ts` 或抽出 `app/shared/src/types/diff.ts`，覆盖 `ChatMessage`、`MessageBlock`、`ToolResultBlock`、`FileDiff`、`DiffHunk`、`DiffLine`、Web `ReplyTarget`。
2. **导入迁移**：把 Desktop/Web active source 和仍需要保留的测试从旧 `ChatView.types` 改到 shared 类型，零行为改变。
3. **门禁加强**：在 `scripts/verify-v4-old-ui-active-paths.ps1` 增加旧 `ChatView.types` active import 检查。
4. **组件删除**：删除 Desktop/Web `ChatView`、`PromptInput`、`ThreadPanel`、Web `RunDetail`、Desktop IM `IMBlockRenderer`、旧 hooks 和对应旧测试/CSS。
5. **功能迁移**：`DiffViewer`、`ArtifactBrowser`、Search/Dialog、Web `hubAdapters` 中仍有价值的逻辑只迁到 shared inspector/transcript/diff contract，不接回旧 UI。

验证命令：

```powershell
cd app/shared; corepack.cmd pnpm exec vitest run src\types --reporter=dot
cd app/desktop; corepack.cmd pnpm typecheck
cd app/web; corepack.cmd pnpm typecheck
.\scripts\verify-v4-old-ui-active-paths.ps1
```

执行记录：
- 2026-06-07：删除 Desktop/Web 旧 registry、旧 `MainView/IMView` active route、Desktop 旧 `RunDetail/RightInspector/PermissionDialog` 和 Web 孤儿 `PermissionDialog`；新增 `scripts/verify-v4-old-ui-active-paths.ps1`，阻断 active Desktop/Web source 重新 import 旧 `ChatView`、`PromptInput`、`RunDetail`、`ThreadPanel`、`IMBlockRenderer`、`useChatMessages`、`useIMChat` 或旧 `viewRegistry`。验证：Desktop typecheck/build 通过；Web focused tests 6 个文件 / 32 个测试通过；Web typecheck/build 通过；Desktop App v4 focused tests 1 个文件 / 4 个测试通过；Web Hub-only boundary 12/12 通过；v4 old UI active path boundary 16/16 通过；Desktop/Web 1440x920 Playwright smoke 通过。
- 2026-06-07：只读 `opus` 子代理盘点剩余旧 UI 债务，结论是先迁移 shared `ChatMessage/FileDiff` 兼容合同，再删除旧 Chat/Prompt/Thread/IM hook 本体；该输出仅作为架构辅助，不作为测试证据。
- 2026-06-07：旧 `ChatView.types` 类型 import 已迁到 shared `types/chat.ts`，门禁脚本新增旧类型 active import 检查并通过 17/17；下一步可删除旧 `ChatView.types.ts` 文件和依赖它的旧组件本体/旧测试。
- 2026-06-07：删除旧 Desktop `ChatView/PromptInput/ThreadPanel/useChatMessages/useIMChat/IMBlockRenderer/IMMessageView` 及对应旧测试/CSS；删除旧 Web `ChatView/PromptInput/ThreadPanel/RunDetail/ReplyPreviewBar/useIMChat/IMMessageView` 及对应旧测试/CSS；IM index 不再导出旧 message view/renderer；Desktop E2E 旧 PromptInput/ThreadPanel 断言改为 v4 composer/sidebar 语义。验证：Desktop typecheck 通过；Web typecheck 通过；Desktop App v4 focused tests 1 文件 / 4 测试通过；Web App focused tests 1 文件 / 3 测试通过；v4 old UI active path boundary 44/44 通过；`git diff --check` 通过。

## 6. 验收命令

```powershell
git diff --check
.\scripts\verify-v4-old-ui-active-paths.ps1
cd app/shared; corepack.cmd pnpm lint; corepack.cmd pnpm test
cd ..\desktop; corepack.cmd pnpm typecheck; corepack.cmd pnpm test
cd ..\web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
cd desktop\src-tauri; cargo test
```

旧入口扫描不是要求字符串绝对为零；测试名、归档说明和迁移记录可以存在，但 active route/import 不能继续依赖旧 UI。

## 7. 截图矩阵

| Surface | Viewport | 场景 |
|---|---:|---|
| Desktop | 1440x920 | 对话 + inspector 展开 |
| Desktop | 1280x800 | 对话 + inspector 展开 |
| Desktop | 390x844 | sidebar/inspector 收起，composer 不遮挡 |
| Web | 1440x920 | 同 Desktop 信息架构 |
| Web | 1280x800 | 同 Desktop 信息架构 |
| Web | 390x844 | 同 Desktop 响应式行为 |

每张截图必须配 DOM 检查：无横向滚动、无关键文本遮挡、composer 不遮挡最后消息、主要按钮可点击。

## 8. 分支策略

- 文档设计分支：`docs/desktop-web-v4-clean-rebuild`
- 实现分支建议：`feat/desktop-web-v4-clean-rebuild`
- 合并目标：`dev/delicious233`
- 保留协作者分支：`origin/dev/trump`、`origin/dev/johnny`
- 不复活已删除历史分支。

## 9. 不做事项

- 不修改 `agenthub-design`。
- 不复制 v4 静态 HTML/CSS/JS 作为生产代码。
- 不新增第二套 Web UI。
- 不保留旧 ChatView 作为长期 fallback。
- 不把 Tauri command shim 当成最终 Host API。
- 不用截图 mock 冒充真实数据链路完成。
