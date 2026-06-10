# v4 UI 与 agenthub-design 对齐审计

> 日期：2026-06-07
> 对比目标：AgentHub Desktop preview `5173`、Web preview `5174` 与 design demo `5176/desktop`
> 设计源：`D:\Code\TokenDance\agenthub-design\desktop`

## 截图证据

本轮用 Playwright 只读截图和 DOM 指标对比：

| 场景 | 5173 | 5174 | 5176 |
|---|---|---|---|
| Chat 1440x920 | `app/desktop/.tmp/v4-page-desktop-chat.png` | `app/web/.tmp/v4-responsive-web-1440x920.png` | `app/desktop/.tmp/v4-page-design-chat.png` |
| Chat 390x844 | `app/desktop/.tmp/v4-responsive-desktop-390x844.png` | `app/web/.tmp/v4-responsive-web-390x844.png` | `app/desktop/.tmp/v4-responsive-design-390x844.png` |
| Agents | `app/desktop/.tmp/v4-page-desktop-agents.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-agents.png` |
| Contacts | `app/desktop/.tmp/v4-page-desktop-contacts.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-contacts.png` |
| Docs | `app/desktop/.tmp/v4-page-desktop-docs.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-docs.png` |
| Tasks | `app/desktop/.tmp/v4-page-desktop-tasks.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-tasks.png` |
| Projects | `app/desktop/.tmp/v4-page-desktop-projects.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-projects.png` |
| Settings | `app/desktop/.tmp/v4-page-desktop-settings.png` | 本轮未截 | `app/desktop/.tmp/v4-page-design-settings.png` |
| Inspector Browser Preview | `app/desktop/.tmp/v4-inspector-preview-desktop.png` | `app/web/.tmp/v4-inspector-preview-web.png` | `app/desktop/.tmp/v4-inspector-preview-design.png` |

## 已基本对齐

- Global rail、sidebar、workspace header、composer capsule、inspector 三 tab 的几何结构在 1440/1280 视口接近 design。
- Contacts、Docs、Tasks、Projects、Settings 页面文本、主导航和布局结构基本同步到 design demo。
- Agents 页面几乎 1:1；5173 已补 Desktop-only 32px window chrome，5174 明确不复制 `.window-chrome`。
- Web 不应复制 `.window-chrome`。当前截图审计中 5173/5176 `hasWindowChrome=true`，5174 `hasWindowChrome=false`。

## 当前验收状态

2026-06-07 晚间保存时，前端 shared UI 的最近一轮可确认结果如下：

- 固定控制区响应式规则已加入验收口径：toolbar、tab、header action、inspector tab、多选条、页面操作区不得通过换行适配宽度；窄宽时必须保持单行，使用截断、隐藏低优先级文字、横向内部 overflow 或 icon-only。内容 chip/长文本流可以换行或断词，但不能把这套规则反向套到固定工具条。
- `v4_profile_popover_compare.mjs` 已确认 Desktop 5173、Web 5174 与 design 5176 的账号弹层无 delta；账号菜单保持 design 源码的 404px、签名入口、7 个菜单项、2 个分隔线和 3 个空间行。
- `v4_style_compare.mjs` 已确认 chat/overview computed-style 基线可用；当前 overlay composer 采用安全滚动 padding，确保最新消息停在 composer 上方，不再按静态 flow composer 的 `28px` bottom padding 硬锁。
- 5173/5174 压缩布局 smoke 已确认：inspector 拖宽到 760px 后左侧最近频道栏自动折叠，置顶卡和 composer 均留在 workspace 内，横向 overflow 为 0；滚到底部后最新消息与 composer 顶部保留约 54px 间距。
- `v4_typography_audit.mjs` failures 为空；已解释的 button root fontFamily 和 Web 无 Desktop chrome 高度差异仍按脚本 ignoredDiffs 处理。
- shared focused tests、Desktop typecheck、Web typecheck、旧 UI active path 44/44 和 `git diff --check` 均通过；`git diff --check` 只剩 CRLF warning。
- 后续仍要继续复跑并修正 `v4_subpage_compare.mjs`、`v4_inspector_interaction_smoke.mjs`、`v4_long_press_multiselect_smoke.mjs`；若并行 Agent 新增功能，优先把功能套进 v4 设计系统，不直接删除。

## 主要不足

### 已处理: Chat transcript grouped run-step

Design 的 `builderAgentHistory()` 把运行过程组织成：

- `run-session-card` 的运行元数据语义
- `agent-timeline`
- `runStepGroup()` 折叠组
- 折叠组内部的 `toolUseCard()` / `fileChangeCard()` / diff
- thinking/subagent/route/context/approval/result 作为连续的 agent history 流

2026-06-07 已完成首轮修复：`TranscriptBlock` 新增 `agent_timeline` 和 `run_step_group`，`TranscriptView` 接入 `AgentTimeline` 与 `RunStepGroup`，Desktop fallback transcript 与 shared demo transcript 均按 design 顺序展示 `agent_timeline -> 深度思考 -> 已运行 3 条命令` 的运行结构。按后续用户反馈，`run_session` 不再作为主聊天流里的大型白色总结卡可见；运行会话元数据应落到折叠步骤组、evidence 或右侧 inspector，而不是在 transcript 主流占一整张卡。5174 默认 Web preview 复用 shared demo transcript，因此同样继承 grouped run-step 结构。

