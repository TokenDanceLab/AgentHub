# AgentHub 组件验收标准（component-acceptance）

最后更新：2026-10-18

本文是 AgentHub shared 组件的**验收标准 SSOT**：任何 `app/shared/src/ui/` 下的新组件（或对既有组件做可见行为改动）必须对照本文件的 5 维验收标准验收。Token 与主题规则见 `docs/architecture/07-design-system-ssot.md`；产品级截图证据按该文 §7 的 Visual QA gate 组织。

## 新组件三件套（硬规则）

| 件 | 路径约定 | 内容要求 |
|---|---|---|
| 组件测试 | `<组件>.test.tsx`（复杂组件可在 `__tests__/` 内拆分） | 覆盖交互、状态、错误、键盘路径的行为断言；禁止只测渲染快照或复制实现 switch |
| 组件故事 | `<组件>.stories.tsx` | 覆盖默认态、禁用/加载/错误态、紧凑/窄宽场景 |
| 验收表 | PR/issue 描述中附本文件的 5 维验收表 | 注明组件路径、token 使用（`--td-*` 优先）、截图/渲染证据路径、未覆盖项原因 |

已有组件缺件时按同规则补件，不能以“旧组件”为由跳过。新增组件复制上述 5 个维度的表结构；修改组件后更新该表，不得保留过期勾选。

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

> `app/shared/src/styles/{tokens-base,themes}.css` 保留 v4 名作为**主题源值**（`--td-*` 桥接其上）；新代码不要直接消费 v4 名。组件级局部组合用 `--hub-*` 或组件前缀，禁止再造通用平行词汇。

### 2. 交互（Interaction）

| 级别 | 标准 |
|---|---|
| 必选 | 点击/输入等主路径有行为断言（异步按钮禁用或显示进度；错误出现在问题旁） |
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
| 必选 | 语义角色正确：对话框 `role="dialog"` + `aria-modal`，toast `role="status"/"alert"` |
| 必选 | 正文对比度 ≥ 4.5:1、大字号 ≥ 3:1；muted 文本不低于 4.5:1（AA） |
| 可选 | 触控目标 ≥ 44px；`prefers-reduced-motion` 下动画降级 |

### 5. 响应式（Responsive）

| 级别 | 标准 |
|---|---|
| 必选 | 组件在最小支持宽度下无横向页面滚动（数据表可按列滚动并注明） |
| 必选 | 长 zh/en 文案不溢出容器（`overflow-wrap`、截断或换行策略明确） |
| 必选 | 固定尺寸控件（按钮、输入、工具条）标签/图标/加载态不改变尺寸 |
| 可选 | 提供窄宽（≤760px）或移动（390px）下的渲染证据，或明确的“桌面专用”例外说明 |

## 验收记录

在 PR 描述中复制上面 5 个维度，逐项标注 ✅ / ❌ / N/A 并写证据路径或缺口；也可在组件目录旁放同名 `.acceptance.md`。必选不满足不得合入。未达必选项必须修复或拆分；可选未做记入 issue debt（owner + 计划），不写入长期文档 backlog。

修改 `app/shared/src/styles/` 或 `app/shared/src/designTokens.ts` 时，运行 `python scripts/verify/verify-design-token-ssot.py`，并保证 `app/shared/src/designTokens.test.ts`、`app/shared/src/styles/tokens-base.test.ts` 全绿。可见 UI 变化按受影响端运行 `visual:qa:shell`，视口矩阵与门禁见 `docs/architecture/07-design-system-ssot.md` §7。
