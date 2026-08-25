# AgentHub 组件验收标准（component-acceptance）

最后更新：2026-08-24（自 TokenDanceLab/docs 迁入本仓库，本文件为 AgentHub 单仓 SSOT；#1672 迁移状态见 §1）

本文是 AgentHub shared 组件的**验收标准 SSOT**：任何 `app/shared/src/ui/` 下的新组件（或对既有组件做可见行为改动）必须对照本文件的 5 维验收标准，并带 `.test.tsx` + `.stories.tsx` + 本文件验收表对照记录。它与跨产品设计契约（`tokendance-design` 仓库 [design-system.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/design-system.md) 管 token 收敛、[design-playbook.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/design-playbook.md) 管实现流程、[visual-qa-matrix.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/visual-qa-matrix.md) 管产品级截图证据）互补：本文管**单组件验收**，矩阵管**产品级视觉证据**。

## 新组件三件套（硬规则）

新增 shared 组件时，PR/任务验收必须同时提交三件套，缺一不得合入：

| 件 | 路径约定 | 内容要求 |
|---|---|---|
| 组件测试 | `<组件>.test.tsx`（复杂组件可在 `__tests__/` 内拆分） | 覆盖交互、状态、错误、键盘路径的行为断言；禁止只测渲染快照或复制实现 switch |
| 组件故事 | `<组件>.stories.tsx` | 覆盖默认态、禁用/加载/错误态、紧凑/窄宽场景，供视觉 QA 与故事书巡检 |
| 验收表对照 | 对照本文件的组件验收表逐项勾选 5 维标准（记录可放在 PR/issue 描述或 `docs/` 附表） | 注明组件路径、token 使用（`--td-*` 优先）、截图/渲染证据路径、未覆盖项的原因 |

已有组件缺件时按同规则补件，不能以“旧组件”为由跳过。

## 5 维验收标准

每维按 必选 / 可选 分级。必选不满足 = 验收不通过；可选不满足 = 记录为 debt，注明 owner 与计划。

### 1. 视觉（Visual）

| 级别 | 标准 |
|---|---|
| 必选 | 使用 shared token（以 `--td-*` 为准），不引入组件级硬编码调色板 |
| 必选 | light 与 dark 两态下文字对比度可读，边框/分隔线可见（含 2x 高分屏 hairlines） |
| 必选 | 悬停/按下/选中/禁用态有明确区分，且不引起布局位移 |
| 可选 | 玻璃/投影/圆角与 Design Contract 一致（control 8px / panel 16px 语义） |
| 可选 | 提供 Storybook 截图或渲染证据路径 |

> 迁移状态（2026-08-14，issue #1672 M1–M7 闭环）：v4 → `--td-*` 组件级消费已清零——chatview/ui/workbench/web/desktop 消费面全部使用 `--td-*`，chatview 产品局部密度阶梯使用 `--chat-*` 前缀。`app/shared/src/styles/{tokens-base,themes}.css` 保留 v4 名作为**主题源值**（`--td-*` 桥接其上），新代码不要直接消费 v4 名。新组件一律直接使用 `--td-*`；确需产品局部组合的用 `--hub-*` 或组件前缀，禁止再造通用平行词汇。

### 2. 交互（Interaction）

| 级别 | 标准 |
|---|---|
| 必选 | 点击/输入等主路径有行为断言测试（异步按钮禁用或显示进度；错误出现在问题旁） |
| 必选 | 异步操作期间禁止重复提交，完成后恢复可交互状态 |
| 必选 | 状态转换（loading→success/error、展开/收起、选中/取消）可观察且可回退 |
| 可选 | 拖拽/长按/手势（移动端）有实现或明确说明不支持的原因 |

### 3. 键盘（Keyboard）

| 级别 | 标准 |
|---|---|
| 必选 | 可达元素可按 Tab 顺序聚焦，焦点顺序符合视觉顺序 |
| 必选 | Enter/Space 触发主操作；Esc 关闭浮层（Modal/菜单/Popover）；方向键支持列表/分组导航（如适用） |
| 必选 | 焦点在浮层打开时移入、关闭时归还触发元素 |
| 可选 | 提供快捷键并给出可见提示（keybind 文案用 `--label-xs`） |

### 4. 无障碍（A11y）

