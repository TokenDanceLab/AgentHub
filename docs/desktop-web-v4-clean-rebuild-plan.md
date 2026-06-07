# AgentHub Desktop/Web v4 Clean Rebuild 实施计划

> 最后更新：2026-06-07

> **给执行 Agent 的要求**：实现本计划时按任务逐项打勾，优先使用独立实现分支；每个阶段必须提交 focused tests、typecheck、截图或明确的未完成风险。不要把旧 UI 继续扩写成长期 fallback。

**目标**：以当前 shared workbench 和 mock/demo 运行态为新标准，参考 `agenthub-design/index.html` 和 `agenthub-design/desktop/` 历史原型，重建 AgentHub Desktop/Web 通用工作台，让 Desktop 和 Web 共用同一套 UI 架构、消息流合同、composer、inspector 和设计系统。

**架构**：`app/shared` 承载 shared workbench、transcript、composer、inspector、platform contracts；`app/desktop` 和 `app/web` 只提供 platform adapter 与启动入口。Tauri Host API 从巨石 command 文件拆为能力模块，UI 只通过 typed adapter 使用平台能力。

**技术栈**：React 19、TypeScript、Vite、CSS Modules、Vitest、Playwright、Tauri 2、Go Edge/Hub、WebSocket typed events。

---

## 1. 已确认事实

| 事实 | 证据 | 影响 |
|---|---|---|
| Desktop/Web 旧主 UI 已退出 active path | Desktop/Web 旧 `ChatView`、`PromptInput`、`ThreadPanel`、`RunDetail` 等主路径文件已删除；`scripts/verify-v4-old-ui-active-paths.ps1` 曾通过 44/44 | 后续不能再把旧 UI 当 fallback；需要把剩余有价值逻辑迁入 shared contract |
| shared workbench 已成为主入口 | `AgentHubWorkbench`、`GlobalRail`、`ConversationSidebar`、`WorkspaceHeader`、`TranscriptView`、`UnifiedComposer`、`RightInspector` 已接入 Desktop/Web | 当前重点从“替换入口”转为“shared workbench 视觉收口、blocks/pages 接线、设计系统冻结” |
| Desktop/Web 设计 token 已同步 | `app/desktop/src/styles/tokens.css` 与 `app/web/src/styles/tokens.css` 一致；`themes.css` 也一致 | 后续 token 改动必须双端同步，优先抽 shared token 源，不能重新分叉 |
| 主题切换已统一到 shared 通道 | `app/shared/src/theme.ts` 提供 `applyAgentHubTheme()`；Workbench、Desktop ThemeContext、Web ThemeContext 均走同一 helper；5173/5174 Playwright 已验证 immediate 同步切换 | 后续不得绕过 shared helper 直接裸写 `html[data-theme]`；新增主题入口必须保持 `data-theme-sync` 同步期 |
| 左右侧栏 resize/collapse 已形成交互基线 | 左侧最近频道栏默认 260px、范围 180-360px、96px snap collapse；右侧 inspector 越过 96px 阈值在 pointermove 阶段立即 collapse | 后续只能在此基线上做细节微调，不能恢复“松手后才折叠”或 48px 残留窄栏 |
| visible composer 已按设计 demo 收敛 | `UnifiedComposer` 只渲染 `.composer`、`.composerRow`、textarea 和发送按钮；@Agent/权限/workDir/附件控件不在首屏可见层 | GLM 报告里“恢复工具条”的建议不采纳；语义保留在 reducer/intent/adapter 等待明确设计槽位 |
| 新组件目录正在分批接线 | `blocks/` 已接入 shared transcript detail renderer；`pages/` 已通过 `WorkbenchRoutes` 接 rail；`inspector/` 已接 overview/browser/files；`floating/ProfilePopover`、`Toast`、`ContextMenu`、`MultiSelectBar` 已接线；Contacts/Docs/Agents/Tasks/Projects/Settings 二级页已建立 5173 对 5176 的 computed-style/截图对比基线；card context menu / multi-select 已补齐真实卡片 surface 状态、复制、删除软隐藏和 toast 文案；Chat 主流已移除大型 run/session 总结卡，运行上下文留在步骤组和右侧 inspector | 下一批继续逐页对齐剩余 page/block 的 hover/focus、窄屏和截图矩阵；最新 `v4_subpage_compare.mjs` 仍需复核 Agents 首卡 padding/background 残余偏差；不能一次性把未验证组件暴露为 public API |
| Chat 首屏 pin/header 已完成微对齐 | 5173/5174 demo 模式的 Builder 置顶公告保持 `agenthub-design/desktop` 文案，不被 live pin 覆盖；`WorkspaceHeader` 的 avatar、title、kind、thread、model、tab、header button 与 5176 computed style 对齐；去掉 header tab/button 和 pin card/action 的额外上移动效 | 真实 Edge/Hub pin 继续只在 real/live 数据模式显示，不删除功能；后续继续扫 sidebar、subpages、block cards 的 hover/focus/icon/radius |
| Chat 压缩布局已改为运行态自适应 | 右侧 inspector 拖宽到挤压聊天列时，shared workbench 自动折叠左侧最近频道栏；置顶公告和 composer 都限制在 workspace 安全边界内，5173/5174 均无横向 overflow，滚到底部后最新消息与输入框保留约 54px 间距 | 不再用硬 `min-width:1180px` 解决真实窗口压缩；后续窄屏/拖拽验收优先检查自动折叠、边界和遮挡 |
| 固定控制区不换行规则已落地 | Workspace header/tabs、inspector tabs、MultiSelectBar、Tasks/Agents/Docs/Projects/Contacts 的 toolbar/action/tabs、shared DiffReviewPanel/ContextSummary 均改为单行、截断、内部 overflow 或 icon-only | 后续新增功能不能用换行撑高 toolbar/tab/action row；内容 chip/长文本流可换行，但固定控制区必须保持高度稳定 |
| User/Agent profile registry 已开始统一 | `app/shared/src/workbench/profileRegistry.ts` 已集中处理 User/Agent initials、Agent name hint、颜色和头像胶囊语义；Docs owner、Tasks assignee/creator、Projects member/run owner 已复用同一 resolver | 后续 Agent 配置、头像 URL、runtime/model 和技能标签必须进入同一个 registry/provider；新增页面不能自建头像或 Agent 判定逻辑 |
| 轻量文档/产物预览边界已冻结 | `app/shared/src/workbench/documentPreview.ts` 定义 `WorkbenchDocumentPreview`；Docs 行点击和 Projects 产物点击都打开同一套 inline `FilePreview`，复用源码/Markdown/Diff/打开方式菜单 | 当前不做完整飞书/Notion 式协同编辑器；后续通过 Document Provider 接 Hub artifact store、本地 workspace 和外部文档服务 |
| Demo/mock 发送必须可交互 | Desktop `5173` 没有真实 Edge `projectId/threadId` 时不再硬走 `submitRun`，而是回落到 demo runtime；Web `5174` demo/mock preview 同样走 shared demo submit | 快速视觉和交互开发时，demo 模式也要能发送、清空输入框、追加用户消息和 mock reply，不能因为 backend 未接好导致 UI 看起来失效 |
| Composer 快捷键偏好已共享 | 默认 `Enter` 发送，`Ctrl+Enter` / `Cmd+Enter` 换行；设置页 `本地开发 -> 发送快捷键` 可切到 `Ctrl+Enter 发送`；storage key 为 `agenthub.workbench.composerSubmitBehavior` | 后续不要在 Desktop/Web 私有层分别处理 Enter；所有输入行为改动先走 shared `workbenchPreferences` 和 `UnifiedComposer` |
| Tauri command 巨石化 | `src-tauri/src/commands.rs` 945 行，混合 Edge、文件、路径、系统能力 | Host API 必须拆分 |
| design v4 壳子已成型 | `agenthub-design/index.html` 是设计系统入口；`agenthub-design/desktop/` 包含 `index.html`、`styles.css`、`app.js`、single-file prototype 和 logo | 作为历史 UI 壳子、视觉密度和交互参考；当前基准以 shared workbench/mock demo 为准 |

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
- **一个消息方向规则**：只有当前登录用户渲染为右侧 user bubble；真人联系人、Agent、system preview 和其他非当前用户作者都渲染为左侧 incoming message card。`author.role` 只能表达身份语义，不能决定卡片是否存在。
- **一个 composer**：发送、草稿、@Agent、附件、workdir、approval mode 的语义一致。
- **一个 inspector**：run evidence、tool timeline、changed files、artifact、preview 的组件一致。
- **平台差异只进 adapter**：Desktop 的 Tauri/Local Edge 和 Web 的 Hub/browser 差异不进入共享 UI。
- **清理优先于兼容**：允许实现分支短期破坏旧 UI，最终不保留双主路径。
- **shared workbench 一致性优先于临时自创功能**：当前 shared workbench 首屏没有的可见控件，不得因为旧功能存在就重新摆上首屏。能力先保留在状态、intent 和 adapter 层，等产品信息架构给出明确槽位再可视化。
- **快速开发护栏**：当前阶段不追求 full test 全绿；必须保留 `git diff --check`、旧 UI active path 扫描和必要 focused smoke，视觉对齐阶段再补全截图矩阵、typecheck 和 full tests。

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

