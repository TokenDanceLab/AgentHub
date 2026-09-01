# Shared UI 原语范本表（ui-core）

> 来源：component-acceptance.md 拆分（#2092）。验收维度与三件套规则见主文件 `../component-acceptance.md`。

### Button（`app/shared/src/ui/Button.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化配色（primary/secondary/danger + hover/disabled） | ✅ | `--td-plum`/`--td-plum-hover`/`--td-danger` 等 |
| 视觉 | light/dark 对比度与 2x 边框 | ✅ | 随 Button.stories.tsx 巡检 |
| 交互 | 异步禁用/进度、防重复提交 | ✅ | Button.test.tsx 有行为断言 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 原生 button 语义 |
| 键盘 | 焦点归还（非浮层场景 N/A） | ✅ | 不适用项 |
| a11y | 可访问名称、focus ring | ✅ | 图标按钮强制 aria-label |
| 响应式 | 无横向滚动、长文案适配、尺寸稳定 | ✅ | 固定高度按钮 |

### Modal（`app/shared/src/ui/Modal.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化面板（`--td-panel`/`--td-surface-3`）、scrim | ✅ | 随 Modal.stories.tsx 巡检 |
| 交互 | 打开/关闭、提交/取消路径行为断言 | ✅ | Modal.test.tsx |
| 键盘 | Esc 关闭、焦点移入/归还 | ✅ | 测试覆盖 |
| 键盘 | Tab 循环（焦点困在对话框内） | ⚠️ | `useFocusTrap`（focusTrap.ts）实现 Tab/Shift+Tab 环绕、focusTrap.test.tsx 有行为断言；必选项未完全闭环（缺 Modal 级断言与真实浏览器复核），按拆分验收记入下方 debt 台账 |
| a11y | `role="dialog"` + `aria-modal` + 标题关联 | ✅ | |
| a11y | 焦点环与对比度 | ✅ | |
| 响应式 | 窄宽下可用、无横向滚动 | ✅ | 宽度上限 + 内滚 |

### ToastStack（`app/shared/src/ui/toast/ToastStack.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化状态色（success/warning/danger）、堆叠间距 | ✅ | 随 ToastStack.stories.tsx 巡检 |
| 交互 | 入列/出列/自动消失/手动关闭行为断言 | ✅ | `toast/__tests__/Toast.test.tsx` + `toast/__tests__/toastStore.test.ts`（2026-08-23 复核存在） |
| 键盘 | 关闭按钮可聚焦 | ✅ | |
| a11y | `role="status"`/`role="alert"` 按消息重要性区分 | ✅ | |
| a11y | 自动消失提供可见时间或可暂停（成功态可放宽） | ✅ | hover/focus 触发 `pauseAutoDismiss`（ToastStack.tsx + toastStore.ts）满足「可暂停」分支；结论见下方 debt 台账 |
| 响应式 | 窄宽下堆叠不遮挡主操作、可滚动查看 | ✅ | |

### 表单组件族：FormField / Input / Textarea / Checkbox / Switch / Radio（#1827）

迁移背景（动机）：19 个文件裸 `<input>/<textarea>`、error 态各自手写；AuthPage `.input` desktop/web 双份分叉（web 带边框 10px radius、desktop 无边框 10px radius，同约定不同值）；SettingsPage 自造 `.switch`。本族为表单输入的唯一实现，error 态统一为 **语义（`aria-invalid` + `aria-describedby` 接线）与 token（`--td-danger`）**。三件套齐全（`.test.tsx` + `.stories.tsx` + 本表）。

