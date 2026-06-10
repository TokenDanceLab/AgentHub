# 04 前端架构审计

> 审计范围: `app/shared/src/`, `app/desktop/src/`, `app/web/src/`
> 审计日期: 2026-06-07
> 审计模型: GLM-5.1 (只读)

---

## 1. 组件粒度

### 1.1 超过 200 行的组件（建议拆分）

| 文件 | 行数 | 严重性 | 说明 |
|------|------|--------|------|
| `app/shared/src/workbench/pages/AgentsPage.tsx` | 1227 | 🔴 | 巨型组件，包含 6 个子视图 + 大量类型定义和 helper 函数。应拆为 `AgentsNav`、`InstalledPane`、`MarketPane`、`PolicyPane`、`ToolsPane`、`ModelsPane`、`AuditPane` |
| `app/web/src/components/SettingsPage.tsx` | 2386 | 🔴 | Web 专属巨型 Settings，远超阈值。应按功能域拆分 |
| `app/desktop/src/components/SettingsPage.tsx` | 784 | 🔴 | Desktop 专属 Settings，同理应拆分 |
| `app/desktop/src/components/ArtifactBrowser.tsx` | 619 | 🟡 | 大型面板组件，建议拆分列表/详情子组件 |
| `app/desktop/src/components/FileExplorer.tsx` | 618 | 🟡 | 文件树组件偏大，建议拆分 TreeNode 子组件 |
| `app/shared/src/workbench/pages/ContactsPage.tsx` | 776 | 🟡 | 单文件包含导航、列表、详情面板、弹窗等多个子视图 |
| `app/shared/src/workbench/pages/SettingsPage.tsx` | 696 | 🟡 | 同上，包含多个设置面板 |
| `app/shared/src/workbench/pages/ProjectsPage.tsx` | 646 | 🟡 | 同上 |
| `app/shared/src/workbench/pages/TasksPage.tsx` | 533 | 🟡 | 同上 |
| `app/shared/src/workbench/RightInspector.tsx` | 404 | 🟡 | 含 3 个内联 SVG icon 定义 + 2 个子 Panel 组件。SVG icons 和 sub-panels 应提取 |
| `app/shared/src/workbench/floating/ProfilePopover.tsx` | 325 | 🟡 | 含大量内联 SVG + 多层嵌套 UI。建议拆出 icon constants 和 profile sections |
| `app/shared/src/workbench/TranscriptView.tsx` | 308 | 🟢 | 结构清晰，switch-case 分发合理，暂可接受 |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | 277 | 🟢 | 路由 + mock 数据定义，结构合理 |
| `app/shared/src/workbench/GlobalRail.tsx` | 243 | 🟢 | 导航栏组件，SVG icons 占较多行，可提取 |
| `app/shared/src/workbench/inspector/OverviewPanel.tsx` | 217 | 🟢 | 略超阈值但结构清晰 |
| `app/shared/src/workbench/inspector/FilePreview.tsx` | 210 | 🟢 | 略超阈值 |
| `app/shared/src/workbench/AgentHubWorkbench.tsx` | 206 | 🟢 | 主编排组件，206 行合理 |

### 1.2 建议

- 🔴 **AgentsPage (1227 行)** 和 **web/SettingsPage (2386 行)** 优先级最高，应立即拆分
- 🟡 所有 pages/ 下的页面组件可采用统一的「左导航 + 右内容」拆分策略，导航和各面板各自独立组件
- 🟡 内联 SVG icon 定义（RightInspector、GlobalRail、WorkspaceHeader、ProfilePopover 中大量出现）应集中到 shared icon 模块

---

## 2. 状态管理

### 2.1 Hook 使用统计

| Hook | 调用次数 | 说明 |
|------|----------|------|
| `useState` | 391 | 主力状态管理 |
| `useReducer` | 2 | 仅用于 composer 状态 (shared) 和 workbench projection (web) |
| `useEffect` | 216 | 总量偏高 |
| `useCallback` / `useMemo` | 502 | 覆盖率良好 |

### 2.2 useReducer 使用

🟢 **合理**。`useReducer` 仅用于复杂状态：
- `AgentHubWorkbench.tsx:48` — composer 状态机
- `app/web/src/hooks/useWorkbenchProjection.ts:50` — web workbench 投影状态

