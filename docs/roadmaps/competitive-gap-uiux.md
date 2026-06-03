# UI/UX 设计质量竞品差距分析

> 分析时间：2026-06-03
> 分析范围：AgentHub Desktop + Web vs 10 个竞品
> 数据来源：竞品源码（reference/）+ Web 搜索交叉验证

---

## 竞品 UI/UX 摘要

### AI Coding IDE 类

**Cursor**（VSCode fork）
- 暗色主题：`#1e1e2e` 为基础，品牌 accent 为 Cursor Orange `#f54e00`
- 已知痛点：Cursor 原生 UI 面板（chat、model picker、View Options）使用独立 CSS，**绕过 VS Code 主题引擎**——workbench.colorCustomizations 对这些面板无效
- 低对比度问题：链接色 `--cursor-text-link` 未定义时 fallback 到 `#0000EE`（暗底不可见，2026-05 仍为已知 bug）
- 外部设计语言（DESIGN.md）：暖灰 canvas `#f7f7f4`，品牌 orange 极少用，timeline 五色 pastel pills，**零阴影只用 hairline border**
- CMD+K inline 编辑 UI 是差异化亮点

**Windsurf Cascade**（VS Code fork，2025-12 被 Devin 母公司收购）
- Wave 12（2026）UI 大改版：新 Chat + Cascade 面板，"glanceable agent trajectory"——agent 做了什么、调了什么 tool、决策链可一眼扫读
- "Flow State" 交互理念：AI 建议 inline gray text 浮现，不弹 modal；引擎持续监控光标速度、编辑历史、terminal 输出、剪贴板
- Wave 13（2026）并行 Cascade sessions——多个 agent 各有独立 terminal/profile/上下文，UI 需展示多线并行
- 弱点：复杂 CSS 动画 / 非标技术栈仍出粗糙结果，production-grade 动画仍需手工介入
- Select Element（2025-07）：embedded browser 点击 DOM → Cascade 定位组件 → 生成动画代码

**GitHub Copilot Chat**
- VSCode 原生集成，ghost text inline suggestion
- Chat participant UI 遵循 VSCode 规范，无独立视觉身份
- 高亮色 / diff 全部继承 VSCode token

**Augment Code**
- 全仓库图谱可视化：依赖关系图 + 代码导航增强
- 界面为 VSCode/JetBrains 插件，不独立做 UI 层

### Agent 自主类

**Claude Code**（终端 Ink/React TUI）
- 三层渲染栈：Custom Ink fork (`@ant/ink` React reconciler) → Yoga-layout (纯 TS flexbox) → ANSI escape sequences
- ~140 个 React 组件，~80 个 hooks，完整 React 生态跑在终端
- 静态/动态渲染分离：完结消息写固定 buffer 永不重渲染，仅 stream 中的响应 + 输入 + status bar 刷新
- 60fps render cap（16ms frame interval），300ms status bar debounce
- Stream 状态机：`idle → requesting → streaming → done`，分支 thinking/compacting/waiting/error
- 多 agent swarm UI：Background Task "Agent Pills" + "Summary Pills"，Teams Dialog 管理子 agent
- Ghost text 输入建议（Tab accept，输入即消失），基于会话缓存做后台 LLM 请求
- Tabbed 权限弹窗（左右箭头切换），三种模式 Shift+Tab 循环
- Status bar 显示 model/context %/tokens/cost($)/FPS

**OpenAI Codex**（2026-06 最新）
- Web dashboard 为主，新增 6 款岗位插件 + Sites 功能（思考→交互网站）
- 卡片式任务列表 + 执行日志时间线 + 内置沙箱终端 + diff viewer
- 面向非技术用户，UI 更接近 SaaS dashboard 而非 IDE