| 级别 | 标准 |
|---|---|
| 必选 | 交互元素有可访问名称（文本、`aria-label` 或 tooltip）；图标按钮必须带 `aria-label` |
| 必选 | 可见焦点环（`:focus-visible`）满足 2.4.7 / 2.4.11，不被 `outline: none` 静默移除 |
| 必选 | 语义角色正确：对话框用 `role="dialog"` + `aria-modal`，toast 用 `role="status"/"alert"` 等 |
| 必选 | 文案对比度：正文 ≥ 4.5:1、大字号 ≥ 3:1；muted 文本不低于 4.5:1（AA） |
| 可选 | 触控目标 ≥ 44px（移动/窄宽）；`prefers-reduced-motion` 下动画降级 |

### 5. 响应式（Responsive）

| 级别 | 标准 |
|---|---|
| 必选 | 组件在最小支持宽度下无横向页面滚动（数据表可按列滚动并注明） |
| 必选 | 长 zh/en 文案不溢出容器（`overflow-wrap`、截断或换行策略明确） |
| 必选 | 固定尺寸控件（按钮、输入、工具条）标签/图标/加载态不改变尺寸 |
| 可选 | 提供窄宽（≤760px）或移动（390px）下的渲染证据或明确的“桌面专用”例外说明 |

## 范本表

以下组件为本文件验收范本（首批三个之外，按组件族与页面验收扩编：DevicesPage / TokenUsagePage / OnboardingOverlay），作为新组件对照格式示例（勾选状态以各组件最近一次验收记录为准，验收记录应随 PR 更新）。

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

### DevicesPage（`app/workbench/src/pages/DevicesPage.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化配色（健康/告警/错误徽章 + 行边框） | ✅ | `--td-moss`/`--td-warning`/`--td-danger`/`--td-line` 等 |
| 视觉 | light/dark 对比度与 2x 边框 | ✅ | 随 DevicesPage.stories.tsx 巡检 |
| 交互 | ping 按钮异步禁用/恢复、错误重试、空态/未登录态 | ✅ | DevicesPage.test.tsx 行为断言 |
| 键盘 | Tab 聚焦、Enter/Space 触发 ping/retry | ✅ | 原生 button 语义 |
| a11y | 可访问名称、`:focus-visible` 焦点环、状态行语义 | ✅ | 错误态 `role="alert"`、空态 `role="status"` |
| 响应式 | 字段换行、长端点截断、无横向滚动 | ✅ | 字段 flex-wrap + ellipsis |

### TokenUsagePage（`app/workbench/src/pages/TokenUsagePage.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化卡片/表格/状态徽章 | ✅ | `--td-surface-2`/`--td-line`/`--td-plum` 等 |
| 视觉 | light/dark 对比度与 2x 边框 | ✅ | 随 TokenUsagePage.stories.tsx 巡检 |
| 交互 | 错误重试、空态/未登录态、未记录计数显示「—」不造假 0 | ✅ | TokenUsagePage.test.tsx 行为断言 |
| 键盘 | Tab 聚焦、Enter/Space 触发 retry | ✅ | 原生 button 语义 |
| a11y | 可访问名称、`:focus-visible`、`role="alert"`/`role="status"` | ✅ | |
| 响应式 | 团队卡片自适应栅格、表格列不溢出、无横向滚动 | ✅ | `auto-fill` 栅格 + 数字列 nowrap |

### OnboardingOverlay（`app/desktop/src/components/OnboardingOverlay.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化遮罩/面板/按钮 | ✅ | `--td-surface`/`--td-plum`/`--td-z-overlay` 等 |
| 视觉 | light/dark 对比度 | ✅ | 随 OnboardingOverlay.stories.tsx 巡检 |
| 交互 | 步进/跳过/完成调用 onFinish、Esc 关闭 | ✅ | OnboardingOverlay.test.tsx 行为断言 |
| 键盘 | Esc 关闭、焦点移入/归还、Tab 循环 | ✅ | 复用共享 `useFocusTrap`（`app/shared/src/ui/focusTrap.ts`）；OnboardingOverlay.test.tsx 断言初始聚焦、Tab 环绕与关闭后焦点归还触发元素 |
| a11y | `role="dialog"` + `aria-modal`、步骤进度可访问名 | ✅ | `aria-label` + `aria-current="step"` |
| 响应式 | 窄宽下面板自适应、无横向滚动 | ✅ | `min(100%, 460px)` |

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

