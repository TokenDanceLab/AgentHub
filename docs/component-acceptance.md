# AgentHub 组件验收标准（component-acceptance）

最后更新：2026-08-14（自 TokenDanceLab/docs 迁入本仓库，本文件为 AgentHub 单仓 SSOT；#1672 迁移状态见 §1）

本文是 AgentHub shared 组件的**验收标准 SSOT**：任何 `app/shared/src/ui/` 下的新组件（或对既有组件做可见行为改动）必须对照本文件的 5 维验收标准，并带 `.test.tsx` + `.stories.tsx` + 本文件验收表对照记录。它与跨产品设计契约（`tokendance-design` 仓库 [design-system.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/design-system.md) 管 token 收敛、[design-playbook.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/design-playbook.md) 管实现流程、[visual-qa-matrix.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/visual-qa-matrix.md) 管产品级截图证据）互补：本文管**单组件验收**，矩阵管**产品级视觉证据**。

## 新组件三件套（硬规则）

新增 shared 组件时，PR/任务验收必须同时提交三件套，缺一不可：

| 件 | 路径约定 | 内容要求 |
|---|---|---|
| 组件测试 | `<组件>.test.tsx`（复杂组件可在 `__tests__/` 内拆分） | 覆盖交互、状态、错误、键盘路径的行为断言；禁止只测渲染快照或复制实现 switch |
| 组件故事 | `<组件>.stories.tsx` | 覆盖默认态、禁用/加载/错误态、紧凑/窄宽场景，供视觉 QA 与故事书巡检 |
| 验收表对照 | PR/issue 描述或 `docs/` 附表中逐项勾选本文 5 维标准 | 注明组件路径、token 使用（`--td-*` 优先）、截图/渲染证据路径、未覆盖项的原因 |

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

以下三个组件为本文件首批验收范本，作为新组件对照格式示例（勾选状态以各组件最近一次验收记录为准，验收记录应随 PR 更新）。

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
| 键盘 | Tab 循环（焦点困在对话框内） | ⚠️ | 需人工复核，见 debt 记录 |
| a11y | `role="dialog"` + `aria-modal` + 标题关联 | ✅ | |
| a11y | 焦点环与对比度 | ✅ | |
| 响应式 | 窄宽下可用、无横向滚动 | ✅ | 宽度上限 + 内滚 |

### ToastStack（`app/shared/src/ui/toast/ToastStack.tsx`，三件套齐全）

| 维度 | 必选项 | 状态 | 备注 |
|---|---|---|---|
| 视觉 | token 化状态色（success/warning/danger）、堆叠间距 | ✅ | 随 ToastStack.stories.tsx 巡检 |
| 交互 | 入列/出列/自动消失/手动关闭行为断言 | ✅ | Toast.test.tsx + toastStore.test.ts |
| 键盘 | 关闭按钮可聚焦 | ✅ | |
| a11y | `role="status"`/`role="alert"` 按消息重要性区分 | ✅ | |
| a11y | 自动消失提供可见时间或可暂停（成功态可放宽） | ⚠️ | 见 debt 记录 |
| 响应式 | 窄宽下堆叠不遮挡主操作、可滚动查看 | ✅ | |

## 验收记录与 debt

- 每次组件改动在 PR 描述中粘贴/链接对应范本表并更新状态；新增组件复制“范本表”结构新建表格。
- 范本表的勾选状态本身就是该组件最近一次验收的证据，随组件改动更新，不得保留过期勾选。
- 未达必选的项 = 验收不通过，必须修复或拆分；可选未做 = 记入 `docs/` 或 issue debt（owner + 计划）。
- 涉及可见 UI 变化的组件，提交前跑对应验证：`python scripts/verify/verify-design-token-ssot.py`、`cd app/shared && npx vitest run src/designTokens.test.ts src/styles/tokens-base.test.ts`，并按 [visual-qa-matrix.md](https://github.com/TokenDanceLab/tokendance-design/blob/master/docs/design/visual-qa-matrix.md) 提供产品级证据。