同日追加完成完整 B0 流程后半段：shared demo transcript 已补齐定位完成、Reviewer subagent、route/context、生成迁移草案、`已编辑 2 个文件` 展开组、created/modified file rows、Review 按钮、SQL diff、Write File approval、验证历史消息折叠组、Browser QA 和最终 result。5173/5174/5176 transcript flow smoke 均为 4 个 run-step，展开状态和 654px 宽度与 design demo 对齐。

2026-06-07 继续补齐文本气泡合同：`TextTranscriptBlock` 新增 `displayTitle/displayDetail/badgeLabel/badgeVariant`，agent 消息不再依赖中文句号或换行启发式拆分。shared demo 与 Desktop fallback 均按 design demo 显式渲染“收到，我会先做运行隔离和代码定位 / 找到迁移边界 / 生成迁移草案 / 迁移方案已完成”，并匹配 `运行中 / 定位完成 / 写入中 / 完成` badge。Desktop fallback 同步移除旧的散落 artifact/diff 重复块，消息顺序收敛到 design demo 的完整 B0 运行流。

同日继续按用户反馈清理 Chat 主流卡片层级：大型 `run_session` summary、`4 个子任务`、`Orchestrator 工作流` 一类独立白卡不得回到主 transcript；agent 文本消息也不再使用 `data-card-surface`、边框和圆角卡片外观，保持 design demo 的 inline 文本层级。需要选择态、右键菜单和多选状态时，只作用在 design 明确存在的真实消息/工具/file/diff surface 上。

关键源码：

- design: `agenthub-design/desktop/app.js` 的 `builderAgentHistory()`、`runStepGroup()`、`toolUseCard()`
- current: `app/desktop/src/platform/desktopPlatform.ts` 的 `desktopTranscript`
- current: `app/shared/src/demo/workbenchDemo.ts`
- renderer: `app/shared/src/workbench/TranscriptView.tsx`

### 已处理: Right inspector overview prototype 优先

Design 的 Builder 右侧概览标题是 `B0 SQLite 迁移`，任务为“梳理现有会话表与消息索引 / 确认 FTS5 / 生成迁移顺序与回滚脚本 / 补充性能验证清单”，产物默认最终文件为 `sqlite-migration-plan.md`。

2026-06-07 已完成首轮修复：`RightInspector` overview 固定使用 design prototype 的 B0 任务和文件清单，避免 runtime evidence 把首屏概览改形。真实 evidence 仍保留在 browser/files tab 的 preview 能力和运行数据聚合里，不覆盖 demo 首屏任务文案。

关键源码：

- design: `agenthub-design/desktop/app.js` 的 monitor state 与 `renderOverviewPanel()`
- current: `app/shared/src/workbench/RightInspector.tsx`
- current: `app/shared/src/workbench/inspector/OverviewPanel.tsx`

### P1: Chat mock data 细节仍有漂移

- Header tag 已接近，但必须保持 `Claude Code / 前端实现 / DeepSeek-V4-Pro` 的固定结构。
- Sidebar unread count 应与 design 保持一致：Agent 协作群为 `4`，Deployer 为 `2`；当前部分截图中 Agent 协作群显示 `5`。
- Result block 已按 design `resultBlock(success, summary)` 收敛为 header + summary；不要恢复旧 duration/turns meta 行。
- Approval mini card 已按 design 去掉标题风险徽标里的 dot；批准/拒绝后的状态徽标仍保留 dot。
- Right inspector overview 文件列表已按 design computed style 保持文件图标 17px、0 圆角、`--text-3` 弱化色；通用文件图标注册表继续保持 design demo 的文件类型色。
- Right inspector 新增的 `+` quick-open 菜单属于当前产品交互增量，保留但必须使用 design window action/menu 密度；5173/5174 smoke 已覆盖“点 `新建右侧窗口` 后选择 `浏览器` / `恢复 浏览器`”，5176 design demo 仍按原型直接打开 browser preview。三端 preview pane 均为 368px 宽，无 console/page error 和 overflow。2026-06-07 本轮继续把 inspector window action 收敛到 design demo 源码：`+` 按钮保持 28px、`var(--r-md)`、transparent 背景，hover 使用 `surface-high`，不改变 quick-open/restore/open-with 新增交互；复跑 `v4_inspector_preview_smoke.mjs` 后 5173/5174/5176 仍无 console/page error、无 overflow，`v4_style_compare.mjs` 仍为 0 computed-style delta。
- 剩余差距集中在 Desktop live pin 覆盖 demo pin 时的文案差异、Builder header badge 微样式、sidebar/button radius 与部分图标色阶；运行流不应再退回分散 blocks。

### 已处理: 窄屏 1180px 工作台基线与运行态压缩策略

Design 在 `styles.css` 中设置：

