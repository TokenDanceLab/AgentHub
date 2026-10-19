# Design system SSOT map

最后更新：2026-10-19

> 权威入口：本文件是 **design tokens / theme runtime / surface CSS ownership** 的 SSOT map。Design token SSOT 由 `app/shared/src/styles/`（CSS 值）与 `app/shared/src/designTokens.ts`（跨平台 alias / surface rules）共同组成；后者不是第二份颜色值表。
> 主架构索引：[architecture.md](../architecture.md)。

## 1. Ownership map

| Layer | Path | Role |
|---|---|---|
| **CSS token SSOT** | `app/shared/src/styles/tokens-base.css` | Base non-theme tokens (type / space / radius / elevation / glass / layout) |
| **CSS theme SSOT** | `app/shared/src/styles/themes.css` | Light / dark via `data-theme` |
| **CSS preset SSOT** | `app/shared/src/styles/presets-base.css` | `data-theme-preset` palettes |
| **Theme runtime SSOT** | `app/shared/src/theme.ts` | storage key, resolve / apply / `data-theme` |
| **Theme preset runtime SSOT** | `app/shared/src/themePresets.ts` (re-exported from `theme.ts`) | preset list, meta, storage key, `data-theme-preset` apply |
| **Cross-platform alias registry** | `app/shared/src/designTokens.ts` | `--td-*` ↔ web/mobile alias map + surface rules; literal fallbacks must mirror the CSS SSOT |
| **UI primitives** | `app/shared/src/ui/**` | Shared components + module CSS |
| **Tailwind / shadcn bridge** | `app/shared/src/styles/shadcn.css` | Maps existing theme tokens into Tailwind v4 colors, radii, fonts and the `data-theme` dark variant; does not fork token values |
| **Vendored shadcn primitives** | `app/shared/src/shadcn/ui/**` | Upstream registry source copied into the repo. Customize through caller classes/tokens, not by editing the token SSOT |
| **Workbench shell** | `app/workbench/src/**` | Product shell CSS/TS（独立包 `@agenthub/workbench`） |
| **Chatview scoped fork** | `app/shared/src/chatview/design/tokens.css` | Re-declares surfaces/text/status under `.chatview` (scoped isolation; value-drift risk) |
| **Desktop / Web re-exports** | `app/{desktop,web}/src/styles/{tokens,themes,presets}.css` | Thin `@import` of shared（presets.css 另 re-export `presets-folder-colors.css`；无本地覆盖） |
| **Desktop / Web ThemeContext** | `app/{desktop,web}/src/contexts/ThemeContext.tsx` | Thin React provider over shared theme + preset API |
| **Mobile RN tokens** | `app/mobile-rn/src/theme/tokens.ts` (+ `AgentHubThemeProvider.tsx`) | RN numeric/color tokens; maps `--td-*` via designTokens aliases |
| **Package surface** | `app/shared/package.json` | exports `./theme` (includes presets) + `./designTokens`; **no** `./styles/*` export (CSS stays shell-imported) |

Entry CSS load: desktop/web `main.tsx` imports surface `styles/{tokens,themes,presets}.css` → shared SSOT.

## 2. Consumer rules

