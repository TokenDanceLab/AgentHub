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
- [ ] 从 Hub message 归一化 IM text/agent/status/team events。
- [ ] renderer 复用 shared UI 卡片，不复制 Desktop 旧 renderer。
- [ ] 覆盖 null/畸形 tool input、长输出截断、未知 block fallback。

执行记录：
- 2026-06-07：新增 `app/shared/src/transcript/normalizeThreadItems.ts` 和测试，把 Edge persisted thread items 映射为 shared `TranscriptBlock`，并为 `runId` 生成 `EvidenceRef(kind="run")`。
- 2026-06-07：新增 `app/shared/src/transcript/normalizeEdgeEvents.ts` 和测试，把 live Edge `run.*`、`run.agent.*`、`artifact.created` 事件映射为 shared `TranscriptBlock` 与 run/tool/file/artifact evidence；focused shared tests 更新为 6 个文件 / 14 个测试通过。

### Task 5: composer 收敛

**Files:**

- Create: `app/shared/src/composer/types.ts`
- Create: `app/shared/src/composer/composerReducer.ts`
- Create: `app/shared/src/composer/UnifiedComposer.tsx`
- Test: `app/shared/src/composer/*.test.tsx`

- [ ] 实现 mode：Ask / Plan / Code / Review / Deploy。
- [ ] 实现 @Agent mention、附件、workdir、approval mode。
- [ ] 实现 per conversation draft persistence interface。
- [ ] 实现 Enter 发送、Shift+Enter 换行、disabled/loading/error；首片已覆盖平台提交失败时保留草稿并退出 submitting 状态。
- [x] submit 只发出 intent，由 platform adapter 执行；Desktop 首片已把 intent 转成当前 Edge thread 的 `startRun` 请求。

执行记录：
- 2026-06-07：shared `AgentHubWorkbench` 在 platform submit 失败时保留 composer 草稿并恢复可编辑状态；focused shared tests 更新为 6 个文件 / 15 个测试通过。

### Task 6: inspector 收敛

**Files:**

- Create: `app/shared/src/inspector/types.ts`
- Create: `app/shared/src/inspector/InspectorPanel.tsx`
- Create: `app/shared/src/inspector/ToolTimelinePanel.tsx`
- Create: `app/shared/src/inspector/ChangedFilesPanel.tsx`
- Create: `app/shared/src/inspector/PreviewPanel.tsx`
- Test: `app/shared/src/inspector/*.test.tsx`

- [ ] 聚合 `EvidenceRef` 为 progress、tool timeline、changed files、artifacts。
- [ ] 支持 overview/browser/files 三种 v4 inspector tab。
- [ ] 支持 collapse/resize 状态由 workbench 控制。
- [ ] 文件/浏览器预览通过 platform capability 决定可用性。
- [ ] 覆盖空状态、失败状态、长文件名、窄屏。

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
- [x] v4 composer submit 通过 Desktop platform adapter 调用真实 Edge `startRun`。
- [x] 跑 Desktop typecheck 和 focused tests。

执行记录：
- 2026-06-07：已建立 `app/desktop/src/platform/desktopPlatform.ts` 首片 adapter，先声明 Desktop capability 并提供 active route smoke transcript；真实 Edge event/message/run normalize 仍是后续任务，不把静态首片当完成。
- 2026-06-07：`app/desktop/src/App.tsx` 已替换为 shared `AgentHubWorkbench` 装配入口。
- 2026-06-07：Desktop v4 focused test、Desktop typecheck/build、1440x920 Playwright visual smoke 均通过。
- 2026-06-07：新增 `app/desktop/src/platform/useDesktopWorkbenchModel.ts`，Desktop root 已在有 Edge thread 数据时显示真实会话和 persisted transcript；fallback transcript 只在没有 Edge thread 数据时使用。
- 2026-06-07：新增 `app/desktop/src/platform/useDesktopEdgeEvents.ts`，Desktop root 已订阅 live Edge event stream，过滤当前 thread 并把 live blocks 合并进 shared v4 transcript；Desktop App focused tests 更新为 1 个文件 / 3 个测试通过。
- 2026-06-07：`app/desktop/src/App.tsx` 通过 `useCreateRun` 把真实 Edge run mutation 注入 `desktopPlatform`；v4 composer submit 会提交 `{ projectId, threadId, prompt }` 到 active Edge thread，没有真实 Edge thread 时不再假成功；Desktop App focused tests 更新为 1 个文件 / 4 个测试通过。

### Task 8: Web platform adapter

**Files:**

- Create: `app/web/src/platform/webPlatform.ts`
- Create: `app/web/src/platform/hubClient.ts`
- Modify: `app/web/src/App.tsx`
- Modify: `app/web/src/main.tsx`
- Test: `app/web/src/platform/*.test.ts`

- [ ] 把 Hub session、conversation、message、remote run 包装为 shared ports。
- [ ] Web `App.tsx` 只装配平台 adapter 和 `AgentHubWorkbench`。
- [ ] Web 不引入 Tauri 或 Local Edge 私有能力。
- [ ] 跑 Web typecheck/build/focused tests。

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

- [ ] 先确认没有 active route/import。
- [ ] 删除旧测试或重写为 shared tests。
- [ ] 删除旧 CSS modules 或迁移必要 token。
- [ ] 运行旧入口扫描。
- [ ] 跑 full Desktop/Web typecheck。

## 6. 验收命令

```powershell
git diff --check
rg -n "ChatView|PromptInput|IMBlockRenderer|RunDetail|ThreadPanel|useChatMessages|useIMChat|viewRegistry" app docs README.md AGENTS.md
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