- `body { min-width: 1180px; }`
- `.app { min-width: 1180px; height: calc(100vh - 32px); }`

2026-06-07 已完成：Desktop/Web shared shell 显式采用 `min-width:1180px`。390 审计中 5173、5174、5176 均保持横向工作台模型，5174 不显示 fake Desktop window chrome。

2026-06-07 晚间按拖拽反馈修正运行态策略：`1180px` 只作为 design demo 的宽屏参考，不再作为 shared shell 硬 `min-width` 顶穿真实 Desktop/Web 窗口。右侧 inspector 拖宽导致聊天列低于可读宽度时，shared workbench 会自动折叠左侧最近频道栏；置顶公告和 composer 统一限制为 `workspace` 内左右 20px 安全边界，避免拖拽后越过 inspector 边界。验证：`v4-pressure-layout-desktop.png`、`v4-pressure-layout-web.png` 中 5173/5174 均为 `data-sidebar-collapsed=true`、grid 第二列 `0px`、inspector `760px`、横向 overflow 为 0；`v4-pressure-bottom-desktop.png`、`v4-pressure-bottom-web.png` 中最新消息与 composer 顶部保留约 54px 间距。

### P2: 页面级细节继续细扫

Agents/Contacts/Docs/Tasks/Projects/Settings 已比较接近。后续只需要逐页核对 hover/focus/active、表格列宽、图标 glyph、按钮半径和空状态，不应大改结构。

### 已处理: 数据模式设置与动效基线

2026-06-07 继续补齐本地开发设置页的数据模式闭环：`自动 / Mock / 正常` segment 和状态说明卡统一使用 `normalizeWorkbenchDataMode()` 映射到底层 `auto / demo / real`。设置变更会写入 `localStorage` 的 `agenthub.workbench.dataMode`，并通过 shared data-mode event 通知 Desktop/Web workbench model 立即重新解析数据模式，不再只依赖 `VITE_AGENTHUB_DATA_MODE` 重启生效。

同日完成首轮 v4 动效基线优化：Desktop/Web token 与 `agenthub-design/desktop/styles.css` 均统一到 `--dur-panel: 520ms`、`--dur-normal: 180ms`、`--ease-panel: cubic-bezier(0.16, 1, 0.3, 1)`，用于右侧 inspector 折叠、composer 宽度联动、overview 卡片折叠和 run-step 展开。`prefers-reduced-motion` 保留兜底，不强行动画。

同日晚间继续完成页面卡片与控件的动效收口：Projects / Agents / Contacts / Tasks / Settings 的重复卡片、表格行、toolbar、segment、switch、路径按钮和状态面板统一改用 v4 token。后续源码级复核确认普通按钮、卡片和列表行不应扩散 `translate/scale/ease-press`；当前规则改为只保留设计 demo 明确存在的面板折叠、菜单入场、发送按钮和文件行响应，其他控件以颜色、边框和阴影缓动为主。

随后继续覆盖高频工作台动效：GlobalRail avatar/button、会话列表行、workspace tab、header icon button、composer focus-within、inspector `+` 菜单、inspector tab、右键菜单、Pinned announcement、Run session、Tool card、File change card 和 Result block 均核对到 `agenthub-design/desktop/styles.css` 的 transition 语义。当前结论是“精致不等于动效变多”：普通 shell/button/tab/card 不做额外 hover 位移，菜单/弹层/折叠区域使用 design 源码的短入场和 panel 曲线，避免后续 Agent 再按个人审美加弹性。

文件图标细节继续收口：`DesignFileIcon` registry 已与 design demo 的 md/css/html/js/ts/sql/db/yaml/ps1/git/xlsx/link SVG 和色阶保持一致，本轮修复 `OverviewPanel.module.css` 中 `.fileIcon svg { color: var(--text-3); }` 覆盖 inline file-type color 的问题。右侧 Files / Browser artifact 行从重边框卡片改回 design 的 monitor-file 风格：32px 透明行、hover `surface-high`、1px 横向位移、右侧 action hover/focus 时浮现。FilePreview 的模式切换和“打开方式”菜单也补齐同一套非线性菜单进入和 hover 动效。

Files tab 可验收性已补：真实 transcript evidence 仍优先进入 Files tab；当当前运行态没有真实 file evidence 时，Files tab 回退使用 overview 的 B0 prototype 文件清单，点击同样进入 `FilePreview`，避免 mock/design 模式下只显示空态而无法验收 monitor-file 行。Account profile popover 也稳定为始终显示签名入口，默认文案为“输入你的个性签名...”，避免账号菜单在无 signature prop 时缺失入口。

验证记录：

