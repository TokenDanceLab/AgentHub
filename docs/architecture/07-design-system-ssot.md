# Design system SSOT map

最后更新：2026-08-23
Issue: #466 (P9.1 SSOT map) · residual hardcode closed via #879 / #910 / #1021 · open residual ModelDropdown + IM rgba chrome · **#1197 frosted-glass material layer**

> 权威入口：本文件是 **design tokens / theme runtime / surface CSS ownership** 的 SSOT map。
> 可选审计清单（design-token-usage-audit.md）已外迁，见 `docs/history.md`。
> 主架构索引：[architecture.md](../architecture.md)

## 1. Ownership map

| Layer | Path | Role |
|---|---|---|
| **CSS token SSOT** | `app/shared/src/styles/tokens-base.css` | Base non-theme tokens (type / space / radius / elevation / glass / layout) |
| **CSS theme SSOT** | `app/shared/src/styles/themes.css` | Light / dark via `data-theme` |
| **CSS preset SSOT** | `app/shared/src/styles/presets-base.css` | `data-theme-preset` palettes |
| **Theme runtime SSOT** | `app/shared/src/theme.ts` | storage key, resolve / apply / `data-theme` |
| **Theme preset runtime SSOT** | `app/shared/src/themePresets.ts` (re-exported from `theme.ts`) | preset list, meta, storage key, `data-theme-preset` apply |
| **Cross-platform alias registry** | `app/shared/src/designTokens.ts` | `--td-*` ↔ web/mobile alias map + surface rules (**TS registry, not CSS values**) |
| **UI primitives** | `app/shared/src/ui/**` | Shared components + module CSS |
| **Workbench shell** | `app/workbench/src/**` | Product shell CSS/TS（#1759 独立为 `@agenthub/workbench`） |
| **Chatview scoped fork** | `app/shared/src/chatview/design/tokens.css` | Re-declares surfaces/text/status under `.chatview` (intentional isolation; value-drift risk) |
| **Desktop re-exports** | `app/desktop/src/styles/{tokens,themes,presets}.css` | Thin `@import` of shared（presets.css 另 re-export `folder-colors.css`；无本地覆盖） |
| **Web re-exports** | `app/web/src/styles/{tokens,themes,presets}.css` | Thin `@import` of shared（presets.css 另 re-export `folder-colors.css`；无本地覆盖） |
| **Desktop ThemeContext** | `app/desktop/src/contexts/ThemeContext.tsx` | Thin React provider over shared theme + **preset API** |
| **Web ThemeContext** | `app/web/src/contexts/ThemeContext.tsx` | Thin React provider over shared theme + **preset API; preset UI in AuthPage advanced settings (#1820)** |
| **Mobile RN tokens** | `app/mobile-rn/src/theme/tokens.ts` (+ `AgentHubThemeProvider.tsx`) | RN numeric/color tokens; maps `--td-*` via designTokens aliases |
| **Package surface** | `app/shared/package.json` | exports `./theme` (includes presets) + `./designTokens` (alias/surface-rules registry, #1820); **no** `./styles/*` export (CSS stays shell-imported) |

Entry CSS load: desktop/web `main.tsx` imports surface `styles/{tokens,themes,presets}.css` → shared SSOT.

## 2. Consumer rules

1. **New visual values** → only `tokens-base.css` (non-theme) or `themes.css` (theme colors). Preset palettes → only `presets-base.css`.
2. **Theme apply / storage** → only `theme.ts`. **Preset apply / storage / list** → only `themePresets.ts` (via `@shared/theme`).
3. **Surface shells** import re-export CSS under `app/{desktop,web}/src/styles/*`. Never fork full token tables in product modules.
4. **`designTokens.ts`** is an **alias + surface-rules registry** for mobile/web naming. It is **not** a second color SSOT.
5. **Brand icon hex** in brand assets (e.g. `designIcons.tsx`) is brand-literal OK. Product chrome (status, surfaces, text) must use theme tokens.
6. **CSS fallbacks** on tokens (`var(--td-*, 字面量)` 等) 若写则必须与 SSOT 一致——不得残留与 tokens/themes 定义冲突的开/闭区间字面量（否则 dark mode 或预设下渲染漂移）。当前 app CSS 仍有 110+ 处 `var(--td-*, 字面量)` fallback 与 SSOT 值矛盾（#1827 token 契约部分清理中）；新代码优先裸 `var(--token)`。
7. **Product CSS** uses semantic tokens `--success` / `--danger` / `--primary` / `--bdr` (and related surface tokens). **`--color-*` is legacy alias / preset-private only** — not for new product module consumers (#910 / #1021 closed ghost product usage).

## 3. Legitimate surface glue (not forks)

| Delta | Why allowed |
|---|---|
| Desktop vs Web `presets.css` 差异 | 已消解——两者均为 `presets-base.css` + `folder-colors.css` 的纯 re-export，无本地覆盖（旧「opaque vs glass borders」表述不实：实际属性为 `data-theme-preset`，且无 tokendance 预设；若新增差异仅允许薄表面覆盖） |
| Chatview `.chatview` scoped tokens | Isolation from host theme; document drift risk; merge is a follow-up |
| Desktop ThemeContext exposes presets; Web does not | Product choice; both must use shared preset SSOT when/if Web adds UI | **Closed #1820** — Web preset API + AuthPage preset switcher landed on shared `themePresets` |

## 4. Known forks / residual (follow-ups)

| Item | Status | Follow-up |
|---|---|---|
| ThemeContext dual providers | **Mitigated in #466** — preset constants + apply moved to shared; providers are thin wrappers | Optional: one shared React provider with `enablePresets` |
| Stale CSS status fallbacks | **#466** ApprovalCard bare status tokens; **#482** Welcome/Auth glass; **#607** shared UI bare semantic/surface tokens | Re-audit: no remaining `var(--danger|success|warning|primary|…, …)` fallback form in app CSS |
| `--td-*` fallback drift | **Closed #1820** — radius-control / text-sm/xs / dur-normal / wb-gap-2xs / r-full 双值统一为 SSOT；`white`/`#eee`、`--bg-3`/`--mono`/`--wb-gap-3xl`/`--ah-border-subtle` 死链清除 | — |
| EntryGate / FileExplorer hardcode | **Closed #879** — desktop modules map to design-token SSOT | — |
| Ghost `var(--color-*)` product consumers | **Closed #910 / #1021** — product modules use semantic SSOT; `--color-*` remains legacy/preset-private | — |
| ModelDropdown + IM rgba chrome | **Open residual** — `ModelDropdown.module.css` (~22 hex/rgba); IM panels retain local rgba chrome | Hardcode pass to semantic / glass tokens |
| Syntax-highlight binding pair (`#282c34` bg / `#abb2bf` ink) | **Intentional (2026-08-23)** — react-syntax-highlighter `oneDark` theme binding, theme-*independent* (code blocks render oneDark in both app themes → no theme token pair exists or should exist; a `--td-syntax-*` group would be fake identical pairs and still not own the library's 30+ inline-style colors). Sites: `CodeBlock.tsx` fallbackStyle + `Markdown.module.css` fade-out gradient `rgba(40,44,52,.85)`. Both carry cross-reference comments. | Re-check both sites in one commit if the pinned `oneDark` palette changes on library upgrade |
| Chatview parallel spacing / density | **Partial in #491** — chatview `--chat-sp-md` aliases base compat `--space-md` (12px，非 v4 `--sp-md` 16px); lg/xl = 16/24（P76 有意密度；v4 为 16/24/32）. **#518 residual inventory** — radius / type / dark remain intentional forks; **#607 reconfirmed hold** | Full merge + dark palette needs deliberate redesign |
| Workbench raw `px` spacing | **Partial in #480** — fully-mappable spacing → `--sp-*` / compat `--space-md|3xl`; odd steps remain raw | Optional: scale extension or redesign normalize |
| `designTokens.ts` not package-exported | **Closed #1820** — `./designTokens` export registered; mobile-rn `theme/tokens.ts` derives glass aliases from registry | — |
| Mobile RN color SSOT | Open | Align RN values to themes.css via registry |

## 5. #466 concrete dedupe landed

### Fix A — unify theme preset SSOT

- Added `app/shared/src/themePresets.ts` with `THEME_PRESETS`, `THEME_PRESET_META`, storage key, get/persist/apply helpers.
- Re-exported from `app/shared/src/theme.ts` (`@shared/theme` package export already exists).
- Desktop `ThemeContext` no longer owns preset list/meta/storage/DOM apply; imports shared helpers.
- Web `ThemeContext` remains mode-only but documents shared ownership for future presets.

### Fix B — kill stale status-token fallbacks

- `app/desktop/src/components/ApprovalCard.module.css`（该路径已不存在：ApprovalCard 已迁入 shared 视觉体系，见 `app/shared/src/ui/RiskBadge.module.css`；Fix B 为 #466 历史记录）：semantic colors and related status/text tokens use bare `var(--…)` so light/dark theme SSOT wins (previous light-only hex fallbacks e.g. `#d15252` / `#409467` / `#0071BC` diverged from dark theme values).

## 6. Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Written SSOT map | this file + optional audit artifacts |
| ≥1 concrete dedupe | Fix A + Fix B above |
| Surfaces still load shared CSS | desktop/web `styles/*.css` remain thin re-exports |

## 7. Frosted glass material (#1197)

**Goal**: light white frosted glass + dark translucent frosted glass as first-class design tokens, not per-component hardcodes.

| Token family | Where | Notes |
|---|---|---|
| `--glass-panel*` / `--glass-border*` / `--glass-bg-*` | `tokens-base.css` base + `themes.css` light/dark pairs | Light prefers white translucent fill; dark prefers translucent panel + hairline light edge |
| `--glass-blur-*` / `--glass-saturate` / `--glass-backdrop-filter` | base + theme pairs | Card/panel material blur recipe |
| `--glass-elev-1..3` / `--glass-card-*` | base + theme pairs | Elevation scale + card recipe |
| `--elevated-card-*` | aliases to glass elev scale | Existing elevated surface consumers keep working |
| `Card` `variant="glass"\|"elevated"` | `ui/Card.module.css` | Consumes glass/elev tokens only |
| Alias registry | `designTokens.ts` `--td-glass-blur/card/elev` | Cross-surface naming; CSS remains value SSOT |

Consumer rule: new frosted surfaces use `var(--glass-*)` / Card glass variant; do not invent local `backdrop-filter` or rgba glass fills.

## 8. Workbench density + micro-motion (#1198)

| Token | Value | Use |
|---|---|---|
| `--wb-gap-2xs` | 4px | tab strip / hairline gaps |
| `--wb-gap-xs` | 8px | chrome padding |
| `--wb-gap-sm` | 12px | panel body / section |
| `--wb-gap-md` | 16px | card / empty-state |
| `--motion-hover/press/panel` | duration+ease recipes | chrome transitions |
| `.ah-glass-press` | soft hover lift + press scale | optional utility class |

Applied first to AuxPanel, TerminalPanel, Card glass/elevated. Respect `prefers-reduced-motion`.

## 9. Visual QA gate (#1199 / #1286 / #1308)

| Layer | SSOT |
|---|---|
| Capture matrix (Visual QA gate，已收口 2026-07-20) | `app/{desktop,web}/scripts/visual-qa-shell.mjs` · `visual:qa:shell` · **1440×810** light+dark · DPR **1x default** |
| CI 双半边（#1827） | web：`visual-qa-shell` job；desktop：`visual-qa-desktop` job（两者均 path-filtered `shell`，chromium only，非空白断言 + artifact 上传，禁 pixel golden） |
| Desktop 断言 | `app/desktop/scripts/assert-visual-qa-shell.mjs` · `assert:visual:qa:shell` |
| Optional 2x capture | `visual:qa:shell:2x` / `VISUAL_QA_DPR=2` · files suffix `@2x` |
| Score rubric / pass bar | 分数值不再由本仓维护（旧 `visual-qa-scorecard.md` 已不在源仓，`docs/history.md` 无对应外迁条目——89/100 等分数断言不可复核，已删除）；验收以 `visual:qa:shell` 截图证据 + PR 人工审阅为准 |
| Optional multi-scene battery | `app/web/scripts/visual-qa.mjs` — **legacy / non-gate** (do not use for merge gate) |

**窄视口门禁（#1827 结论：本轮不做）**。理由：断点体系尚未落地（见 §10——760–1920 区间无
布局策略、JS 断点 hook 在途），desktop Tauri 窗口 `minWidth 800×minHeight 600`；此时设
1 个窄视口（如 900×810）门禁只会把「主区被压」的现状固化进红色门禁，而修复责任在响应式
lane——本 lane 无法闭环。处置：断点 lane 合并后，在 `visual-qa-shell.mjs` 补 ≥1 个窄视口
场景并同步 `assert-visual-qa-shell.mjs` 期望文件清单，届时再开为门禁。

Do not cite `1440x920` as the Desktop/Web gate viewport.

## 10. Typography + HiDPI (#1304–#1309, P75)

| Concern | Where | Notes |
|---|---|---|
| OpenType / rendering | `tokens-base.css` roots | `text-rendering: optimizeLegibility`; `font-feature-settings: "kern" 1, "liga" 1`; `font-synthesis: none`; non-Retina subpixel AA |
| Font stacks | `--font-sans` / `--font-mono` | Noto Sans SC + mono CJK fallbacks |
| Fluid type | `--headline-*` / `--body-lg` / `--title-sm` | `clamp()`; `--body` / `--label` stay fixed 14/12 |
| Root scale wide | `html` @ 1920 / 2560 | 17px / 18px for viewing distance |
| HiDPI glass | `@media (min-resolution: 192dpi)` in tokens + themes | blur ~1.4×, stronger hairline borders, focus ring 3–4px |
| Breakpoint SSOT | `tokens-base.css` 注释声明 + `styles/breakpoints.ts` JS 表（双份同改，`breakpoints.test.ts` cross-check）——minimal 420 / mobile 480 / compact 720 / narrow 768 / medium 1024 / standard 1280 / wide 1440 / xwide 1920 / ultra 2560（`--bp-narrow: 768px` 由 `tokens-base.test.ts` 断言） | 剩余非 SSOT `@media`：`app/web/src/components/AuthPage.module.css` 760（legacy，未归一至 narrow 768）+ desktop/App.module.css 1023/1279（既定成对约定）。760–1920 布局策略仍无 CSS `@media`；JS hook 在 #1827 响应式部分在途 |
