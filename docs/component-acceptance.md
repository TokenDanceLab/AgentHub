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

以下组件为仓库验收范本（按组件族拆分子文档：共享 UI 原语见 `component-acceptance/ui-core.md`，页面级见 `pages.md`，chatview 族见 `chatview.md`），作为新组件对照格式示例（勾选状态以各组件最近一次验收记录为准，验收记录应随 PR 更新）。


## 范本索引

范本表正文按组件族拆分（#2092 文档卫生）：共享 UI 原语在 `ui-core.md`，页面级组件在 `pages.md`，chatview 族在 `chatview.md`。修改组件后更新对应子文档的范本表，本索引不重复勾选状态。

| 组件 | 范本表位置 |
|---|---|
| Button | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| Modal | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| ToastStack | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| 表单组件族：Input / Switch | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| AgentStreamingBar | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| CodeBlock | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| DagTree | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| DiffReviewPanel | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| RunReviewOverlay | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| DiffReviewPanelParts | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| DocxPreview | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| ErrorBoundary | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| Icon | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| Markdown | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| RiskBadge | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| Select | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| SkeletonBar | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| SlideshowPreview | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| TablePreview | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| TokenDanceMark | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| Tooltip | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| PermissionModePicker | [component-acceptance/ui-core.md](component-acceptance/ui-core.md) |
| DevicesPage | [component-acceptance/pages.md](component-acceptance/pages.md) |
| TokenUsagePage | [component-acceptance/pages.md](component-acceptance/pages.md) |
| OnboardingOverlay | [component-acceptance/pages.md](component-acceptance/pages.md) |
| RuntimeEvidenceParts 产物下载动作 | [component-acceptance/pages.md](component-acceptance/pages.md) |
| MediaAttachment | [component-acceptance/chatview.md](component-acceptance/chatview.md) |

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