- `app/shared`: `vitest run src/demo/dataMode.test.ts src/workbench/AgentHubWorkbench.test.tsx src/workbenchDataMode.test.ts --reporter=dot`，3 files / 29 tests passed。
- `app/shared`: `vitest run src/workbench/AgentHubWorkbench.test.tsx --reporter=dot`，1 file / 23 tests passed；该轮覆盖 Chat 主流卡片清理和 Tasks 直接 CRUD。
- `app/desktop`: `pnpm typecheck` passed。
- `app/web`: `pnpm typecheck` passed。
- `scripts/verify-v4-old-ui-active-paths.ps1`：44/44 passed。
- `git diff --check`：无 whitespace error，仅 CRLF warning。
- `app/desktop/.tmp/v4_subpage_compare.mjs`：最新复跑无 console error，但 Agents 的 `已安装 Agent` 与 `市场` 首卡仍有 padding/background 残余 diff；这是后续 design parity 项，不作为 Chat 卡片清理回退理由。
- Playwright smoke：5173/5174/5176 的 inspector 容器均使用 0.52s panel 曲线；Settings 点击 Mock 后 `localStorage=demo`，状态卡切到 `Mock fixture`。
- Playwright clicked smoke：通过 GlobalRail 点击 5173 的 Chat / Projects / Agents / Tasks / Settings，`data-page` 分别切到 `chat / projects / agents / runs / settings`；截图保存到 `app/.tmp/v4-animation-pass-clicked/`。该轮记录保留为历史证据；后续源码级收口已移除普通 Tasks/Settings 行上的原型外弹性 transform。
- Playwright motion smoke：5173 rail hover、composer focus、run card hover、右键菜单打开和 inspector `+` 菜单打开均可读到 transition/animation；截图保存到 `app/.tmp/v4-motion-smoke/`。5174 通过 GlobalRail 点击 Chat / Projects / Agents / Tasks / Settings 后截图保存到 `app/.tmp/v4-motion-smoke-web/`，Web 端继续使用共享 UI 壳且不显示 Desktop window chrome。后续复核要求这些 motion 必须能追溯到 design 源码。
- Playwright file icon smoke：5173 overview 中 `data-design-file-icon=sql/ts/md` 的外层 color 与 SVG computed color 一致，尺寸均为 17px，截图保存到 `app/.tmp/v4-file-icon-pass/`。
- Playwright Files tab smoke：5173/5174 Files tab 均显示 4 行 B0 prototype 文件；首行 computed height 为 32px、border 为 0、默认透明背景、hover 后 action opacity 接近 1 且 action color 为 primary，截图保存到 `app/.tmp/v4-files-tab-pass/`。
- 2026-06-07 本轮继续由前端负责人接手动效优化：先前 `ProfilePopover` 曾被改成 `--dur-medium + --ease-panel`，本轮复核后已恢复 design 源码的 `--dur-normal + --ease`；账号菜单行不保留实现侧额外 transition/transform。账号状态、签名、联系人、Agent、Projects 等普通控件不再扩散非设计弹性，只保留必要的颜色、边框、阴影和 focus-ring 反馈。运行态验证：5173/5174/5176 motion smoke 均无 console/page error、无 overflow。
- 2026-06-07 修复右侧 inspector 拖到最小时残留窄栏的问题：原逻辑只把宽度 clamp 到 48px，没有进入 `data-inspector-collapsed=true`，因此会留下可滚动的细侧栏。现在新增 96px 吸附阈值，拖拽过程中一旦越过阈值就立即结束 resize 并切到 collapsed=0，不再等到松手；键盘 resize 缩到阈值内也自动折叠，展开时恢复 400px；折叠动画继续使用 shared shell/inspector 的 panel 曲线。Playwright 证据：5173/5174 在鼠标仍按下的 during-drag 阶段均为 `data-inspector-collapsed=true`、`data-inspector-resizing=false`、grid 末列 `0px`，截图和 JSON 保存到 `app/.tmp/v4-inspector-immediate-collapse-pass/`。
- 2026-06-07 修复深浅主题切换的分批变色问题：`AgentHubWorkbench` 不再直接裸写 `html[data-theme]`，Desktop/Web ThemeProvider 和 Workbench theme button 统一走 shared `applyAgentHubTheme()`。切换时根节点短暂进入 `data-theme-sync=true`，Desktop/Web 全局 CSS 在两帧内禁用 `transition/animation`，让 `--app-bg/--surface/--text-*` token 一次性同步提交，随后恢复正常交互动效。Playwright 证据：5173/5174 点击 `切换主题` 后 immediate 阶段均为 `data-theme=dark`、`data-theme-sync=true`、shell `transition-property=none`，rail/workspace/inspector 背景已同时变为 dark；180ms 后 `data-theme-sync` 自动移除，截图和 JSON 保存到 `app/.tmp/v4-theme-sync-pass/`。
- 2026-06-07 新增左侧最近频道栏折叠/拖拽：Chat 页 shell 从固定 260px 改为 `--sidebar-w` 驱动，默认 260px，键盘/拖拽范围 180-360px，点击当前高亮的 GlobalRail `对话` 图标在当前页直接折叠/展开，拖拽越过 96px 吸附阈值释放后自动切到 `data-sidebar-collapsed=true`。左栏使用和右侧 inspector 一致的 grid 列折叠、clip-path、opacity/translate 延迟退出和 2px resizer 高亮，不在非 Chat 页面显示最近频道栏。Playwright 证据：5173/5174 均验证 initial=260px、click collapse grid 第二列 0px、click expand=260px、drag max=360px、drag snap collapsed=true，截图和 JSON 保存到 `app/.tmp/v4-sidebar-resize-pass/`。
- `app/shared`: `vitest run src/workbench/designIcons.test.tsx src/workbench/AgentHubWorkbench.test.tsx --reporter=dot`，2 files / 21 tests passed。
- `app/web`: `pnpm typecheck` 重新通过；过程中顺手修复 `ContactsPage.tsx` 在 `exactOptionalPropertyTypes` 下向 `ProfilePopover` 传入 `subtitle={undefined}` 的类型问题，行为保持为“无 subtitle 时不传该 prop”。
- `app/shared`: `vitest run src/workbench/AgentHubWorkbench.test.tsx src/workbench/designIcons.test.tsx --reporter=dot`，2 files / 22 tests passed。
- `app/desktop`: `pnpm typecheck` passed。
- `app/web`: `pnpm typecheck` passed。
- 2026-06-07 本轮复核 5174 Web 本地开发页：强制 reload 后仅保留设置行内一个 `自动/Mock/正常` segmented control，状态区只显示当前模式 badge，无 `modeStatusSeparator` 装饰点；Playwright 指标为 `chrome=false`、`modeStatus=true`、`bodyW=viewportW=1440`、console error 为空，截图写入 `app/web/.tmp/v4-web-settings-local.png`。