**Devin**（2026 Cognition）
- Slack-native UI：`@Devin` 启动全 session，支持 `!ask`/`!deep`/`!fast`/`!dana` 快捷指令
- 浏览器共享画面 + workflow 时间线 + 截图嵌入消息 + 实时状态灯
- 2026 里程碑：单周 659 个 Devin PR 合入（4.3× 年增长）
- Scheduled sessions（cron 驱动）：每日健康 digest、每周 deps PR、夜间 E2E smoke
- Daily 设计系统审计：扫描 24h PR → 硬编码 hex/非标准间距/一次性组件 → 自动 Linear ticket
- DeepWiki hover cards（CMD+Shift+Click 获取任意符号 AI 解释）

**OpenHands**（All-Hands-AI，源码直接审阅）
- React 19 + React Router 7 + Tailwind CSS 4 + Vite，`@openhands/ui` 组件库
- 三栏可拖拽面板（Desktop）：Chat 左 → Workspace+Editor 右上 → Terminal 右下；Mobile 单栏 chat-only
- Dark-only，基础色 `--bg-dark: #0c0e10`，`--bg-workspace: #1f2228`
- Monaco Editor + Xterm.js + TanStack Query，`ChatInterface` → `chat-message.tsx` 承载 agent 思维链
- Task tracking：`task-tracking/task-item.tsx` + `task-list-section.tsx`，步骤展开/折叠
- Budget 展示：`budget-display.tsx` + `budget-progress-bar.tsx`
- Typing indicator (`typing-indicator.tsx`) 和 waiting-for-runtime message
- 已知缺：Firefox/WebKit Playwright 项目

**Aider**（纯终端，源码直接审阅）
- 依赖 `prompt_toolkit` 做输入（vi/emacs mode、文件历史、多列补全），`rich` 做 Markdown 彩色输出
- `io.py` 中 `_validate_color_settings()` 验证用户自定义颜色，`_tool_message()` 用 `RichStyle(color=...)` 渲染工具输出
- `Style.from_dict()` 构建 prompt_toolkit 样式字典，颜色全部可配置
- 终端 ASCII art logo by default，`--no-splash` 可隐
- 本质是 readline+echo，不渲染组件树——极简主义

**Cline**（VSCode extension，webview-ui 源码直接审阅）
- VSCode webview React app：Tailwind CSS 4 + `theme.css` + `tailwindcss-animate`
- `ChatRow.tsx` 是消息渲染中枢——根据 message type 选择：ThinkingRow / MarkdownRow / CommandOutputRow / DiffEditRow / BrowserSessionRow / CompletionOutputRow / SubagentStatusRow / HookMessage / ErrorRow / QuoteButton / UserMessage
- `TaskHeader.tsx` + `StickyUserMessage` + `ContextWindow` + `FocusChain` + `Highlights`——任务级上下文管理
- `BrowserSessionRow.tsx`：实时浏览器截图嵌入对话流，含 URL/screenshot/click/tab 操作
- `CheckpointControls` + `CheckpointError`：checkpoint 回滚 UI
- `TypewriterText.tsx`：打字机流式文本组件
- 操作历史即对话流，diff 高亮通过 `DiffEditRow` 内联展示

## 设计系统对比矩阵（含源码证据）