| 组件 | 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|---|
| FormField（`shared/src/ui/FormField.tsx`） | 视觉 | token 化 label/hint/error | ✅ | `--td-ink-muted`/`--td-ink-faint`/`--td-danger`/`--td-text-xs` |
| FormField | 交互 | label↔control 绑定（htmlFor/auto-id） | ✅ | FormField.test.tsx：`getByLabelText` 断言显式 id 与自动 id 两条路径 |
| FormField | 交互 | error 态语义接线可见 | ✅ | `aria-invalid` + `aria-describedby` 指向 error 文本；hint 冲突时让位 |
| FormField | 键盘 | label Tab 聚焦原生 | ✅ | 原生 `<label htmlFor>` |
| FormField | a11y | error 文本参与名称/描述 | ✅ | `aria-describedby`；必选标记 `aria-hidden` 星号 |
| FormField | 响应式 | 长字段文案不横向溢出 | ✅ | `min-width: 0` + 纵向 gap 布局 |
| Input（`shared/src/ui/Input.tsx`） | 视觉 | token 化（`--td-*` 优先，glass 材质延续 auth 卡） | ✅ | `--glass-border`/`--glass-bg-light`/`--td-ink`/`--td-focus`/`--td-danger`/`--td-radius-control`；无组件级硬编码调色板 |
| Input | 视觉 | light/dark 对比度、hover/focus/disabled/invalid 可区分且无布局位移 | ✅ | 状态均由 border/box-shadow/bg 表达；stories 巡检 |
| Input | 交互 | 输入主路径行为断言 | ✅ | Input.test.tsx：typing/value/change |
| Input | 交互 | disabled 禁止交互 | ✅ | 原生 disabled + 0.5 opacity（disabled token 族属 #1827 token lane，缺 token 记 debt） |
| Input | 键盘 | Tab/`focus-visible` 环（2.4.7） | ✅ | `:focus-visible` 用 `--focus-ring` |
| Input | a11y | invalid 低配置访问名名称 | ✅ | `aria-invalid` 由 prop/FormField 注入 |
| Input | 响应式 | 窄宽触控 ≥44px | ✅ | `@media (max-width:760px) min-height: var(--touch-target-min)`（原 web AuthPage 每页 44px 规则收敛进族） |
| Textarea（`shared/src/ui/Textarea.tsx`） | 视觉 | 同 Input token 体系 | ✅ | 仅垂直 resize，横向永不变形 |
| Textarea | 交互 | 多行输入行为断言 | ✅ | Textarea.test.tsx：typing |
| Textarea | 键盘/a11y | 同 Input | ✅ | 原生 textarea + 同族 focus/invalid 规则 |
| Textarea | 响应式 | 窄宽触控、无横向滚动 | ✅ | 同 Input |
| Checkbox（`shared/src/ui/Checkbox.tsx`） | 视觉 | token 化（`--td-plum`/`--td-line-strong`/`--td-danger`/`--td-ink-on-plum`） | ✅ | 原生 input 隐藏、表层叠视觉盒；checked=plum 底 + 白勾 |
| Checkbox | 交互 | 点击/键盘切换、label 关联 | ✅ | Checkbox.test.tsx：label 名查询、click 触发 |
| Checkbox | 键盘 | Space 切换（原生）+ `focus-visible` 环 | ✅ | 环在视觉盒上（`+ .box`），input 本体隐藏 |
| Checkbox | a11y | 原生 checkbox 语义 | ✅ | `role="checkbox"` + 原生状态；invalid 带 `aria-invalid` |
| Checkbox | 响应式 | 标签长文案换行、无横向溢出 | ✅ | inline-flex + label text 参与文本流 |
| Switch（`shared/src/ui/Switch.tsx`） | 视觉 | 与旧 SettingsPage `.switch` 逐 token 等价 | ✅ | 42×24 药丸、`--td-surface-3`/`--td-line`/`--td-plum`/`--td-shadow-sm`；迁移视觉不变 |
| Switch | 交互 | 切换回调、disabled 保持状态可见 | ✅ | Switch.test.tsx：false/true/disabled 三路 |
| Switch | 键盘 | Tab + Space/Enter 切换 + `focus-visible` 环 | ✅ | 新族补上了旧实现缺失的焦点环 |
| Switch | a11y | `role="switch"` + `aria-checked`，可访问名 | ✅ | `aria-label` 透传；#1818 disabled 语义保留 |
| Switch | 响应式 | 尺寸固定不随状态变化 | ✅ | width/height 固定，thumb 位移仅 transform |
| Radio（`shared/src/ui/Radio.tsx`） | 视觉 | token 化（同 Checkbox 家族） | ✅ | 16px 圆环 + 8px `--td-plum` 内点 |
| Radio | 交互 | name 分组、切换回调 | ✅ | Radio.test.tsx：grouping/click |
| Radio | 键盘 | 方向键组内移动（原生 radio）+ 焦点环 | ✅ | 原生语义 |
| Radio | a11y | 原生 radio 语义 + invalid 接线 | ✅ | |
| Radio | 响应式 | 同 Checkbox | ✅ | |
| Select（`shared/src/ui/Select.tsx`，既有组件可见行为改动 #1827） | 视觉 | error 态 token 化 | ✅ | `--td-danger` 触发沿；focus 时焦点环优先（a11y） |
| Select | 交互 | disabled option 不可选/不可 hover/不可导航 | ✅ | Select.test.tsx：Arrow 跳跃、Enter/click 拒选、Home/End 跳过 |
| Select | 交互 | resize 重定位（翻转方向 + 锚点） | ✅ | open 期间 window `resize` 重算 top/bottom/width；测试 mock rect + innerHeight |
| Select | 键盘 | disabled option 不落入 `aria-activedescendant` | ✅ | 导航 helper 只落在 enabled option |
| Select | a11y | error 态 `aria-invalid` 于 trigger | ✅ | |
| Select | 响应式 | 面板 max-height 内滚（不变） | ✅ | |