- [x] 写明 v4 shared workbench 是当前主线。
- [x] 写明 `agenthub-design/index.html` 和 `agenthub-design/desktop/` 是只读历史原型参考，当前基准以 shared workbench/mock demo 为准。
- [x] 写明 Desktop/Web 不再分阶段迁移，而是同源实现。
- [x] 写明旧 UI 文件是清理对象。
- [x] 写明 design 仓库只读，AgentHub 内实现。
- [x] 写明分支保留事实和清理结果。
- [ ] 运行 `git diff --check`。
- [ ] 运行 active docs 关键词扫描，确认没有旧主线冲突。

### Task 2: shared UI public API 清理

**Files:**

- Modify: `app/shared/src/ui/index.ts`
- Modify/Create: `app/shared/src/ui/tokens.css`
- Test: `app/shared/src/ui/*.test.tsx`

- [ ] 列出 v4 必需 primitives：Button、Icon、Tooltip、Modal、SegmentedControl、SearchInput、Avatar、Pill、ProgressBar。
- [ ] 列出 v4 必需业务卡片：MessageBubble、ToolTimeline、DiffReviewPanel、ArtifactCard、DeployCard。
- [ ] `PermissionModePicker` 等旧可见能力控件暂不作为 composer 首屏 public API，只能作为 settings/adapter 语义或未来明确设计槽位。
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
- [x] 按 `agenthub-design/desktop/index.html` 实现 v4 rail/sidebar/header/workspace/inspector 基础布局；5173/5174/5176 当前基础壳子坐标和 chrome policy 已进入对比脚本。
- [x] 按 `agenthub-design/desktop/styles.css` 抽取 token 意图、密度、间距、圆角、边框、focus 状态和动效边界；`v4_style_compare.mjs` 当前为 0 computed-style delta。
- [x] 按 `agenthub-design/desktop/app.js` 把 rail pages 原型交互转成 React state/reducer，不保留 DOM query 操作。
- [x] 保留 design demo 的 1180px 宽屏参考和历史截图基线；真实 Desktop/Web 运行态不再用硬 `min-width` 顶穿窗口，而是在 inspector 压缩聊天列时自动折叠左侧最近频道栏，Desktop/Web 保持同源 shell，Web 不显示 fake Desktop window chrome。
- [x] 将任务页 route id 对齐 design demo 的 `runs`，但保留产品文案“任务”；5173/5176 使用 32px Desktop chrome，5174 保持 Web 无 chrome 壳子。
- [x] 左侧最近频道栏和右侧 inspector 的 resize/collapse 统一到 shared shell 状态与 CSS grid；左右两侧都使用 96px snap 阈值和 shared motion token。
- [x] 深浅主题切换统一到 shared `applyAgentHubTheme()`，并用短暂 `data-theme-sync` 禁用颜色补间，保证全局同帧切换。
- [ ] 不直接依赖 Desktop/Web 私有模块。
- [x] 加 keyboard/aria 基础测试；已覆盖 global rail route、inspector collapse/resize 和 composer submit/error。
- [ ] 加 1440/1280/390 截图场景。