1. **New visual values** → only `tokens-base.css` (non-theme) or `themes.css` (theme colors). Preset palettes → only `presets-base.css`.
2. **Theme apply / storage** → only `theme.ts`. **Preset apply / storage / list** → only `themePresets.ts` (via `@shared/theme`).
3. **Surface shells** import re-export CSS under `app/{desktop,web}/src/styles/*`. Never fork full token tables in product modules.
4. **`designTokens.ts`** is an **alias + surface-rules registry** for mobile/web naming. Its literal values are fallbacks that must track the CSS SSOT; design decisions and new values belong in the CSS files above.
5. **Brand icon hex** in brand assets (e.g. `designIcons.tsx`) is brand-literal OK. Product chrome (status, surfaces, text) must use theme tokens.
6. **CSS fallbacks** on tokens (`var(--td-*, 字面量)`) 若写则必须与 SSOT 一致；不得残留与 tokens/themes 定义冲突的字面量。新代码优先裸 `var(--token)`。
7. **Product CSS** uses semantic tokens `--success` / `--danger` / `--primary` / `--bdr` (and related surface tokens). **`--color-*` is legacy alias / preset-private only** — not for new product module consumers.
8. **Design token gate**：修改 `app/shared/src/styles/` 或 `app/shared/src/designTokens.ts` 后，运行 `pnpm --dir app --filter @agenthub/shared test`；`designTokens.test.ts`、`styles/tokens-base.test.ts`、`styles/surfaceStyles.test.ts` 必须全绿。
9. **Shared component acceptance**：新组件验收见 [component-acceptance.md](../component-acceptance.md)。
10. **New chat surfaces** use the vendored shadcn primitives (`Message`, `Bubble`, `InputGroup`, `Attachment`) plus Tailwind utilities whose colors/radii resolve from `shadcn.css`. Do not add a second palette or a component-local radius scale.
11. **Preflight stays off during migration.** `shadcn.css` imports Tailwind theme + utilities only; enabling Preflight would reset legacy CSS-Module surfaces. Remove this exception only in the change that retires the last migrated module.
12. **Flat chrome, glass overlays.** Workbench chrome (rail, sidebar, header, inspector, composer) uses flat `--background` / `--surface-dim` surfaces and 9–18% foreground hairlines. Frosted glass remains for transient overlays and previews, not for the persistent shell.

## 3. Legitimate surface glue (not forks)

| Delta | Why allowed |
|---|---|
| Desktop vs Web `presets.css` 差异 | 两者均为 `presets-base.css` + `presets-folder-colors.css` 的纯 re-export，无本地覆盖；若新增差异仅允许薄表面覆盖。 |
| Chatview `.chatview` scoped tokens | Isolation from the host theme; document drift risk. |
| Desktop/Web 各自 ThemeContext | Thin wrappers over shared theme/preset SSOT; product choice, not a token fork. |

## 4. Known forks and follow-ups

| Item | Status | Follow-up |
|---|---|---|
| Syntax-highlight binding pair (`#282c34` bg / `#abb2bf` ink) | Pinned to react-syntax-highlighter `oneDark`, theme-independent（`CodeBlock.tsx` fallbackStyle + `Markdown.module.css` fade gradient，均带 cross-reference 注释） | 若升级改变 `oneDark` palette，两处同一 commit 重检 |
| Chatview parallel spacing / density | `--chat-sp-md` aliases compat `--space-md` (12px)；lg/xl = 16/24 为独立密度；radius/type/dark 为独立 fork | Full merge + dark palette needs deliberate redesign |
| Chat surface migration | Composer + message rows now use shadcn primitives; remaining CSS-Module shell rules are being retired slice by slice | Delete a module rule only in the same change that removes its last consumer |
| Workbench raw `px` spacing | 可映射 spacing 已走 `--sp-*` / `--space-*`；odd steps remain raw | Optional: scale extension or redesign normalize |
| Mobile RN theme deltas | Open | 保留已登记 delta：glass proxy / OLED / scrim；token 注册表从共享设计 token 派生 |
| IM panels local rgba chrome | Open | Hardcode pass to semantic / glass tokens |

## 5. Frosted glass material

Light white frosted glass + dark translucent frosted glass are first-class tokens, not per-component hardcodes.

| Token family | Where | Notes |
|---|---|---|
| `--glass-panel*` / `--glass-border*` / `--glass-bg-*` | `tokens-base.css` base + `themes.css` light/dark pairs | Light prefers white translucent fill; dark prefers translucent panel + hairline light edge |
| `--glass-blur-*` / `--glass-saturate` / `--glass-backdrop-filter` | base + theme pairs | Card/panel material blur recipe |
| `--glass-elev-1..3` / `--glass-card-*` | base + theme pairs | Elevation scale + card recipe |
| `--elevated-card-*` | aliases to glass elev scale | Existing elevated surface consumers keep working |
| Alias registry | `designTokens.ts` `--td-glass-blur/card/elev` | Cross-surface naming; CSS remains value SSOT |