产物与证据：
- 迁移：web/desktop `AuthPage.tsx` 的 hub/dev URL 输入 → `<Input size="sm" mono>`（web 视觉等价；desktop 从 11px 透明底收敛到家族 13px glass 字段——11px 低于 CJK 可读下限，双份 `.input/.error` 手写分叉块已删除）；workbench `SettingSwitch` → 共享 `<Switch>`（视觉逐 token 等价，新增焦点环）。
- 渲染证据：各组件 `.stories.tsx`（Storybook 巡检路径 `UI/Form/*`）；本条未随本提交提供独立截图，如需截图证据路径记 debt（#1820 Storybook 基建路在补 stories 渲染链路）。
- 未覆盖项：disabled 透明度 0.5 沿用旧值（#1827 token lane 的 disabled token 家族未落，落定后替换）；可选 44px 触控不在 Switch/Checkbox/Radio 强制（桌面设置面）。

### AgentStreamingBar（`app/shared/src/ui/AgentStreamingBar.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化状态色 | ✅ | AgentStreamingBar.module.css `--td-*` 14 处，无硬编码色 |
| 视觉 | light/dark 对比度 | ✅ | 随 AgentStreamingBar.stories.tsx 巡检（single/multi/finished/failed 4 态） |
| 交互 | 主路径行为断言 | ✅ | 展示型组件（`agentActivity` store 驱动，无操作入口），不适用项 |
| 键盘 | 无可达操作（N/A） | ✅ | 不适用项 |
| a11y | 可访问名、焦点环、语义角色 | ✅ | `role="status"`，活动期 `aria-live="off"`（#1823），AgentStreamingBar.test.tsx 断言 |
| 响应式 | 无横向滚动、文案适配 | ⚠️ | 宽度自适应；窄宽未单独验证（随 Overview 面板覆盖） |

### CodeBlock（`app/shared/src/ui/CodeBlock.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化配色 | ✅ | 复用 Markdown.module.css（`--td-*` 36 处）；oneDark 高亮主题为内容共享 |
| 视觉 | light/dark 对比度 | ✅ | 随 CodeBlock.stories.tsx 巡检（inline/block/language/long 折叠 5 态） |
| 交互 | 异步禁用/进度、防重复提交 | ✅ | 复制按钮 copied 态切换，CodeBlock.test.tsx 有行为断言 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 复制/展开均为原生 button |
| a11y | 可访问名、焦点环 | ✅ | 复制按钮动态 `aria-label`（copy/copied） |
| 响应式 | 无横向滚动、长文案适配、尺寸稳定 | ✅ | 代码区 `overflow: auto`，内联 code 自动换行 |

### DagTree（`app/shared/src/ui/DagTree.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化状态点 | ✅ | 内联样式使用 `--td-moss`/`--td-danger`/`--state-thinking`/`--td-ink-subtle` |
| 视觉 | light/dark 对比度 | ✅ | 随 DagTree.stories.tsx 巡检（tree/无标题/空 3 态） |
| 交互 | 展开/收起的可观察状态 | ⚠️ | 实现具备（点击+键盘切换）；DagTree.test.tsx 以渲染断言为主，无交互断言，记 debt |
| 键盘 | Enter/Space 触发 | ✅ | `onKeyDown` 覆盖 Enter/Space |
| a11y | 语义角色、可访问名 | ✅ | `role="tree"/"treeitem"/"group"` + `aria-expanded` |
| 响应式 | 长文案不溢出 | ✅ | 标签 `text-overflow: ellipsis` + `nowrap` |