关键源码：

- current: `app/shared/src/demo/dataMode.ts`
- current: `app/shared/src/workbench/WorkbenchRoutes.tsx`
- current: `app/desktop/src/platform/useDesktopWorkbenchModel.ts`
- current: `app/web/src/platform/useWebWorkbenchModel.ts`
- current: `app/shared/src/workbench/pages/SettingsPage.tsx`
- current: `app/shared/src/workbench/pages/ProjectsPage.module.css`
- current: `app/shared/src/workbench/pages/AgentsPage.module.css`
- current: `app/shared/src/workbench/pages/ContactsPage.module.css`
- current: `app/shared/src/workbench/pages/TasksPage.module.css`
- current: `app/shared/src/workbench/pages/SettingsPage.module.css`
- current: `app/shared/src/workbench/AgentHubWorkbench.module.css`
- current: `app/shared/src/workbench/blocks/RunSessionCard.module.css`
- current: `app/shared/src/workbench/blocks/ToolCardBlock.module.css`
- current: `app/shared/src/workbench/blocks/FileChangeCard.module.css`
- current: `app/shared/src/workbench/blocks/ResultBlock.module.css`
- current: `app/shared/src/workbench/blocks/PinnedAnnouncement.module.css`
- current: `app/shared/src/workbench/floating/ContextMenu.module.css`
- current: `app/shared/src/workbench/inspector/OverviewPanel.module.css`
- current: `app/shared/src/workbench/inspector/FilePreview.module.css`
- current: `app/shared/src/workbench/pages/ContactsPage.tsx`
- current: `app/shared/src/workbench/RightInspector.tsx`
- current: `app/shared/src/workbench/WorkbenchRoutes.tsx`
- current: `app/shared/src/workbench/floating/ProfilePopover.tsx`

### 已处理: Inspector tab 关闭与文件查看框架

Design prototype 的 inspector tab 本身带 `data-inspector-close` 关闭标记。当前 shared `RightInspector` 已把 `概览 / 浏览器 / 文件` 三个 tab 的关闭从视觉标记升级为真实交互，关闭后可通过 header `+` 菜单恢复。`+` 菜单同时保留 Codex-like 快捷入口框架：文件、侧边聊天、浏览器、终端。侧边聊天和终端先作为入口框架，不在首屏新增自造面板。

`FilePreview` 已补齐源码、Markdown 预览、Diff 预览和“打开方式”菜单。Markdown 文件默认进入预览模式，Diff 使用 design demo 的 readonly editor/diff line 视觉语义；“打开方式”菜单目前只记录选择目标，真实 VS Code、Terminal、打开所在文件夹等动作后续必须通过 Desktop/Web platform adapter 接线，不能在 shared UI 里写平台命令。

2026-06-07 晚间继续修正 `FilePreview` 的信息层级：右栏文件预览不再像独立弹窗卡片，外层 border/radius/shadow 已移除，变成 `文件` tab 内的内嵌 editor。Toolbar 收敛为单行：文件名左侧截断，右侧为 `源码/Diff`、icon-only 打开方式和关闭按钮；TS/SQL/JS 等代码文件不显示 Markdown `预览`，Markdown 文件才显示 `预览`；源码/Diff 保留 Prism 语法高亮。截图证据：`app/desktop/.tmp/file-preview-simplified-open-5173.png`。

2026-06-07 点击级 smoke 已补：5173 Desktop 和 5174 Web 均可完成打开 `sqlite-migration-plan.md`、切换 Diff、展开打开方式菜单、关闭文件 tab、通过 `+` 恢复文件 tab；5176 design 对照确认三个 inspector close mark 均存在。smoke 过程中修复了 `+` 菜单被 inspector panel stacking context 截获点击的问题，header 菜单现在明确高于 panel。

