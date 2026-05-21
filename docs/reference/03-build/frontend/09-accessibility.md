# AgentHub 无障碍（a11y）设计

> 综合自: `design-keyboard-shortcuts.md`（7 层导航）、`design-desktop-ux.md`（组件层次）、`design-micro-interactions.md`（动画 token）、`design-theme-system.md`（OKLCH 调色板）、`design-error-handling.md`（4 通道反馈）
> 目标: WCAG 2.2 AA | 日期: 2026-05-21 | 状态: 草稿 v1.0

---

## 1. WCAG 2.2 AA 合规检查清单

### 1.1 可感知性

| SC | 要求 | AgentHub 状态 | 差距 / 措施 |
|----|------------|----------------|--------------|
| 1.1.1 非文本内容 | 所有图标/图片有文本替代 | 部分 -- Lucide 图标在当前规格中缺少 aria-label | 为每个 IconButton 添加 `aria-label`；ToolUseCard 工具图标需要 `role="img"` 并附带工具名 |
| 1.2.1 音视频 | 无预录制媒体 | 不适用（聊天应用） | -- |
| 1.3.1 信息与关系 | 以编程方式传达语义结构 | 部分 -- 组件树使用 div | 在 MainLayout 中使用 `<header>`、`<nav>`、`<main>`、`<aside>` 地标；MessageTree 中使用 h1-h4 标题层级 |
| 1.3.2 有意义的顺序 | DOM 顺序匹配视觉顺序 | 通过 -- 三栏布局使用 CSS 排序，未重排 | 验证移动端 drawer/bottom-sheet 重新挂载时保留 Tab 顺序 |
| 1.3.3 感官特性 | 没有仅依赖形状/颜色/声音的说明 | **风险: DiffCard** -- 绿色/红色边框是纯颜色依赖 | Diff 行始终显示 `+`/`-` 前缀；状态徽章使用文本 + 图标，而非仅颜色 |
| 1.4.1 颜色使用 | 颜色不是唯一的视觉区分手段 | **风险: AuthorityStripe**（蓝色=Hub，绿色=Edge，橙色=Hybrid） | AuthorityLabel 文本始终伴随色条；ConnectionStatus 圆点有 `aria-label`（"Connected"/"Disconnected"） |
| 1.4.2 音频控制 | 无自动播放音频 | 不适用 | -- |
| 1.4.3 对比度（最低） | 4.5:1 普通文本，3:1 大文本 | 需要审计 -- OKLCH 调色板尚未验证 | 见第 2 节 |
| 1.4.4 文本缩放 | 200% 缩放不丢失内容 | 使用 Tailwind rem 基础尺寸，通过 | 用浏览器缩放测试；验证虚拟列表处理缩放 |
| 1.4.10 回流 | 320px 视口无二维滚动 | 风险: RightPanel Diff 统一视图 | 在移动端（<=768px），统一 diff 切换为上下分栏布局 |
| 1.4.11 非文本对比度 | UI 组件 3:1，焦点指示器 | **缺失: 焦点指示器定义** | 见第 3.1 节 |
| 1.4.12 文本间距 | 行高 1.5，段落间距 2em，字间距/词间距 0.12/0.16em | Markdown 渲染器可控 | 在消息文本主体设置 `line-height: 1.5` |
| 1.4.13 悬停/焦点内容 | Tooltip 可关闭、可悬停、持久 | Radix Tooltip 提供 Escape 关闭 | 确保悬停内容（时间戳、SiblingSwitch）遵循此模式 |

### 1.2 可操作性