### 2.3 Prop Drilling 分析

| 路径 | 层级 | 严重性 | 说明 |
|------|------|--------|------|
| `AgentHubWorkbench` → `RightInspector` | 1 层 | 🟢 | 通过 props 直接传递 |
| `AgentHubWorkbench` → `WorkbenchRoutes` → `AgentsPage` | 2 层 | 🟢 | 可接受 |
| `WorkbenchRoutes` 持有 10+ 个 `useState` (行 149-159) | N/A | 🟡 | WorkbenchRoutes 作为路由编排组件持有所有页面的状态，这会导致将来需要大量 props 透传。考虑在页面增多时引入 context 或 zustand |

### 2.4 Platform Adapter 一致性

| 维度 | Desktop | Web | 一致性 |
|------|---------|-----|--------|
| `surface` | `'desktop'` | `'web'` | 🟢 |
| `capabilities` | `localEdge: true, localFiles: true, browserPreview: true` | 全部 `false` | 🟢 合理区分 |
| `conversations.list()` | 返回硬编码 mock | 返回硬编码 mock | 🟡 两者都未真正接入 API |
| `attachments` | 有 `pickFiles` | **缺失** | 🟡 Web 端没有 attachments port |
| `preview` | `canOpenEvidence` + `openEvidence` | `canOpenEvidence` + `openEvidence` | 🟢 |
| `runs.submitComposerIntent` | Edge thread 模式 | Hub message + agent task 模式 | 🟢 接口统一，实现差异化 |

### 2.4.1 建议

- 🟡 Web 端 `createWebPlatform` 缺少 `attachments` port，共享 `UnifiedComposer` 中 `onPickLocalAttachments` 在 Web 下为 undefined，功能缺失但不会报错
- 🟡 `WorkbenchRoutes` 中 10+ 个 `useState` 集中管理多页面状态。当页面继续增多时，考虑使用 context 或轻量状态管理

---

## 3. React 模式

### 3.1 useEffect 审查

| 文件 | useEffect 数量 | 严重性 | 说明 |
|------|----------------|--------|------|
| `app/shared/src/ui/Select.tsx` | 4 | 🟡 | 多个 useEffect 管理选中项、展开、焦点和键盘导航，考虑合并为 useReducer |
| `app/desktop/src/components/FileSearchDialog.tsx` | 4 | 🟡 | 搜索 debounce、快捷键、焦点管理，逻辑可提取为自定义 hook |
| `app/shared/src/workbench/floating/ProfilePopover.tsx` | 3 | 🟢 | 定位计算、键盘、点击外部关闭 — 都是合理副作用 |
| `app/shared/src/workbench/AgentHubWorkbench.tsx:65` | 1 | 🟢 | Pointer resize 事件监听，正确使用 cleanup |
| `app/shared/src/workbench/floating/ContextMenu.tsx:51` | 1 | 🟢 | 定位 + 键盘监听 |

### 3.2 潜在派生状态

🟢 **无问题**。`AgentHubWorkbench` 中的 `evidence`、`mentionableAgents`、`activeConversation` 都是直接计算而非 useEffect 同步到 state。

### 3.3 列表渲染 key 检查

| 文件 | 严重性 | 说明 |
|------|--------|------|
| `TranscriptView.tsx:59` | 🟢 | 使用 `block.id` 作为 key |
| `ConversationSidebar.tsx:28` | 🟢 | 使用 `conversation.id` |
| `RightInspector.tsx:305,358` | 🟢 | 使用 `artifact.id` / `file.id` |
| `GlobalRail.tsx:163` | 🟢 | 使用 `item.id` |
| `blocks/AgentTimeline.tsx:79` | 🔴 | 使用 `idx` (数组索引) 作为 key，在动态列表中可能导致渲染问题 |
| `blocks/DiffCard.tsx:61` | 🟡 | 使用 `i` (索引) 作为 key，diff 行可能重排 |
| `floating/ContextMenu.tsx:78` | 🟡 | 使用 `i` (索引) 作为 key，菜单项一般静态，风险低 |
| `floating/MultiSelectBar.tsx:21` | 🟡 | 同上 |
| `inspector/FilePreview.tsx:200` | 🟡 | 代码行用索引 key，行不变所以安全 |
| `inspector/OverviewPanel.tsx:117,169,194` | 🟡 | 任务/文件列表用索引 key，若列表动态更新有风险 |

