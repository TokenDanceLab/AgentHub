# v4 前端负责人进度汇总

> 日期：2026-06-07
> 范围：Desktop `5173`、Web `5174`；`5176/desktop` 仅作为历史参考
> 基准：当前 shared workbench 与 mock/demo 运行态；`agenthub-design` 为只读历史参考

## 当前结论

Desktop/Web v4 主工作台已经以 `app/shared/src/workbench` 为唯一 UI 壳子继续推进。5173 是 Desktop/Tauri 前端，5174 是 Web 前端，二者共享同一套 workbench、transcript、inspector、composer、floating controls、pages 和 design icon registry。5173 可以有 Desktop window chrome；5174 不渲染 fake Desktop chrome。

当前 freeze 口径是 **UI skeleton freeze candidate**，不是 production interaction freeze。冻结覆盖 shared workbench 的 mock/demo 视觉骨架、当前交互基线和 Desktop/Web 主入口统一；不宣称生产 CRUD、真实文档/项目/Agent mutation、FilePreview open-with 平台动作、Desktop Edge/Web Hub 全量数据接线已经完成。

本轮前端重点从“旧 UI 替换”进入 shared workbench 细节收口和交互质量收口。后续 Agent 不应重新发明页面结构、动效曲线、图标、卡片圆角或主题切换逻辑；所有可见差异先对照当前 shared workbench/mock demo，再参考 `agenthub-design` 历史原型。

2026-06-07 最新接手 checkpoint：Chat 首屏稳定 CSS 已用 `app/desktop/.tmp/v4_style_compare.mjs` 在当前脚本覆盖的基线状态下收口到 Desktop `5173`、Web `5174` 和历史参考 `5176/desktop` 三端无 computed-style delta。该结论只覆盖 Chat 首屏稳定样式；置顶公告 padding、diff 展开态、sidebar/inspector collapse、二级页和真实数据态仍由独立 smoke / screenshot matrix 继续验收。当前设计规则是：普通 shell/button/tab/card/list row 不新增 shared workbench 之外的 `translate/scale/ease-press`；只保留当前分支已固化的菜单/弹层入场、折叠面板、发送按钮、run-step toggle 和 monitor/file 行响应。

## 已保存进度

### 最新保存点：主色 token 对齐 AgentHub logo 蓝

- Desktop/Web v4 共享主题主色已从旧紫蓝 `#5063e8` / `#6985e8` 对齐到 AgentHub logo 蓝：Light `#0071BC`，Dark `#29ABE2`。
- `--primary`、`--primary-hover`、`--primary-light`、`--primary-soft`、`--bdr-focus`、`--ring`、`--surface-selected` 等 active primary/focus/selected token 已同步更新；`--brand`、`--authority-hub`、`--run-starting`、`--color-primary` 继续通过 `var(--primary)` 继承。
- 旧名兼容 alias `--glass-tint-plum` 仍保留变量名，但值改为 logo blue tint，避免旧壳和空状态强调层继续呈现旧紫色。
- 组件内仅清理 `ApprovalCard` 和 shared `DeployCard` 的旧 primary fallback，避免缺少主题变量时回落到旧紫色。
- 本次不改变 backend/mobile，也不把角色色、历史审计、archive/reference 中的旧色说明改写成新事实。

### 最新保存点：右侧 FilePreview 打开方式图标改为库资产

- 右侧 `FilePreview` 顶部继续保持紧凑结构：toolbar 40px、meta 22px、打开方式菜单 212px 宽、10 项每项 30px。
- 打开方式菜单不再使用手写近似 logo 或文字占位图标。
- 打开方式图标统一进入 `designIcons.tsx` registry，`FilePreview.tsx` 不再直接导入 vendor icon 或手写内联 SVG。
- VS Code、Visual Studio、Android Studio 使用 Devicon 本地 SVG 资产。
- Antigravity 使用 `@lobehub/icons` 官方图标组件；Cursor、Git for Windows、Linux/WSL 使用 `simple-icons` 官方品牌 path。
- Default app、Terminal、打开所在文件夹是系统动作，不按厂商 logo 处理，继续使用 v4 线性系统图标。
- inspector 与主工作台文件图标统一回到 design demo 的 17px、3px radius，不再出现同一类文件图标一处直角、一处圆角的漂移。
- `@lobehub/icons` 已加入 `@agenthub/shared`，作为 AgentHub v4 新 UI 的常用品牌图标库；后续 AI/Agent/provider/model/application 品牌图标优先使用 Lobe Icons，缺失的 IDE/系统工具图标再用 Devicon 或 `simple-icons` 补位。

