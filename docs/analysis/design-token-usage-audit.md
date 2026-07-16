# Design token usage audit (inventory)

最后更新：2026-07-17
Issue: #466 / #480 / #482 / #491
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
| chatview | `app/shared/src/chatview/design/tokens.css` | full parallel table | **#491**: dense scale kept; `--sp-md` now aliases base compat `--space-md` (12px ≠ v4 16px); dark palette still forked |

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
2. Full chatview token merge (dark palette / radius / type) — **#491** inventory + `--sp-md`→`--space-md` only
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

## 6. Chatview token drift inventory (#491)

Sources:

- `app/shared/src/chatview/design/tokens.css` (scoped `.chatview` + `[data-theme="dark"] .chatview`)
- `app/shared/src/styles/tokens-base.css`
- `app/shared/src/styles/themes.css`
- SSOT map: [07-design-system-ssot.md](../architecture/07-design-system-ssot.md)

### 6.1 Load path

```text
desktop|web main → tokens-base + themes
ChatViewTranscript / chatview global.css → chatview/design/tokens.css  (.chatview scope wins)
```

Chatview keeps a **scoped parallel token table** for isolation / standalone import. Host apps load SSOT via `tokens-base.css` + `themes.css`, then chatview **re-overrides** the same names inside `.chatview`, so product chat does not inherit host spacing/radius/type and only partially tracks host colors.

### 6.2 Usage density (chatview CSS)

| Token | ~uses | Primary sites |
|---|---:|---|
| `--label-xs` | 12 | `RowItem.css`, `Transcript.css` |
| `--label` | 12 | `RowItem.css`, `Transcript.css` |
| `--sp-sm` | 17 | rows / transcript chrome |
| `--sp-xs` | 12 | rows / transcript chrome |
| `--r-xs` | 9 | cards, chips, code |
| `--r-md` | 8 | cards, chips, code |
| `--sp-md` | 5 | gap / code / row padding |
| `--r-sm` | 5 | chips / buttons |
| `--body` | 5 | body text |
| `--sp-lg` / `--sp-xl` / `--r-lg` | 1 each | agent margin / empty pad / one radius |

### 6.3 Spacing (`--sp-*`)

| Token | Base (`tokens-base`) | Chatview | Match? |
|---|---|---|---|
| `--sp-2` | 2px | 2px | yes |
| `--sp-xs` | 4px | 4px | yes |
| `--sp-xxs` | 6px | 6px | yes |
| `--sp-sm` | 8px | 8px | yes |
| `--sp-10` | 10px | 10px | yes |
| `--sp-14` | 14px | 14px | yes |
| `--sp-16` | 16px | 16px | yes |
| **`--sp-md`** | **16px** | **12px** (`var(--space-md, 12px)`) | **name collision; value = base compat** |
| **`--sp-lg`** | **24px** | **20px** | **NO** |
| **`--sp-xl`** | **32px** | **28px** | **NO** |

Compat note (base only): `--space-md: 0.75rem` (**12px**) == chat density `--sp-md`. Chat density is the **compat 12px step**, not v4 `--sp-md`.

If `--sp-md/lg/xl` were forced to base 16/24/32: row gaps, agent margins, empty padding, and code paddings all expand → **visual redesign of transcript density**, not a silent alias fix.

### 6.4 Radius (`--r-*`)

| Token | Base | Chatview | Δ |
|---|---|---|---|
| `--r-xs` | 6px | 3px | −3 |
| `--r-sm` | 8px | 6px | −2 |
| `--r-md` | 12px | 10px | −2 |
| `--r-lg` | 16px | 14px | −2 |
| `--r-full` | 9999px | 9999px | ok |
| `--r-xl` / `--r-2xl` | base only | absent | n/a |

High fan-out on cards/chips/code/buttons. Aligning to base rounds the whole chat surface.

### 6.5 Typography

| Token | Base | Chatview |
|---|---|---|
| `--font-sans` / `--font-mono` | same stacks | same |
| `--body` | `400 0.875rem/1.5` (14px) | `400 0.8125rem/1.5` (**13px**) |
| `--label` | `500 0.75rem/1.5` | same |
| `--label-xs` | `600 0.625rem/1.5` (10px) | `600 0.6875rem/1.5` (**11px**) |
| `--bubble-font` | — | chat-only `0.875rem` |
| headlines / `--font-size-*` | base only | absent |

Dense chat type is intentional (comments in `tokens.css`).

### 6.6 Motion

| Token | Base | Chatview |
|---|---|---|
| `--dur`, `--dur-slow`, `--dur-pulse`, `--dur-route`, `--dur-bar` | same | same |
| `--ease` | same | same |
| `--dur-fast/normal/medium/panel/...` | base only | absent |