2026-06-07 本轮继续修正两个 inspector 细节：`+` window action 回到 design 源码的 28px、`var(--r-md)`、transparent 背景、`surface-high` hover，不使用自创圆形轻底；恢复文件 tab 后的空文件面板从裸文本改为 inspector 内轻量卡片，使用文件图标、标题和说明，避免右侧栏出现未设计的空白文本状态。验证：`v4_inspector_interaction_smoke.mjs` 在 5173/5174 均无 console/page error，文件 tab 可关闭并通过 `+` 恢复；`v4_inspector_preview_smoke.mjs` 三端仍无 overflow。

2026-06-07 本轮继续核对 `OverviewPanel` 与 `BrowserPreview`：`BrowserPreview` 已与 design 源码的 browser chrome / address / status 结构保持一致；`OverviewPanel` 文件行补齐 design 源码里的 `box-shadow` transition 和 open-state `box-shadow:none` 明确规则。运行态抽检确认 5173 与 5176 的 primary file row 在 min-height、padding、radius、background、color、font 上一致；`v4_style_compare.mjs` 和 `v4_subpage_compare.mjs` 继续保持 0 diff / 0 console error。同步修复 `ContactsPage` 对 `ProfilePopover` optional props 的 exact optional 类型传参，避免 Web typecheck 因显式 `undefined` 失败。

2026-06-07 本轮继续核对 card context menu / multi-select：`ContextMenu` 动画回到 design 源码的 `dur-fast/ease`，菜单项 hover 去掉自创 `translateX(1px)` 位移；`OverviewPanel` 文件图标 radius 回到 design `.file-icon` 的 3px，消除 `v4_style_compare.mjs` 中 `monitorFileIcon.radius` 的 0px/3px 差异。同步修复 `AgentHubWorkbench.test.tsx` 中长按多选测试漏声明 `secondCard` 的断言问题，并修复 `WorkbenchRoutes` 对 `AgentsPage.selectedAgentId` 的 exact optional 传参。验证：`v4_interaction_smoke.mjs` 三端无 failures，shared focused test 16/16 通过，Desktop/Web typecheck 通过。

2026-06-07 本轮补齐 `Review` 跳转语义和数据边界：transcript 中的 file-change `Review` 不再是空回调，点击 SQL 变更行会把右侧 inspector 展开并切换到 `文件` tab，打开 `FilePreview` 的源码/Diff 详情；B0 demo 的任务、文件列表、文件正文和 diff 已抽为 `workbenchDemoData` 结构化数据，避免把聊天记录关联文件内容继续写死在 `RightInspector` 展示组件内。验证：shared focused test 17/17 通过，Desktop/Web typecheck 通过，旧 UI active path 44/44 通过；`verify_review_opens_inspector.mjs` 确认 5173/5174 均打开 `migrations/0007_chat_threads.sql` 预览且无 console error，截图为 `v4-review-opens-inspector-desktop.png` 和 `v4-review-opens-inspector-web.png`。

2026-06-07 本轮继续做 design 源码级交互收口：`GlobalRail` avatar/button、sidebar conversation row、inspector tab 去掉 design demo 未定义的 hover 位移和弹性 transform，保留 design 明确存在的 run-step、monitor-file、菜单进入动效。账号 profile popover 恢复 design `delicious233.accountRows` 的完整菜单：个人名片、二维码、登录更多账号、帮助与客服、设置、退出登录、管理后台，以及签名入口和 spaces。验证：`v4_style_compare.mjs` 仍为 0 computed-style delta；`v4_interaction_smoke.mjs` 5173/5174/5176 无 failures；`app/shared` focused test 2 files / 23 tests passed；Desktop/Web typecheck 通过。`v4_subpage_compare.mjs` 本轮样式 diff 仍为空，但 contacts 子页出现一次 dev server 500 console error，后续需要复跑确认是否为热更新瞬态。

2026-06-07 本轮继续补齐 transcript 交互与 Settings 状态组件：长按 520ms 进入多选、Esc/Ctrl+A/Ctrl+C/Delete 快捷键、pointerup 二次选择均在 shared Workbench 落地，5173/5174 smoke 均为 `selectedCount=2` 且 Composer 隐藏；用户连续短时间发送 text 消息时后续气泡隐藏重复头像但保留 28px 占位，避免截图中右侧头像重复。Settings 状态组件页保留 design 源码的 `.settings-state-system/.state-grid/.state-panel/.state-mark` 结构，去掉原型外 hover 位移和额外阴影。验证：shared `AgentHubWorkbench.test.tsx` 18/18 通过，Desktop/Web typecheck 通过，`v4_long_press_multiselect_smoke.mjs` 和 `v4_settings_states_smoke.mjs` 均无 failures；截图写入 `app/desktop/.tmp/v4-long-press-multiselect-desktop.png`、`app/web/.tmp/v4-long-press-multiselect-web.png`、`app/desktop/.tmp/v4-settings-states-design.png`。