Consumer rule: new frosted surfaces use `var(--glass-*)`; do not invent local `backdrop-filter` or rgba glass fills.

## 6. Workbench density + micro-motion

| Token | Value | Use |
|---|---|---|
| `--wb-gap-2xs` | 4px | tab strip / hairline gaps |
| `--wb-gap-xs` | 8px | chrome padding |
| `--wb-gap-sm` | 12px | panel body / section |
| `--wb-gap-md` | 16px | card / empty-state |
| `--motion-hover/press/panel` | duration+ease recipes | chrome transitions |
| `.ah-glass-press` | soft hover lift + press scale | optional utility class |

Applied first to AuxPanel and TerminalPanel. Respect `prefers-reduced-motion`.

## 7. Visual QA gate

| Layer | SSOT |
|---|---|
| Capture matrix (merge gate) | `app/desktop/scripts/visual-qa-shell.mjs` + `app/web/scripts/visual-qa-shell.mjs`；两端 `package.json` 均以 `visual:qa:shell` 暴露；标准审阅矩阵为 **1440×810** light+dark · DPR **1x default** |
| Chat path capture | `app/web/scripts/visual-qa-chat.mjs` (`visual:qa:chat`)：1440×810 light+dark 主场景 + 768×900 goal scene；断言 code block / tool card / goal banner 与横向溢出合同 |
| Supplemental narrow captures | 同一 gate 额外生成并断言 Web **768×900**、Desktop **800×900** 的 light+dark 截图与 DOM/几何合同；这些宽度不替代 1440×810 标准审阅矩阵 |
| CI | web：`visual-qa-shell` job；desktop：`visual-qa-desktop` job（均 path-filtered `shell`，chromium only，非空白断言 + artifact 上传，禁 pixel golden） |
| Gate assertions | `app/{desktop,web}/scripts/assert-visual-qa-shell.mjs` · `assert:visual:qa:shell` |
| Optional 2x capture | `visual:qa:shell:2x` / `VISUAL_QA_DPR=2` · files suffix `@2x` |
| Pass bar | `visual:qa:shell` 截图证据 + PR 人工审阅；不维护分数 rubric |

窄视口只用于补充非空白与横向溢出合同；不得把补充窄视口写成两端统一断点，也不得用它替代 1440×810 的标准截图审阅。

## 8. Typography + HiDPI + breakpoints

| Concern | Where | Notes |
|---|---|---|
| OpenType / rendering | `tokens-base.css` roots | `text-rendering: optimizeLegibility`; `font-feature-settings: "kern" 1, "liga" 1`; `font-synthesis: none`; non-Retina subpixel AA |
| Font stacks | `--font-sans` / `--font-mono` | Noto Sans SC + mono CJK fallbacks |
| Fluid type | `--headline-*` / `--body-lg` / `--title-sm` | `clamp()`; `--body` / `--label` stay fixed 14/12 |
| Root scale wide | `html` @ 1920 / 2560 | 17px / 18px for viewing distance |
| HiDPI glass | `@media (min-resolution: 192dpi)` in tokens + themes | blur ~1.4×, stronger hairline borders, focus ring 3–4px |
| Breakpoint definitions | `app/shared/src/styles/tokens-base.css` 的 `--bp-*` 变量即 SSOT，`tokens-base.test.ts` 断言取值 | minimal 420 / mobile 480 / compact 720 / narrow 768 / medium 1024 / standard 1280 / wide 1440 / xwide 1920 / ultra 2560 |

响应式断点只定义在 `tokens-base.css` 的 `--bp-*`；剩余非 SSOT `@media` 仅 `app/shared/src/ui/Input.module.css` 与 `app/web/src/components/AuthPage.module.css` 的 legacy 760、`app/workbench/src/WorkbenchGoalBanner.module.css` 的 900，以及 Desktop `App.module.css` 的 1023/1279 成对窗口约定。

## 9. Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Written SSOT map | this file |
| Surfaces load shared CSS | desktop/web `styles/*.css` remain thin re-exports |
| Token changes verified | `surfaceStyles.test.ts` + token/theme tests |
| Component acceptance | [component-acceptance.md](../component-acceptance.md) |
