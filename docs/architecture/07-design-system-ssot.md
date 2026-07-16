# Design system SSOT map

最后更新：2026-07-17
Issue: #466 (P9.1) / #491 (chatview drift inventory) / #518 (chatview radius·type·dark residual)

> 权威入口：本文件是 **design tokens / theme runtime / surface CSS ownership** 的 SSOT map。
> 可选审计清单见 [design-token-usage-audit.md](../analysis/design-token-usage-audit.md)。
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

## 3. Legitimate surface glue (not forks)

| Delta | Why allowed |
|---|---|
| Desktop `presets.css` opaque borders vs Web glass borders under `[data-preset="tokendance"]` | Platform material difference; keep as thin surface override only |
| Chatview `.chatview` scoped tokens | Isolation from host theme; document drift risk; merge is a follow-up |
| Desktop ThemeContext exposes presets; Web does not | Product choice; both must use shared preset SSOT when/if Web adds UI |

## 4. Known forks / drift (follow-ups)

| Item | Status | Follow-up |
|---|---|---|
| ThemeContext dual providers | **Mitigated in #466** — preset constants + apply moved to shared; providers are thin wrappers | Optional: one shared React provider with `enablePresets` |
| Stale CSS status fallbacks | **Partial fix in #466** — `ApprovalCard.module.css` uses bare status tokens; **#482** Welcome/Auth glass hardcodes → `--glass-*` | Continue on EntryGate / FileExplorer / IM panels |
| Chatview parallel spacing / density | **Partial in #491** — chatview `--sp-md` aliases base compat `--space-md` (12px); lg/xl stay dense 20/28. **#518 residual inventory** — radius (3/6/10/14 vs base 6/8/12/16), dense type (`--body` 13px / `--label-xs` 11px), and full dark palette (incl. primary `#3399dd` vs `#29ABE2`) remain intentional forks; **no further zero-visual alias** (audit §6.14) | Full merge + dark palette → `themes.css` (or dual-scale product decision) needs deliberate visual redesign + standalone load-path plan |
| Workbench raw `px` spacing | **Partial in #480** — fully-mappable spacing decls → `--sp-*` / compat `--space-md|3xl`; odd steps (3/5/7/9/18…) + sizes left raw | Optional: scale extension or redesign normalize |
| `designTokens.ts` not package-exported | Open | Export when mobile/web path aliases stabilize |
| Mobile RN color SSOT | Open | Align RN values to themes.css via registry |

## 5. #466 concrete dedupe landed

### Fix A — unify theme preset SSOT

- Added `app/shared/src/themePresets.ts` with `THEME_PRESETS`, `THEME_PRESET_META`, storage key, get/persist/apply helpers.
- Re-exported from `app/shared/src/theme.ts` (`@shared/theme` package export already exists).
- Desktop `ThemeContext` no longer owns preset list/meta/storage/DOM apply; imports shared helpers.
- Web `ThemeContext` remains mode-only but documents shared ownership for future presets.

### Fix B — kill stale status-token fallbacks

- `app/desktop/src/components/ApprovalCard.module.css`: semantic colors and related status/text tokens use bare `var(--…)` so light/dark theme SSOT wins (previous light-only hex fallbacks e.g. `#d15252` / `#409467` / `#0071BC` diverged from dark theme values).

## 6. Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Written SSOT map | this file + optional audit under `docs/analysis/` |
| ≥1 concrete dedupe | Fix A + Fix B above |
| Surfaces still load shared CSS | desktop/web `styles/*.css` remain thin re-exports |