| SC | 要求 | AgentHub 状态 | 差距 / 措施 |
|----|------------|----------------|--------------|
| 2.1.1 键盘 | 所有功能可通过键盘操作 | **基础扎实**: 7 层快捷键系统 | 审计非输入交互：调整手柄、拖放文件上传、bottom-sheet 拖拽 |
| 2.1.2 无键盘陷阱 | 焦点永不困住，始终可逃逸 | Radix Dialog/Popover 已处理 | 验证所有模态路径（ForkDialog、Settings、GlobalSearch、ErrorCard modal） |
| 2.1.4 字符键快捷键 | 可重新映射、范围限定、可关闭 | 是 -- ShortcutSettings 面板 + localStorage 中 `ah_shortcuts_overrides` | 单键快捷键（`j`、`k`、`n`、`p`、`1-6`）仅在无输入框焦点时激活 |
| 2.2.1 可调节时间 | 时间限制可调整或无时间限制 | 审批自动拒绝有 5 分钟过期 | 显示倒计时；剩余 1 分钟时提供 "Extend" 按钮 |
| 2.2.2 暂停/停止/隐藏 | 自动更新内容可暂停 | 流式自动滚动有手动覆盖 | JumpToBottomButton 支持手动滚动；滚动超过 100px 时不自动移动 |
| 2.3.1 三次闪烁 | 内容闪烁不超过 3 次/秒 | 打字机光标闪烁为 1Hz step-end；RunIndicator 脉冲为 1.5s 周期 | 所有动画在安全范围内 |
| 2.4.1 绕过块 | 重复内容的跳过链接 | **缺失** | 添加 "Skip to chat" 链接作为第一个可聚焦元素 |
| 2.4.2 页面标题 | 描述性 `<title>` | 通过 | 设置 `document.title` = 活跃 thread 标题 + " - AgentHub" |
| 2.4.3 焦点顺序 | 焦点顺序遵循含义与可操作性 | 需要为模态框进行有意设计 | 见第 3.2 节 |
| 2.4.4 链接目的 | 链接文本描述目标 | ContextMenu 项目、"View Full Diff"、SiblingSwitch 箭头 | 所有链接在上下文中；验证独立清晰度 |
| 2.4.5 多种方式 | 多种定位内容的方式 | `Ctrl+K` 全局搜索、sidebar tree、最近项目、FTS5 | 超出最低要求 |
| 2.4.6 标题与标签 | 描述性标题和标签 | ThreadTitleBar、PanelTabBar 标签页 | 对 SearchInput 使用 `<label>`；MessageBody 中的标题层级 |
| 2.4.7 焦点可见 | 所有交互元素上可见的焦点指示器 | **主题规格中缺失** | 见第 3.1 节 |
| 2.4.11 焦点外观 | 最小 2px，与相邻色对比度 3:1 | **必须定义** | 见第 3.1 节 |
| 2.5.8 目标尺寸 | 指针目标最小 24x24px | SidebarToolbar 中 IconButton 为 28px | 确保移动端 bottom-sheet 标签按钮满足 24px 最小要求 |

### 1.3 可理解性

| SC | 要求 | AgentHub 状态 | 差距 / 措施 |
|----|------------|----------------|--------------|
| 3.1.1 语言 | 以编程方式声明语言 | `<html lang="en">` | 通过 |
| 3.2.1 焦点时 | 焦点单独不引起上下文变化 | 基于层的快捷键可防止此问题 | 验证 j/k 导航不自动提交操作 |
| 3.2.2 输入时 | 输入单独不引起上下文变化 | Settings 修改为显式保存；主题切换为原子操作 | 通过 |
| 3.2.3 一致导航 | 跨页面导航一致 | Sidebar 持久、PanelTabBar 固定顺序 | 通过 |
| 3.2.6 一致帮助 | 帮助机制一致 | `Ctrl+K` Command Palette + `?` 快捷键显示所有绑定 | 添加 `?` 全局帮助覆盖层，按层列出所有快捷键 |
| 3.3.1 错误识别 | 以文本描述错误 | **强**: AgentHubError.Message + .Suggestion 字段 | ErrorCard 渲染两者；确保屏幕阅读器播报内联错误 |
| 3.3.2 标签/说明 | 输入框有标签 | ChatInput、SearchInput、CommitMessageInput | 验证所有输入框的 `aria-label` 或 `<label>` |
| 3.3.3 错误建议 | 错误时提供建议 | AgentHubError.Suggestion 字段已覆盖 | 验证所有 ErrorCode 变体都填充 Suggestion |
| 3.3.7 无障碍认证 | 无认知功能测试 | 不适用（基于 OAuth） | -- |

