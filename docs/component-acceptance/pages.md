# 页面级组件范本表（pages）

> 来源：component-acceptance.md 拆分（#2092）。验收维度与三件套规则见主文件 `../component-acceptance.md`。

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