2026-06-07 本轮继续做动效精修：Workbench header icon、workspace tab、composer row、ProfilePopover action/status、FilePreview mode/open-with、Contacts quick/service/member/modal control、Projects new/run/artifact/announcement、Agents outline/skill/market/model 等普通控件去掉原型外的 `translateY(-1px)`、`scale(0.985/0.992)` 和 `ease-press` hover/active 弹性；保留 design 明确存在的发送按钮 scale、菜单入场、modal 入场、Overview section toggle、monitor-file 行内 1px 横向响应和 inspector/file 菜单行响应。验证：`v4_motion_polish_smoke.mjs` 在 5173/5174/5176 均无 console/page error、无 overflow；5173/5174 的 shell button 只保留 `background,color` transition，composer row 只保留 `width,box-shadow,border-color`，send button 保留 `background,transform`；shared `AgentHubWorkbench.test.tsx` 20/20 通过，Desktop/Web typecheck 通过，`git diff --check` 通过但仍有 CRLF warning。该轮曾暴露 tool/diff card 密度差异；当前保存状态以本文“当前验收状态”为准，最近一次 `v4_style_compare.mjs` 已无 computed-style delta。

2026-06-07 本轮继续完成 chat 首屏稳定 CSS 收口：`v4_style_compare.mjs` 先修正脚本状态问题，不再点击已激活的 Chat rail 触发 shared sidebar collapse；运行态坐标确认 5173 与 5176 的 rail/sidebar/workspace/inspector 均为 `52/260/728/400`。随后按 design 源码修正 `ProfilePopover` 入场为 `--dur-normal + --ease`，账号菜单行移除实现侧额外 transition；`ToolCardBlock` 背景、description `margin-top:4px` 与 `line-height:1.45` 对齐 `.agent-tool-card`；`RunStepGroup` open shadow、detail transform、detail inner `gap:8px`、`padding:0 12px 12px` 对齐 `.run-step-detail-inner`；nested thinking detail 的 `padding:11px 13px`、`radius:var(--r-md)`、正文 `margin-top:7px` 与 `line-height:1.55` 对齐 `.agent-detail-block.thinking-block`；send button 不再强制反色文本，只保留 design 源码里的 background/transform transition。基础样式 compare 将 pinned padding、diff 展开态和当前 fixture 不存在的旧探针剥离，交给对应交互 smoke 覆盖。验证：`node app\desktop\.tmp\v4_style_compare.mjs` 输出 `No computed-style deltas against design.`；`node app\desktop\.tmp\v4_motion_polish_smoke.mjs` 在 5173/5174/5176 无 console/page error、无 overflow；shared `AgentHubWorkbench.test.tsx` 25/25 通过；Desktop/Web typecheck 通过；`git diff --check` 通过，仅 CRLF warning。

2026-06-07 本轮修正真人好友资料卡路径：点击 Johnny 私聊里的头像时，shared Workbench 先尝试 Agent 配置，找不到后按联系人资料卡处理，不再把真人误报为缺少 Agent 配置。`Johnny 资料卡` 展示身份、组织、状态、最近消息，动作只有 `发送消息/复制链接`，不出现 `Agent 配置`。验证：shared `AgentHubWorkbench.test.tsx` 20/20 通过；Desktop/Web typecheck 通过；5173/5174 Playwright 点击 Johnny 私聊头像均通过，截图为 `app/desktop/.tmp/v4-human-profile-johnny-desktop.png` 和 `app/desktop/.tmp/v4-human-profile-johnny-web.png`；旧 UI active path 44/44 通过；`git diff --check` 无 whitespace error（仅 CRLF warning）。

2026-06-07 本轮继续修正私聊 transcript 卡片路径：Johnny 是真人用户，不是 Agent，但其消息仍应和 Agent 回复一样使用左侧 incoming 白色消息卡片。shared `TranscriptView` 已把 text block 布局规则从 `author.role === "agent"` 改为 current-user 判定：只有 `Delicious233` 走右侧 user bubble，Johnny、Trump、Agent、system preview 等其他作者统一走 `AgentMessage` 左侧卡片；`AgentMessage` 恢复 `surface + border + shadow` 卡片视觉，并新增 `data-agent-bubble` 供 Playwright/DOM 验收。demo preview 中 Johnny/Trump 明确标为 `human`，避免测试夹具继续误导实现。验证：`AgentHubWorkbench.test.tsx -t "Johnny|human contact|profile"` 3 passed，`workbenchDemo.test.ts` 5 passed。下一轮截图 smoke 应直接检查 Johnny 会话文本的 `closest([data-agent-bubble])` 背景和边框，防止卡片再次被 CSS 透明化。