### 1.4 鲁棒性

| SC | 要求 | AgentHub 状态 | 差距 / 措施 |
|----|------------|----------------|--------------|
| 4.1.2 名称/角色/值 | 所有 UI 组件对辅助技术暴露 | **风险: 自定义组件**（MessageNode、ToolUseCard、DiffCard、ApprovalCard） | 见第 4 节 |
| 4.1.3 状态消息 | 状态变化播报而不移动焦点 | **风险: 流式内容、错误 toast、run 状态变化** | 见第 4.2 节 |

---

## 2. 颜色对比度审计（主题系统）

### 2.1 OKLCH 调色板读数

来源: `packages/ui/src/styles/theme.css`（design-theme-system.md 第 2.2 节）

| Token | Light LCh | Dark LCh | Light 对比度（on bg 0.98） | Dark 对比度（on bg 0.12） |
|-------|-----------|----------|---------------------------|--------------------------|
| `--foreground` | 0.12 | 0.95 | **12.1:1**（AAA） | **12.1:1**（AAA） |
| `--primary` | 0.50 / 0.15 / 260 | 0.70 / 0.15 / 260 | ~4.6:1（AA） | ~5.5:1（AA） |
| `--muted-foreground` | 0.45 | 0.55 | ~5.5:1（AA） | ~5.0:1（AA） |
| `--destructive` | 0.55 / 0.22 / 25 | 0.55 / 0.22 / 25 | ~3.8:1（风险） | ~3.2:1（风险） |
| `--border` | 0.88 | 0.22 | ~1.3:1（装饰性） | ~1.8:1（装饰性） |

### 2.2 必要修复

1. **Destructive 文本对比度**: `--destructive` 在 L=0.55 上暗色 L=0.12 产生 ~3.2:1，低于 4.5:1。**修复**: 暗色 destructive → `oklch(0.65 0.20 25)` 用于大文本，或仅在粗体/大文本时使用 destructive，或作为背景色。
2. **Primary on primary-foreground**: Light `primary-foreground` 是 `--background`（0.98），对 `--primary`（0.50）~5.8:1 -- 通过。Dark `primary-foreground` 也是 background（0.12）对 primary（0.70）~6.2:1 -- 通过。
3. **Diff 颜色依赖**: DiffCard 绿色/红色边框必须始终伴随 `+`/`-` 前缀和 `AddedLine`/`DeletedLine` 文本标签。绝不单独依赖 `bg-green-50` 或 `bg-red-50`。
4. **AuthorityStripe**: 彩色左边框（蓝/绿/橙）必须伴随 `AuthorityLabel` 文本徽章。色条为装饰性。

### 2.3 对比度测试协议

- 使用 `@radix-ui/react-polymorphic` focus-visible polyfill（Radix 已包含）
- 在 CI 中运行 axe-core（`@axe-core/react`，以至于 violations/needs-review 级别的严重性门槛）
- 手动抽查：DiffCard 内联、ApprovalCard 琥珀色脉冲、RunStatus 徽章

---

## 3. 焦点管理与键盘导航

### 3.1 焦点指示器规格

当前差距：`--ring` token 存在（oklch(0.50 0.15 260) / oklch(0.70 0.15 260)）但未定义 focus-visible 样式。

```css
/* packages/ui/src/styles/theme.css -- 追加 */
:root {
  --ring-width: 2px;
  --ring-offset: 2px;
}

*:focus-visible {
  outline: var(--ring-width) solid var(--ring);
  outline-offset: var(--ring-offset);
  border-radius: var(--radius);
}
```

**Ring 按背景的对比度**:
- Light: ring L=0.50 在 bg L=0.98 上 → ~5.2:1（超过 WCAG 2.4.11 最低 3:1）
- Dark: ring L=0.70 在 bg L=0.12 上 → ~5.7:1（超过最低要求）

### 3.2 各视图焦点顺序