### DiffReviewPanel（`app/shared/src/ui/DiffReviewPanel.tsx`，#1820 补 stories，#1967 run 级扩展，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化 diff 行/徽章 | ✅ | DiffReviewPanel.module.css `--td-*`/`--diff-*`，无硬编码色；#1967 run 工具条复用 `--td-surface-2`/`--td-line` |
| 视觉 | light/dark 对比度 | ✅ | 随 DiffReviewPanel.stories.tsx 巡检（default/empty/custom labels/run-level 5 态） |
| 交互 | accept/reject 行为断言 | ✅ | DiffReviewPanel.test.tsx 覆盖行/全量 accept-reject 与 hunk 状态提交 |
| 交互 | run 级批量写回合同（#1967） | ✅ | 仅可信宿主传入 `runId` + apply port 时可用；跨文件批量复用 `onApplyAllHunks`，失败按操作前 snapshot 精确恢复 mixed 状态，`onAcceptRun`/`onRejectRun` 仅在异步成功后回调 |
| 交互 | 显式只读模式 | ✅ | `readOnly` 隐藏 run/file/hunk 全部 accept/reject 控件；不会把本地标记伪装成工作区写回 |
| 键盘 | 方向键列表导航、原生按钮 | ✅ | tablist roving（箭头/Home/End，#1823）；可写面操作为原生 button，只读面不暴露动作 |
| a11y | 语义角色、可访问名 | ✅ | `role="tablist"/"tab"/"tabpanel"` + `aria-selected`，行操作与 run 操作按钮 `aria-label` |
| 响应式 | 窄宽下可用 | ⚠️ | 双列 side-by-side 窄宽未单独验证；run 工具条 `flex-wrap` 降级 |

### RunReviewOverlay（`app/shared/src/ui/RunReviewOverlay.tsx`，#1967 三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化浮层（`--glass-*` + `--td-*`） | ✅ | RunReviewOverlay.module.css 复用 Modal 玻璃面板配方，无硬编码调色板；只读提示条 `--td-warning` 派生 |
| 视觉 | light/dark 对比度 | ✅ | 随 RunReviewOverlay.stories.tsx 巡检（ReadOnly/ReadOnlyZh/Empty 3 态） |
| 交互 | 打开/关闭（按钮、Esc、backdrop）行为断言 | ✅ | RunReviewOverlay.test.tsx 覆盖三种关闭路径与内容点击不误关 |
| 交互 | 聚合文件渲染 + 单 run 边界 | ✅ | `kind=run` evidence ref 选择当前/最新单 run，跨 run 文件不混合；同 run/path 的多个 `editId` 片段合并并对重放 hunk 去重；无 run evidence 时明示会话级 legacy 兼容视图 |
| 交互 | Workbench 写回能力诚实边界（#1967） | ✅ | 写回仅在 `kind=run` evidence 携带执行器上报的 `workDir` 且平台有 apply port（Desktop Local Edge）时启用；无 workDir / 无 port（Web Hub-only）/ legacy 三种只读态各配诚实提示（`role="status"`）；禁止用当前 composer workDir 猜测历史运行目录 |
| 键盘 | 焦点困在浮层、Esc 关闭、关闭归还焦点 | ✅ | `useFocusTrap`（focusTrap.ts）+ 测试断言焦点移入/归还触发元素 |
| a11y | `role="dialog"` + `aria-modal` + 可访问名 | ✅ | `aria-label` = 宿主标题；关闭按钮强制 `aria-label` |
| a11y | 打开期间锁定 body 滚动并在关闭后恢复 | ✅ | 测试断言 `overflow` 变化（Modal 同构） |
| 响应式 | 窄宽下可用 | ✅ | ≤768px 全屏化（100vw/100vh，去圆角），面板随容器内滚 |

### DiffReviewPanelParts（`app/shared/src/ui/DiffReviewPanelParts.tsx`，#1820 补 stories）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化（共用 DiffReviewPanel.module.css） | ✅ | `--td-*` 59 处 |
| 视觉 | light/dark 对比度 | ✅ | 随 DiffReviewPanelParts.stories.tsx 巡检（FileTabs/Toolbar/SideColumn 3 story） |
| 交互 | tab 切换、accept/reject-all、行 accept/reject 断言 | ✅ | DiffReviewPanelParts.test.tsx 12 处事件断言 |
| 键盘 | 方向键导航 | ✅ | roving tabindex（#1823）+ 原生按钮 |
| a11y | 语义角色、可访问名 | ✅ | tablist/tab、按钮 `aria-label` |
| 响应式 | 窄宽下可用 | ⚠️ | 同 DiffReviewPanel（两列并排未单独验证） |