本轮直接相关文件：

- `app/shared/src/workbench/inspector/FilePreview.tsx`
- `app/shared/src/workbench/inspector/FilePreview.module.css`
- `app/shared/package.json`
- `app/pnpm-lock.yaml`
- `app/desktop/.tmp/v4_file_preview_compact_probe.mjs`
- `docs/roadmap.md`
- `docs/v4-frontend-progress-2026-06-07.md`

最新验证：

- `cd app/desktop; corepack.cmd pnpm typecheck` passed。
- `cd app/web; corepack.cmd pnpm typecheck` passed。
- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\designIcons.test.tsx src\workbench\icon-governance.test.ts --reporter=dot`，2 files / 8 tests passed。
- `.\scripts\verify-v4-old-ui-active-paths.ps1`，44/44 passed。
- `.\scripts\verify-web-hub-boundary.ps1`，12/12 passed。
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_file_preview_compact_probe.mjs`，5173/5174 均为 `toolbarHeight=40`、`metaHeight=22`、`menuWidth=212`、`menuHeight=284`、`itemCount=10`、`graphicCount=10`、`missingGraphics=[]`、无 console/page error。
- 截图：`app/desktop/.tmp/v4-file-preview-compact-desktop.png`、`app/web/.tmp/v4-file-preview-compact-web.png`。

### 最新保存点：资料卡发送消息与行内 Diff 交互闭环

- Johnny 这类真人好友头像已稳定打开联系人资料卡；Agent 头像继续打开 Agent 资料卡，二者不再共享错误的 Agent 配置兜底路径。
- Agent/真人资料卡的 `发送消息` 已接入 shared workbench intent：点击后切换到对应 direct conversation，并聚焦底部 composer，5173 Desktop 与 5174 Web 行为一致。
- `UnifiedComposer` 暴露 textarea ref 给 Workbench 聚焦，不在 ProfilePopover 或浮层里直接操作 DOM。
- file-change 行的 `Review` 与 `展开/收起` 已拆清：`Review` 只打开右侧 `FilePreview`，`展开/收起` 控制 transcript 主流里的 inline diff。
- inline diff 默认折叠；展开后在消息流内显示 diff，收起后只保留轻量文件行。
- file-change 与 artifact/diff 按文件路径配对，避免 SQL diff 错挂到 `hooks/useThreadNavigation.ts` 这类相邻文件。

本轮直接相关文件：

- `app/shared/src/workbench/AgentHubWorkbench.tsx`
- `app/shared/src/workbench/UnifiedComposer.tsx`
- `app/shared/src/workbench/TranscriptView.tsx`
- `app/shared/src/workbench/blocks/FileChangeCard.tsx`
- `app/shared/src/workbench/blocks/FileChangeCard.module.css`
- `app/shared/src/workbench/AgentHubWorkbench.test.tsx`
- `docs/roadmap.md`
- `docs/desktop-web-v4-clean-rebuild-plan.md`
- `docs/v4-design-parity-audit-2026-06-07.md`
- `docs/v4-frontend-progress-2026-06-07.md`

### 最新保存点：固定控制区不换行与右栏文件预览收敛

