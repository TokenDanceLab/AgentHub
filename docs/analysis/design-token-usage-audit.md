# Design token usage audit (inventory)

最后更新：2026-07-17
Issue: #466 / #480
Issue: #466 / #482
Companion SSOT map: [../architecture/07-design-system-ssot.md](../architecture/07-design-system-ssot.md)

> Inventory only. Do not treat this file as token ownership — ownership is the architecture SSOT map.

## 1. CSS load path

```text
app/desktop|web/src/main.tsx
  -> styles/tokens.css   @import @shared/styles/tokens-base.css
  -> styles/themes.css   @import @shared/styles/themes.css
  -> styles/presets.css  @import @shared/styles/presets-base.css + surface border glue
```

## 2. Top hardcode offenders (sample counts)

Counts ≈ matches of `#hex` / `rgba(...)` literals (module CSS / preset preview meta). Snapshot for prioritization, not a CI gate.

| Rank | File | ~matches | Notes |
|---:|---|---:|---|
| 1 | `app/web/src/components/WelcomeScreen.module.css` | was 53 → **0** | **#482**: glass/status hardcodes → `--glass-*` / semantic tokens |
| 2 | `app/desktop/src/components/ApprovalCard.module.css` | was 45 | **#466**: semantic status fallbacks removed; residual font-stack fallbacks may remain |
| 3 | `app/web/src/components/AuthPage.module.css` | was 42 → **0** | **#482**: auth glass hardcodes → `--glass-*` / elevated-card tokens |
| 4 | `app/desktop/src/contexts/ThemeContext.tsx` | was 36 | **#466**: preview hex moved to shared `themePresets.ts` meta only |
| 5 | `app/desktop/src/components/FileExplorer.module.css` | 31 | explorer chrome |
| 6 | `app/web/src/components/IM/TeamApprovalPanel.module.css` | 28 | IM status colors |
| 7 | `app/desktop/src/components/DesktopEntryGate.module.css` | 26 | entry chrome |
| workbench | `app/shared/src/workbench/**/*.module.css` | few hex; spacing largely tokenized | **#480**: exact/compat spacing → `--sp-*` / `--space-md|3xl`; odd micro-steps + sizes remain raw |
| entry | `app/desktop/src/components/WelcomeScreen.module.css` | was 5 → **0** | **#482**: residual elevation rgba → `--glass-shadow*` |
| entry | `app/desktop/src/components/AuthPage.module.css` | was 7 → **0** | **#482**: residual identity/logo glass literals tokenized |
| workbench | `app/shared/src/workbench/AgentHubWorkbench.module.css` | few hex; many raw px | spacing not using `--sp-*` |
| chatview | `app/shared/src/chatview/design/tokens.css` | full parallel table | spacing differs (`--sp-md: 12px` vs base `16px`) |

## 3. Theme fork evidence (pre-#466 → post)

| Fork | Pre | Post #466 |
|---|---|---|
| ThemeContext dual providers | desktop with local preset list; web re-wrapping helpers | both thin wrappers; preset SSOT in `themePresets.ts` |
| presets surface deltas | desktop opaque / web glass borders | unchanged legitimate glue |
| chatview scoped tokens | parallel color/spacing tables | unchanged (deferred) |
| `designTokens.ts` package export | not exported | still deferred |
| Fallback hex drift | ApprovalCard `var(--danger, #d15252)` etc. | bare `var(--danger)` etc. |

### Example drift (why bare vars matter)

| Token | Light (`themes.css` :root) | Dark (`[data-theme=dark]`) | Stale fallback often used |
|---|---|---|---|
| `--danger` | `#d15252` | `#e87070` | `#d15252` / `#e53e3e` |
| `--success` | `#409467` | `#69c967` | `#409467` |
| `--primary` | `#0071BC` | `#29ABE2` | `#0071BC` |
| `--warning` | `#c0883a` | `#d4aa4c` | `#c0883a` |

## 4. Deferred (out of smallest #466 slice)

1. ~~Wholesale WelcomeScreen / AuthPage glass rewrite~~ → landed in **#482** (module CSS only; no theme runtime rewrite)
2. Full chatview token merge
3. ~~Workbench `px` → `--sp-*` pass~~ → landed in **#480** (exact/compat spacing only; odd steps deferred)
4. Mobile RN color SSOT merge
5. Shared React `ThemeProvider` with `enablePresets`
6. Package export for `./designTokens` and/or `./styles/*`
7. DesktopEntryGate / FileExplorer / IM panel hardcode passes

## 4b. #482 Welcome/Auth glass migration notes

### Visual parity intent

- Keep web WelcomeScreen as the quiet Codex-style empty state (`launcher`/`brandMark` remain `display: none` / `contents`); token migration only rewires latent glass styles for future re-enable paths.
- Keep web AuthPage glass card/sheet chrome (blur, elevated panel, soft borders) but source fills/borders/tints from shared `--glass-*` / `--elevated-card-*` tokens so light/dark theme SSOT wins.
- Desktop Welcome/Auth already mostly tokenized; residual elevation rgba / light identity hex cleaned for the same token set.
- No theme runtime rewrite (`theme.ts` / `themes.css` / `tokens-base.css` unchanged).

### Residual / not rewritten

- Exact blur amounts (`blur(24|28px)`) and saturate factors remain component-local (not tokenized; visual recipe, not color SSOT).
- Web Auth submit remains glass-muted (web product choice); desktop Auth submit remains solid `var(--primary)` — intentional surface delta, not a fork of token values.
- Desktop light identity button gradient still composes multiple glass tokens for specular highlight; acceptable residual complexity.
- Other top offenders (EntryGate, FileExplorer, IM panels) remain deferred.

## 4b. #480 Workbench spacing migration notes

### Visual parity intent

- Convert only spacing props (`padding*`, `margin*`, `gap`/`row-gap`/`column-gap`, pure positioned offsets) when **every** px atom in the declaration maps exactly.
- Prefer v4 `--sp-*` (`2/4/6/8/10/14/16→md/24/32`). Use compat `--space-md` (12px) and `--space-3xl` (48px) only where no v4 name exists.
- Do **not** snap odd micro-steps (3/5/7/9/18/20/22…) or invent new scale tokens in this pass.
- Leave mixed multi-value decls, negatives, and `calc(...)` spacing raw; leave width/height/border/radius/font/size alone.
- Stay on base tokens — do not use chatview-scoped `--sp-*` (chatview redefines `--sp-md`/`--sp-lg`).

### Residual / not rewritten

- Odd micro-steps and mixed recipes (e.g. `padding: 5px 10px`, `padding: 26px 12px 14px` in page-shared nav).
- Local custom props such as `--composer-scroll-gap: 18px`.
- Size/touch-target dimensions (rail 52px, avatars, icons).
- Negative offsets (`-2px`, `-8px`, …).

### Yield (this pass)

- ~430 fully-mappable spacing decls / ~485 spacing atoms tokenized across shell, pages, floating, inspector.
- Remaining raw spacing atoms are mostly unmapped odd steps and mixed multi-value recipes.

## 5. How to re-audit

```bash
# rough hardcode density (module CSS)
rg -c '#[0-9a-fA-F]{3,8}|rgba?\(' app/web/src/components app/desktop/src/components --glob '*.module.css'

# stale semantic fallbacks
rg 'var\(--(danger|success|warning|primary),' app --glob '*.css'
```