执行记录：
- 2026-06-07：新增 `app/desktop/.tmp/v4_subpage_compare.mjs` 作为 Desktop 5173 与 design demo 5176 的二级页面 computed-style/截图对比脚本，覆盖 Contacts、Docs、Agents、Tasks、Projects、Settings 共 26 个 pane；修复 demo runtime store 的 `useSyncExternalStore` snapshot 缓存，避免 5173 React maximum update depth；Settings 行样式补齐 `background: var(--surface)` 和块级标题，消除状态组件页行高/底色偏差；脚本输出摘要到终端并把 full/summary JSON 写入 `.tmp`。验证：`cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_subpage_compare.mjs`，26 个子页 `withDiffs=[]`、`withConsoleErrors=[]`；`cd app/desktop; corepack.cmd pnpm typecheck` 通过；`cd app/web; corepack.cmd pnpm typecheck` 通过；`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\transcript\normalizeEdgeEvents.test.ts --reporter=dot`，2 文件 / 16 测试通过；`.\scripts\verify-v4-old-ui-active-paths.ps1` 44/44 通过；`git diff --check` 通过，仅 CRLF 提示；截图写入 `app/desktop/.tmp/v4-subpage-{desktop|design}-*.png`。
- 2026-06-07：`app/desktop/.tmp/v4_design_compare.mjs` 升级为 Desktop 5173、Web 5174、design 5176 三方硬性对比，使用 `domcontentloaded + selector wait` 规避 Vite HMR 的 `networkidle` 超时；覆盖 `chat/contacts/docs/agents/runs/projects/settings` 与 `1440x920`、`390x844` 两视口，共 42 条结果。脚本现在校验 fatal/page/console error、Desktop/Web chrome policy、root/rail/workspace/primaryCard 存在、桌面无横向 overflow、390 窄屏保持 1180px 工作台基线、1440 根宽和 52px rail 宽，并在失败时返回非零退出码；仅窄过滤 Vite/外部资源连接关闭或超时噪声，不吞真实 UI 错误。验证：`cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_design_compare.mjs`，`compared=42`、`failures=[]`；完整结果写入 `app/desktop/.tmp/v4_design_compare.json`，截图写入 `app/desktop/.tmp/compare-*-517{3,4,6}-*.png`。
- 2026-06-07：Composer focus 细节按 design demo 收敛，删除 shared `.composerRow:focus-within` 的额外抬升/强阴影/边框改色，并在 `.composerInput:focus-visible` 显式覆盖全局 focus ring，保持 `agenthub-design/desktop` 的输入框 `border-radius:0`、`box-shadow:none` 和无自身 outline。验证：shared workbench focused tests 1 文件 / 14 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；`v4_card_mode_audit.mjs` 确认 5173/5174/5176 composer focus 的 radius/shadow/outline 完全一致。
- 2026-06-07：chat 首屏稳定 CSS 和动效边界继续收口。运行态坐标确认 5173 与 5176 的 rail/sidebar/workspace/inspector 均为 `52/260/728/400`；`v4_style_compare.mjs` 修正为不误点已激活 Chat 触发 shared sidebar collapse，并把 pinned padding、diff 展开态和当前 fixture 不存在的旧探针从基础样式对比中剥离，交由独立 smoke 覆盖。代码侧按 design 源码修正 `ProfilePopover` 入场为 `--dur-normal + --ease`，账号菜单行去掉实现侧额外 transition/transform；`ToolCardBlock` 背景、description `margin-top:4px` 与 `line-height:1.45` 对齐 `.agent-tool-card`；`RunStepGroup` open shadow、detail transform、detail inner `gap:8px`、`padding:0 12px 12px` 对齐 `.run-step-detail-inner`；nested thinking detail 的 `padding:11px 13px`、`radius:var(--r-md)`、正文 `margin-top:7px` 与 `line-height:1.55` 对齐 `.agent-detail-block.thinking-block`；send button 保留 design 源码的 background/transform transition，不额外指定反色文本。验证：`node app\desktop\.tmp\v4_style_compare.mjs` 输出 `No computed-style deltas against design.`；`node app\desktop\.tmp\v4_motion_polish_smoke.mjs` 在 5173/5174/5176 无 console/page error、无 overflow；`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，1 文件 / 25 测试通过；Desktop/Web typecheck 通过；`git diff --check` 通过，仅 CRLF warning。
- 2026-06-07：左侧最近频道栏补齐 Chat 页 resize/collapse：`--sidebar-w` 默认 260px、范围 180-360px，当前页点击 GlobalRail `对话` 直接折叠/展开，拖拽越过 96px snap 阈值后自动折叠；右侧 inspector 修复拖到最小后卡住的问题，越过 96px 阈值时在 pointermove 阶段立即进入 collapsed。验证：shared focused tests 2 文件 / 28 测试通过；Desktop/Web typecheck 通过；5173/5174 Playwright 证据保存到 `app/.tmp/v4-sidebar-resize-pass/` 和 `app/.tmp/v4-inspector-immediate-collapse-pass/`。
- 2026-06-07：按用户截图反馈修复右侧 inspector 拖宽后的聊天区挤压和置顶卡越界：shared shell 去掉硬 `min-width:1180px`，当 workspace 低于可读宽度时自动折叠左侧最近频道栏；置顶公告和 composer 都限制在 workspace 内，滚到底部后最新消息停在 composer 上方。验证：shared `AgentHubWorkbench.test.tsx` 23/23 通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；5173/5174 Playwright 压缩验证均为 `data-sidebar-collapsed=true`、横向 overflow 0，底部 clearance 约 54px；截图为 `app/desktop/.tmp/v4-pressure-layout-desktop.png`、`app/desktop/.tmp/v4-pressure-layout-web.png`、`app/desktop/.tmp/v4-pressure-bottom-desktop.png`、`app/desktop/.tmp/v4-pressure-bottom-web.png`。
- 2026-06-07：主题切换统一到 shared `app/shared/src/theme.ts`，Workbench theme button、Desktop ThemeContext、Web ThemeContext 均通过 `applyAgentHubTheme()` 提交 `data-theme`、`color-scheme` 和 storage；Desktop/Web `themes.css` 在 `data-theme-sync=true` 两帧内禁用 transition/animation，避免 token 切换时分批变色。验证：shared focused tests 2 文件 / 31 测试通过；Desktop/Web typecheck 通过；5173/5174 Playwright 证据保存到 `app/.tmp/v4-theme-sync-pass/`。
- 2026-06-07：Composer 发送和快捷键偏好补齐：Desktop demo preview 只有在 `submitRun && activeProjectId && activeThreadId` 同时存在时才走真实 Edge run，否则回落到 `workbenchDemoRuntimeStore.submitComposerIntent()`；`UnifiedComposer` 默认 `Enter` 发送、`Ctrl/Cmd+Enter` 换行，设置页可切到 `Ctrl+Enter 发送`。验证：shared focused tests 覆盖 `Enter to send`、`keyboard behavior from Settings`、`grouped consecutive user messages`、`submits composer`；Desktop `desktopPlatform.test.ts` 通过；5173/5174 Playwright smoke 确认 demo 发送追加消息和 mock reply、输入框清空、快捷键切换正确且无 console/pageerror。
- 2026-06-07：Agent 管理页继续按 design demo 收口。标题改为 `Agent管理`；GlobalRail Agent 图标换成更清晰的 v4 stroke 机器人头；Agents 页运行引擎、默认模型、运行模式、状态和 Contacts 国家区号均使用 shared v4 `Select`，不再使用原生页面级下拉；`AgentsPage` 列表和详情头像改为 `resolveWorkbenchProfile()`，不再使用页面局部首字母/颜色 helper；已安装列表行移除 `data-card-surface`、彩色左描边和自创阴影，回到轻量列表行；右侧详情内部左靠，Skills/工具权限/最近运行退回 design demo 的分段列表，不再嵌套卡片。验证：shared `AgentHubWorkbench.test.tsx` 25/25 通过；`verify_agents_page_refine.mjs` 在 5173/5174 均无 console error，头像为 34x34、8px radius，截图写入 `app/desktop/.tmp/agents-page-refine-5173.png`。当前仍需继续核对 Agents 市场首卡、字段密度、真实 Agent provider 和头像 URL。
- 2026-06-07 晚间：按用户“不要换行挤压，窄宽隐藏文字或只显示 icon”要求，全局收敛固定控制区响应式行为。`AgentHubWorkbench.module.css` 的 workspace header/tabs 和 inspector tabs 改为 nowrap + ellipsis + 窄宽 icon-only；`MultiSelectBar` 单行滚动，窄宽动作只显示 icon 且保留 `aria-label/title`；Tasks toolbar、Agents market toolbar、Docs/Projects/Contacts tabs/actions、shared `DiffReviewPanel` toolbar 和 `ContextSummary` actions 均不再通过 `flex-wrap` 撑高布局。保留的 wrap 只限技能 chip、项目成员 chip、空状态建议等内容流。验证：shared focused tests 2 files / 51 tests passed；Desktop/Web typecheck passed；`v4_responsive_audit.mjs` `compared=9 failures=[]`；`v4_design_compare.mjs` `compared=42 failures=[]`；旧 UI active path 44/44 passed；`git diff --check` 无 whitespace error。

### Task 4: transcript contract 和 renderer

**Files:**

- Create: `app/shared/src/transcript/types.ts`
- Create: `app/shared/src/transcript/normalizeEdgeEvents.ts`
- Create: `app/shared/src/transcript/normalizeHubMessage.ts`
- Create: `app/shared/src/transcript/TranscriptView.tsx`
- Create: `app/shared/src/transcript/TranscriptBlockRenderer.tsx`
- Test: `app/shared/src/transcript/*.test.tsx`

- [x] 定义 `TranscriptBlock` discriminated union，已覆盖 text/tool/diff/approval/artifact/thinking/subagent/child_agent/route_decision/context_usage/result。
- [ ] 定义 `EvidenceRef`，供 inspector 聚合。
- [x] 从 Edge runtime events 归一化 text/tool/diff/approval/artifact/thinking/subagent/child_agent/route_decision/context_usage/result；首片已支持 persisted thread items 和 live WebSocket events。
- [ ] 从 Hub message 归一化 IM text/agent/status/team events；首片已支持 Hub session message -> shared text transcript，Web Hub WS 已接 query invalidation，Hub `agent.stream` runtime event 已直接 projection，Web Hub message submit 已有 optimistic cache；后续补 team runtime events 和更完整 renderer。
- [x] renderer 复用 shared UI 卡片，不复制 Desktop 旧 renderer；`TranscriptView` 已接 design detail blocks。
- [x] text block 方向按 current-user 判定：当前用户 `Delicious233` 走右侧 `UserMessage`，其他作者无论 `human/agent/system` 都走左侧 `AgentMessage` 白色卡片；Johnny/Trump 等真人联系人不得因为不是 Agent 而退化成裸文本。
- [ ] 覆盖 null/畸形 tool input、长输出截断、未知 block fallback。

合同边界：

- `TranscriptBlock` 是 v4 渲染目标合同；Desktop/Web 新工作台不得继续以旧 `ChatView.types` 作为跨端目标模型。
- `app/shared/src/types/chat.ts` 只作为旧消息视图兼容合同，服务 Search、Diff、artifact 提取、旧测试迁移和旧组件删除前的过渡。
- `TextTranscriptBlock.author.role` 只表达 `human/agent/system` 身份，不是 outgoing/incoming 布局开关；布局必须由当前用户身份判定。
- 下一批实现先补齐 shared `ChatMessage/MessageBlock/FileDiff` 兼容类型和缺失 block kind，再把 Desktop/Web 的 `import type { ... } from '@/components/ChatView.types'` 迁到 shared 类型。
- 旧 `ChatView.types.ts` 不新增字段、不作为 fallback 根；类型迁移完成后与旧组件本体一起删除。

执行记录：
- 2026-06-07：新增 `app/shared/src/transcript/normalizeThreadItems.ts` 和测试，把 Edge persisted thread items 映射为 shared `TranscriptBlock`，并为 `runId` 生成 `EvidenceRef(kind="run")`。
- 2026-06-07：新增 `app/shared/src/transcript/normalizeEdgeEvents.ts` 和测试，把 live Edge `run.*`、`run.agent.*`、`artifact.created` 事件映射为 shared `TranscriptBlock` 与 run/tool/file/artifact evidence；focused shared tests 更新为 6 个文件 / 14 个测试通过。
- 2026-06-07：新增 `app/shared/src/transcript/normalizeHubMessages.ts` 和测试，把 Hub session messages 映射为 shared `TranscriptBlock`，Web v4 不再依赖旧 `ChatView` 消息转换；focused shared tests 中相关 4 个文件 / 15 个测试通过。
- 2026-06-07：新增 `normalizeHubRuntimeEventsToTranscript`，复用 Edge runtime normalizer，把 Hub WS `agent.stream` payload 的 `event_type/payload/edge_run_id/session_id` 投影成 shared transcript blocks，并保留 run/tool/artifact preview evidence；focused shared tests 更新为 11 个文件 / 36 个测试通过。
- 2026-06-07：shared `types/chat.ts` 升级为旧 `ChatView.types` 迁移兼容合同，新增 `ReplyTarget`、显式 `undefined` 兼容字段和 `chat.test.ts`；Desktop/Web/shared 的旧 `ChatView.types` 类型 import 已迁到 shared，`verify-v4-old-ui-active-paths.ps1` 已新增旧 `ChatView.types` active import 回归检查。验证：shared `src\types\chat.test.ts` + `src\ui\MessageSearchPanel.test.tsx` 2 文件 / 13 测试通过；Desktop typecheck 通过；Web typecheck 通过；Web Diff/MessageTime focused tests 2 文件 / 4 测试通过；Desktop Diff/Search focused tests 2 文件 / 25 测试通过；v4 old UI active path boundary 17/17 通过。
- 2026-06-07：Transcript selectable cards 补齐键盘交互和统一焦点视觉：卡片可 Tab 聚焦，Shift+F10/ContextMenu 打开设计菜单，选择模式下 Space/Enter 切换选中；focus-visible ring 落在真实 `data-card-surface` 上，不改变默认静态卡片。验证：shared workbench focused tests 1 文件 / 14 测试通过；Desktop/Web typecheck 通过；5173/5174 键盘卡片 smoke 通过，截图 `app/desktop/.tmp/v4-card-keyboard-desktop.png`、`app/web/.tmp/v4-card-keyboard-web.png`。
- 2026-06-07：Transcript 长按多选按 design demo 行为补齐到 shared Workbench：520ms 长按进入多选、Esc 退出、Ctrl+A 全选、Ctrl+C 复制、Delete/Backspace 软删除；鼠标二次选择改走 pointerup，避免卡片内部元素吞 click。同步补齐用户连续消息头像分组，5 分钟内同一 human author 的后续 text 气泡隐藏重复头像并保留右侧占位。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，1 文件 / 18 测试通过；Desktop/Web typecheck 通过；`node app\desktop\.tmp\v4_long_press_multiselect_smoke.mjs` 在 5173/5174 无 failures。
- 2026-06-07：Settings 状态组件页继续按 design 源码收口：`.settings-state-system`、`.state-grid`、`.state-panel`、`.state-mark` 同名结构进入 shared；设置行和状态面板去掉原型外 hover 位移/额外阴影，按钮高度、panel 高度、圆角、色阶与 5176 对齐。验证：`node app\desktop\.tmp\v4_settings_states_smoke.mjs` 覆盖 5173/5174/5176，三端无 failures，截图写入 `v4-settings-states-{desktop,web,design}.png`。
- 2026-06-07：`TranscriptBlock` union 与 `TranscriptView` 接入 design detail blocks：thinking、Subagent/子Agent、route decision、context usage、result；`normalizeEdgeEventsToTranscript` 支持对应 runtime events，Desktop/Web fallback transcript 已展示同一套 v4 detail blocks。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\transcript\normalizeEdgeEvents.test.ts --reporter=dot`，2 个文件 / 11 个测试通过。
- 2026-06-07：Desktop-only `DesktopChrome` 接入 5173，shared shell 高度改为填充 chrome content；5174 继续直接渲染 shared workbench，不引入 fake window chrome；`v4_design_compare.mjs` 覆盖 5173/5174/5176 三方截图并记录 chrome policy。验证：Desktop App v4 focused tests 1 文件 / 4 测试通过；Web App focused tests 1 文件 / 3 测试通过；shared workbench focused tests 1 文件 / 12 测试通过；Desktop/Web typecheck 通过；三方截图 JSON 无 console/page error，5173/5176 chrome present、5174 chrome absent。
- 2026-06-07：按 `agenthub-design/desktop` 的 `builderAgentHistory()` 重组 Chat 默认运行流：`TranscriptBlock` 新增 `agent_timeline` 与 `run_step_group`，`TranscriptView` 新增 grouped run-step 渲染和 nested tool/file/diff/thinking child renderer；Desktop fallback transcript 与 shared demo transcript 保留 `agent_timeline -> 深度思考 -> 已运行 3 条命令` 的运行结构，但不再把 `run_session` 渲染成主聊天流里的大型白色总结卡；运行会话元数据留给步骤组、evidence 和右侧 inspector 表达。5174 Web preview 继承 shared demo。验证：shared focused tests 2 个文件 / 16 个测试通过；Desktop/Web typecheck 通过；5173/5174/5176 Playwright screenshot smoke 无 console/page error。
- 2026-06-07：`TranscriptView` 的 artifact/file row `Review` 动作已贯通到 `AgentHubWorkbench` 和 `RightInspector`，点击文件变更行会展开右侧栏、恢复 `文件` tab 并打开对应 `FilePreview`；`RightInspector` 的 B0 demo 任务、文件清单、文件内容和 diff 抽到 `app/shared/src/demo/workbenchDemoData.ts`，展示组件只消费结构化数据，不再内联聊天记录关联的文件正文。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，1 文件 / 17 测试通过；Desktop/Web typecheck 通过；`cd app/desktop; corepack.cmd pnpm exec node .tmp\verify_review_opens_inspector.mjs`，5173/5174 均打开 SQL 预览且无 console error。
- 2026-06-07：修复 Johnny 私聊等非 Agent 作者的 incoming 消息卡片消失问题。根因是旧逻辑把 `author.role === "agent"` 当成左侧消息卡片条件，导致真人联系人容易退化为裸文本或错误路径；现已改为只有当前用户 `Delicious233` 走右侧 `UserMessage`，其余作者统一走左侧 `AgentMessage`。`AgentMessage` 白色卡片恢复 `surface/border/shadow`，并加 `data-agent-bubble` 作为 Playwright/DOM 验收标记；demo preview 中 Johnny/Trump 标为 `human`。验证：shared Johnny/profile focused tests 3 passed，demo runtime tests 5 passed。

### Task 5: composer 收敛

**Files:**

- Create: `app/shared/src/composer/types.ts`
- Create: `app/shared/src/composer/composerReducer.ts`
- Create: `app/shared/src/composer/UnifiedComposer.tsx`
- Test: `app/shared/src/composer/*.test.tsx`

- [ ] 实现 mode：Ask / Plan / Code / Review / Deploy 的语义字段和 adapter 传递。
- [ ] 实现 @Agent mention、附件、workdir、approval mode 的语义字段和 adapter 传递；首屏可见层不得恢复旧工具条、旧 chip 或旧下拉。
- [ ] 实现 per conversation draft persistence interface。
- [ ] 实现 Enter 发送、Shift+Enter 换行、disabled/loading/error；首片已覆盖平台提交失败时保留草稿并退出 submitting 状态。
- [x] submit 只发出 intent，由 platform adapter 执行；Desktop 首片已把 intent 转成当前 Edge thread 的 `startRun` 请求。
- [x] 设置页支持 `自动/Mock/正常` 数据模式选择，统一写入 shared `agenthub.workbench.dataMode` storage key，并用状态卡片说明 Desktop/Web 当前数据来源。

执行记录：
- 2026-06-07：shared `AgentHubWorkbench` 在 platform submit 失败时保留 composer 草稿并恢复可编辑状态；focused shared tests 更新为 6 个文件 / 15 个测试通过。
- 2026-06-07：shared `UnifiedComposer` 增加 approval mode 下拉和 workDir 输入；`buildComposerIntent` 会输出 trim 后的 `workDir`，但不会把空 workDir 写入 intent；focused shared tests 更新为 7 个文件 / 19 个测试通过。
- 2026-06-07：新增 shared `composer/attachments.ts`，支持浏览器文件转附件、文本预览截断、附件上下文格式化和 attachment-only prompt；`UnifiedComposer` 已显示附件入口/chip/删除动作，focused shared tests 更新为 8 个文件 / 23 个测试通过。
- 2026-06-07：新增 shared `composer/mentions.ts`，`UnifiedComposer` 已支持 @Agent 菜单、mention chip、移除动作和结构化 mention intent；Desktop submit 会把 mention 名称、id、模型、runtime 拼进 Edge prompt；focused shared tests 更新为 9 个文件 / 26 个测试通过。
- 2026-06-07：shared platform 新增 `attachments.pickFiles()` port；Desktop `UnifiedComposer` 的附件按钮在有 platform picker 时走 Tauri 原生文件选择，并把本机路径和文本预览写入 `ComposerIntent.attachments`；focused shared tests 更新为 9 个文件 / 30 个测试通过。
- 2026-06-07：按用户 1:1 对齐要求回收 composer 可见层：删除自造 mode toolbar、@Agent 按钮/chip、approval/workDir 控件和附件入口；`UnifiedComposer` 当前只显示设计 demo 的输入框和发送按钮。上述语义仍保留在 composer reducer、intent、Desktop/Web adapter 和测试数据中，等待设计系统明确槽位后再可视化。
- 2026-06-07：Settings 本地开发页补齐数据模式状态卡片，`自动/Mock/正常` 的 segmented controls 与 `agenthub.workbench.dataMode` 持久化同步；Mock 模式说明固定使用 `agenthub-design` 演示数据，正常模式说明只走真实 Hub/Edge 数据。本轮继续把状态区收敛到 design demo 的设置页语言：初始 label 统一为中文，状态值使用 v4 胶囊 badge，移除非原型分隔点，窄屏下行控件和 facts 单列避免溢出。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\demo\dataMode.test.ts --reporter=dot`，2 文件 / 16 测试通过；Desktop/Web typecheck 通过；`cd app/desktop; corepack.cmd pnpm exec node .tmp\settings-mode-check.mjs` 确认 5173/5174 设置页 smoke 通过，5174 无 console error，截图 `app/desktop/.tmp/settings-mode-check/desktop-settings-local-1440.png`、`app/desktop/.tmp/settings-mode-check/web-settings-local-1440.png`。

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
- [x] 支持 collapse/resize 状态由 workbench 控制。
- [x] 文件/浏览器预览通过 platform capability 决定可用性；已显示 changed files list/empty state 和 browser preview capability 状态，并通过 `preview.openEvidence()` 把 file/artifact evidence 打开动作交给 platform adapter。
- [x] inspector tab 支持关闭和通过 `+` 菜单恢复；`+` 菜单已暴露文件、侧边聊天、浏览器、终端等 Codex-like 快捷入口框架。
- [x] 文件预览支持源码、Markdown 预览、Diff 预览和“打开方式”菜单；当前为 shared UI/adapter 框架，外部应用实际打开仍需 Desktop/Web platform action 接线。
- [ ] 覆盖空状态、失败状态、长文件名、窄屏和 inspector 关闭/恢复交互截图。

执行记录：
- 2026-06-07：新增 `app/shared/src/inspector/inspectorEvidence.ts`、`app/shared/src/inspector/index.ts` 和 focused tests；`RightInspector` 已从占位文本升级为 overview summary、run/tool/artifact evidence sections、changed files tab 和 browser capability card。
- 2026-06-07：`collectTranscriptEvidence` 保持首次出现顺序，同时用后续同 ID evidence 更新最新 status，避免 live Edge run 状态被早期 pending/running evidence 卡住；shared focused tests 更新为 7 个文件 / 19 个测试通过。
- 2026-06-07：`EvidenceRef` 新增 `path/uri/mimeType` preview 元数据，`RightInspector` files/browser tabs 已渲染可点击 file/artifact 行并调用 platform `preview.openEvidence()`；shared focused tests 更新为 9 个文件 / 31 个测试通过。
- 2026-06-07：`AgentHubWorkbench` 按 design prototype 接入 inspector CSS 变量宽度、header icon collapse toggle 和可访问 resize separator；`RightInspector` 支持 ArrowLeft/ArrowRight 键盘 resize，折叠状态由 workbench 控制。验证：shared workbench focused tests 1 文件 / 9 测试通过；Desktop/Web typecheck 通过；Desktop/Web App focused tests 通过；Desktop 1440x920 Playwright DOM/screenshot smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop-inspector.png` 大小 59767 bytes。
- 2026-06-07：RightInspector overview 改为 design prototype 的 B0 任务和文件清单优先，避免 runtime evidence 把首屏 demo 任务/最终文件改形；真实 file/artifact evidence 继续保留在 files/browser tab 和 platform preview port。验证：shared focused tests 2 个文件 / 16 个测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；5173/5174/5176 responsive audit 无 console/page error。
- 2026-06-07：RightInspector 补齐 tab 关闭和 `+` 恢复/快捷入口框架，`概览/浏览器/文件` 均可关闭，`+` 菜单可恢复关闭 tab，并展示文件、侧边聊天、浏览器、终端入口；`FilePreview` 补齐源码、Markdown、Diff 三种查看模式和“打开方式”菜单，菜单先记录目标选择，后续由 Desktop/Web platform adapter 接真实本机打开、Web 下载或禁用策略；同时修复 `+` 菜单被 inspector panel stacking context 截获点击的问题。验证：shared workbench focused test 已覆盖 Markdown 预览、Diff 切换、打开方式、关闭文件 tab、`+` 恢复文件 tab 和浏览器快捷入口；Desktop/Web typecheck 通过；5173/5174/5176 responsive audit 无 console/page error；`v4_inspector_interaction_smoke.mjs` 在 5173/5174 点击通过，截图写入 `app/desktop/.tmp/v4-inspector-interaction-desktop.png`、`app/web/.tmp/v4-inspector-interaction-web.png`，5176 对照截图写入 `app/desktop/.tmp/v4-inspector-interaction-design.png`。
- 2026-06-07 晚间：`FilePreview` 进一步从右栏内嵌弹窗卡收敛为文件 tab 的单行 editor header：去掉 pane 外层 border/radius/shadow，文件名单行截断，代码文件只显示 `源码/Diff`，Markdown 才显示 `预览`，`打开方式` 降为 icon-only 入口并保留菜单；源码和 Diff 继续复用 shared Prism 高亮。验证：`file-preview-simplified-open-5173.png` 截图确认 5173 右栏文件头不换行且代码高亮可见；同轮 Desktop/Web typecheck、responsive audit、design compare 和旧 UI active path 全部通过。

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
- [x] 保留真实 Edge 数据接入，不用 mock 冒充完成；首片 happy path 已通过 `useThreads` / `useThreadMessages` 接入真实 Edge thread list 和 persisted items，并通过 `createEventStream` 接入当前 thread live run/tool/file/approval/artifact events；这不代表 full production facade、全量 CRUD、host 文件动作或异常恢复完成。
- [x] v4 composer submit 通过 Desktop platform adapter 调用真实 Edge `startRun`，并传递 `permissionMode/workDir`，@Agent mention、浏览器文件附件和 Desktop 原生文件附件通过 prompt 上下文传递；当前是 active thread submit happy path，不宣称 Desktop/Tauri+Edge 生产对接完成。
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

- [ ] 把 Hub session、conversation、message、remote run 包装为 shared ports；已完成首片：Hub `GET /web/agent-profiles` 接入 v4 workbench @Agent 列表，Hub `/client/sessions`、`/client/sessions/{id}/messages` 接入 shared conversations/transcript，Hub WS query invalidation、Web remote submit（Hub message + optional `/web/agent-tasks`）、Hub runtime event live projection、optimistic message cache 和 Agent Profile -> exact AgentInstance dispatch 已有 happy path。未完成：Team runtime events、全量 renderer、CRUD/mutation、正式错误态、权限边界和回滚矩阵冻结。
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
- [x] 删除旧测试或重写为 shared tests；Desktop/Web 旧 Chat/Prompt/Thread/RunDetail/IM 主路径测试已删除或改为 v4 语义。
- [x] 删除旧 CSS modules 或迁移必要 token；旧 Chat/Prompt/Thread/RunDetail/IM 主路径 CSS 已随组件删除。
- [x] 运行旧入口扫描；新增 `scripts/verify-v4-old-ui-active-paths.ps1`。
- [x] 跑 full Desktop/Web typecheck。

下一批安全顺序：

1. **卡片/按钮细节回归审计**：Contacts/Docs/Tasks/Settings 已完成首轮；继续按 `agenthub-design/desktop` 核对剩余 page/block 的卡片圆角、按钮样式、卡片颜色层级、hover/active/focus、空态和响应式密度，不能只看 icon。Chat 主聊天流禁止再引入大型独立 run/session 总结卡；需要运行摘要时优先放入折叠步骤组或右侧 inspector。
2. **shared diff/evidence 合同**：把剩余 `DiffViewer`、`ArtifactBrowser`、Search/Dialog、Web `hubAdapters` 中有价值的逻辑迁到 shared inspector/transcript/diff contract，不接回旧 UI。
3. **视觉对比节点**：启动 Desktop `5173`、Web `5174` 和 design demo，对 rail pages、message blocks、composer、inspector、context menu、multi-select 和 icon 状态做 1440x920 首轮截图对比。
4. **旧文案残留清理**：菜单/i18n/settings 中仍有 `RunDetail`、旧 permission/workDir 提示等历史文案，后续随对应页面重做清理，不作为首屏 blocker。

验证命令：

```powershell
cd app/shared; corepack.cmd pnpm exec vitest run src\types --reporter=dot
cd app/desktop; corepack.cmd pnpm typecheck
cd app/web; corepack.cmd pnpm typecheck
.\scripts\verify-v4-old-ui-active-paths.ps1
```

执行记录：
- 2026-06-07：`app/desktop/.tmp/v4_interaction_smoke.mjs` 从观察型输出升级为卡片交互硬性验收：三端检查右键菜单 13 项顺序、复制 toast、多选 toolbar、actioned/selected/soft-hidden 状态、真实 `data-card-surface` 628px 宽度、soft-hidden opacity/filter 和页面 overflow，失败时返回非零退出码并保留 Desktop/Web/design 三张截图。验证：`v4_interaction_smoke.mjs` failures 为空；`v4_settings_data_mode_smoke.mjs` failures 为空；shared focused tests 3 文件 / 20 测试通过。
- 2026-06-07：`app/desktop/.tmp/v4_settings_data_mode_smoke.mjs` 从截图观察升级为硬性验收脚本：三端进入 Settings 本地开发页后校验前四行顺序、首卡/数据模式行高度、5173/5174 数据模式状态卡和 badge token、5176 对照无数据模式增量、无页面 overflow，并在失败时返回非零退出码；同时把 `AgentHubWorkbench.openBlockContextMenu` 改为接收 `TranscriptContextMenuEvent`，修复键盘 ContextMenu fallback 与鼠标右键事件合同不一致导致的 Desktop/Web typecheck 失败。验证：`v4_settings_data_mode_smoke.mjs` failures 为空；shared focused tests 3 文件 / 20 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过。
- 2026-06-07：Settings 本地开发页继续按 `agenthub-design/desktop` 源码对齐，保留新增“数据模式”但不让它破坏原型首卡：本地预览列表前四行恢复为 demo 的 `Vite 地址/工作区/目标项目/热更新覆盖层` 顺序和 64px 首卡高度，`数据模式` 改为同节末尾单行 control，Auto/Mock/正常说明落到独立状态区；`demo/dataMode` 兼容中文/英文/normal 别名并支持 localStorage override。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\demo\dataMode.test.ts src\workbench\AgentHubWorkbench.test.tsx src\transcript\normalizeEdgeEvents.test.ts --reporter=dot`，3 文件 / 19 测试通过；Desktop/Web typecheck 通过；`app/desktop/.tmp/v4_subpage_compare.mjs` 26 项 0 diff、0 console error；`app/desktop/.tmp/v4_card_mode_audit.mjs` 三端卡片宽度 628、菜单圆角 12px、无 console error；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。
- 2026-06-07：吸收 GLM 前端审计报告时仅采纳与当前设计哲学一致的风险提示：v4 组件测试缺口、CSS token/z-index/对比度和废弃组件清理进入后续护栏；不采纳恢复旧首屏工具条、旧控件或旧 UI fallback 的建议。本轮已补齐 context menu / multi-select 的真实卡片面板状态、复制/复制链接、删除软隐藏、toast 和多选条原型交互。验证：Desktop 5173、Web 5174、design 5176 交互 smoke 均无 console/page error、无横向 overflow；截图 `app/desktop/.tmp/v4-interaction-desktop.png`、`app/web/.tmp/v4-interaction-web.png`、`app/desktop/.tmp/v4-interaction-design.png`。
- 2026-06-07：标准化 shared v4 token：把浮层 z-index 从 CSS 硬编码收敛为 `--z-inspector-resizer`、`--z-modal-backdrop`、`--z-profile-popover`、`--z-multi-select`、`--z-context-backdrop`、`--z-context-menu`、`--z-demo-toast`，数值与 design demo 一致；把 `#ff7a1a`、QR cell 色和 pinned pin 色改为 Desktop/Web 同步 token。验证：Desktop/Web `tokens.css` 无差异；shared workbench 无剩余数字 z-index；focused shared tests 和 Desktop/Web typecheck 通过。
- 2026-06-07：删除 Desktop/Web 旧 registry、旧 `MainView/IMView` active route、Desktop 旧 `RunDetail/RightInspector/PermissionDialog` 和 Web 孤儿 `PermissionDialog`；新增 `scripts/verify-v4-old-ui-active-paths.ps1`，阻断 active Desktop/Web source 重新 import 旧 `ChatView`、`PromptInput`、`RunDetail`、`ThreadPanel`、`IMBlockRenderer`、`useChatMessages`、`useIMChat` 或旧 `viewRegistry`。验证：Desktop typecheck/build 通过；Web focused tests 6 个文件 / 32 个测试通过；Web typecheck/build 通过；Desktop App v4 focused tests 1 个文件 / 4 个测试通过；Web Hub-only boundary 12/12 通过；v4 old UI active path boundary 16/16 通过；Desktop/Web 1440x920 Playwright smoke 通过。
- 2026-06-07：只读 `opus` 子代理盘点剩余旧 UI 债务，结论是先迁移 shared `ChatMessage/FileDiff` 兼容合同，再删除旧 Chat/Prompt/Thread/IM hook 本体；该输出仅作为架构辅助，不作为测试证据。
- 2026-06-07：旧 `ChatView.types` 类型 import 已迁到 shared `types/chat.ts`，门禁脚本新增旧类型 active import 检查并通过 17/17；下一步可删除旧 `ChatView.types.ts` 文件和依赖它的旧组件本体/旧测试。
- 2026-06-07：删除旧 Desktop `ChatView/PromptInput/ThreadPanel/useChatMessages/useIMChat/IMBlockRenderer/IMMessageView` 及对应旧测试/CSS；删除旧 Web `ChatView/PromptInput/ThreadPanel/RunDetail/ReplyPreviewBar/useIMChat/IMMessageView` 及对应旧测试/CSS；IM index 不再导出旧 message view/renderer；Desktop E2E 旧 PromptInput/ThreadPanel 断言改为 v4 composer/sidebar 语义。验证：Desktop typecheck 通过；Web typecheck 通过；Desktop App v4 focused tests 1 文件 / 4 测试通过；Web App focused tests 1 文件 / 3 测试通过；v4 old UI active path boundary 44/44 通过；`git diff --check` 通过。
- 2026-06-07：Web `hubAdapters` 的 runtime projection 内部命名从旧 `RunDetail*` 收敛为 `RunEvidence*`，避免旧 `RunDetail` 组件删除后继续保留旧 UI 数据层口径；输出结构不变。验证：Web `hubAdapters.test.ts` 1 文件 / 10 测试通过。
- 2026-06-07：`WorkbenchRoutes` 已把 `pages/` 从 export-only 接入 Global Rail；chat 以外页面进入 design workbench mode，不显示 sidebar/header/composer/inspector；`TranscriptView` 已接入 `blocks/` 中的 thinking/subagent/child/result/route/context detail components。验证：shared workbench + Edge normalizer focused tests 2 文件 / 11 测试通过。
- 2026-06-07：新增 shared `designIcons.tsx`，把 `agenthub-design/desktop/app.js` 的 `fileIcon` 和 profile/nav action icon 首片迁入 React；overview/files inspector、Projects artifacts、account ProfilePopover actions/menu 已改用 design SVG、17px 文件图标尺寸和设计菜单结构。验证：shared workbench + Edge normalizer focused tests 2 文件 / 12 测试通过；Desktop/Web typecheck 通过；Desktop/Web/design 项目页 1440x920 smoke 均为 3 artifact rows / 3 file icons / 6 nav icons；Desktop/Web/design profile popover 均为 2 actions / 7 menu rows / 7 menu icons / 1 status icon，无 console/page error 和页面级 overflow。注意：这只是首片接入，文件 icon、导航 icon、操作 icon 的路径/尺寸/颜色/状态仍需单独按 design demo 做逐项视觉核对。
- 2026-06-07：`designIcons.tsx` 已扩展到 design demo `navIcon()` 的完整首片集合，Projects/Agents 页面移除本地 placeholder SVG，transcript `DiffCard/FileChangeCard` 改用 `DesignFileIcon`；`ContextMenu` / `MultiSelectBar` 改为 design demo 的标题、分组、中文 aria、13 项菜单、图标、快捷键、chevron、danger、count/total 和退出结构，并在 `AgentHubWorkbench` 接入 transcript 右键菜单与多选模式。验证：shared focused tests 2 文件 / 13 测试通过；Desktop/Web typecheck 通过；5173/5174 Playwright smoke 右键菜单均为 13 项、244px 宽、12px 圆角、无 console/page error；多选条出现后 composer 隐藏，截图 `app/desktop/.tmp/v4-context-menu-desktop.png`、`app/web/.tmp/v4-context-menu-web.png`、`app/desktop/.tmp/v4-context-multiselect-desktop.png`、`app/web/.tmp/v4-context-multiselect-web.png`。
- 2026-06-07：Contacts/Docs/Tasks/Settings 进入“非图标”细节对齐首轮：四页移除本地 SVG，统一使用 `designIcons.tsx`；Docs focus ring 和 icon-action hover 改回 design demo；Contacts 默认外部联系人/服务台数据、internal 快捷卡文案、Docs 6 行表格、Tasks 4 行任务、`筛选 1` active 状态、Settings 示例配置均按 design demo 收齐。验证：shared focused tests 2 文件 / 13 测试通过；Desktop/Web typecheck 通过；`.\scripts\verify-v4-old-ui-active-paths.ps1` 44/44 通过；`git diff --check` 无 whitespace error；5173/5174 Playwright smoke 无 console/page error、无横向 overflow，截图 `app/desktop/.tmp/v4-detail-contacts.png`、`app/desktop/.tmp/v4-detail-docs.png`、`app/desktop/.tmp/v4-detail-tasks.png`、`app/desktop/.tmp/v4-detail-settings-states.png` 及 Web 同名 `.tmp` 文件。
- 2026-06-07：按 `agenthub-design/desktop` 源码和 computed style 复核字体/密度细节：Desktop/Web root font-size 统一为 16px，body 统一为 design demo 的 14px/21px `var(--body)`；`RightInspector` 的 B0 overview 不再用 run/tool evidence 文案污染首屏，恢复 demo 的四步任务、最终文件/工作文件分组和同一组 SQLite 文件；Web fallback transcript 补齐 artifact/file evidence，与 Desktop 使用同一 inspector 数据结构；inspector 内容区 padding 收敛为 demo `.insp-body` 的 16px；OverviewPanel 文件图标按 design demo 的实际 computed style 对齐为 17px、0 圆角、`--text-3` 弱化色；`RunStepGroup` 从旧 48px 卡片按钮收敛到 demo `.run-step-toggle` 的 38px、6px 8px padding、12px 圆角和 22px icon。验证：`app/desktop/.tmp/v4_overview_metrics.mjs` 确认 root/body、section/head/task/file/fileIcon/subhead 的字号、行高、padding、gap、半径、颜色与 design demo 对齐；`app/desktop/.tmp/v4_typography_audit.mjs` 确认 Desktop/Web runStepToggle 尺寸、padding、半径与 design demo 对齐，剩余 button root fontFamily 差异来自 demo 原生 button 默认 Arial，不作为强制改回项；`app/desktop/.tmp/v4_interaction_smoke.mjs` 覆盖 5173/5174/5176；Desktop/Web typecheck 通过；shared focused tests 2 文件 / 16 测试通过；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。
- 2026-06-07：RightInspector 预览细节继续对齐 design demo：`新建右侧窗口` 进入 browser preview，关闭按钮回 overview，右栏 `data-preview` 切换背景，browser preview 默认使用设计 demo URL 而不是被 artifact evidence URL 抢占；Web/desktop token 根节点补齐 `height:100%` 和 body overflow 边界，修复 Web 5174 预览打开后 1349px 文档级纵向溢出。验证：`cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\transcript\normalizeEdgeEvents.test.ts --reporter=dot`，2 文件 / 16 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；`git diff --check` 仅 CRLF warning；5173/5174/5176 inspector preview smoke 均无 console/page error、无横向/纵向 overflow，截图 `app/desktop/.tmp/v4-inspector-preview-desktop.png`、`app/web/.tmp/v4-inspector-preview-web.png`、`app/desktop/.tmp/v4-inspector-preview-design.png`。
- 2026-06-07：Chat transcript grouped run-step 从前半段扩展到 design demo 的完整 B0 流程：shared demo transcript 补齐定位完成、Reviewer subagent、route/context、生成迁移草案、`已编辑 2 个文件` 展开组、created/modified file rows、Review 按钮、SQL diff、Write File approval、验证历史消息折叠组、Browser QA 和最终 result；`ArtifactTranscriptBlock` 增加 `action/additions/deletions` 可选字段，`TranscriptView` 在 run-step 内按 design file-change card 渲染统计和 Review 按钮。验证：shared focused tests 2 文件 / 16 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；`git diff --check` 仅 CRLF warning；5173/5174/5176 transcript flow smoke 均为 4 个 run-step、深度思考展开、编辑组展开、验证组折叠、含 created/modified/Review/approval/Browser QA/result，无 console/page error 和 overflow，截图 `app/desktop/.tmp/v4-transcript-flow-desktop.png`、`app/web/.tmp/v4-transcript-flow-web.png`、`app/desktop/.tmp/v4-transcript-flow-design.png`。
- 2026-06-07：`app/desktop/.tmp/v4_typography_audit.mjs` 从观察输出升级为字体/密度硬性验收：三端读取 rail/sidebar/header/transcript/composer/inspector 关键组件的 font、line-height、padding、gap、圆角、min-height 和尺寸，保存完整 JSON 到 `app/desktop/.tmp/v4_typography_audit.json`，未解释差异返回非零；本轮以 `agenthub-design/desktop` 源码为准纠偏侧栏和文件 icon，shared 会话侧栏回到 flex row/row-fill 结构，title/subtitle 块级化恢复 48px 行高和宽度，overview 文件 icon 圆角改为 0，并移除 composer focus 时 demo 没有的额外边框、强阴影、上移和 `+` 缩放。验证：`v4_typography_audit.mjs` `failures=[]`；`v4_design_compare.mjs` 42 项 `failures=[]`；`v4_interaction_smoke.mjs` 和 `v4_settings_data_mode_smoke.mjs` failures 为空；shared focused tests 3 文件 / 22 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过。
- 2026-06-07：继续把观察型视觉审计升级为可执行门禁：`v4_style_compare.mjs` 强制进入 `chat/overview` 基线，修正过时的 transcript、agent header 等 selector，保存完整 JSON 到 `app/desktop/.tmp/v4_style_compare.json`，computed-style delta 非空即失败；`v4_responsive_audit.mjs` 改用 `domcontentloaded + selector wait`，强制进入 chat，修正 workspace/transcript selector，保存完整 JSON 到 `app/desktop/.tmp/v4_responsive_audit.json`，校验 5173/5174/5176 在 1440x920、1280x800、390x844 的 chrome policy、关键区域存在、overflow、1180px 窄屏工作台基线和 rail/sidebar/inspector 宽度。验证：`v4_style_compare.mjs` 无 computed-style delta；`v4_responsive_audit.mjs` `compared=9`、`failures=[]`。
- 2026-06-07：复核 transcript/composer 首屏密度时曾按 `agenthub-design/desktop/styles.css` 的静态 flow composer 基线验证 `.transcript { padding: 16px 20px 28px; }`，用于避免 shared UI 因额外留白偏离 design demo；该历史基线已被晚间 overlay composer 遮挡修复覆盖，当前实现采用安全滚动 padding，验收重点改为最新消息不能被输入框遮挡。本轮重新跑完 Desktop 5173、Web 5174、design 5176 的 computed-style、响应式、字体密度和 42 图矩阵硬门禁。验证：`v4_style_compare.mjs` 无 computed-style delta；`v4_responsive_audit.mjs` `compared=9`、`failures=[]`；`v4_typography_audit.mjs` `failures=[]`；`v4_design_compare.mjs` `compared=42`、`failures=[]`；shared focused tests 3 文件 / 24 测试通过；Desktop/Web typecheck 通过；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。
- 2026-06-07：`claude -p` subagent 通道最小验证通过：普通 print 返回 `CLAUDE_PRINT_OK`，JSON print 返回 `SONNET_PROBE_OK`；`modelUsage` 显示 `claude-sonnet-4-6`、`contextWindow=200000`，本轮未直接暴露 GLM-5.1 provider 名称，后续只能把它作为 sonnet alias/200k window 可用证据，不能当 provider 解析证据。
- 2026-06-07：头像资料卡语义修复：Agent 头像继续打开 Agent 配置资料卡；`Johnny` 这类真人好友头像改走联系人资料卡，不再提示“未找到 Johnny 的 Agent 配置”。真人资料卡从联系人与会话数据取身份、组织、状态和最近消息，动作限定为 `发送消息/复制链接`。验证：shared `AgentHubWorkbench.test.tsx` 20/20 通过；Desktop/Web typecheck 通过；5173/5174 Playwright 点击 Johnny 私聊头像均打开 `Johnny 资料卡`，无 Agent 配置错误、无 `Agent 配置` 动作，截图保存到 `app/desktop/.tmp/v4-human-profile-johnny-desktop.png` 和 `app/desktop/.tmp/v4-human-profile-johnny-web.png`；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。

## 5.5 当前保存快照

> 2026-06-07 晚间整理。此处只记录当前前端负责人可确认的 Desktop/Web v4 shared UI 事实；后端并行改动另走后端计划。

- Desktop `5173` 和 Web `5174` 的 shared workbench/mock demo 是当前主基线；`5176/desktop` 仅作为只读历史对照，`agenthub-design` 不在 AgentHub 实现分支里修改。
- shared workbench 已覆盖 rail、sidebar、workspace header、transcript、composer、inspector、profile popover、context menu、multi-select、Contacts/Docs/Agents/Tasks/Projects/Settings 页面；旧 Desktop/Web `ChatView/PromptInput/ThreadPanel/RunDetail/IMMessageView` active path 已由 `verify-v4-old-ui-active-paths.ps1` 44/44 守住。
- 账号 ProfilePopover 当前按 design 源码保存为 404px account variant、签名入口、7 个菜单项、2 个分隔线和 3 个空间行；不要再按旧测试或个人审美收窄到 352px。
- transcript/composer 首屏密度以 shared workbench 当前实现和 v4 token 为准；必要时参考 `agenthub-design/desktop/styles.css` 的历史密度。当前 overlay composer 场景使用安全滚动 padding，验收重点是最新消息不能被输入框遮挡。visible composer 保持输入框 + 发送按钮，不恢复旧 @Agent/权限/workDir/附件工具条到首屏。
- 当前已通过的轻量护栏：shared focused tests、Desktop/Web typecheck、`v4_profile_popover_compare.mjs`、`v4_typography_audit.mjs`、`v4_style_compare.mjs`、旧 UI active path 扫描和 `git diff --check`。`git diff --check` 仅有 Windows CRLF warning。
- 2026-06-07 晚间新增保存：demo/mock 模式在 5173/5174 均可发送试用；composer 快捷键偏好已进入 Settings；`TranscriptView` 连续用户消息头像分组的 `shouldHideGroupedUserAvatar` 运行时错误已修复。
- 下一步优先继续复跑并修正 `v4_subpage_compare.mjs`、`v4_inspector_interaction_smoke.mjs`、`v4_long_press_multiselect_smoke.mjs` 这类 5173/5174/5176 交互脚本；同时复核左右侧栏极窄拖拽后的恢复路径，避免 snap 阈值造成“缩小后拖不出来”；新增功能来自其他 Agent 时不要误删，先套回 v4 设计系统。

- 2026-06-07：资料卡动作和 file-change inline diff 语义继续收口：Agent/真人资料卡 `发送消息` 不再只是关闭弹层，而是切回对应 direct conversation 并把焦点交给 shared composer；`UnifiedComposer` 暴露 textarea ref 供 Workbench 聚焦。file-change 行新增 `展开/收起` inline diff 控件，默认折叠；`Review` 继续只负责打开右侧 `FilePreview`，不再兼任展开消息流 diff。diff 与 artifact 不按相邻顺序配对，而按文件路径配对，避免 SQL diff 错挂到 `hooks/useThreadNavigation.ts` 行。验证：shared `AgentHubWorkbench.test.tsx` 25/25 通过；Desktop/Web typecheck 通过；5173/5174 smoke 确认 Builder 资料卡发送后回到 Chat/Builder 且 composer focused，`migrations/0007_chat_threads.sql` 首行默认有 `展开 + Review`，展开后显示 inline SQL diff，收起后隐藏，Review 打开右侧 SQL 文件预览；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。

## 6. 验收命令

当前快速开发阶段先跑轻量护栏：

```powershell
git diff --check
.\scripts\verify-v4-old-ui-active-paths.ps1
```

视觉对齐节点再跑完整矩阵：

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

- 当前主工作树分支：`feat/desktop-web-v4-clean-rebuild`
- 合并目标：`dev/delicious233`
- 保留协作者分支：`origin/dev/trump`、`origin/dev/johnny`
- 并行 worktree：`.worktrees/backend` 负责 backend 线，本轮 UI 不碰；`.worktrees/johnny-dev` detached，只读隔离。
- 不复活已删除历史分支。

## 9. 不做事项

- 不修改 `agenthub-design`。
- 不复制 v4 静态 HTML/CSS/JS 作为生产代码。
- 不新增第二套 Web UI。
- 不保留旧 ChatView 作为长期 fallback。
- 不把 Tauri command shim 当成最终 Host API。
- 不用截图 mock 冒充真实数据链路完成。