- 全局响应式规则已明确：toolbar、tab、header action、inspector tab、多选条、页面操作区等固定控制区不得通过换行适配宽度；窄宽时优先单行、截断、隐藏低优先级文字或只显示 icon，并保留 `aria-label` / `title`。
- `FilePreview` 从“右栏里再套一张弹窗卡”收敛为右侧文件 tab 的内嵌 editor：去掉外层边框/阴影，顶部压成单行文件名 + 源码/Diff + 打开方式 icon + 关闭 icon，meta 保持低权重单行。
- 代码类文件只显示 `源码/Diff`，Markdown 才显示 `预览`；源码和 Diff 保留 Prism 语法高亮，Diff 行继续按 add/delete/context 着色。
- `打开方式` 从文字按钮降为 icon 入口，菜单和厂商/系统图标保留；真实 VS Code/Terminal/文件夹打开仍属于 Desktop/Web platform adapter 后续接线，不写进 shared UI。
- 多选条保持单行，不再因动作变多换成两层；窄宽下动作按钮只显示图标，同时保留可访问名称和 hover title。
- Workspace header、workspace tabs、RightInspector tabs、Tasks toolbar、Agents market toolbar、Docs/Projects/Contacts tabs/actions、shared `DiffReviewPanel` 和 `ContextSummary` 操作区均已按上述规则处理。
- 剩余 `flex-wrap` 只保留在内容 chip/文本流中，例如技能 chip、成员 chip、空状态建议和长代码/消息断词；这些不是固定控制区，强行单行会造成内容溢出。

本轮直接相关文件：

- `app/shared/src/workbench/AgentHubWorkbench.module.css`
- `app/shared/src/workbench/inspector/FilePreview.tsx`
- `app/shared/src/workbench/inspector/FilePreview.module.css`
- `app/shared/src/workbench/floating/MultiSelectBar.tsx`
- `app/shared/src/workbench/floating/MultiSelectBar.module.css`
- `app/shared/src/workbench/pages/AgentsPage.module.css`
- `app/shared/src/workbench/pages/ContactsPage.module.css`
- `app/shared/src/workbench/pages/DocsPage.module.css`
- `app/shared/src/workbench/pages/ProjectsPage.module.css`
- `app/shared/src/workbench/pages/TasksPage.module.css`
- `app/shared/src/ui/DiffReviewPanel.module.css`
- `app/shared/src/ui/ContextSummary.module.css`

最新验证：

- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\ui\DiffReviewPanel.test.tsx --reporter=dot`，2 files / 51 tests passed。
- `cd app/desktop; corepack.cmd pnpm typecheck` passed。
- `cd app/web; corepack.cmd pnpm typecheck` passed。
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_responsive_audit.mjs`，`compared=9`、`failures=[]`。
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_design_compare.mjs`，`compared=42`、`failures=[]`。
- `.\scripts\verify-v4-old-ui-active-paths.ps1`，44/44 passed。
- `git diff --check` 无 whitespace error，仅 CRLF warning。

### 最新保存点：工作流卡片和 Subagent 命名压缩

- Chat 主流中的工作流/运行卡片继续压缩信息层级：运行细节留在折叠步骤组、文件行、审批卡和 inspector，不再恢复大型 run/session summary 白卡。
- `Child Agent` 产品文案已收敛为 `子Agent`，英文场景使用 `Subagent`；元信息不再显示 `worker:`，改为 `子Agent: ...` / `subagent: ...`。
- 子Agent/Subagent 标签从胖胶囊收敛为轻量 inline label，减少聊天流中小卡片的视觉噪声。
- 审批卡、tool/file/diff/run-step 展开区继续降低 padding、圆角、行高和阴影权重，避免在 transcript 主流里堆出第二套“卡片墙”。

### 最新保存点：压缩布局与遮挡修复

- shared shell 不再用硬 `min-width:1180px` 顶穿真实 Desktop/Web 窗口；`1180px` 只作为 design demo 宽屏参考和历史截图基线。
- 右侧 inspector 拖宽导致聊天列低于可读宽度时，shared workbench 自动折叠左侧最近频道栏，保护聊天区和右侧 inspector 的同屏可用性。
- 置顶公告使用 workspace 内浮层，但宽度限制在聊天列和左右 20px 安全边界内，不会越过 inspector。
- composer 继续固定在底部右下区域，但底部遮罩和输入胶囊只覆盖聊天列；滚到底部时最新消息停在输入框上方，不被输入框挡住。
- `WorkbenchRoutes.tsx` 项目产物预览先把 `artifact.name` 收敛成本地 `name` 常量，修复 Desktop/Web typecheck 中 `string | undefined` 类型漂移。
- 本轮文档已同步到 `roadmap.md`、`architecture.md`、`desktop-web-v4-clean-rebuild-plan.md`、`v4-design-parity-audit-2026-06-07.md` 和本文档。

本轮直接相关文件：

- `app/shared/src/workbench/AgentHubWorkbench.module.css`
- `app/shared/src/workbench/AgentHubWorkbench.tsx`
- `app/shared/src/workbench/AgentHubWorkbench.test.tsx`
- `app/shared/src/workbench/WorkbenchRoutes.tsx`
- `docs/roadmap.md`
- `docs/architecture.md`
- `docs/desktop-web-v4-clean-rebuild-plan.md`
- `docs/v4-design-parity-audit-2026-06-07.md`
- `docs/v4-frontend-progress-2026-06-07.md`

### 设计系统与视觉细节

- `DesignNavIcon` 和 `DesignFileIcon` 继续作为 shared 图标入口，文件图标、rail 图标、profile action 图标不再各页自造 SVG。
- 普通按钮、卡片、tab、列表行以颜色、边框、阴影缓动为主，不扩散原型外 `translate/scale/ease-press`。
- 保留 design 明确存在的动效：发送按钮 scale、菜单入场、modal 入场、Overview section toggle、monitor-file 行内 1px 横向响应、inspector/file 菜单行响应。
- `ProfilePopover` 入场已恢复到 design 的 `--dur-normal + --ease`；账号菜单行不保留实现侧额外 transition/transform。
- `ToolCardBlock` 背景、description `margin-top:4px` 与 `line-height:1.45` 已对齐 `.agent-tool-card`。
- `RunStepGroup` open shadow、detail `translateY(-6px -> 0)`、inner `gap:8px`、`padding:0 12px 12px` 已对齐 design；nested thinking detail 的 padding、半径、正文 margin/line-height 已对齐 `.agent-detail-block.thinking-block`。
- Composer send button 不再强制反色文本，只保留 design 源码中的 background/transform transition。
- Projects、Agents、Contacts、Tasks、Settings 等页面已进入“结构和主要 computed style 可对齐”状态，后续只做局部 hover/focus/active、密度、图标色阶和窄屏补扫。

### 右侧 inspector

- 右侧 inspector 支持 overview/browser/files tab、关闭 tab、通过 `+` 恢复、file preview 源码/Markdown/Diff/open-with 菜单。
- 右侧 resizer 支持键盘和拖拽；拖拽越过 96px 折叠阈值时立即结束 resize 并切到 `data-inspector-collapsed=true`，不再等 pointerup，也不留下 48px 窄栏。
- inspector 折叠和展开继续使用 shared shell/inspector 的 panel 曲线，不在拖拽期间启用颜色或布局补间。

### 左侧最近频道栏

- Chat 页左侧最近频道栏由 `--sidebar-w` 驱动，默认 260px，键盘/拖拽范围 180-360px。
- 点击当前高亮的 GlobalRail `对话` 图标会在当前页折叠/展开左侧栏。
- 左侧栏越过 96px 吸附阈值后自动折叠，使用与右侧 inspector 一致的 grid 列折叠、clip-path、opacity/translate 退出和 2px resizer 高亮。
- 非 Chat 页面不显示最近频道栏。

### 主题切换

- 新增 shared `app/shared/src/theme.ts`，统一 `applyAgentHubTheme()`、`toggleAppliedAgentHubTheme()`、storage key、system theme resolution 和 `color-scheme`。
- `AgentHubWorkbench` 的主题按钮、Desktop `ThemeContext`、Web `ThemeContext` 均走 shared theme helper，不再存在一条路径裸写 DOM、另一条路径由 React effect 后写 DOM 的双通道。
- Desktop/Web `themes.css` 增加 `html[data-theme-sync='true']` 同步期：主题切换后两帧内禁用 transition/animation，让 `--app-bg`、`--surface-*`、`--text-*` 一次性提交，避免部分区域先变黑、部分区域后变黑。
- 同步期结束后自动恢复正常交互动效。

### Transcript 与资料卡交互

- Transcript 支持长按 520ms 进入多选，Esc/Ctrl+A/Ctrl+C/Delete 可用，二次选择走 pointerup。
- 用户连续短时间消息隐藏重复头像但保留 28px 占位，保持右侧气泡边缘稳定。
- Agent 头像和真人好友头像已分流：Agent 打开 Agent 资料卡，真人打开联系人资料卡，不再把 `Johnny` 这类真人误报为缺少 Agent 配置。
- Agent/真人资料卡 `发送消息` 已切换到对应 direct conversation 并聚焦 composer，避免只关闭资料卡但不进入私聊。
- file-change 行内 diff 已改为默认折叠；`展开/收起` 控制 transcript 内 diff，`Review` 只负责打开右侧文件预览。
- GlobalRail 账号弹层按 `agenthub-design/desktop` 的 `delicious233.accountRows` 保存为 404px account variant、签名入口、7 个菜单项、2 个分隔线和 3 个空间行；不要再按旧测试或低频菜单假设收窄到 352px。

### 全局 User / Agent 头像

- `app/shared/src/workbench/profileRegistry.ts` 已作为 shared profile/avatar resolver，集中处理 User/Agent initials、Agent name hint、颜色和头像胶囊语义。
- `WorkbenchRoutes` 统一构造 `profileSources`，并传入 Docs、Tasks、Projects 等页面，避免各页重复猜测用户或 Agent 身份。
- Docs owner、Tasks assignee/creator、Projects member/run owner 已改为同一套 User/Agent avatar pill；`Codex` 已纳入 Agent hint，避免文档 owner 被误判为普通用户。
- Agents 页已开始接入同一套 profile resolver：已安装列表和右侧详情头部的 Agent 头像不再使用页面局部首字母/颜色函数，而是走 `resolveWorkbenchProfile()`；当前仍是首字母色块头像，后续真实头像 URL 和 Agent 配置 provider 需要继续统一。
- 仍需继续收口：Agent 的真实配置、头像 URL、runtime/model、技能标签应进入同一个 registry/provider，不允许后续页面另建一套 Agent 配置表。

### Agent 管理页设计系统收口

- 已安装页标题按当前产品语义改为 `Agent管理`，不再显示旧文案 `Agent 配置`。
- 左侧 rail 的 Agent 图标从弱线框改为更清晰的 v4 stroke 机器人头，仍使用 `DesignNavIcon` registry 和现有 rail hover/active 样式。
- Agents 页原生 `<select>` 已替换为 shared v4 `Select`，覆盖运行引擎、默认模型、运行模式、状态和联系人国家区号；`app/shared/src/workbench` 与 `app/shared/src/ui` 当前不再保留页面级 native select/option。
- 已安装 Agent 列表行去掉 `data-card-surface`，选中态不再出现彩色左描边或全局卡片边框干扰；当前采用轻量列表行语义：透明默认、`surface-high` hover/selected、34px `r-sm` Agent avatar。
- 右侧详情面板内部内容左靠并限制最大宽度，避免字段网格贴到右侧滚动条；`Skills`、`工具权限`、`最近运行` 从嵌套卡片退回为 design demo 风格的分段列表。
- 这页仍处于细节收口阶段：后续要继续按 `agenthub-design/desktop/app.js` 的 `agentsView()` / `agentEditPanel()` 对比字段密度、列表 row padding、市场页首卡和右侧详情滚动区，不允许再加入原型外彩色描边、渐变、额外阴影或弹性位移。

### 云文档与项目产物预览

- 当前不实现完整飞书/Notion 式多人协同编辑器，v4 首轮边界是轻量 `Document Library` + `Project Artifacts` + 只读 `File / Artifact Preview`。
- `app/shared/src/workbench/documentPreview.ts` 已定义 `WorkbenchDocumentPreview` 预览合同；Docs 行点击在云文档页内打开 inline `FilePreview`，Projects 产物点击在项目页内打开同一套 preview。
- Preview 复用右侧 inspector 已有能力：源码、Markdown、Diff 和打开方式菜单；后续真实打开 VS Code/Terminal/文件夹必须从 Desktop/Web platform adapter 接线，不在 shared UI 里写平台命令。
- 后续 provider 顺序建议：先接 Hub artifact store / 本地 workspace，再接 Feishu、Google Docs、Tencent Docs、WPS 等外部文档 provider。页面只消费统一 preview contract。

### Composer 与 demo 发送

- Desktop `5173` 和 Web `5174` 在 demo/mock preview 下也必须可真实试发消息：没有真实 Edge `projectId/threadId` 时，Desktop platform 不再把消息送进 `submitRun` 空路径，而是回落到 `workbenchDemoRuntimeStore.submitComposerIntent()`，消息会进入 transcript 并追加 mock reply。
- `UnifiedComposer` 已接入共享快捷键偏好，默认 `Enter` 发送，`Ctrl+Enter` / `Cmd+Enter` 插入换行，`Shift+Enter` 保留 textarea 原生换行。
- 设置页 `设置 -> 本地开发 -> 发送快捷键` 已提供 `Enter 发送` 和 `Ctrl+Enter 发送` 两档；偏好写入 `localStorage` key `agenthub.workbench.composerSubmitBehavior`，Desktop/Web 共用。
- `Ctrl+Enter 发送` 模式下，普通 `Enter` 变成换行，`Ctrl/Cmd+Enter` 发送；这用于兼容长文本输入习惯，但默认仍按用户要求采用 Enter 发送。

### 最近运行时修复

- 修复 `TranscriptView` 中 `shouldHideGroupedUserAvatar is not defined` 的运行时错误；连续用户消息头像分组逻辑现在在组件渲染前可用，并已有回归测试覆盖。
- `desktopPlatform` 的真实 Edge 提交边界已收紧：只有 `submitRun && activeProjectId && activeThreadId` 同时存在时才调用 Edge run，否则走 demo runtime，避免 5173 预览点击发送后无响应。

## 验证证据

本轮保存的主要证据：

- `app/.tmp/v4-inspector-immediate-collapse-pass/`
  - 5173/5174 在鼠标仍按下的 during-drag 阶段均为 `data-inspector-collapsed=true`、`data-inspector-resizing=false`、grid 末列 `0px`。
- `app/.tmp/v4-theme-sync-pass/`
  - 5173/5174 点击 `切换主题` 后 immediate 阶段均为 `data-theme=dark`、`data-theme-sync=true`、shell `transition-property=none`，rail/workspace/inspector 背景同时变为 dark；180ms 后同步标记移除。
- `app/.tmp/v4-sidebar-resize-pass/`
  - 5173/5174 验证 initial=260px、click collapse grid 第二列 0px、click expand=260px、drag max=360px、drag snap collapsed=true。
- `app/desktop/.tmp/v4-pressure-layout-desktop.png`
  - 5173 在 inspector 拖到 760px 后，左侧栏自动折叠，置顶公告和 composer 均留在 workspace 内，横向 overflow 为 0。
- `app/desktop/.tmp/v4-pressure-layout-web.png`
  - 5174 使用同一 shared UI 行为，不显示 fake Desktop chrome；压缩后左侧栏自动折叠，横向 overflow 为 0。
- `app/desktop/.tmp/v4-pressure-bottom-desktop.png`
  - 5173 滚到底部后最新消息与 composer 顶部保留约 54px 间距。
- `app/desktop/.tmp/v4-pressure-bottom-web.png`
  - 5174 滚到底部后最新消息与 composer 顶部保留约 54px 间距。
- `app/desktop/.tmp/v4_document_preview_smoke.mjs`
  - 5173/5174 均确认 Docs 行点击和 Projects 产物点击会打开 inline preview panel，failures 为空。
- `app/desktop/.tmp/v4_profile_registry_smoke.mjs`
  - 5173/5174 均确认 Docs、Tasks、Projects 的 User/Agent avatar pill 渲染稳定，failures 为空。
- `app/desktop/.tmp/v4_project_tabs_smoke.mjs`
  - Projects 概览/设置/成员头像与左侧 `新建项目` 位置继续通过 smoke，failures 为空。
- `app/desktop/.tmp/verify_agents_page_refine.mjs`
  - 5173/5174 均能进入 Agents 页，无 console error；Agent avatar 为 34x34、8px radius；详情面板存在 8 个字段和 12 个 skill chip；5173 当前截图保存为 `app/desktop/.tmp/agents-page-refine-5173.png`。
- `app/desktop/.tmp/v4-human-profile-johnny-desktop.png` 与 `app/desktop/.tmp/v4-human-profile-johnny-web.png`
  - 5173/5174 均确认 Johnny 真人好友头像打开联系人资料卡，而不是 Agent 配置错误态。
- `app/desktop/.tmp/v4-agent-send-message-focus-desktop.png` 与 `app/desktop/.tmp/v4-agent-send-message-focus-web.png`
  - 5173/5174 均确认资料卡 `发送消息` 后 Builder direct conversation active，composer focused。
- `app/desktop/.tmp/v4-inline-diff-closed-desktop.png`、`app/desktop/.tmp/v4-inline-diff-open-desktop.png`、`app/desktop/.tmp/v4-inline-diff-closed-web.png`、`app/desktop/.tmp/v4-inline-diff-open-web.png`
  - 5173/5174 均确认 SQL file-change 默认折叠，展开显示 inline SQL diff，收起隐藏，`Review` 打开右侧 SQL 文件预览。
- `docs/v4-design-parity-audit-2026-06-07.md`
  - 保存了更细的逐项对齐审计、旧差异、验证命令和后续顺序。

以下为前端负责人此前保存的验证记录；本次只读复核确认旧 UI active path 仍为 44/44 PASS。typecheck、visual smoke、style/responsive/design compare 若用于合并或 PR 描述，需要在当前 worktree 和当前 dev server 上重新执行并写入最新输出。

本轮已保存过：

- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\workbench\designIcons.test.tsx --reporter=dot`
- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`
- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx -t "Enter to send|keyboard behavior from Settings|grouped consecutive user messages|submits composer" --reporter=dot`
- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\transcript\normalizeEdgeEvents.test.ts --reporter=dot`
- `cd app/desktop; corepack.cmd pnpm exec vitest run src\platform\desktopPlatform.test.ts --reporter=dot`
- `cd app/desktop; corepack.cmd pnpm typecheck`
- `cd app/web; corepack.cmd pnpm typecheck`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_profile_popover_compare.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_typography_audit.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_style_compare.mjs`
- `node app\desktop\.tmp\v4_motion_polish_smoke.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_document_preview_smoke.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_profile_registry_smoke.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\v4_project_tabs_smoke.mjs`
- `cd app/desktop; corepack.cmd pnpm exec node .\.tmp\verify_agents_page_refine.mjs`
- `.\scripts\verify-v4-old-ui-active-paths.ps1`
- `git diff --check`
- 最新资料卡与 inline diff checkpoint：shared `AgentHubWorkbench.test.tsx --reporter=dot` 25/25 通过；Desktop/Web typecheck 通过；5173/5174 Playwright smoke 确认资料卡发送消息聚焦 composer、inline diff 默认折叠、展开/收起和 `Review` 分工正确。
- 旧 UI 活跃路径护栏：`.\scripts\verify-v4-old-ui-active-paths.ps1` 44/44 passed。
- 5173/5174 Playwright smoke：demo 发送会追加用户消息和 mock reply，输入框清空；默认快捷键和设置切换后的快捷键行为均正确；无 console/pageerror。
- 最新样式/motion checkpoint：`v4_style_compare.mjs` 输出 `No computed-style deltas against design.`；`v4_motion_polish_smoke.mjs` 在 5173/5174/5176 均无 console/page error、无 overflow；shared `AgentHubWorkbench.test.tsx` 25/25 通过；Desktop/Web typecheck 通过。