**聊天视图（默认）**:
```
1. Skip-to-chat 链接（首次 Tab 可见）
2. SidebarToolbar: NewThread → ToggleArchive → SettingsGear
3. SearchBar（如展开）
4. ProjectTree → ThreadList（j/k 箭头）
5. ChatHeader: ThreadTitleBar → AgentSelector → WorkspaceIndicator
6. MessageTree（j/k 导航消息，Enter 展开）
7. ComposeArea: RichTextInput
8. SendButton
9. RightPanel 标签页（1-6）→ 面板内容
```

**Modal dialog**（ForkDialog、Settings、GlobalSearch）:
```
焦点陷阱 → 模态框内第一个可聚焦元素
Escape → 关闭模态框 → 焦点返回触发元素
```

### 3.3 键盘快捷键 a11y 审计

7 层系统（design-keyboard-shortcuts.md 第 2 节）已经处理了 WCAG 2.1.1/2.1.4。剩余三个差距：

1. **帮助发现**: 添加 `?`（全局层，无输入焦点时）打开快捷键速查表覆盖层。现有的 `Ctrl+K` Command Palette 展示操作但不默认显示其快捷键。
2. **调整手柄键盘**: Sidebar↔Center 和 Center↔RightPanel 调整手柄仅通过鼠标拖拽工作。**添加**: `Ctrl+Shift+Left/Right` 按 40px 增量调整 sidebar 宽度；`Ctrl+Shift+Alt+Left/Right` 用于右侧面板。
3. **拖放文件上传**: FileDropOverlay（FileTreePanel）当前仅鼠标操作。**添加**: `Ctrl+U`（全局层）打开文件选择对话框作为键盘替代方案。

---

## 4. 屏幕阅读器支持

### 4.1 地标与标题结构

```html
<header role="banner">         <!-- ChatHeader -->
<nav aria-label="Sidebar">     <!-- LeftSidebar -->
  <ul role="tree">             <!-- ProjectTree -->
    <li role="treeitem">       <!-- ThreadCard -->
<main aria-label="Chat">       <!-- CenterChat -->
  <section aria-label="Messages">  <!-- MessageTree -->
    <article>                  <!-- MessageNode -->
      <h3>AgentName</h3>       <!-- MessageHeader ActorName -->
<aside aria-label="Tools">     <!-- RightPanel -->
  <div role="tablist">         <!-- PanelTabBar -->
    <button role="tab">        <!-- 标签页: Diff -->
  <div role="tabpanel">        <!-- DiffPanel -->
<footer>                       <!-- SidebarFooter (ConnectionStatus) -->
```

### 4.2 动态内容 Live Region

| 组件 | Live Region | 播报内容 |
|-----------|------------|--------------|
| MessageTree（流式） | 流式容器上 `aria-live="polite"` | 流开始时 "Claude is responding..."；以句子边界为原子更新 |
| ToolUseCard（运行中） | `aria-live="polite"` + `aria-label="Tool running: {toolName}"` | 完成时 "Read completed (1.2s)" |
| ApprovalCard（出现时） | `aria-live="assertive"` | "Claude requests permission to run: pip install torch" |
| RunStatus（变化时） | ExecutionBadge 上 `aria-live="polite"` | "Run completed" / "Run failed: rate limit exceeded" |
| ErrorCard（出现时） | `aria-live="assertive"` | ErrorCard.Message 文本立即朗读 |
| Toast 通知 | ToastContainer 上 `aria-live="polite"` + `role="status"` | Toast 类型 + 消息 |
| ConnectionStatus | `aria-live="polite"` | "Edge disconnected" / "Connection restored" |

### 4.3 自定义组件 ARIA

**MessageNode**（递归、虚拟化）:
```tsx
<article
  role="article"
  aria-labelledby={`msg-${id}-author`}
  aria-describedby={`msg-${id}-content`}
  data-message-id={id}
>
  <header id={`msg-${id}-author`}>
    {isUser ? "You" : agentName}
    <span aria-label={`${authority} authority`}>{authority}</span>
  </header>
  <div id={`msg-${id}-content`}>
    {/* TextContent、ThinkingBlock、ToolUseCard 等 */}
  </div>
</article>
```