### DocxPreview（`app/shared/src/ui/DocxPreview.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化容器/加载/错误态 | ✅ | DocxPreview.module.css `--td-*` 41 处 |
| 视觉 | light/dark 对比度 | ✅ | 随 DocxPreview.stories.tsx 巡检 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 1 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | 关闭/重试行为断言 | ⚠️ | 原生按钮实现；DocxPreview.test.tsx 以渲染断言为主、无事件断言，记 debt |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 关闭/重试均为原生 button |
| a11y | 可访问名、语义角色 | ✅ | section/关闭按钮带 `aria-label`，错误 `role` 语义 |
| 响应式 | 内容区滚动 | ⚠️ | 未单独验证 |

### ErrorBoundary（`app/shared/src/ui/ErrorBoundary.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化错误卡 | ✅ | ErrorBoundary.module.css `--td-*` 13 处 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 1 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | retry/reload/copy 行为断言 | ✅ | ErrorBoundary.test.tsx 覆盖 retry 复位与 primary 行为 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 全部为原生 button |
| a11y | `role="alert"`、可访问名 | ✅ | 错误卡 `role="alert"`，按钮文本可访问名；chunk reload 分支隐藏 retry |
| 响应式 | 窄宽下可用 | ⚠️ | 未单独验证 |

### Icon（`app/shared/src/ui/Icon.tsx`，#1820 补 stories）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化配色（无自带颜色） | ✅ | 不适用项——Material Symbols 字体承载，无组件级配色 |
| 视觉 | light/dark 对比度 | ✅ | 随 Icon.stories.tsx 巡检（default/filled/large/decorative 4 态） |
| 交互 | 展示型（N/A） | ✅ | 不适用项 |
| 键盘 | 无可达交互（N/A） | ✅ | 不适用项 |
| a11y | 可访问名、焦点环 | ✅ | 默认 `aria-hidden`；文本字形可作可访问名 |
| 响应式 | 尺寸稳定 | ✅ | `flex-shrink: 0`，size 驱动 |

### Markdown（`app/shared/src/ui/Markdown.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化 | ✅ | Markdown.module.css `--td-*` 36 处 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 2 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | 复制/锚点行为断言 | ✅ | Markdown.test.tsx 覆盖 code 复制与 GFM/CJK 渲染 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 复制/链接为原生 button/a |
| a11y | 标题锚点 `aria-label`、外链语义 | ✅ | `rehype-slug` 标题 id + `aria-label="跳转标题"`，外链 `target=_blank` + `noopener` |
| 响应式 | 表格/长代码不溢出 | ⚠️ | 随内容容器；窄宽未单独验证 |

### RiskBadge（`app/shared/src/ui/RiskBadge.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化等级色 | ✅ | RiskBadge.module.css `--td-*` 6 处，无硬编码色 |
| 视觉 | light/dark 对比度 | ✅ | 随 RiskBadge.stories.tsx 巡检（low/medium/high/critical 4 态） |
| 交互 | 展示型（N/A） | ✅ | 不适用项 |
| 键盘 | 无可达交互（N/A） | ✅ | 不适用项 |
| a11y | 可访问名 | ✅ | 文本徽章，children 即可访问名 |
| 响应式 | 无横向滚动 | ✅ | 内联 pill 不产生滚动 |

### Select（`app/shared/src/ui/Select.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化 | ✅ | Select.module.css `--td-*` 26 处 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 4 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | 开合/选择/typeahead/点击外部断言 | ✅ | Select.test.tsx 26 处事件断言 |
| 键盘 | Tab/箭头/Home/End/Enter/Esc + typeahead | ✅ | 全部实现且有测试覆盖 |
| a11y | `listbox`/`option`/`aria-activedescendant`/`aria-expanded` | ✅ | 10 处 aria 断言 |
| 响应式 | 窄宽适配 | ✅ | 依据 trigger 宽度定位，底部翻转（`up`/`down`） |

### SkeletonBar（`app/shared/src/ui/SkeletonBar.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化（结构组件无配色需求） | ✅ | 仅圆角使用 `--td-radius-control` |
| 视觉 | light/dark 对比度 | ✅ | 随 SkeletonBar.stories.tsx 巡检（line/circle/block/narrow 4 态） |
| 交互 | 展示型（N/A） | ✅ | 不适用项 |
| 键盘 | 无可达交互（N/A） | ✅ | 不适用项 |
| a11y | 可访问名、语义角色 | ✅ | `aria-busy="true"` + `aria-hidden="true"`（测试断言） |
| 响应式 | 尺寸稳定 | ✅ | 宽度/间隙由 props（CSS 值）控制 |

