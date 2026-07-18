# Visual QA scorecard

最后更新：2026-07-19
Issue: #1199 (P74)

> 100-point rubric for Desktop/Web shell screenshots. North star: **light white frosted glass**, dense spacing, micro-motion, dark translucent pair.
> Capture path: §4. Design tokens SSOT: [07-design-system-ssot](../architecture/07-design-system-ssot.md).

## 1. Pass bar

| Band | Score | Action |
|---|---|---|
| Ship | ≥85 | Accept iteration; note residual ≤15 |
| Iterate | 70–84 | Fix highest-weight fails before merge |
| Block | <70 | Do not land visual PR |

Score each surface (Desktop shell / Web shell) **light + dark** separately; report the **min** of the four shots as the gate score when shipping a visual change.

## 2. Rubric (100 pts)

| # | Dimension | Pts | Pass criteria (frosted-glass product) |
|---|---|---|---|
| 1 | Glass material | 18 | Panels/cards use `--glass-*` / Card `glass\|elevated`; visible blur+saturate on elevated chrome; no solid flat slabs where glass is intended |
| 2 | Hierarchy | 14 | Clear primary surface vs chrome vs content; no competing equal-weight slabs |
| 3 | Spacing density | 14 | Chrome uses `--wb-gap-*` (4/8/12/16); no large empty gutters or cramped collisions |
| 4 | Type scale | 10 | Body/label from token scale; no runaway sizes; secondary text weaker, still readable |
| 5 | Motion | 10 | Hover/press use `--motion-*`; no janky multi-second anim; `prefers-reduced-motion` kills transform |
| 6 | Light frost | 12 | Light theme: white/translucent frost, soft elev, no muddy gray wash |
| 7 | Dark frost | 8 | Dark theme: translucent panel + hairline edge; no pure black voids or white outlines |
| 8 | A11y chrome | 8 | Focus ring visible; contrast on primary actions; touch targets ≥44 on dense controls where interactive |
| 9 | Empty / loading | 6 | Empty states use density tokens; no raw i18n keys or dead white boxes |

**Deductions (stack):** horizontal overflow −5; raw hex/rgba chrome outside SSOT −5; left-only color rail −5; gradient decoration −5; competitor/copy language in UI −100 (block).

## 3. Score sheet template

```text
Surface: Desktop|Web   Theme: light|dark   Viewport: 1440x810   SHA: ____
1 Glass __/18  2 Hierarchy __/14  3 Spacing __/14  4 Type __/10
5 Motion __/10  6 Light __/12  7 Dark __/8  8 A11y __/8  9 Empty __/6
Deductions: ____   Total: __/100   Band: Ship|Iterate|Block
Notes: …
```

Keep loop notes under `docs/analysis/` or PR body — not a second SSOT.

## 4. Capture matrix (runnable)

| Surface | Viewport | Themes | Entry | Output dir |
|---|---|---|---|---|
| Desktop shell | 1440×810 | light, dark | Demo workbench | `app/desktop/screenshots/visual-qa/` |
| Web shell | 1440×810 | light, dark | Authenticated mock shell | `app/web/screenshots/visual-qa/` |

**Commands** (from monorepo root; starts local Vite via Playwright webServer or existing dev):

```bash
# Desktop — demo shell light+dark
pnpm --filter agenthub-desktop exec node scripts/visual-qa-shell.mjs

# Web — mock-hub shell light+dark (requires web dev or WEB_QA_URL)
pnpm --filter agenthub-web exec node scripts/visual-qa-shell.mjs
```

Package scripts: `pnpm --filter agenthub-desktop visual:qa:shell` · `pnpm --filter agenthub-web visual:qa:shell`.

Playwright configs already pin **1440×810** (`app/{desktop,web}/playwright.config.ts`). Full Web scene battery remains `app/web/scripts/visual-qa.mjs` (broader; not the P74 gate).

Baselines are **generated locally** (`screenshots/` is gitignored). Commit score notes + scripts, not PNG blobs, unless an explicit baseline PR force-adds a named set.

## 5. Iteration loop

1. Capture light+dark shells (§4).
2. Score with §2 sheet; gate = min of four.
3. Fix tokens/consumers only via design SSOT (no local rgba glass).
4. Re-capture → re-score until Ship (≥85) or explicit residual filed.

## 6. Out of scope (follow-ups)

Real Desktop PTY chrome, full workbench glass restyle of every panel, Mobile RN (has own `visual:qa`), pixel-diff CI.