**DiffCard**（内联，在消息流中）:
```tsx
<div
  role="region"
  aria-label={`Diff: ${filePath}, ${additions} additions, ${deletions} deletions`}
>
  <button aria-label="Apply diff">Apply</button>
  <button aria-label="Discard diff">Discard</button>
  <button aria-label="View full diff for ${filePath}">View Full Diff</button>
</div>
```

**ToolUseCard**（L2，可展开）:
```tsx
<div role="region" aria-label={`${toolName} tool call`}>
  <button
    aria-expanded={isExpanded}
    aria-controls={`tool-result-${toolUseId}`}
  >
    {toolName}: {paramSummary}
  </button>
  <div id={`tool-result-${toolUseId}`} role={isExpanded ? "region" : undefined}>
    {isExpanded && <ToolResult />}
  </div>
</div>
```

**ApprovalCard**（内联，assertive）:
```tsx
<div
  role="alertdialog"
  aria-label="Permission required"
  aria-describedby={`approval-detail-${requestId}`}
>
  <p id={`approval-detail-${requestId}`}>{command}</p>
  <button aria-label="Approve command">Approve</button>
  <button aria-label="Approve this command once">Approve Once</button>
  <button aria-label="Deny command">Deny</button>
</div>
```

**渐进式展开（L0-L4）**: 每个可展开层使用 `aria-expanded` + `aria-controls` 指向内容区域 ID。当 ThinkingBlock 或 ToolUseCard 在流式过程中自动展开时，通过 `aria-live` 播报："Thinking block expanded"。

---

## 5. shadcn/ui + Radix a11y 清单

### 5.1 内置能力（无需额外工作）

| Radix Primitive | 继承的 a11y 特性 | 用于何处 |
|----------------|------------------------|---------|
| `Dialog` | 焦点陷阱、Escape 关闭、`aria-modal`、`aria-labelledby`、滚动锁定 | ForkDialog、Settings modal、NewProjectDialog |
| `Popover` | 焦点移到内容、Escape 关闭、`aria-expanded` | SearchResultsDropdown、MentionPopover、CommentPopover |
| `DropdownMenu` | 箭头键导航、typeahead 查找、`role="menu"`/`menuitem` | ContextMenu、AgentSelector、RefFromSelector |
| `Tooltip` | 焦点和悬停时显示、Escape 关闭、`role="tooltip"` | 时间戳悬停、AuthorityLabel 详情 |
| `Tabs` | 箭头键导航、`role="tablist"`/`tab`/`tabpanel`、`aria-selected` | PanelTabBar、PreviewTabs、GitViewTabs |
| `Select` | 箭头键打开、typeahead、`role="listbox"`/`option` | ThemeToggle（如下拉变体）、ViewModeSwitch |
| `Collapsible` | `aria-expanded`、`aria-controls` | ThinkingBlock、ToolUseCard、ArchivedSection |
| `Toggle` / `ToggleGroup` | `aria-pressed`、组内箭头键导航 | AuthorityFilterChips、DiffViewSettings |

### 5.2 shadcn/ui 组件审计

AgentHub 组件树中使用 shadcn/ui 包装的组件 -- 继承的 a11y 已足够：

- `Button`（variant + size + 仅图标的 `asChild`）: 仅图标实例需要显式 `aria-label`
- `Input` / `Textarea`: 需要关联 `<label>` 或 `aria-label`
- `Badge`: 仅装饰性 -- 确保含义由相邻文本传达
- `Separator`: `role="separator"`（内置）
- `ScrollArea`: 无需额外 a11y（原生滚动条可访问）

### 5.3 必要补充

shadcn/ui / Radix 不覆盖的交互模式：

| 交互 | 缺失的 a11y | 补充 |
|-------------|-------------|------------|
| IconButton（SidebarToolbar） | 无文本替代 | 所有 IconButton 必须有 `aria-label`；NewThreadButton = "New thread"、SettingsGear = "Settings" |
| ResizeHandle | 无键盘操作 | 带 live `aria-valuenow` 的箭头键处理器 |
| 虚拟列表（react-virtual） | 屏幕阅读器看到所有项 | ThreadList 使用 `role="listbox"` + `aria-setsize` + `aria-posinset`；ThreadCard 使用 `role="option"` |
| FileTreeBody（自定义树） | 非原生树 | 遵循 Tree 模式: `role="tree"`、`role="treeitem"`、`aria-expanded`、`aria-selected`、箭头键导航 |
| JumpToBottomButton | 无 "bottom" 含义的上下文 | `aria-label="Jump to latest message"`；屏幕阅读器可见隐藏文本 |