`git diff --check` 仅有 Windows CRLF warning，无 whitespace error。

2026-06-07 冻结整理复验：

- `git diff --check` 通过，仅 Windows CRLF warning。
- `.\scripts\verify-v4-old-ui-active-paths.ps1`，44/44 passed。
- `.\scripts\verify-web-hub-boundary.ps1`，12/12 passed。
- `cd app/shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\workbench\designIcons.test.tsx --reporter=dot`，2 files / 31 tests passed。
- `cd app/desktop; corepack.cmd pnpm typecheck` passed。
- `cd app/web; corepack.cmd pnpm typecheck` passed。
- `cd app/desktop; corepack.cmd pnpm build` passed；Vite 报大 chunk warning 和 `vendor-react -> vendor-tanstack -> vendor-react` circular chunk warning。
- `cd app/web; corepack.cmd pnpm build` passed；Vite 报大 chunk warning。

## 当前工程边界

- 后端不在本轮前端负责人范围内；不要为了 UI smoke 改 Edge/Hub 行为。
- 其他 Agent 新增的任务编辑、select、backend、mobile 或 store 改动不要误删。
- `.tmp` 下的 Playwright 脚本和截图是本地证据，不作为产品源码入口。
- 5174 Web 不复制 Desktop window chrome；5173 Desktop 可保留 chrome wrapper。
- shared UI 的可见层必须以当前 shared workbench 和 mock/demo 为基准；`agenthub-design` 仅作历史参考。新增能力先放进 reducer/intent/adapter 或明确菜单入口，不在首屏自创控件。