### 6.7 Colors — light

Light surfaces/text/borders/primary in chatview **match** `themes.css` light (`#f7f6f9`, `#ffffff`, `#1a1a2e`, `rgba(0,0,0,0.055)`, primary `#0071BC`, etc.).

Minor light `*-bg` opacity drift vs themes:

| Token | themes light | chatview light |
|---|---|---|
| `--success-bg` | 0.08 | 0.06 |
| `--warning-bg` | 0.08 | 0.06 |
| `--info-bg` | 0.06 | 0.06 |
| `--danger-bg` | 0.06 | 0.06 |

Status/role/state hexes mostly match **tokens-base** light defaults.

### 6.8 Colors — dark (**major fork**)

| Token | themes dark | chatview dark |
|---|---|---|
| `--app-bg` | `#1a1a20` | `#121217` |
| `--surface` | `#24242d` | `#1c1c24` |
| `--surface-dim` | `#1e1e26` | `#16161d` |
| `--surface-low` | `#282830` | `#1e1e28` |
| `--surface-high` | `#2e2e38` | `#252532` |
| `--surface-highest` | `#383844` | `#2d2d3a` |
| `--text-1` | `#e3e4e6` | `#e8e8ed` |
| `--text-2` | `#9a9aa4` | `#a0a0b0` |
| `--text-3` | `#606068` | `#6a6a7a` |
| `--bdr` | `rgba(255,255,255,0.06)` | `0.07` |
| `--bdr-strong` | `0.10` | `0.12` |
| **`--primary`** | **`#29ABE2`** | **`#3399dd`** |
| `--success` | `#69c967` | `#4dab7a` |
| `--warning` | `#d4aa4c` | `#d4a84a` |
| `--danger` | `#e87070` | `#e06565` |
| `--info` | `#6a93d4` | `#6e9de0` |
| state/role/diff | follow themes | follow chatview palette |

Highest product risk: chat sits in workbench under host `data-theme` but **does not use host dark SSOT**.

### 6.9 Chat-only tokens (keep)

`--bubble-font`, `--think-max-h`, `--avatar-size`, `--icon-size`, `--opacity-*`, `--guide-line`, `--shadow` (Transcript already prefers `var(--e-2, var(--shadow))`), chat-local role aliases already partially mirrored in base.

### 6.10 Elevation / shadow

| | Base | Chatview |
|---|---|---|
| elevation | `--e-0…--e-4` | — |
| `--shadow` | — | light `0 2px 8px…` / dark `0 2px 12px…` |
| themes | `--shadow-sm/md` | different recipe |

### 6.11 Safe vs blocked aligns

#### Blocked (do **not** do in #491)

1. **`--sp-md/lg/xl` → base 16/24/32** — redesigns transcript density (5+ layout sites).
2. **Radius scale → base 6/8/12/16** — rounds cards/chips/code (high fan-out).
3. **`--body` / `--label-xs` → base type** — intentional dense type; high use of `--label-xs`.
4. **Delete entire color table “to inherit host” without dark redesign** — dark surfaces + primary brand diverge; standalone path still imports only `chatview/design/tokens.css`.
5. **Remove identical redeclares (fonts / micro-sp / dur) without host guarantee** — package API still says import scoped tokens for isolation; no package export of `./styles/*` yet.

#### Landed in #491

**Align 1 — spacing semantic link (safe, zero visual change)** in `chatview/design/tokens.css`:

```css
/* 12px = base compat --space-md, NOT v4 --sp-md (16px) */
--sp-md: var(--space-md, 12px);
```

- Keeps 12px with or without host.
- Documents SSOT relationship; unblocks later consumers that already use `--space-md`.
- **Does not** retarget `--sp-lg` / `--sp-xl` (no base 20/28; inventing tokens out of scope).

**Align 2b — color blocked with evidence (no value change)**  
Dark palette fork + light `success/warning-bg` opacity drift documented in §6.7–6.8. Full dark → `themes.css` merge deferred (high visual QA; separate issue). Light opacity inherit (2a) skipped for standalone fallback safety.

### 6.12 Residual after #491

| Area | Status |
|---|---|
| Spacing semantic | **partially linked**: chatview `--sp-md` → base `--space-md` (12px); `--sp-lg`/`--sp-xl` still dense 20/28 |
| Radius | still forked (tighter chat scale) |
| Typography | still dense chat type |
| Dark colors | still full palette fork (incl. primary `#3399dd` vs `#29ABE2`) |
| Full merge / package `./styles/*` export | deferred |

### 6.13 Out of scope / later phases

- Full chatview token merge / delete scoped table
- Dark palette → `themes.css`
- Radius + type density redesign
- Package export of shared styles
- Workbench odd-px residual (already #480)