### SlideshowPreview（`app/shared/src/ui/SlideshowPreview.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化 | ✅ | SlideshowPreview.module.css `--td-*` 49 处 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 1 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | 上/下页、缩略图切换断言 | ✅ | SlideshowPreview.test.tsx 覆盖导航与计数 |
| 键盘 | 方向键导航 | ✅ | window keydown 监听 + 测试覆盖 |
| a11y | 箭头/缩略图 `aria-label` | ✅ | |
| 响应式 | 幻灯片自适应 | ⚠️ | 未单独验证 |

### TablePreview（`app/shared/src/ui/TablePreview.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化表格 | ✅ | TablePreview.module.css `--td-*` 63 处 |
| 视觉 | 硬编码颜色清零 | ⚠️ | 3 处硬编码色（清理归 #1820 其他 lane） |
| 交互 | 排序、sheet 切换、错误重试断言 | ✅ | TablePreview.test.tsx 9 处事件断言 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 排序/sheet tab 为原生 button，roving tabindex（#1823） |
| a11y | 表格语义、`aria-sort`/`aria-selected`/tabpanel 关联 | ✅ | 11 处 aria 断言 |
| 响应式 | 表格列滚动、不横向撑破页面 | ✅ | 表容器内滚（`tableWrapper`） |

### TokenDanceMark（`app/shared/src/ui/TokenDanceMark.tsx`，#1820 补 stories）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化配色（品牌图资源） | ✅ | 不适用项——静态 SVG 资源 |
| 视觉 | light/dark 对比度 | ✅ | 随 TokenDanceMark.stories.tsx 巡检（default/small/custom alt 3 态） |
| 交互 | 展示型（N/A） | ✅ | 不适用项 |
| 键盘 | 无可达交互（N/A） | ✅ | 不适用项 |
| a11y | 可访问名 | ✅ | `alt` 默认 TokenDance，可覆盖 |
| 响应式 | 尺寸稳定 | ✅ | 原生 img width/height |

### Tooltip（`app/shared/src/ui/Tooltip.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化 | ✅ | Tooltip.module.css `--td-*` 5 处，无硬编码色 |
| 视觉 | light/dark 对比度 | ✅ | 随 Tooltip.stories.tsx 巡检（bottom/top/sides/delay/icon 5 态） |
| 交互 | 悬停延迟、聚焦即时、ESC 关闭断言 | ✅ | Tooltip.test.tsx 18 处事件断言 |
| 键盘 | 聚焦触发、ESC 关闭 | ✅ | 触发元素聚焦即显示 |
| a11y | `role="tooltip"` + `aria-describedby` 生命周期 | ✅ | idref 仅在开启时挂载（防悬空引用） |
| 响应式 | viewport 翻转 | ✅ | 四侧翻转（#1507），开启时按视口测量 |

### PermissionModePicker（`app/shared/src/ui/PermissionModePicker.tsx`，#1913 补 stories）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化（composer 控件族 + `--td-*` 兜底） | ✅ | `--composer-*` 消费，`--td-ink-muted`/`--td-radius-control` 兜底；light 主题 rgba 已收编进 `--composer-*` 变量族（themes.css light 块） |
| 视觉 | light/dark 对比度 + hover/active 状态区分 | ✅ | 随 PermissionModePicker.stories.tsx 巡检（default/acceptEdits/plan/bypass/disabled/custom-aria 6 态） |
| 交互 | 打开/关闭、选中回调、外部点击/Esc 关闭、disabled 拒绝打开 | ✅ | PermissionModePicker.test.tsx 行为断言（open/select/close/outside/escape/disabled） |
| 键盘 | Tab 聚焦、Enter/Space 触发、方向键/Home/End 导航、焦点移入/归还 | ✅ | test.tsx 覆盖；#1913 补可见焦点环 |
| a11y | 可访问名称（label 文本 + ariaLabel）、`aria-expanded` + `aria-haspopup="menu"` | ✅ | 触发按钮 |
| a11y | 可见焦点环不被 `outline:none` 静默移除（2.4.7/2.4.11） | ✅ | #1913 为 `:focus-visible` 补 `box-shadow: var(--focus-ring)` 可见焦点环，替代原先静默的 `outline:none` |
| a11y | 语义角色正确 | ✅ | 浮层 `role="menu"` + 选项 `role="menuitemradio"`/`aria-checked`/`tabIndex=-1`；触发 `aria-haspopup="menu"` |
| 响应式 | 触发 170px 截断 + 270px 面板 viewport 夹取，无横向滚动 | ✅ | trigger/option ellipsis + left clamp |