| 维度 | AgentHub | Cursor | Windsurf | Claude Code | Codex | OpenHands | Cline |
|------|----------|--------|----------|-------------|-------|-----------|-------|
| 设计 Token 体系 | ✅ 四层 | ⚠️ VSCode+自有一层CSS(绕过主题引擎) | ⚠️ VSCode+自有panel CSS | ✅ ~140组件+Yoga layout+ANSI | ✅ Web | ⚠️ Tailwind4+`--bg-*` | ⚠️ Tailwind4+theme.css |
| Dark/Light 主题 | ✅ dark+light+6preset×2 | ✅ dark2套+light1套 | ✅ | N/A | ✅ | ❌ dark-only(#0c0e10) | ❌ 随VSCode |
| 玻璃拟态 | ✅ rgba+blur/saturate | ❌ hairline border only | ✅ 部分panel | N/A | ❌ | ❌ | ❌ |
| 响应式布局 | ✅ 3 breakpoints | ✅ VSCode原生 | ✅ | N/A | ✅ | ✅ Desktop3栏/Mobile单栏 | ❌ sidebar only |
| 虚拟滚动 | ✅ TanStack Virtual | ✅ 内置 | ✅ | ✅ VirtualMessageList | 未确认 | ❌ | ❌ |
| 流式UI动画 | ✅ cursor+shimmer+pulse | ✅ | ✅ Cascade | ✅ 状态机+textSweep | ✅ | ✅ typing-indicator | ✅ TypewriterText |
| 键盘导航 | ✅ focus-visible+focus-source | ✅ | ✅ | ✅ vi/emacs+80快捷键 | 未确认 | ⚠️ | ✅ |
| ARIA | ⚠️ srOnly+reducedMotion | ✅ WCAG | ✅ | N/A | 未确认 | ⚠️ | ✅ |
| 子代理可视化 | ✅ agentTaskBlock | ❌ | ✅ 并行sessions | ✅ Agent Pills | 未确认 | ✅ task-tracking | ✅ SubagentStatusRow |
| Diff viewer | ✅ Unified/SideBySide | ✅ VSCode内置 | ✅ | ✅ NAPI+AnsiSlicing | ✅ | ✅ FileDiffViewer | ✅ DiffEditRow |
| 浏览器预览嵌入 | ❌ | ❌ | ✅ SelectElement | N/A | ✅ 沙箱终端 | ✅ browser.tsx | ✅ BrowserSessionRow |
| 审批/Checkpoint | ✅ TeamApprovalPanel | ❌ | ❌ | ✅ Tabbed权限弹窗 | 未确认 | ❌ | ✅ CheckpointControls |
| 色对比度WCAG AA | ⚠️ 未正式验证 | ❌ 已知低对比度bug | ⚠️ | N/A | 未确认 | ⚠️ | ✅ VSCode保障 |

## 视觉质量评分（1-5 分）

| 维度 | AgentHub 现状 | 业界标杆 | 差距 |
|------|-------------|---------|------|
| 颜色系统一致性 | 3.5/5 | Cursor 5/5 | -1.5 |
| 组件设计统一性 | 4/5 | Codex Dashboard 4.5/5 | -0.5 |
| 动效/转场质量 | 3/5 | Windsurf Cascade 5/5 | -2 |
| 空状态处理 | 3.5/5 | Linear/Cursor 5/5 | -1.5 |
| 排版间距节奏 | 4/5 | Cursor VSCode 5/5 | -1 |
| 主题切换体验 | 4.5/5 | Cursor 5/5 | -0.5 |
| 终端/CLI 视觉 | N/A | Claude Code Ink/React 5/5 | N/A |
| Diff 视觉质量 | 4/5 | GitHub PR 5/5 | -1 |
| 错误状态设计 | 4/5 | Claude Code 4.5/5 | -0.5 |
| 信息密度控制 | 4.5/5 | Bloomberg Terminal 5/5 | -0.5 |

## 改进清单（按优先级排序）

### P0 — 视觉底线（评审第一印象）

**1. TSX 内联 style 硬编码颜色清理**
- 当前问题：`TeamApprovalPanel.tsx` 的 `statusStyle()` 函数硬编码 `#f59e0b`、`#fef3c7`、`#10b981` 等 6 个 hex；`DataSection.tsx` 有 `#fff`、`rgb(220,38,38)`、`#e67e22`；`TeamEventTimeline.tsx`、`TeamTaskBoard.tsx`、`TeamMemberList.tsx` 有 fallback hex；`AppearanceSection.tsx` 硬编码 preset swatch 颜色
- 竞品参考：Cursor 全部使用 VS Code token，零硬编码
- 改进方案：
  - `TeamApprovalPanel.tsx:29-46` — `statusStyle()` 改为 CSS class + `--status-pending` / `--status-approved` 等 token
  - `DataSection.tsx:215,245,270,304,345` — 所有 inline `background`/`color` 改为 CSS Module class
  - `AppearanceSection.tsx:57-59` — swatch 颜色从 `designTokens.ts` 读取而非硬编码
- 预估工作量：S（半天，约 5 个文件）
- 可并入：WT-C2 settings-css-split

**2. CSS 文件中 rgba 硬编码收敛检查**
- 当前问题：32 个 CSS Module 中 780 处 rgba/hex 出现在 shadow、glass background、border 等上下文。STATE.md 声称 "CSS 硬编码颜色 0 残留 (150+处→变量 33文件)"，但 780 处 rgba 中许多是 glass 效果的**有意设计**（如 `backdrop-filter: blur(40px) saturate(1.2)` + `rgba(37,37,45,0.82)`），不是缺陷。需要区分"设计 token 缺失"与"glass morphism 语义透明度"。
- 竞品参考：Linear 使用 `hsl(var(--surface) / 0.8)` 模式，所有透明度从 token 派生
- 改进方案：将常用 glass 透明度提取为 token：`--glass-bg-sidebar`、`--glass-bg-panel`、`--glass-bg-card` 等，减少各处重复的 `rgba(255, 255, 255, 0.xxx)` 模式
- 预估工作量：M（1-2 天，需遍历 32 个文件）
- 可并入：WT-D glass-tokens

**3. 空状态页面缺乏品牌个性**
- 当前问题：`WelcomeScreen` 有品牌标记和 launcher，但空 Threads/Runs/Chat 列表只有纯文字 empty state（`sidebarEmpty` / `empty` class），缺乏插图或导引式 empty state
- 竞品参考：Linear 的 "No issues yet" 带插图 + CTA；Cursor 的空文件列表有键盘快捷键提示
- 改进方案：
  - `ThreadPanel.module.css` — 空状态增加图标 + 引导文案 + 快捷键 CTA
  - ChatView 空消息区增加 "Type / to use slash commands" 引导
  - 统一使用 `@shared/ui/EmptyState` 组件（已存在）
- 预估工作量：S（半天）

### P1 — 体验提升（使用 5 分钟后的感受）

**4. 缺少任务/子代理执行进度可视化**
- 当前问题：AgentTask/ChildAgent/RouteDecision block 是静态卡片（`agentTaskBlock` / `childAgentBlock`），没有 Windsurf Cascade 风格的分步动画或进度条
- 竞品参考：Windsurf Cascade 有动画流式面板 + 渐变进度条 + 步骤完成打勾动画；OpenHands 有 agent 思维链可视化
- 改进方案：
  - `ChatView.module.css` — 给 `agentTaskBlock` 增加 `@keyframes taskAppear` 入场动画
  - 给 pending/running agent task 增加 `--task-progress` 进度条（利用已有的 `ContextUsage.bar` 模式）
  - Step visualization：多步骤 task 展开为编号步骤列表
- 预估工作量：M（1 天）
- 可并入：WT-A artifact-lifecycle

**5. Light 主题未在 Web 落地**
- 当前问题：Desktop 有完整的 light 主题（`themes.css` + `presets.css`），但 Web 的 `tokens.css` 只有 dark，且 `[data-theme='light']` 选择器里几乎为空
- 竞品参考：Cursor/Codex 均提供 dark/light 切换
- 改进方案：将 Desktop `themes.css` 的 `[data-theme='light']` 块同步到 Web `tokens.css`，并在 Web 页面增加主题切换入口
- 预估工作量：M（半天）
- 可并入：WT-D glass-tokens

**6. 转场动画缺失**
- 当前问题：全局 `transition` reset 只覆盖 `color, background-color, border-color, opacity, box-shadow`。视图切换（Welcome→Chat、Chat→Settings）无转场动画
- 竞品参考：Windsurf 的 workbench 切换有流畅的 layout 动画；OpenHands 三栏面板切换有 slide transition
- 改进方案：
  - 给 `body` 内的主面板切换增加 CSS `view-transition-name`（Chrome 126+ `View Transitions API`）
  - 或使用 `@keyframes` + React 状态驱动的入场/离场动画
- 预估工作量：M（1 天）

**7. Scroll-to-bottom 按钮可发现性**
- 当前问题：`scrollToBottomBtn` 仅在用户向上滚动后出现，新用户可能不知道有未读消息
- 竞品参考：ChatGPT/Claude.ai 使用固定底部箭头 + 新消息计数 badge
- 改进方案：
  - 给 `scrollToBottomBtn` 增加未读消息计数（基于 streaming 事件）
  - 首次进入长线程时自动提示 "↓ New messages"
- 预估工作量：S（2 小时）

**8. Diff viewer 缺少行级操作反馈**
- 当前问题：`diffCard` 有 Apply/Reject 按钮，但点击后无即时视觉反馈（原地替换动画）
- 竞品参考：Cline 有实时 diff 高亮 + 行级 accept/reject；GitHub PR review 有 checkmark 动画
- 改进方案：
  - `diffApplyBtn`/`diffRejectBtn` 点击后增加 scale→fade out 动画
  - 已应用的 diff 行增加绿色对勾 overlay
- 预估工作量：S（2 小时）

### P2 — 差异化设计（让人记住的视觉亮点）

**9. 浏览器预览截图嵌入对话流**
- 当前问题：AgentHub 无浏览器预览能力，agent 生成的 web/UI 产物只能看到代码
- 竞品参考：Cline 的 `BrowserSessionRow.tsx` **实时嵌入浏览器截图**到对话流——agent 操作网页后 screenshot 直接出现在 ChatRow 中；Windsurf Select Element 点击预览页面的 DOM → Cascade 自动定位组件
- 改进方案：Edge 调用 Chromium/Playwright 截图 → 通过 `message.image` 嵌入 ChatView
- 预估工作量：L（后端+前端，1-2 周）

**10. Agent 角色视觉区分**
- 当前问题：所有 agent 消息使用相同的 `agentMsg` 样式，无法从视觉上区分不同 agent/子代理的输出
- 竞品参考：Claude Code 用 color-coded "Agent Pills"；OpenHands 为不同 agent 分配不同 avatar 颜色；Cline 的 `SubagentStatusRow.tsx` 用 icon + status badge 区分
- 改进方案：
  - `agentNameLabel` 旁增加 agent 专属色条（从 agentId hash 生成一致 color）
  - 子代理消息增加 `--agent-tint` CSS 变量微调背景
- 预估工作量：S（2 小时）

**11. 快捷键导引（第一次体验辅助）**
- 当前问题：`ShortcutHelp` 组件已有，但新用户不会主动打开
- 竞品参考：Cursor CMD+K inline 搜索框；Claude Code Ctrl+G 打开 $EDITOR，Ctrl+R 反向搜索历史；Windsurf 空状态显示快捷键
- 改进方案：
  - 首次启动时在 bottom bar 显示 1-2 个最重要快捷键（如 `Ctrl+K` 命令面板）
  - 键盘未活动 30 秒后自动消失
- 预估工作量：S（2 小时）

## AgentHub 设计优势（答辩展示点）

1. **玻璃拟态系统已成熟** — 完整的 `rgba + blur/saturate` 方案，dark/light 双主题 + 6 套 preset，比大多数竞品（扁平 dark theme）更具品牌辨识度

2. **设计 Token 体系完整** — `tokens.css`(非主题 token) + `themes.css`(主题变量) + `presets.css`(6 presets) + `designTokens.ts`(跨平台 alias) 四层架构，业内罕见

3. **信息密集型设计方向独特** — 侧边栏 + 主区 + 右侧面板三栏布局，Settings 工作台覆盖 30+ 一级入口，区别于 Cursor/Copilot 的极简风格

4. **Diff viewer 功能完备** — Unified/Side-by-side 双模式 + 文件级 +/- stat + Apply/Reject 操作，超越大部分 web-based agent UI

5. **错误状态设计细致** — 8 类错误分类（auth/quota/model/network/server/context-length/tool/unknown），各有独立 icon + 颜色

6. **虚拟滚动已落地** — `TanStack Virtual` 在 ChatView 正式运行，大消息列表无性能问题

7. **Mobile 设计系统已完整** — 390×844 dark/light 全覆盖，44px touch targets，glassmorphism pass，比所有竞品更早覆盖移动端

8. **WCAG 基础关注** — `prefers-reduced-motion`、`focus-visible`、`data-focus-source` 指针/键盘区分、44px touch target
