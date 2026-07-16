# Design token usage audit (inventory)

最后更新：2026-07-17  
Issue: #466  
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
| 1 | `app/web/src/components/WelcomeScreen.module.css` | 53 | heavy rgba/hex glass |
| 2 | `app/desktop/src/components/ApprovalCard.module.css` | was 45 | **#466**: semantic status fallbacks removed; residual font-stack fallbacks may remain |
| 3 | `app/web/src/components/AuthPage.module.css` | 42 | auth glass hardcodes |
| 4 | `app/desktop/src/contexts/ThemeContext.tsx` | was 36 | **#466**: preview hex moved to shared `themePresets.ts` meta only |
| 5 | `app/desktop/src/components/FileExplorer.module.css` | 31 | explorer chrome |
| 6 | `app/web/src/components/IM/TeamApprovalPanel.module.css` | 28 | IM status colors |
| 7 | `app/desktop/src/components/DesktopEntryGate.module.css` | 26 | entry chrome |
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

1. Wholesale WelcomeScreen / AuthPage glass rewrite  
2. Full chatview token merge  
3. Workbench `px` → `--sp-*` pass  
4. Mobile RN color SSOT merge  
5. Shared React `ThemeProvider` with `enablePresets`  
6. Package export for `./designTokens` and/or `./styles/*`

## 5. How to re-audit

```bash
# rough hardcode density (module CSS)
rg -c '#[0-9a-fA-F]{3,8}|rgba?\(' app/web/src/components app/desktop/src/components --glob '*.module.css'

# stale semantic fallbacks
rg 'var\(--(danger|success|warning|primary),' app --glob '*.css'
```