### ArtifactVersionTimeline（`app/shared/src/ui/ArtifactVersionTimeline.tsx`，#1820 补 stories，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化结构/状态色 | ✅ | ArtifactVersionTimeline.module.css `--td-*` 24 处，无硬编码色 |
| 视觉 | light/dark 对比度 | ✅ | 随 ArtifactVersionTimeline.stories.tsx 巡检 |
| 交互 | 展开/收起行为断言 | ✅ | ArtifactVersionTimeline.test.tsx 覆盖展开切换与 actions 渲染 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 展开头为原生 button |
| a11y | 可访问名、焦点环 | ⚠️ | 版本号+时间文本构成可访问名；展开态未暴露 `aria-expanded`，记 debt |
| 响应式 | 长标题适配、无横向滚动 | ⚠️ | 未单独验证 |

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
| 交互 | Workbench 诚实只读边界 | ✅ | transcript 只有 run id、无可信历史 workDir；ConversationHost 禁止借用当前 composer workDir，传 `readOnly` 并隐藏全部写回动作，提示条使用 `role="status"`；Web 同样只读 |
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

### RuntimeEvidenceParts 产物下载动作（`app/workbench/src/inspector/RuntimeEvidenceParts.tsx`，#1945）

背景：产物行原硬编码「Download: unavailable — no download action」。本次将下载动作改经 `PreviewPort.downloadArtifactContent` 平台端口：Desktop（拥有 Local Edge）解析 Edge 内容端点并执行真实下载；Web 为 Hub-only，Hub 仅有产物元数据投影、无内容端点，故省略 `downloadArtifactContent`，renderer 统一降级为「下载不可用」文案。renderer 全程不构造 host REST 路径。

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化按钮/降级提示 | ✅ | `--td-plum`/`--td-line`/`--td-surface-3`/`--td-ink-subtle`/`--td-radius-control`，无组件级硬编码调色板 |
| 视觉 | light/dark 对比、hover/按下/禁用可区分且无布局位移 | ✅ | hover/focus-visible/disabled 由 background/box-shadow/opacity 表达；降级提示行内展示 |
| 交互 | 异步下载禁用按钮防重复提交、失败错误 toast | ✅ | RuntimeEvidenceParts.test.tsx 行为断言（调用端口/下载中禁用/失败 toast） |
| 交互 | 不支持端统一降级为提示而非静默无操作 | ✅ | 省略 `downloadArtifactContent` 时渲染 `role="status"` 提示 |
| 键盘 | Tab 聚焦、Enter/Space 触发 | ✅ | 原生 button 语义 |
| a11y | 可访问名、焦点环、提示语义 | ✅ | 按钮 `aria-label`=`ui.downloadArtifact`，提示 `role="status"` |
| 响应式 | 窄宽无横向滚动、长文件名适配 | ✅ | artifactWorkspace flex-wrap + `overflow-wrap: anywhere` |

降级文案（中英一致，#1945）：
- `inspector.artifactDownloadUnavailable`
  - zh：`下载不可用：当前端无产物内容端点。`
  - en：`Download unavailable: this client has no artifact content endpoint.`
- 可达性评估结论：Hub 无产物内容端点——`GET /web/agent-tasks/{id}/artifacts` 为仅元数据投影（`api/openapi.yaml`：does not expose content），契约内唯一内容路由 `/v1/artifacts/{artifactId}/content` 属 Edge-local 且 `x-agenthub-status: planned`。Web 为 Hub-only（不直连 Local Edge），故产物内容下载明确记录为不支持并统一降级文案。

产物与证据：
- 端口：`app/shared/src/platform/types.ts` `PreviewPort.downloadArtifactContent` + `DownloadArtifactInput`。
- Desktop：`app/desktop/src/platform/desktopPreview.ts` `downloadDesktopArtifactContent`（经 `resolveDesktopRuntimeEvidenceContent` 解析端点 + Edge Bearer fetch + blob 下载）。
- Web：`app/web/src/platform/webPlatform.ts` 省略 `downloadArtifactContent`，统一降级。
- 测试：`RuntimeEvidenceParts.test.tsx`（Desktop-shaped 下载 / Web-shaped 降级）、`desktopPreview.test.ts` 下载行为、`RuntimeEvidenceHelpers.test.ts` ref/文件名。本机仅 L0 单测，real_tested=false。