## 下一步建议

1. 保持 `v4_style_compare.mjs` 作为 Chat 首屏稳定 CSS 护栏；置顶公告、diff 展开、sidebar/inspector collapse 继续由独立 smoke 覆盖，避免把状态差异混入基线。
2. 继续做 5173/5174/5176 截图级验收：真实数据模式、FilePreview/open-with、BrowserPreview、Projects cards、sidebar 图标色阶、inline diff 视觉密度和窄屏/压缩布局。
3. 把 FilePreview “打开方式”菜单接入 Desktop/Web platform action；shared UI 只发出意图，不写 VS Code、Terminal、文件夹等本地命令。
4. 子页交互进入生产化：Contacts 的新增/邀请/行点击、Docs 的新建/上传/搜索、Projects 的新建/过滤/公告编辑、Agents 的安装/保存/删除/策略/模型/audit 动作仍有 no-op 或仅本地状态；Tasks/Settings 已有较多本地交互，但还需要接 Hub mutation、失败回滚和用户偏好持久化。
5. 继续补真实 Edge/Hub runtime event 的 tool timeline 聚合；不要把真实运行数据硬塞回 design overview 首屏。
6. 继续推进 i18n：shared workbench 用户可见 chrome 文案进入 shared dictionary，Agent/user 消息内容不翻译。
7. 继续把 Agent 配置和头像来源统一到 profile registry/provider；新增页面只能消费 shared resolver，不能自建头像、首字母或 Agent 判断逻辑。Agents 页下一步优先把真实 Agent 配置、头像 URL、runtime/model、skills 和 tools 合并到同一个 provider。
7. 继续完善 Docs/Projects 的轻量文档体验：搜索、标签、来源/provider badge、最近访问、项目产物到云文档的交叉入口；暂不做重型协同编辑。