---

## 6. AgentHub 场景规格

### 6.1 代码 Diff 审阅

**焦点管理**: 当用户在有 diff 的消息上按 `Shift+Enter`（或点击 "View Full Diff"）时，焦点移到 DiffPanel 的 DiffFileList 第一个文件。后续 `n`/`p` 在面板内导航文件而不失去面板焦点。

**屏幕阅读器 diff 播报**:
- 文件条目: "File: src/auth.ts, 12 additions, 3 deletions, modified"
- Hunk 条目: "Lines 45 to 58, context: function authenticate"
- 行条目: "Added line 47: const token = await ..." / "Deleted line 50: return null"
- 状态变化: "Diff applied successfully" / "Diff application failed: merge conflict"

**颜色不依赖**（WCAG 1.4.1）:
- 每个 `AddedLine` 以 `+` 为前缀，`DeletedLine` 以 `-` 为前缀（已在规格中）
- DiffFileHeader 的 `+X/-X` 徽章使用数字 + 符号，而非仅绿/红颜色
- 每行的内联评论按钮: `aria-label="Add comment on line {N}"`

**纯键盘 diff 操作**: design-keyboard-shortcuts.md 第 3.5 节已全覆盖（n/p/j/k 导航、Ctrl+Enter 应用、Ctrl+A 全选、Escape 关闭）。

### 6.2 消息流导航

**流式内容播报**:
- 新 agent 消息开始: aria-live region 播报 "New message from {agentName}"
- 文本静默累积直到句子边界（`.`、`!`、`?`、`\n`），然后原子更新以避免逐字符喋喋不休
- 如果用户在流式过程中滚动离开，屏幕阅读器不追踪 -- aria-live 内容更新而不改变焦点
- 流完成: "Message from {agentName} complete. Contains {N} tool calls."

**渐进式展开（L0-L4）**: 每次展开播报其层:
- L1 展开: "Thinking content visible"
- L2 展开: "Read tool: src/auth.ts, 45 lines"（toolName + 文件 + 行数）
- L3 展开: "Subagent code-reviewer: 3 tools used, 2 findings"
- 折叠始终播报: "{layer} collapsed"

**虚拟滚动键盘**: j/k 在可见消息和尚未在 DOM 中的虚拟项之间移动。`useVirtualizer` 的 `scrollToIndex` 将屏幕外项带入视图，然后聚焦。`aria-posinset` 和 `aria-setsize` 告知屏幕阅读器总消息数和当前位置。

**消息上下文菜单**: 在已聚焦 MessageNode 上 `Shift+F10` 或应用程序键打开上下文菜单。箭头键导航菜单项；Enter 选择；Escape 关闭。

### 6.3 审批卡片操作

**关键 a11y 时间**: ApprovalCard 具有时间敏感性（5 分钟自动拒绝）。当 ApprovalCard 出现时:

1. 审批容器上的 `aria-live="assertive"` 立即播报: "Action required: {agentName} requests permission to run command. Press Enter to review."
2. 焦点不自动从用户当前位置夺走（遵守 WCAG 3.2.1）。取而代之，卡片上的倒计时徽章每 30 秒播报 "Approval expires in {N}s"。
3. 剩余 60 秒时，播报变为: "Approval expires in 1 minute. Press Tab to navigate to the approval card."
4. 剩余 10 秒时: "Approval expiring in 10 seconds"（assertive）。

**ApprovalCard 上的键盘操作**:
- `Ctrl+Enter`: 批准
- `Ctrl+Shift+Enter`: 批准一次
- `Ctrl+Shift+D`: 拒绝（需要确认对话框）
- `Escape`: 取消卡片焦点（不拒绝）

