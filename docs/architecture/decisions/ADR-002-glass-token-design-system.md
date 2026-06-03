# ADR-002: Glass Token 设计系统

## Status

Accepted

## Context

AgentHub 的桌面端 UI 采用 macOS 风格的玻璃态（glassmorphism）视觉语言。在长期迭代中，CSS 文件中积累了大量硬编码的颜色值：

- **1200+ 处 `rgba()` 硬编码**散落在 90+ 个 CSS/模块文件中。
- 同一视觉效果（如"半透明背景"）在不同组件中使用了不同的 rgba 值，导致视觉不一致。
- 无法实现主题切换（dark/light）——每个 rgba 值都需要逐个修改。
- 同时存在 `#hex` 格式硬编码色值，与 rgba 混用。

需要一套设计 token 系统来统一管理所有玻璃态视觉效果，同时兼容未来可能的主题扩展。

## Decision

建立 `--glass-*` CSS 变量系统，将玻璃态效果分为以下语义层级：

**背景层（background）：**
- `--glass-bg-subtle` / `--glass-bg-light` / `--glass-bg-medium` / `--glass-bg-strong` / `--glass-bg-heavy` / `--glass-bg-active` / `--glass-bg-hover` — 7 级透明度梯度，覆盖从微弱到浓重的背景填充。

**边框层（border）：**
- `--glass-border` / `--glass-border-subtle` / `--glass-border-strong` / `--glass-border-heavy` — 4 级边框亮度。

**面板层（panel）：**
- `--glass-panel` / `--glass-panel-strong` / `--glass-panel-overlay` — 面板/浮层背景。

**阴影/特效：**
- `--glass-shadow` / `--glass-shadow-subtle` / `--glass-light-fill` — 阴影和光效。

**交互/输入：**
- `--glass-input-bg` / `--glass-input-bg-hover` — 输入框背景。

**文本：**
- `--glass-text-muted` / `--glass-text-disabled` — 弱化文本。

**语义色彩：**
- `--glass-tint-amber` / `--glass-tint-danger` / `--glass-tint-moss` / `--glass-tint-plum` — 状态/分类着色。

Token 定义在 `desktop/src/styles/tokens.css`（主题无关的基础 token）和 `themes.css`（主题相关的色值，通过 `data-theme` 切换）。

配合 **stylelint 规则**（`color-no-hex`、`declaration-property-value-disallowed-list`）阻止新代码引入硬编码色值，确保增量收敛。

## Consequences

**正面：**
- 主题切换只需修改 `themes.css` 中的 `--glass-*` 变量值，无需触及组件 CSS。
- 语义化命名使组件 CSS 更易读：`background: var(--glass-bg-medium)` 比 `background: rgba(255,255,255,0.055)` 更直观。
- Stylelint 守护线防止新违规，增量趋势向好。

**负面：**
- 存量 1200+ 处 rgba 硬编码需要逐步迁移，短期内无法完全消除。
- 迁移过程中，已豁免的旧文件和未迁移的新文件并存，需要依赖代码审查确保新文件不新增违规。
- Token 粒度可能不够——某些组件需要的透明度梯度可能介于两个 token 之间，需要在迁移中补充。