### 3.4 缺少 useCallback 的性能隐患

| 文件 | 严重性 | 说明 |
|------|--------|------|
| `GlobalRail.tsx:164` | 🟡 | `onClick={() => handleNavigate(item.id)}` 每次渲染创建新函数，对 6 个导航按钮影响不大 |
| `GlobalRail.tsx:148` | 🟡 | `onClick={() => setProfileOpen(...)}` 内联函数 |
| `AgentHubWorkbench.tsx:172` | 🟡 | `onToggleInspector={() => setInspectorCollapsed(...)}` 内联函数传给子组件 |
| `AgentHubWorkbench.tsx:86` | 🟢 | `submitComposer` 未用 useCallback 但依赖 composer 状态，用 useReducer 的 dispatch 稳定性补偿 |

### 3.5 不安全的 DOM 操作

| 文件 | 严重性 | 说明 |
|------|--------|------|
| `AgentHubWorkbench.tsx:131` | 🟡 | `document.documentElement.setAttribute('data-theme', ...)` 直接操作 DOM。React 中应使用 state + className 切换 |
| `ContextMenu.tsx:43` | 🟢 | 通过 ref 获取尺寸 + `window.innerHeight` 计算，合理 |
| `ProfilePopover.tsx:89-100` | 🟢 | 同上 |

### 3.6 dangerouslySetInnerHTML

| 文件 | 严重性 | 说明 |
|------|--------|------|
| `app/shared/src/ui/DiffReviewPanel.tsx:421,488` | 🟡 | Diff 渲染使用 dangerouslySetInnerHTML，需确保输入经过 sanitize |
| `app/desktop/src/components/DiffViewer.tsx:476` | 🟡 | 同上 |

---

## 4. CSS 架构

### 4.1 tokens.css 对比

🟢 **完全一致**。Desktop 和 Web 的 `tokens.css` 文件内容完全相同（diff 无输出），通过共享同一个源实现 token 统一。

### 4.2 themes.css 对比

🟢 **完全一致**。Desktop 和 Web 的 `themes.css` 文件大小均为 420 行，diff 无输出。

### 4.3 Token 组织评估

| 维度 | 严重性 | 说明 |
|------|--------|------|
| 向后兼容 alias | 🟡 | `tokens.css` 中存在大量 `--space-*`、`--radius-*`、`--duration-*`、`--ease-*` 别名映射到 `--sp-*`、`--r-*`、`--dur-*`，增加了约 40 行冗余。建议清理未使用的旧名 |
| Glass token 体系 | 🟢 | 20+ 个 glass token 层级分明，dark/light 主题都正确 override |
| Z-Index 层级 | 🟢 | 统一使用 `--z-base` 到 `--z-toast` (1-700) 的 token，有明确的语义化层级 |
| 内联 z-index 硬编码 | 🔴 | 多处 CSS Module 中使用裸数字而非 token： |
| | | `BottomSheet.module.css:4` → `z-index: 80` |
| | | `ContextMenu.module.css:4` → `z-index: 79` |
| | | `ContextMenu.module.css:9` → `z-index: 80` |
| | | `MultiSelectBar.module.css:3` → `z-index: 75` |
| | | `ProfilePopover.module.css:5` → `z-index: 60` |
| | | `Toast.module.css:3` → `z-index: 90` |
| | | `MessageSearchPanel.module.css:5` → `z-index: 100` |
| | | `PermissionModePicker.tsx:107` → `zIndex: 9999` |
| | | `ContactsPage.module.css:397` → `z-index: 50` |

### 4.4 建议

- 🔴 所有内联 `z-index` 硬编码应替换为 CSS token（`var(--z-popover)` 等），`PermissionModePicker` 的 `zIndex: 9999` 尤其危险
- 🟡 清理未使用的 backward-compat token 别名

---

## 5. 可访问性

### 5.1 ARIA 属性覆盖