**安全阻止（不可重试）**: SeverityBlock 审批以红色边框 + `role="alert"` 显示。屏幕阅读器: "Command blocked by security policy: brace expansion obfuscation detected. Rephrase the command to proceed."

---

## 7. 减少动画的适配

### 7.1 媒体查询入口

```css
/* packages/ui/src/styles/theme.css -- 追加 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

这全局归零所有 CSS 动画/过渡。微交互系统（design-micro-interactions.md 第 6 节）随后必须小心地仅重新启用必要的过渡。

### 7.2 各功能的禁用表

| 功能 | 正常行为 | 减少动画 | 理由 |
|---------|----------------|----------------|-----------|
| 打字机光标闪烁 | `@keyframes cursor-blink 1s step-end` | 静态 `▍`（始终作为 `::after` 伪元素可见，无动画） | 闪烁是装饰性的；光标存在是信息性的 |
| 流式文本逐字符 | 每字符 30ms 间隔 | 立即追加完整 chunk | 动画是装饰性的；内容到达是信号 |
| ThinkingBlock 三点脉冲 | 300ms 错开弹跳 | 三个静态点，无弹跳 | 点存在 + 已用时间计数器传达活动 |
| RunIndicator 脉冲 | 1.5s 缩放 + opacity | 静态圆，仅颜色变化（绿→琥珀→绿） | 颜色 + 文本状态传达 run 状态 |
| 旋转器（工具运行中） | SVG rotate 1s linear | 静态图标 + "Running..." 标签 | 文本标签传达活动 |
| DiffCard 滑入 | 200ms translateY + opacity | 立即出现 | 内容变化传达事件 |
| Sidebar 折叠（280→48px） | 200ms width 过渡 | 立即宽度变化 | 功能性非装饰性 |
| RightPanel 打开/关闭 | 200ms width + opacity | 立即切换 | 功能性非装饰性 |
| Toast 进入/退出 | 200ms translateY + opacity | 立即出现/消失 + 4s 保持 | 保持时长保留；入场是装饰性的 |
| Modal 背景 | 150ms opacity 淡入 | 立即 opacity 0→1 | Opacity 对焦点陷阱上下文是功能性的 |
| Drawer 覆盖层（移动端） | 150ms translateX | 立即出现 | 功能性: 用户需要 sidebar 内容 |
| Bottom sheet（移动端） | 200ms translateY | 立即出现 | 功能性: 用户需要面板内容 |
| ApprovalCard 滑入 | 200ms max-height + opacity | 立即出现（assertive aria-live 仍触发） | 存在通知是关键信号 |
| 撤销倒计时（DiffCard） | 5s 计时器渐变消失 | 静态 "Undo" 按钮，无倒计时 | 操作可用性是关键；倒计时是次要的 |
| JumpToBottomButton | 150ms scale + opacity | 立即出现/消失 | 按钮存在是功能性的 |
| SiblingSwitch 箭头 | instant | instant（已经是 instant） | 无需变更 |

### 7.3 JS 级减少动画检测

```ts
// src/hooks/useReducedMotion.ts
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
```

在流式 hook 中的用法:
```ts
const reducedMotion = useReducedMotion();
const interval = reducedMotion ? 0 : animation.tokens.streaming.typewriterInterval; // 0 = 即时
```

### 7.4 动画 Token 覆盖映射

```ts
// src/lib/animation-tokens.ts
import { animation } from "@/styles/tokens";