2026-06-07 本轮继续修正资料卡和 file-change 交互语义：Agent/真人资料卡的 `发送消息` 会切到对应私聊并聚焦 composer，避免用户点完后没有可见反馈；`UnifiedComposer` 接受 textarea ref，由 Workbench 在 direct-message action 后聚焦。file-change 行拆分 `展开/收起` 与 `Review`：inline diff 默认折叠，点击 `展开` 后在消息流原地显示 diff，点击 `收起` 隐藏；`Review` 只打开右侧 `FilePreview`。diff 与 artifact 现在按文件路径配对，避免 SQL diff 被错误挂到 `hooks/useThreadNavigation.ts` 行。验证：shared `AgentHubWorkbench.test.tsx` 25/25 通过；Desktop/Web typecheck 通过；5173/5174 smoke 确认资料卡发送后 Builder 会话 active 且 composer focused，SQL file-change 默认折叠、展开/收起可用、Review 打开右侧 SQL 文件预览；截图为 `app/desktop/.tmp/v4-agent-send-message-focus-desktop.png`、`app/desktop/.tmp/v4-agent-send-message-focus-web.png`、`app/desktop/.tmp/v4-inline-diff-closed-desktop.png`、`app/desktop/.tmp/v4-inline-diff-open-desktop.png`、`app/desktop/.tmp/v4-inline-diff-closed-web.png`、`app/desktop/.tmp/v4-inline-diff-open-web.png`。

2026-06-07 晚间继续修正 Agents 页设计系统偏差：页面标题改为 `Agent管理`；GlobalRail `Agent` 图标换为更清晰的 v4 stroke 机器人头；Agents 页与 Contacts 国家区号不再使用原生下拉，统一使用 shared v4 `Select`。用户截图指出的非设计系统彩色左描边已移除：已安装 Agent 行不再挂 `data-card-surface`，selected 状态只保留轻量 `surface-high` 背景和普通边框，不允许使用彩色左线、渐变或额外阴影表达选中。Agent 头像来源改为 `resolveWorkbenchProfile()`，列表和详情共用 shared profile resolver；头像视觉保持 design demo 的 34px、`r-sm`、首字母色块，不再使用页面局部首字母/颜色 helper。右侧详情内部内容左靠并限制最大宽度，Skills / 工具权限 / 最近运行退回分段列表，不再作为嵌套卡片堆叠。验证：`AgentHubWorkbench.test.tsx` 25/25 通过；`verify_agents_page_refine.mjs` 在 5173/5174 均无 console error，头像为 34x34、8px radius，截图 `app/desktop/.tmp/agents-page-refine-5173.png`。后续仍需按 design demo 继续核对 Agents 市场首卡、右侧字段密度和真实 Agent provider / 头像 URL。

2026-06-07 晚间继续完成全局固定控制区防回流：`AgentHubWorkbench.module.css` 的 workspace header/tabs 和 inspector tabs 改为 nowrap + ellipsis + 窄宽 icon-only；`MultiSelectBar` 单行滚动，窄宽动作只显示 icon 且保留 `aria-label/title`；Tasks toolbar、Agents market toolbar、Docs/Projects/Contacts tabs/actions、shared `DiffReviewPanel` toolbar 和 `ContextSummary` actions 均不再通过 `flex-wrap` 撑高布局。保留的 `flex-wrap` 只限技能 chip、项目成员 chip、空状态建议等内容流。验证：shared focused tests 2 files / 51 tests passed；Desktop/Web typecheck passed；`v4_responsive_audit.mjs` `compared=9 failures=[]`；`v4_design_compare.mjs` `compared=42 failures=[]`；旧 UI active path 44/44 passed；`git diff --check` 无 whitespace error。

关键源码：

- design: `agenthub-design/desktop/index.html` 的 inspector tab close 标记
- design: `agenthub-design/desktop/styles.css` 的 readonly editor、diff line 和 browser preview 样式
- design: `agenthub-design/desktop/app.js` 的 `profileDirectory().delicious233.accountRows`
- current: `app/shared/src/workbench/GlobalRail.tsx`
- current: `app/shared/src/workbench/RightInspector.tsx`
- current: `app/shared/src/workbench/AgentHubWorkbench.module.css`
- current: `app/shared/src/workbench/inspector/FilePreview.tsx`
- current: `app/shared/src/workbench/floating/ProfilePopover.module.css`
- current: `app/shared/src/workbench/inspector/FilePreview.module.css`
- current: `app/shared/src/workbench/pages/AgentsPage.module.css`
- current: `app/shared/src/workbench/pages/ContactsPage.module.css`
- current: `app/shared/src/workbench/pages/ProjectsPage.module.css`
- current: `app/shared/src/workbench/blocks/RunStepGroup.module.css`
- current: `app/shared/src/workbench/blocks/ToolCardBlock.module.css`
- current: `app/desktop/.tmp/v4_style_compare.mjs`

## 下一步顺序

1. 保持 `v4_style_compare.mjs` 作为 chat 首屏稳定 CSS 护栏；pinned、diff 展开、sidebar/inspector collapse 继续由独立 smoke 覆盖。
2. 新增或修改固定控制区时先按 nowrap/icon-only 规则验收，不能用换行撑高 toolbar、tab、action row 或右栏文件头。
3. 继续做 5173/5174/5176 截图级验收，重点看真实数据模式、文件预览打开方式、browser preview、project cards 和 sidebar 图标色阶。
4. 把“打开方式”菜单接入 Desktop/Web platform action；shared UI 不写本地命令。
5. 为真实 Edge/Hub runtime events 补 tool timeline 聚合，不把真实运行数据硬塞回 overview 首屏。