| 组件 | ARIA 覆盖 | 严重性 |
|------|-----------|--------|
| `ConversationSidebar.tsx` | `aria-label`, `aria-current`, `aria-hidden` | 🟢 |
| `TranscriptView.tsx` | `aria-label="Transcript"` | 🟢 |
| `RightInspector.tsx` | `aria-hidden`, `aria-label`, `role="separator"`, `aria-valuenow/max/min`, `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"` | 🟢 **优秀** |
| `GlobalRail.tsx` | `aria-label`, `aria-current`, `aria-expanded`, `aria-haspopup`, `role="button"` | 🟢 |
| `WorkspaceHeader.tsx` | `role="tablist"`, `aria-selected`, `aria-hidden`, `aria-label` | 🟢 |
| `UnifiedComposer.tsx` | `aria-label="Composer input"`, `aria-label="发送消息"` | 🟢 |
| `ContextMenu.tsx` | `role="menu"`, `role="menuitem"` | 🟢 |
| `ThinkingBlock.tsx` | `aria-expanded`, `aria-hidden` | 🟢 |
| `PinnedAnnouncement.tsx` | `aria-label` | 🟢 |
| `AgentTimeline.tsx` | `aria-label`, `aria-hidden` | 🟢 |

### 5.2 键盘导航

| 组件 | 键盘支持 | 严重性 |
|------|----------|--------|
| `RightInspector.tsx` — resize separator | ArrowLeft/Right + Shift | 🟢 |
| `GlobalRail.tsx` — avatar button | Enter/Space 打开 profile | 🟢 |
| `ContextMenu.tsx` | Escape 关闭 | 🟢 |
| `ProfilePopover.tsx` | Escape 关闭, click outside 关闭 | 🟢 |
| `ConversationSidebar.tsx` — conversation buttons | **缺少** keyboard focus 和 selection | 🟡 |
| `UnifiedComposer.tsx` — textarea | **缺少** mention 选择键盘导航 (ArrowUp/Down/Enter) | 🟡 |

### 5.3 颜色对比度

| 位置 | 严重性 | 说明 |
|------|--------|------|
| Dark theme `--text-3: #606068` on `--background: #1a1a20` | 🔴 | 对比度约 2.1:1，远低于 WCAG AA 要求的 4.5:1。用于 `text-weakest`（微弱分隔符/时间戳） |
| Dark theme `--glass-text-muted: rgba(255,255,255,0.5)` on dark panel | 🟡 | 对比度约 2.5:1，用于 muted 文本，低于 AA 标准 |
| Dark theme `--glass-text-disabled: rgba(255,255,255,0.3)` | 🟢 | 禁用状态，WCAG 不要求对比度 |
| Light theme colors | 🟢 | 主文本 `#1a1a2e` on `#f7f6f9` 对比度 > 12:1 |

### 5.4 建议

- 🔴 `--text-3` / `--text-weakest` 对比度不足，需提亮至至少 `oklch(0.45 0.010 252)` 或将用途限制在纯装饰元素
- 🟡 `UnifiedComposer` 需要添加 mention 弹出框的键盘导航支持
- 🟡 `ConversationSidebar` 会话列表项需要 Tab/Arrow 键盘导航和 `aria-activedescendant` 模式

---

## 6. Shared Workbench 接入完整性

### 6.1 blocks/ 组件接入状态

blocks/ 共导出 15 个组件。TranscriptView.tsx 导入使用了以下 14 个：

| 组件 | 被 TranscriptView 使用 | 严重性 |
|------|----------------------|--------|
| `AgentMessage` | ✅ 行 4, 108 | 🟢 |
| `UserMessage` | ✅ 行 5, 115 | 🟢 |
| `ToolCardBlock` | ✅ 行 6, 128 | 🟢 |
| `FileChangeCard` | ✅ 行 7, 145 | 🟢 |
| `DiffCard` | ✅ 行 8, 163 | 🟢 |
| `ThinkingBlock` | ✅ 行 12, 195 | 🟢 |
| `SubagentBlock` | ✅ 行 10, 208 | 🟢 |
| `ChildAgentBlock` | ✅ 行 11, 220 | 🟢 |
| `ResultBlock` | ✅ 行 13, 269 | 🟢 |
| `RouteDecisionBlock` | ✅ 行 14, 236 | 🟢 |
| `ContextUsageBlock` | ✅ 行 15, 248 | 🟢 |
| `DateDivider` | ✅ 行 9, 60 | 🟢 |
| `PinnedAnnouncement` | ✅ 行 11, 43 | 🟢 |
| `RunSessionCard` | ✅ 行 15, 183 | 🟢 |
| **`AgentTimeline`** | ❌ **未被 TranscriptView 使用** | 🟡 |