### MediaAttachment（`app/shared/src/chatview/components/MediaAttachment.tsx`，#1939 三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化（`--chat-*` 密度阶梯 + `--td-*`） | ✅ | RowItem.css `att-media-*` 块消费 `--chat-sp-*`/`--chat-r-md`/`--td-line`，无硬编码调色板；播放器本体为原生控件 |
| 视觉 | light/dark 对比度 + 状态区分 | ✅ | 随 MediaAttachment.stories.tsx 巡检（AudioReady/VideoReady/Loading/Unavailable/TooLarge 5 态）；通知文案走 `--td-ink-subtle` 既有 `.att-image-status` |
| 交互 | 端口解析状态机（loading→ready/unavailable/too-large/failed）行为断言 | ✅ | MediaAttachment.test.tsx 覆盖五态转换；超限行不触发 fetch（fetched=false 断言） |
| 交互 | 异步期间无空播放器、完成后恢复可交互 | ✅ | loading 态显示明确通知，不渲染 `<audio>`/`<video>`；ready 态原生控件可交互 |
| 键盘 | 播放器为原生 `<audio controls>`/`<video controls>`，继承浏览器原生键盘操作 | ✅ | 无自定义浮层，无焦点陷阱需求 |
| a11y | 可访问名称 | ✅ | 播放器带 `aria-label`（`card.attachment.audioInline`/`videoInline`）；降级通知 `role="status"` |
| a11y | 诚实降级，无静默坏播放器 | ✅ | 无 resolver/解析失败/加载失败/超限/危险 scheme 均回退文件 chip + 明确状态通知；负向测试断言 `javascript:`/`data:` URL 不进 `src` |
| 响应式 | 播放器宽度夹取，无横向滚动 | ✅ | `max-width:320px`（音频 100%/视频 320x180 上限），随窄容器收缩 |

## 验收记录与 debt

### Modal / ToastStack debt 台账（2026-08-22 范本复核）

| 组件 | 项 | 状态与缺口 | 跟踪载体 |
|---|---|---|---|
| Modal | 键盘 Tab 循环（必选） | 部分闭环，必选项未完全达标：`Modal.tsx` 经 `useFocusTrap` 困住焦点，`focusTrap.test.tsx` 断言 Tab/Shift+Tab 环绕与焦点归还；残留缺口为无 Modal 级专属断言、复核仅在 jsdom、未在真实浏览器人工复核。拆分验收：行为实现与共享层单测计入已通过，剩余验证工作记 debt | owner：前端 track；计划：补 Modal 级 Tab 循环断言（Modal.test.tsx）+ Visual QA 真实浏览器复核；跟踪：[#1820](https://github.com/TokenDanceLab/AgentHub/issues/1820)（验收补全） |
| PermissionModePicker | light 主题 rgba 硬编码色清零 | 已闭环：`[data-theme='light']` 分支 rgba 字面量全部收编进 `--composer-*` 变量族（`themes.css` light 块定义 token，module 裸 `var(--composer-*)` 引用） | 跟踪：[#1914](https://github.com/TokenDanceLab/AgentHub/issues/1914) |
| ToastStack | 自动消失可见时间/可暂停 | 已实现：hover/focus 触发 `pauseAutoDismiss`（ToastStack.tsx + toastStore.ts），满足「可暂停」必选分支。残留缺口：剩余倒计时不可视化（非必选） | 无独立 debt；倒计时可视化为可选增强，如需跟踪归入 [#1820](https://github.com/TokenDanceLab/AgentHub/issues/1820) 验收补全 |

### 维护规则

- 每次组件改动在 PR 描述中粘贴/链接对应范本表并更新状态；新增组件复制“范本表”结构新建表格。
- 范本表的勾选状态本身就是该组件最近一次验收的证据，随组件改动更新，不得保留过期勾选。
- 未达必选的项 = 验收不通过，必须修复或拆分；可选未做 = 记入 `docs/` 或 issue debt（owner + 计划）。
- 修改 `app/shared/src/styles/` 或 `app/shared/src/designTokens.ts` 时，必须运行 `python scripts/verify/verify-design-token-ssot.py`，且 `app/shared/src/designTokens.test.ts`、`app/shared/src/styles/tokens-base.test.ts` 全绿。
- 涉及可见 UI 变化时，按受影响端运行 `app/{desktop,web}/scripts/visual-qa-shell.mjs` 对应的 `visual:qa:shell`；标准审阅矩阵为 `1440x810` light+dark，同一 gate 的 Web `768x900` / Desktop `800x900` 是补充窄视口合同。`app/web/scripts/visual-qa.mjs` 为可选/遗留多场景电池，不是 merge gate；产品级证据仍按 [visual-qa-matrix.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/visual-qa-matrix.md) 组织。
