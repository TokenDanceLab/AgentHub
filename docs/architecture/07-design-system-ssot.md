# Design system SSOT map

最后更新：2026-07-19
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
| **Workbench shell** | `app/shared/src/workbench/**` | Product shell CSS/TS |
| **Chatview scoped fork** | `app/shared/src/chatview/design/tokens.css` | Re-declares surfaces/text/status under `.chatview` (intentional isolation; value-drift risk) |
| **Desktop re-exports** | `app/desktop/src/styles/{tokens,themes,presets}.css` | Thin `@import` of shared (+ desktop border overrides in presets) |
| **Web re-exports** | `app/web/src/styles/{tokens,themes,presets}.css` | Thin `@import` of shared (+ web glass border overrides) |
| **Desktop ThemeContext** | `app/desktop/src/contexts/ThemeContext.tsx` | Thin React provider over shared theme + **preset API** |
| **Web ThemeContext** | `app/web/src/contexts/ThemeContext.tsx` | Thin React provider over shared theme (**no presets UI yet**) |
| **Mobile RN tokens** | `app/mobile-rn/src/theme/tokens.ts` (+ `AgentHubThemeProvider.tsx`) | RN numeric/color tokens; maps `--td-*` via designTokens aliases |
| **Package surface** | `app/shared/package.json` | exports `./theme` (includes presets); **no** `./designTokens` or `./styles/*` export yet |

Entry CSS load: desktop/web `main.tsx` imports surface `styles/{tokens,themes,presets}.css` → shared SSOT.

## 2. Consumer rules

1. **New visual values** → only `tokens-base.css` (non-theme) or `themes.css` (theme colors). Preset palettes → only `presets-base.css`.
2. **Theme apply / storage** → only `theme.ts`. **Preset apply / storage / list** → only `themePresets.ts` (via `@shared/theme`).
3. **Surface shells** import re-export CSS under `app/{desktop,web}/src/styles/*`. Never fork full token tables in product modules.
4. **`designTokens.ts`** is an **alias + surface-rules registry** for mobile/web naming. It is **not** a second color SSOT.
5. **Brand icon hex** in brand assets (e.g. `designIcons.tsx`) is brand-literal OK. Product chrome (status, surfaces, text) must use theme tokens.
6. **CSS fallbacks** on semantic tokens (`var(--danger, #…)` etc.) are discouraged: stale light fallbacks break dark mode. Prefer bare `var(--token)`.
7. **Product CSS** uses semantic tokens `--success` / `--danger` / `--primary` / `--bdr` (and related surface tokens). **`--color-*` is legacy alias / preset-private only** — not for new product module consumers (#910 / #1021 closed ghost product usage).

## 3. Legitimate surface glue (not forks)

| Delta | Why allowed |
|---|---|
| Desktop `presets.css` opaque borders vs Web glass borders under `[data-preset="tokendance"]` | Platform material difference; keep as thin surface override only |
| Chatview `.chatview` scoped tokens | Isolation from host theme; document drift risk; merge is a follow-up |
| Desktop ThemeContext exposes presets; Web does not | Product choice; both must use shared preset SSOT when/if Web adds UI |

## 4. Known forks / residual (follow-ups)

| Item | Status | Follow-up |
|---|---|---|
| ThemeContext dual providers | **Mitigated in #466** — preset constants + apply moved to shared; providers are thin wrappers | Optional: one shared React provider with `enablePresets` |
| Stale CSS status fallbacks | **#466** ApprovalCard bare status tokens; **#482** Welcome/Auth glass; **#607** shared UI bare semantic/surface tokens | Re-audit: no remaining `var(--danger|success|warning|primary|…, …)` fallback form in app CSS |
| EntryGate / FileExplorer hardcode | **Closed #879** — desktop modules map to design-token SSOT | — |
| Ghost `var(--color-*)` product consumers | **Closed #910 / #1021** — product modules use semantic SSOT; `--color-*` remains legacy/preset-private | — |
| ModelDropdown + IM rgba chrome | **Open residual** — `ModelDropdown.module.css` (~22 hex/rgba); IM panels retain local rgba chrome | Hardcode pass to semantic / glass tokens |
| Chatview parallel spacing / density | **Partial in #491** — chatview `--sp-md` aliases base compat `--space-md` (12px); lg/xl stay dense 20/28. **#518 residual inventory** — radius / type / dark remain intentional forks; **#607 reconfirmed hold** | Full merge + dark palette needs deliberate redesign |
| Workbench raw `px` spacing | **Partial in #480** — fully-mappable spacing → `--sp-*` / compat `--space-md|3xl`; odd steps remain raw | Optional: scale extension or redesign normalize |
| `designTokens.ts` not package-exported | Open | Export when mobile/web path aliases stabilize |
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
| Capture matrix (Visual QA gate 89/100，已收口 2026-07-20) | `app/{desktop,web}/scripts/visual-qa-shell.mjs` · `visual:qa:shell` · **1440×810** light+dark · DPR **1x default** |
| Optional 2x capture | `visual:qa:shell:2x` / `VISUAL_QA_DPR=2` · files suffix `@2x` |
| Score rubric / pass bar | visual-qa-scorecard.md 已外迁（100-pt core + optional HiDPI 6 bonus），见 `docs/history.md` |
| Optional multi-scene battery | `app/web/scripts/visual-qa.mjs` — **legacy / non-gate** (do not use for merge gate) |

Do not cite `1440x920` as the Desktop/Web gate viewport.

## 10. Typography + HiDPI (#1304–#1309, P75)

| Concern | Where | Notes |
|---|---|---|
| OpenType / rendering | `tokens-base.css` roots | `text-rendering: optimizeLegibility`; `font-feature-settings: "kern" 1, "liga" 1`; `font-synthesis: none`; non-Retina subpixel AA |
| Font stacks | `--font-sans` / `--font-mono` | Noto Sans SC + mono CJK fallbacks |
| Fluid type | `--headline-*` / `--body-lg` / `--title-sm` | `clamp()`; `--body` / `--label` stay fixed 14/12 |
| Root scale wide | `html` @ 1920 / 2560 | 17px / 18px for viewing distance |
| HiDPI glass | `@media (min-resolution: 192dpi)` in tokens + themes | blur ~1.4×, stronger hairline borders, focus ring 3–4px |
| Breakpoint SSOT | docs in tokens + hooks | **760** shell narrow; hooks `max-width: 759px` / tablet from 760 |
