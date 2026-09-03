# AgentHub 工作台 UX 对标报告（2026-08）

最后更新：2026-08-28 · lane：UX 对标审计（只读研究 + 远程截图）→ 交付状态已登记
参考产品：[codeg](https://github.com/xintaofei/codeg)（公开 README / [docs.codeg.app](https://docs.codeg.app/guide/) / 公开截图）、[Cursor Agent](https://cursor.com/docs/agent)（公开文档：[Agents Window](https://cursor.com/docs/agent/agents-window)、[Agent Review](https://cursor.com/docs/agent/agent-review)）。第三方材料仅以公开 URL 引用，不 vendor 进本仓。

## 0.5 交付状态（2026-08-28）

F1–F15 已全部合入 master（squash，issue 号即提案编号）；本报告由「建议清单」转为已交付的架构参考。

| # | 交付载体 | 状态 |
|---|---|---|
| F1/F6 | #1961 会话行 live 状态点 + 全局注意力计数底座；#1970 降级口径与失败计数 | 已交付 |
| F2 | #1963 Tasks↔会话双向深链；#1988 任务队列来源徽标与 provider 隔离 | 已交付 |
| F3 | #1997 会话分屏布局树与并行 review 面板 | 已交付 |
| F4/F9 | #1964/#1966 工程列自动展开与 Preview 标签 | 已交付 |
| F5 | #1994 全局底部状态栏 | 已交付 |
| F7 | #1965 run 中可见派发队列与撤销/改向（queue/steer） | 已交付 |
| F8 | #1998 会话级目标横幅投影（fail-closed） | 已交付 |
| F10 | #1992 产物卡点击聚焦工程列 Preview | 已交付 |
| F11 | #1967 run 聚合只读审查入口 + 可信 workDir 真实批准/驳回 | 已交付 |
| F12 | #1968 checkpoint 时间线卡与只读预览 | 已交付；restore 为有意门禁 |
| F13 | #1999 Tasks 看板列 SSOT 与 review-before-merge | 已交付 |
| F14 | #1990 状态条 live token chip 直达用量页 | 已交付 |
| F15 | #1986 工作台主题预设切换入口 | 已交付 |

F12 边界说明：时间线卡与只读预览已落地；「恢复」动作展示 `checkpoint.restoreUnavailable` 诚实态（恢复未接线：写回需远程证据轨道与显式批准），不假装可用——真实 restore 需要 Edge 工作区快照能力端口，另立任务跟踪。

## 0. 方法与边界

- 本产品观察仅在远程 dev 服务器完成：真实全栈（TokenDance ID / Hub / Edge / Web）+ 一次性 Playwright 脚本（chromium，1440x810，light+dark），走真实 OIDC 登录动线（镜像 `app/e2e/real-oidc-login.spec.ts`）。本机不运行任何 AgentHub UI。
- 截图证据：`tests/artifacts/ux-2026-08/`（gitignored，不入库；本报告只登记结论与索引，截图本身留在跑测的那台机器上）。截图只含合成测试账号的显示名（AgentHub E2E User/Partner），无生产数据；邮箱未出现在所截表面。
- 本报告不改产品源码；建议均标注优先级（P0/P1/P2）与涉及文件，供后续 issue 化。
- 现状组件事实以 `docs/architecture/04-frontend-data-flow.md`、`docs/architecture/07-design-system-ssot.md`、`docs/component-acceptance.md` 与 `app/workbench/src/`、`app/shared/src/ui/` 源码为准。

## 1. 维度一：信息架构与会话聚合

**参考产品做法**

- codeg：单一 Conversations 列表聚合**所有 agent 会话**，按项目文件夹分组，每行带 live 状态点（In Progress / Review / Completed）；侧栏顶部 Automations / To-dos 入口带注意力徽章（失败运行数、待 review 任务数），"队列需要你"在任意页面可见；会话可搜索、可断点续跑（[The Workspace](https://docs.codeg.app/guide/workspace)、[Conversation Aggregation](https://docs.codeg.app/guide/)）。
- Cursor：Agents Window 统一本地/云/SSH 多环境的并行 agent，每任务独立 worktree，本地↔云可互相 handoff（[Agents Window](https://cursor.com/docs/agent/agents-window)）。

**AgentHub 现状**

- GlobalRail（`GlobalRail.tsx`，`data-rail-page`）+ 会话侧栏（`ConversationSidebar.tsx`：分组、未读、pin、archive）+ 独立 Tasks/Agents/Projects/Contacts/Docs/Usage 页面。会话列表是 IM 语义（未读/在线），**run 状态不是一等侧栏属性**；任务队列在独立 Tasks 页。

**差距**：多 agent 并行时，"谁在跑、谁等我批准"必须切页回答；注意力信号分散在聊天内联卡片里。

**建议动作**

| # | 优先级 | 动作 | 涉及文件/组件 |
|---|---|---|---|
| F1 | P0 | 会话行加 live 状态点（running / awaiting-approval / done，复用 `StatusBadge`/`RuntimeIcon`），rail 的 Tasks/审批入口加注意力计数徽章 | `ConversationSidebar.tsx`、`GlobalRail.tsx`、`workbenchApprovalSummary.ts`、`workbenchTasksPageModel.ts` |
| F2 | P1 | Tasks 与会话双向深链：任务卡可跳到承载会话，会话头可跳到任务详情；侧栏提供"任务队列"折叠组 | `WorkbenchTasksRouteView.tsx`、`ConversationSidebar.tsx` |
| F3 | P2 | 评估会话分屏/标签组（codeg Split View 语义），支持并行 review 两个 run | `useWorkbenchPanelLayout.ts`、`WorkbenchFrame.tsx` |

## 2. 维度二：视觉层次与密度

**参考产品做法**：codeg 桌面工作区四列（Conversations / Conversation / Files / Aux）+ 可拖 hairline；terminal  dock 在中两列下方；底部状态栏；无全宽标题栏，chrome 收进两个角落簇；每列自带 header strip，密而有层（[The Workspace](https://docs.codeg.app/guide/workspace)）。

**AgentHub 现状**：rail + 侧栏 + 聊天 + 右 inspector 四区已成形；token/Usage 页（`WorkbenchUsageRouteView.tsx`，#1819）密度合格。但人与人会话首屏中央留白大，`ChatEngineeringColumn` 与 terminal dock 默认不展开，首屏"命令中心"感弱（证据：`01-workbench-first-light.png` / `08-workbench-first-dark.png`）。

**差距**：首屏密度与"工程循环在一屏内"的承诺不匹配；工程表面需要用户主动找。

**建议动作**

| # | 优先级 | 动作 | 涉及文件/组件 |
|---|---|---|---|
| F4 | P1 | 会话存在 active run / 产物时自动展开工程列与 terminal dock（偏好持久化，可一键收回） | `ChatEngineeringColumn.tsx`、`workbenchPreferences.ts`、`WorkbenchFrame.tsx` |
| F5 | P2 | 底部状态栏化：连接态、运行中计数、token chip 合并为全局 status bar（现 `MainchainStatusStrip` 仅在聊天列内） | `MainchainStatusStrip.tsx`、`AgentHubWorkbench.tsx` |

## 3. 维度三：状态反馈与等待可见性

**参考产品做法**

- codeg：状态栏显示会话计数（点击开 Token Usage 全报告）、运行中后台任务数、版本更新徽章；To-dos/ Automations 徽章全局可见。
- Cursor：queued messages（Enter 排队、Cmd+Enter 立即发送、拖拽排序）、steer（在下一个 tool call 边界送达，不中断在飞工作）、checkpoints 时间线、`/goal` 长程目标（[Agent Overview](https://cursor.com/docs/agent)）。

**AgentHub 现状**：`AgentStreamingBar` 提供流式反馈，connection dot 显示 Hub 连接，toast/`StatusNotice` 覆盖局部状态；但**运行中 composer 的排队/steer 语义无可见队列列表**，也无全局"运行中 n / 待批准 m"计数。

**差距**：等待可见性是"当前会话内"的局部体验；离开会话即失去全局态势。

**建议动作**

| # | 优先级 | 动作 | 涉及文件/组件 |
|---|---|---|---|
| F6 | P0 | 全局注意力计数：rail + status strip 显示运行中/待批准数量，点击直达对应队列（与 F1 同批落地） | `GlobalRail.tsx`、`MainchainStatusStrip.tsx`、`workbenchApprovalSummary.ts` |
| F7 | P1 | composer 队列/steer：run 期间输入 Enter 排队、队列列表显示在活动任务下方可排序、提供"立即送达"快捷键 | `UnifiedComposer.tsx`、`AgentStreamingBar.tsx` |
| F8 | P2 | 任务级目标横幅（/goal 语义）：长程任务显示目标、进度与暂停入口 | `WorkbenchTasksRouteView.tsx`、`workbenchTasksPageModel.ts` |

## 4. 维度四：多模态与预览表面

**参考产品做法**：codeg Files 列与聊天并排，agent 改动"落地即见"；office 文档 in-tab live preview、Project Boot 左配置右预览；Cursor Browser 工具截图验证、图像生成 inline 展示。

**AgentHub 现状**：预览组件库齐全（`DocxPreview` / `TablePreview` / `SlideshowPreview` / `CodePreviewCard` + `previewSandbox.ts`），inspector 有 browser preview 焦点目标（`data-browser-preview-focus-target`）。但预览**只住在右 inspector**，与 transcript 空间分离（证据：`03-inspector-light.png`、`10-inspector-dark.png`）。

**差距**："生成即看见"慢一步；窄屏下 inspector 与聊天互抢宽度。

**建议动作**

| # | 优先级 | 动作 | 涉及文件/组件 |
|---|---|---|---|
| F9 | P1 | 工程列增加 Preview 标签（与 diff/terminal 并列），产物生成时自动聚焦；inspector 保留为详情态 | `ChatEngineeringColumn.tsx`、`RightInspector.tsx`、`documentPreview.ts` |
| F10 | P2 | transcript 内产物卡点击后在工程列展开而非替换 inspector，保持聊天上下文不丢 | `ArtifactCard` 相关、`workbenchProjectPreview.ts` |

## 5. 维度五：审批与 Diff 工作流

**参考产品做法**

- Cursor：Agent Review 可配置为每次 commit 后自动跑，或在 Source Control  tab 对**全部本地变更 vs main** 一次性 review；checkpoints 在聊天时间线可点击预览并 restore（[Agent Review](https://cursor.com/docs/agent/agent-review)、[Agent Overview](https://cursor.com/docs/agent)）。
- codeg：Aux 面板 Changes / Commits 标签；To-dos 每任务独立 worktree、**review 前不合并**；多 agent 委派出的子会话各自可 review。

**AgentHub 现状**：`DiffReviewPanel`（+Parts/Types/Helpers）、`RiskBadge`、`PermissionModePicker`、审批内联卡与 `workbenchApprovalSummary` 已构成单审批闭环；但**无 run 级聚合 review 入口**（"本次 run 的全部变更"），也**无 checkpoint/回滚时间线节点**。

**差距**：review 粒度停在单卡片；长 run 的整体审查与回滚要靠用户自己拼。

**建议动作**

| # | 优先级 | 动作 | 涉及文件/组件 |
|---|---|---|---|
| F11 | P1 | run 级"查看全部变更"入口：聊天头/审批摘要一键聚合该 run 全部 diff 进 `DiffReviewPanel`，review 面内可批准/驳回 | `DiffReviewPanel.tsx`、`workbenchApprovalSummary.ts`、transcript adapter |
| F12 | P1 | checkpoint 时间线节点：run 前快照可点击预览并恢复（Edge EventStore 已具备回放基础，产品化为时间线卡） | `app/shared/src/transcript/`、`RecoveryPanel.tsx` |
| F13 | P2 | 无人值守任务"review-before-merge"产品流：任务卡显式标记等待 review，批准后合并（To-dos 语义） | `workbenchTasksPageModel.ts`、`workbenchTaskGroups.ts` |

## 6. 补充发现

| # | 优先级 | 发现与建议 | 涉及文件/组件 |
|---|---|---|---|
| F14 | P2 | codeg 状态栏 token 计数直达全报告（按日/文件夹/agent/模型 + cache hit）；AgentHub Usage 页已存在但无 live chip。建议在 composer/status strip 加当前会话 token chip，点击跳 Usage 页 | `WorkbenchUsageRouteView.tsx`、`MainchainStatusStrip.tsx` |
| F15 | P2 | codeg 12 主题逐 token 改色 + 导入导出；AgentHub 有 light/dark + preset（`themePresets.ts`，preset UI 目前在登录页高级设置 #1820）。建议工作台设置内提供 preset 切换入口 | `themePresets.ts`、`WorkbenchSettingsRouteView.tsx` |

## 7. Top 5 摘要

1. **F1/F6（P0）**：会话行 live 状态点 + rail/状态栏全局注意力计数——多 agent 工作台的态势感知底座，当前完全缺失。
2. **F11（P1）**：run 级聚合 diff review 入口，把单审批卡升级为"整 run 审查"。
3. **F4（P1）**：active run 自动展开工程列/terminal，首屏密度对齐"命令中心"定位。
4. **F7（P1）**：composer 队列/steer 语义与可见队列列表，对齐 Cursor 的等待体验。
5. **F9（P1）**：预览从 inspector 前移到工程列，产物"生成即见"。

## 8. 截图证据索引

`tests/artifacts/ux-2026-08/`（gitignored，不入库）。视口 1440x810 @2x。

| 文件 | 表面 | 备注 |
|---|---|---|
| `01-workbench-first-light.png` | 已认证工作台首屏（light） | 四区布局、会话侧栏、inspector 默认开 |
| `02-chat-conversation-light.png` | 聊天/会话视图（light） | 含成员 chips、连接态 |
| `03-inspector-light.png` | 右侧 inspector 可见态（light） | 与 02 同帧（inspector 默认开，证明默认可见性） |
| `05-agents-light.png` | Agents 页（light） | profile 卡片网格 |
| `06-usage-light.png` | Token Usage 页（light） | KPI 卡 + 按日图表 + 明细表 |
| `07-global-search-light.png` | Ctrl+K 全局搜索（light） | 命令面板形态 |
| `08-workbench-first-dark.png` | 工作台首屏（dark） | 主题切换经应用内 toggle |
| `09-chat-conversation-dark.png` | 聊天视图（dark） | 与 08 同帧（chat 为默认页） |
| `10-inspector-dark.png` | inspector 可见态（dark） | — |

缺口：Tasks 页截图未获取（一次性脚本的 rail 选择器未命中该入口，Tasks 表面结论以源码与路由模型为准，不以截图宣称）；未触发 active agent run，streaming/approval 内联卡无真实截图（该表面结论以组件源码为准）。证据等级：observed-remote（UI 表面），不宣称 real-tested 全链路。