export function getAnimationTokens(reducedMotion: boolean) {
  if (!reducedMotion) return animation;
  return {
    ...animation,
    duration: { instant: 0, fast: 0, normal: 0, medium: 0, slow: 0, glacial: 0 },
    streaming: {
      ...animation.streaming,
      typewriterInterval: 0,
      cursorBlinkInterval: 0,
      cursorRemovalDelay: 0,
    },
    thinking: {
      ...animation.thinking,
      dotStaggerDelay: 0,
      expandDuration: 0,
      collapseDuration: 0,
      contentFadeIn: 0,
    },
    toolCall: {
      ...animation.toolCall,
      statusCrossfade: 0,
      borderColorTransition: 0,
      expandDuration: 0,
      collapseDuration: 0,
    },
    undoWindow: animation.undoWindow, // 保留撤销窗口持续时间
  };
}
```

---

## 8. 实施检查清单

### P0（发布阻塞项）

- [ ] 在 `theme.css` 中使用 `--ring` token 定义 focus-visible 样式（第 3.1 节）
- [ ] 为所有 IconButton 实例添加 `aria-label`（SidebarToolbar、PanelCloseButton 等）
- [ ] 地标角色: MainLayout 区域上的 `<header>`、`<nav>`、`<main>`、`<aside>`（第 4.1 节）
- [ ] MessageTree 流式、ApprovalCard、ErrorCard、ToastContainer 上的 `aria-live` region（第 4.2 节）
- [ ] DiffCard: 确保所有 diff 行有 `+`/`-` 前缀（已在规格中，验证）
- [ ] AuthorityStripe: 验证 AuthorityLabel 文本始终伴随彩色边框（第 2.2 节）
- [ ] `theme.css` 中的 `prefers-reduced-motion` CSS 入口（第 7.1 节）
- [ ] `useReducedMotion` hook + 流式 interval 覆盖（第 7.3 节）
- [ ] "Skip to chat" 链接作为第一个可 tab 元素（WCAG 2.4.1）
- [ ] `?` 帮助覆盖层显示所有快捷键（WCAG 3.2.6）

### P1（MVP 后，公开 Beta 前）

- [ ] 标题层级审计: h1（thread 标题）→ h2（消息组）→ h3（agent 名）→ h4（工具名）
- [ ] 虚拟列表 ARIA: ThreadList 和 MessageTree 上 `role="listbox"` + `aria-posinset`/`aria-setsize`
- [ ] 屏幕阅读器 diff 模式: 逐行播报（第 6.1 节）
- [ ] 键盘调整手柄: Ctrl+Shift+Left/Right 调整 sidebar 宽度（第 3.3 节）
- [ ] 键盘文件上传: Ctrl+U 文件选择器（第 3.3 节）
- [ ] Axe-core CI 集成: `@axe-core/react` 带违规门槛
- [ ] 对比度审计输出文档（验证所有 OKLCH token 通过 4.5:1 / 3:1）
- [ ] 屏幕阅读器流式句子边界批处理（第 6.2 节）
- [ ] 审批卡片倒计时播报（第 6.3 节）

### P2（打磨）

- [ ] 自定义 Monaco 主题（`agenthub-dark` / `agenthub-light`）具有无障碍对比度
- [ ] 基于 thread 上下文的 MessageContextMenu 项自定义 `aria-label`
- [ ] MCP 设置面板: 连接测试结果播报
- [ ] 插件位 ARIA: 确保插件渲染内容符合标准
- [ ] 移动端 bottom sheet: 验证拖拽手柄 + 标签栏满足触摸目标最小值
- [ ] 完整 VPAT（自愿产品无障碍模板）草案

---

## 9. 参考资料

| 来源 | 导入内容 |
|--------|---------|
| `design-keyboard-shortcuts.md` | 7 层范围键盘系统、层激活规则、冲突解决 |
| `design-desktop-ux.md` | 组件树（地标映射）、DiffCard 状态机、ApprovalCard UX、MobileDrawer/BottomSheet、ToastContainer |
| `design-micro-interactions.md` | 动画 token、流式打字机、thinking 脉冲、旋转器旋转、减少动画目标 |
| `design-theme-system.md` | OKLCH 调色板、`--ring` token、`:root`/`.dark` 变量集、Monaco 主题同步 |
| `design-error-handling.md` | 4 通道错误显示（内联/toast/状态/模态）、AgentHubError.Suggestion 字段、严重性层级、重试策略 |
| WCAG 2.2（W3C） | 50 条成功标准，AA 合规目标 |
| shadcn/ui + Radix Primitives | Dialog/Popover/Menu/Tabs/Tooltip/Select 的内置 ARIA、键盘、焦点管理 |