### 6.2 floating/ 组件接入状态

floating/ 共导出 5 个组件：

| 组件 | 被消费方引用 | 严重性 |
|------|-------------|--------|
| `ProfilePopover` | ✅ `GlobalRail.tsx:2` | 🟢 |
| `Toast` | ✅ `GlobalRail.tsx:2` | 🟢 |
| `ContextMenu` | ❌ 仅通过 barrel export 暴露，内部无引用 | 🟡 |
| `MultiSelectBar` | ❌ 仅通过 barrel export 暴露，内部无引用 | 🟡 |
| `PersonPanel` | ❌ 仅通过 barrel export 暴露，内部无引用 | 🟡 |

### 6.3 pages/ 路由接入

| 页面 | 路由接入 | 严重性 |
|------|----------|--------|
| `AgentsPage` | ✅ `WorkbenchRoutes.tsx:222` | 🟢 |
| `ContactsPage` | ✅ `WorkbenchRoutes.tsx:199` | 🟢 |
| `DocsPage` | ✅ `WorkbenchRoutes.tsx:211` | 🟢 |
| `ProjectsPage` | ✅ `WorkbenchRoutes.tsx:249` | 🟢 |
| `SettingsPage` | ✅ `WorkbenchRoutes.tsx:261` | 🟢 |
| `TasksPage` | ✅ `WorkbenchRoutes.tsx:236` | 🟢 |

### 6.4 消费方接入

| 消费方 | 接入方式 | 严重性 |
|--------|----------|--------|
| Desktop (`app/desktop/src/App.tsx`) | ✅ `import { AgentHubWorkbench } from '@shared/workbench'` | 🟢 |
| Web (`app/web/src/App.tsx`) | ✅ `import { AgentHubWorkbench } from '@shared/workbench'` | 🟢 |

### 6.5 建议

- 🟡 `AgentTimeline` (blocks/) 未被 TranscriptView 的 switch-case 路由使用。如果 `TranscriptBlock.kind` 没有 `'timeline'` 类型，则该组件属于预留或死代码。需确认设计意图
- 🟡 `ContextMenu`、`MultiSelectBar`、`PersonPanel` (floating/) 当前无内部消费方。如果为 v4 后续功能预留，建议添加注释说明；否则属于死代码
- 🟢 所有 6 个页面已通过 `WorkbenchRoutes` 接入路由，Desktop 和 Web 均已接入主 workbench 组件

---

## 7. 总结

### 按严重性统计

| 严重性 | 数量 | 关键发现 |
|--------|------|----------|
| 🔴 高 | 4 | AgentsPage 1227 行、web/SettingsPage 2386 行、z-index 硬编码、`--text-3` 对比度不足 |
| 🟡 中 | 15 | 多个 pages 组件超 500 行、Web 缺 attachments port、内联 SVG 应集中、AgentTimeline/floating 组件未使用、useEffect 可优化 |
| 🟢 低/良好 | 20+ | CSS token 一致性、ARIA 覆盖率、platform adapter 模式、key 使用、memoization |

### 优先修复建议

1. **🔴 拆分巨型组件**：AgentsPage (1227 行) 和 web/SettingsPage (2386 行) 应拆为独立子视图
2. **🔴 统一 z-index**：所有硬编码值替换为 `var(--z-*)` token
3. **🔴 修复对比度**：`--text-3` / `--text-weakest` 需提亮至 WCAG AA
4. **🟡 清理死代码**：确认 `AgentTimeline`、`ContextMenu`、`MultiSelectBar`、`PersonPanel` 的设计意图
5. **🟡 提取 SVG icons**：4+ 个组件中的内联 SVG 应集中到 shared icon 模块
6. **🟡 Web attachments port**：补充 Web 端 `attachments` platform 实现
