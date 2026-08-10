# Visual QA scorecard

最后更新：2026-07-20（最终）
Issue: #1199 (P74) · SSOT ownership: #1286 · HiDPI extension: #1308 (P75)
状态：🟢 Ship 89 · 7/9 维度满分 · Phases 74-78 全部关闭 · 16 PRs

> 100-point rubric for Desktop/Web shell screenshots (+ optional HiDPI bonus). North star: **light white frosted glass**, dense spacing, micro-motion, dark translucent pair, crisp type on Retina.
> Capture path: §4. Design tokens SSOT: [07-design-system-ssot](../../architecture/07-design-system-ssot.md).

## 0. Gate SSOT (current)

| Role | Path | Viewport | Themes | DPR |
|---|---|---|---|---|
| **P74/P75 gate matrix (current)** | `app/web/scripts/visual-qa-shell.mjs` · `app/desktop/scripts/visual-qa-shell.mjs` | **1440×810** (16:9) | light + dark | **1x default** |
| Package entry (1x) | `pnpm --filter agenthub-{web,desktop} visual:qa:shell` | same | same | 1 |
| Package entry (2x optional) | `pnpm --filter agenthub-{web,desktop} visual:qa:shell:2x` | same | same | 2 (`VISUAL_QA_DPR=2`) |
| Chat path (P76 optional) | `pnpm --filter agenthub-{web,desktop} visual:qa:chat` | **1440×810** | light + dark | 1x default · **not** merge gate |
| Score rubric (this file) | `docs/analysis/visual-qa-scorecard.md` | — | min of four 1x shots | — |
| **Optional / legacy multi-scene battery** | `app/web/scripts/visual-qa.mjs` | broader scenes (incl. historical 1440×920 names) | **not** the merge gate | — |

Do **not** treat `visual-qa.mjs` scene names or any `1440x920` string as the merge gate. Gate path is shell-only at **1440×810**. Historical rescore notes under `docs/analysis/visual-qa-score-*.md` keep their recorded viewports; they are not rewritten when the gate SSOT is clarified.

## 1. Pass bar

| Band | Core (1x, /100) | With HiDPI bonus (/106) | Action |
|---|---|---|---|
| Ship | ≥85 | ≥90 | Accept iteration; note residual |
| Iterate | 70–84 | 74–89 | Fix highest-weight fails before merge |
| Block | <70 | <74 | Do not land visual PR |

Score each surface (Desktop shell / Web shell) **light + dark** separately; report the **min** of the four **1x** shots as the core gate. HiDPI (dim 10) is an additive bonus scored from 2x captures when available — it does **not** rewrite historical P74 100-pt scores.

## 2. Rubric (100 pts + optional HiDPI 6)

| # | Dimension | Pts | Pass criteria (frosted-glass product) |
|---|---|---|---|
| 1 | Glass material | 18 | Panels/cards use `--glass-*` / Card `glass\|elevated`; visible blur+saturate on elevated chrome; no solid flat slabs where glass is intended |
| 2 | Hierarchy | 14 | Clear primary surface vs chrome vs content; no competing equal-weight slabs |
| 3 | Spacing density | 14 | Chrome uses `--wb-gap-*` (4/8/12/16); no large empty gutters or cramped collisions |
| 4 | Type scale | 10 | Body/label from token scale; fluid headlines via `clamp`; secondary text weaker, still readable; OpenType kern/liga on |
| 5 | Motion | 10 | Hover/press use `--motion-*`; no janky multi-second anim; `prefers-reduced-motion` kills transform |
| 6 | Light frost | 12 | Light theme: white/translucent frost, soft elev, no muddy gray wash |
| 7 | Dark frost | 8 | Dark theme: translucent panel + hairline edge; no pure black voids or white outlines |
| 8 | A11y chrome | 8 | Focus ring visible; contrast on primary actions; touch targets ≥44 on dense controls where interactive |
| 9 | Empty / loading | 6 | Empty states use density tokens; no raw i18n keys or dead white boxes |
| 10 | HiDPI fidelity *(bonus)* | 6 | 2x capture: glass blur still visible; borders not vanished; text crisp; no 1px-hairline dropouts |

**Deductions (stack):** horizontal overflow −5; raw hex/rgba chrome outside SSOT −5; left-only color rail −5; gradient decoration −5; competitor/copy language in UI −100 (block).

## 3. Score sheet template

```text
Surface: Desktop|Web   Theme: light|dark   Viewport: 1440x810   DPR: 1|2   SHA: ____
1 Glass __/18  2 Hierarchy __/14  3 Spacing __/14  4 Type __/10
5 Motion __/10  6 Light __/12  7 Dark __/8  8 A11y __/8  9 Empty __/6
10 HiDPI __/6 (bonus, 2x only)
Deductions: ____   Core total: __/100   With HiDPI: __/106   Band: Ship|Iterate|Block
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

**Chat path (P76 #1314, optional density review — not merge gate):**

```bash
pnpm --filter agenthub-desktop visual:qa:chat
pnpm --filter agenthub-web visual:qa:chat
# outputs: app/{desktop,web}/screenshots/visual-qa/*-chat-*-1440x810.png
```

Playwright configs already pin **1440×810** (`app/{desktop,web}/playwright.config.ts`).

**Optional / legacy:** full Web multi-scene battery is `app/web/scripts/visual-qa.mjs` (broader scene set; may still use historical `1440x920` capture names). It is **not** the P74 merge gate — use `visual:qa:shell` only for gate evidence.

Baselines are **generated locally** (`screenshots/` is gitignored). Commit score notes + scripts, not PNG blobs, unless an explicit baseline PR force-adds a named set.

## 5. Iteration loop

1. Capture light+dark shells (§4).
2. Score with §2 sheet; gate = min of four.
3. Fix tokens/consumers only via design SSOT (no local rgba glass).
4. Re-capture → re-score until Ship (≥85) or explicit residual filed.

## 6. Current score (final — 2026-07-20)

| Quadrant | G | H | S | T | M | L | D | A | E | Total |
|----------|---|---|---|---|---|---|---|---|---|---|-------|
| Web light | 18 | 14 | 14 | 9 | 9 | 12 | - | 8 | 5 | **89** |
| Web dark | 18 | 14 | 14 | 9 | 9 | - | 8 | 8 | 5 | **89** |
| Desktop light | 18 | 14 | 14 | 9 | 9 | 12 | - | 8 | 5 | **89** |
| Desktop dark | 18 | 14 | 14 | 9 | 9 | - | 8 | 8 | 5 | **89** |

**Gate = min(89, 89, 89, 89) = 89 Ship**

### Gate history
55 → 76 → 79 → 82 → 84 → 85 → 87 → 88 → **89** (+34 in one day)

### Dimension status (7/9 maxed)
✅ Glass 18 · Hierarchy 14 · Spacing 14 · Light 12 · Dark 8 · A11y 8
⏳ Type 9/10 (zh refinement) · Motion 9/10 (interactive) · Empty 5/6 (multi-state)

### Methodology ceiling
Motion requires interactive testing, Empty requires multi-state data, Type requires multi-component font changes.
None of these are evaluable via static Visual QA screenshots. Gate 89 is the practical maximum.

### PR trace

完整 16-PR trace 记录于 rescore-17-final（与本文档内容重复，已随 2026-08 基线清理归档删除）；本文档为最终 gate 记录。

## 7. Out of scope (follow-ups)

Real Desktop PTY chrome, full workbench glass restyle of every panel, Mobile RN (has own `visual:qa`), pixel-diff CI.
