# Open Design -- Design System Schema Reference

> **Parent:** [01-overview-and-architecture.md](./01-overview-and-architecture.md)
> **Sources:** `design-systems/_schema/`, 10 DESIGN.md files, AgentHub `tokens.css` / `themes.css`
> **Updated:** 2026-05-24

---

## 1. The 9-Section DESIGN.md Schema

Every design system in Open Design follows a **fixed 9-section format** in its `DESIGN.md`. This schema is the runtime contract between the design system author and the AI agent that consumes it. The agent reads these 9 sections and applies the rules when generating HTML/CSS artifacts.

### Section-by-section specification

| # | Section | Purpose | Example Content |
|---|---------|---------|----------------|
| 1 | **Visual Theme & Atmosphere** | Prose narrative describing the system's personality, materials, and design philosophy. Sets the emotional tone. | "Calm, functional, quietly confident. Content-first, chrome-second." (default) |
| 2 | **Color Palette & Roles** | Complete color definitions with semantic roles. Hex values (occasional OKLCH), named roles, and surface hierarchy. | `--bg #FAFAFA`, `--accent #2F6FEB`, semantic colors (success/warn/danger) |
| 3 | **Typography Rules** | Font families, type scale table (font/size/weight/line-height/letter-spacing), OpenType features, hierarchy principles. | "Inter for UI, Geist Mono for code, Berkeley Mono for terminal" |
| 4 | **Component Stylings** | Concrete CSS values for every component category: buttons (primary/secondary/ghost/pill), cards, inputs, navigation, badges, image treatments. | "Buttons: 8px radius, 10px 16px padding, accent fill" |
| 5 | **Layout Principles** | Spacing scale (base unit, scale steps), grid system, container widths, whitespace philosophy, border-radius scale. | "12-col grid, 1200px max-width, 24px gutters. 80px section spacing." |
| 6 | **Depth & Elevation** | Shadow levels table (Flat → Elevated → Modal), shadow values, decorative depth techniques. | "2 levels: Flat (0) and Raised (2px y-offset, 8px blur, 8% fg)" |
| 7 | **Do's and Don'ts** | Explicit behavioral rules for agents. Constraints that prevent common AI design mistakes. | "No gradients, no drop shadows on inputs, max 3 type sizes per screen." |
| 8 | **Responsive Behavior** | Breakpoint table (name/width/changes), touch targets, collapsing strategy, image behavior. | "Desktop >= 1024px (12-col), Tablet 640-1023 (8-col), Phone < 640 (4-col)" |
| 9 | **Agent Prompt Guide** | Quick color reference, copy-paste-ready component prompts, iteration guide. This is the "prompt engineer's cheat sheet" for the agent. | "When in doubt, subtract. Use accent sparingly -- at most one hero accent per screen." |

### Parsing rules

The first `# H1` is the **system title** shown in the picker dropdown. The line immediately after the H1 is parsed for `> Category: <name>` to group systems. The boilerplate prefix `Design System Inspired by ` is stripped at runtime -- it's metadata only.

Sections are detected by `## N. Section Name` headers (where N is 1-9). Sections 7 and 8 are sometimes combined or reordered (e.g., "Do's and Don'ts" may appear before "Responsive Behavior," and some systems use "Interaction & Motion" for section 7).

---

## 2. Color System

### Format pervasiveness

**Hex is dominant.** Across the 150+ DESIGN.md files, nearly all color values are hex (`#FAFAFA`, `#2F6FEB`, `#f54e00`). However, certain advanced design systems use additional formats:

| Format | Usage | Examples |
|--------|-------|----------|
| **Hex** | 95% of colors. Universal default. | `#2F6FEB`, `#ffffff`, `#0d0d0d` |
| **OKLCH / OKLab** | Advanced systems for border transparency and perceptual uniformity. | `oklab(0.263084 -0.0023 0.0125 / 0.1)` (Cursor borders), `color-mix(in oklab, var(--fg), transparent 92%)` (Open Design schema) |
| **HSL** | Used sparingly; Supabase uses HSL-based Radix color tokens. | `hsl(251, 63.2%, 63.2%)` (Supabase violet) |
| **rgba()** | Transparency fallbacks; universal for shadows. | `rgba(50,50,93,0.25)`, `rgba(255,255,255,0.08)` |
| **color-mix()** | Open Design schema's A2 fallback system. Not in DESIGN.md but in generated `tokens.css`. | `color-mix(in oklab, var(--accent), transparent 70%)` |

### Semantic color roles

Every DESIGN.md uses these semantic categories:

```
Primary (--bg, --fg, --surface)    → page background, text, card surfaces
Accent (--accent)                  → brand color, CTAs, links (≤2 visible uses per screen)
Semantic (--success, --warn, --danger) → state indicators
Neutral scale                      → 3-5 text levels (primary → muted → placeholder)
Border scale                       → 3-4 border levels (default → subtle → strong → solid)
Surface scale                      → 4-6 surface levels (page → card → raised → overlay → deep)
```

### Open Design's 4-layer token scheme (from `_schema/tokens.schema.ts`)

The **`tokens.css`** file in each design system folder uses a rigorous 4-layer classification:

| Layer | Name | Who decides | If omitted | Examples |
|-------|------|-------------|------------|----------|
| **A1-identity** | Brand identity | Brand author | Guard fails | `--bg`, `--fg`, `--accent`, `--font-display`, `--font-body` |
| **A1-structure** | Structural decisions | Brand author | Guard fails | type scale (`--text-xs`…`--text-4xl`), `--container-max`, `--section-y-*` |
| **A2** | With fallback | Brand author (or derive script) | Guard fails; derive script fills later | `--motion-fast: 150ms`, `--success: #16a34a`, `--space-4: 16px`, `--font-mono` |
| **B-slot** | Tiered depth | Brand author or schema alias | Guard fails; brand must declare (as `var(--sibling)` or independent) | `--fg-2 → var(--fg)`, `--surface-warm → var(--surface)`, `--meta → var(--muted)` |
| **C-extension** | Brand-specific | One brand only | Brand allowlist | `--leading-display` (kami), `--space-20` (default) |

**Key insight:** Artifacts are generated by agents pasting one brand's `:root` block into a single `<style>` element. There is no global cascade. This is why every token must be declared in each `tokens.css` -- missing `var()` targets silently break.

### AgentHub vs. Open Design color comparison

AgentHub uses **OKLCH-first** tokens, which is more sophisticated than most DESIGN.md files:

| Aspect | AgentHub (`tokens.css`) | Open Design (`DESIGN.md`) |
|--------|--------------------------|---------------------------|
| Color space | **OKLCH** (`oklch(0.985 0.002 260)`) | **Hex** (`#FAFAFA`) |
| Hue consistency | Fixed hue 260 (cool blue) across all grays | Brand-specific hex values |
| Chroma control | Zero chroma on grays (`0.002`), rich chroma on accents (`0.24`) | No chroma concept -- flat hex |
| Theme switching | `data-theme` attribute with full light/dark :root blocks | Separate sections or separate DESIGN.md files |
| Surface layering | `--surface-base` → `--surface-raised` → `--surface-overlay` | Implicit in hex values |

---

## 3. Typography System

### Font stack conventions

Most DESIGN.md files specify **3-tier font stacks**:

```
Display/Headings → custom display font (CursorGothic, sohne-var, Anthropic Serif, Geist)
Body/UI         → custom sans or system-ui (Inter, Geist Sans, Anthropic Sans)
Code/Mono       → monospace (Berkeley Mono, SourceCodePro, Geist Mono, SF Mono)
```

Custom fonts are described by name with CSS fallback chains. OpenType features are explicitly called out:

- `"liga"` (ligatures) -- Vercel, mandatory on all Geist text
- `"ss01"`, `"ss03"` (stylistic sets) -- Stripe, Linear
- `"cv01"` (character variant) -- Linear's alternate lowercase 'a'
- `"tnum"` (tabular numbers) -- Stripe for financial data
- `"cswh"` (contextual swash) -- Cursor for serif body text

### Type scale format

All DESIGN.md systems use a **table format** for the type hierarchy:

```
| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
```

Key conventions:
- Sizes shown in both `px` and `rem` (`48px (3.00rem)`)
- Negative letter-spacing at display sizes (Cursor: -2.16px at 72px, Stripe: -1.4px at 56px, Linear: -1.584px at 72px)
- Progressive tracking relaxation as size decreases
- Weight restraint: many systems cap at 600 (Stripe uses 300!, Linear maxes at 590)

### AgentHub typography comparison

AgentHub's typography is simpler and more utilitarian:

| Aspect | AgentHub | Open Design |
|--------|----------|-------------|
| Scale levels | 7 (`2xs` → `2xl`) | 10-22 named roles in table |
| Weights | 3 (400 / 500 / 600) | 2-5 (varies: Stripe uses 300/400, Linear uses 300/400/510/590) |
| OpenType features | Not specified | Explicit `"ss01"`, `"liga"`, `"cv01"`, `"tnum"` |
| Letter-spacing | Not specified per-size | Detailed per-size tracking values |
| Code font | Geist Mono | Varies (Berkeley Mono, SourceCodePro, Geist Mono, SF Mono) |

---

## 4. Component Descriptions

Components in DESIGN.md are described as **prose CSS specifications**, not as code:

### Button specification convention

```
**Primary (Green Border)**
- Background: transparent
- Text: #000000
- Padding: 11px 13px
- Border: 2px solid #76b900
- Radius: 2px
- Font: 16px weight 700
- Hover: background #1eaedb, text #ffffff
- Focus: background #1eaedb, text #ffffff, outline #000000 solid 2px
- Use: Primary CTA ("Learn More", "Explore Solutions")
```

Every DESIGN.md specifies at minimum 4-5 button variants: Primary, Secondary/Ghost, Pill, and sometimes Tertiary/Small/Muted.

### Card specification convention

```
### Cards & Containers
- Background: #ffffff
- Border: 1px solid #e5edf5
- Radius: 6px
- Shadow: rgba(50,50,93,0.25) 0px 30px 45px -30px, rgba(0,0,0,0.1) 0px 18px 36px -18px
- Padding: 16-24px
- Hover: shadow intensification
```

### Distinctive components

Many DESIGN.md files also describe **brand-specific distinctive components**:
- Cursor: AI Timeline (4 colored steps)
- Vercel: Workflow Pipeline (Develop → Preview → Ship)
- Stripe: Pricing Cards, Dashed Borders, Gradient Accents
- Claude: Model Comparison Cards, Organic Illustrations
- GitHub: Status Pills (Open/Closed/Merged/Draft), Labels

---

## 5. Design System Import & Generation

### Project shape

Each design system is a folder under `design-systems/<slug>/` with this structure:

```text
design-systems/<slug>/
├── manifest.json                ← machine-readable project entry (v1)
├── USAGE.md                     ← optional agent-facing package guide
├── DESIGN.md                    ← canonical 9-section design prose for agents
├── tokens.css                   ← canonical compiled CSS custom properties
├── components.html              ← optional standalone component fixture
├── components.manifest.json     ← optional rebuildable component cache
├── assets/                      ← optional brand assets
├── fonts/                       ← optional webfont files
├── preview/                     ← optional static preview pages
└── source/                      ← optional importer evidence and snippets
```

### Manifest format (`manifest.json`)

```json
{
  "schemaVersion": "od-design-system-project/v1",
  "id": "default",
  "name": "Neutral Modern",
  "category": "Starter",
  "description": "A clean, product-oriented default.",
  "source": {
    "type": "bundled",
    "origin": "hand-authored"
  },
  "files": {
    "design": "DESIGN.md",
    "tokens": "tokens.css",
    "components": "components.html"
  }
}
```

### Upstream sources for the 153 bundled systems

| Source | Count | Description |
|--------|-------|-------------|
| **Hand-authored** | 3 | `default`, `warm-editorial`, `atelier-zero` (Open Design starters) |
| **Hand-authored (skill)** | 2 | `kami`, plus `cisco`/`webex` |
| **VoltAgent/awesome-design-md** | 70 | Imported from [`getdesign`](https://www.npmjs.com/package/getdesign) npm package (MIT), powered by the `getdesign@latest` CLI tool. One folder per brand. |
| **bergside/awesome-design-skills** | 57 | Design skills converted to 9-section `DESIGN.md` format |
| **Total** | ~153 | Full bundled catalog |

The upstream npm package is synced via:
```bash
curl -sL $(npm view getdesign dist.tarball) -o /tmp/getdesign.tgz
tar -xzf /tmp/getdesign.tgz -C /tmp
node --experimental-strip-types scripts/sync-design-systems.ts
```

### The `getdesign` import pipeline

The `getdesign` npm package (by VoltAgent) scrapes live production websites and extracts design tokens into 9-section `DESIGN.md` files. It operates as an agent: given a brand URL, it analyzes the CSS, extracts colors/typography/spacing/shadow values, identifies font families and type scales, and synthesizes the narrative "Visual Theme & Atmosphere" section using the extracted values as source data.

Import modes:
- **`normalized`** -- Tokens and styles cleaned up and conforming to Open Design conventions (the default for most bundled systems)
- **`hybrid`** -- Keeps some original structure, partially normalized
- **`verbatim`** -- Exact extraction with minimal transformation (not recommended)

---

## 6. Converting AgentHub's tokens.css to a DESIGN.md

### Step 1: Extract A1-identity tokens

From AgentHub's `tokens.css` + `themes.css`:

```
--bg:              oklch(0.12 0.008 260) dark / oklch(0.985 0.002 260) light
--surface:         oklch(0.16 0.008 260) / oklch(1 0 0)             (card)
--fg:              oklch(0.92 0.005 260) / oklch(0.14 0.005 260)
--accent:          oklch(0.75 0.12 260) / oklch(0.21 0.006 286)    (primary)
--font-display:    "Inter Variable", system-ui sans
--font-body:       "Inter Variable", system-ui sans
--font-mono:       "Geist Mono", ui-monospace
```

### Step 2: Map semantic tokens

```
--success:         oklch(0.65 0.16 150)   → #16a34a-ish green
--warn:            oklch(0.75 0.16 85)    → #eab308-ish amber
--danger:          oklch(0.65 0.22 25)    → #dc2626-ish red
--brand:           oklch(0.55 0.16 255)   → Blue brand accent
--border:          oklch(0.22 0.008 260)  → Dark border
```

### Step 3: Map type scale

```
--text-xs:         0.75rem (12px)         → metadata, badges
--text-sm:         0.875rem (14px)        → default body
--text-base:       1rem (16px)            → page titles
--text-lg:         1.125rem (18px)        → section titles
--text-xl:         1.25rem (20px)         → page titles
--text-2xl:        1.5rem (24px)          → empty state titles
```

### Step 4: Map spacing and radius

```
--space-1: 4px, --space-2: 8px, --space-3: 12px, --space-4: 16px,
--space-5: 20px, --space-6: 24px, --space-8: 32px, --space-12: 48px
--radius-sm: 4px, --radius-md: 6px, --radius-lg: 8px, --radius-pill: 9999px
```

### Step 5: Write the 9 sections

The conversion produces a DESIGN.md structured as:

1. **Visual Theme** -- "Dark-mode-native AI infrastructure hub. Blue-cool palette on near-black canvas. Inter Variable for UI, Geist Mono for code."
2. **Color Palette** -- OKLCH values converted to approximate hex + named roles, light/dark sections
3. **Typography** -- Type scale table with 7 levels, font stacks, OpenType features
4. **Component Stylings** -- Buttons (primary/secondary/ghost/pill), cards, inputs, navigation (sidebar), status badges (run states, authority badges, diff indicators)
5. **Layout** -- 12-col grid, sidebar layout, 280px sidebar, section spacing
6. **Depth & Elevation** -- Shadow scale (sm/md), surface layering (base/raised/overlay), focus ring
7. **Do's and Don'ts** -- AgentHub-specific constraints (OKLCH-only, no hardcoded hex, 7 sizes + 3 weights + zero shadow defaults)
8. **Responsive** -- Breakpoints at 768px and 1024px, sidebar collapse
9. **Agent Prompt Guide** -- Quick color reference, component prompt templates

### Step 6: Generate tokens.css

The result is a standard Open Design `tokens.css` with all A1 and A2 tokens declared, plus AgentHub-specific C-extensions:

```css
:root {
  /* A1-identity */
  --bg: oklch(0.12 0.008 260);
  --fg: oklch(0.92 0.005 260);
  --accent: oklch(0.75 0.12 260);
  --font-display: 'Inter Variable', system-ui, -apple-system, sans-serif;
  --font-body: 'Inter Variable', system-ui, -apple-system, sans-serif;

  /* AgentHub C-extensions */
  --brand: oklch(0.7 0.15 255);
  --authority-hub: oklch(0.7 0.16 250);
  --run-running: oklch(0.65 0.16 150);
  /* ... etc */
}
```

---

## 7. Most Relevant Design Systems for AgentHub

AgentHub is an AI agent management platform with a developer-tool aesthetic, dark-mode-native interface, and blue-cool palette. These 10 design systems from the Open Design catalog are most relevant:

### Tier 1: Directly applicable (AI & Developer Tools)

| # | System | Category | Why It Matters |
|---|--------|----------|----------------|
| 1 | **Linear** | Productivity & SaaS | Dark-mode-native, near-black canvas, Inter Variable with OpenType features, semi-transparent white borders, single accent color. **The closest match to AgentHub's existing visual approach.** |
| 2 | **Cursor** | Developer Tools | Warm off-white alternative with oklab-space borders, sophisticated multi-font system, pill-shaped elements. Demonstrates how developer tools can feel premium without being cold. |
| 3 | **Vercel** | Developer Tools | Shadow-as-border philosophy, Geist font with aggressive negative tracking, multi-layer shadow stacks. The most sophisticated elevation system of any design system. |
| 4 | **Supabase** | Backend & Data | Dark-mode-native, emerald green accents, pill CTAs, HSL-based token system. Closest match to AgentHub's dark-background + accent-color approach. |
| 5 | **GitHub** | Developer Tools | Functional density, 14px body text, Primer design tokens, system fonts. The canonical reference for information-dense developer interfaces. |
| 6 | **Claude** | AI & LLM | Warm parchment canvas, terracotta accent, Anthropic Serif for editorial moments. Shows how AI products can use warmth and human tone instead of cold tech aesthetics. |
| 7 | **OpenAI** | AI & LLM | Clinical restraint, Signifier serif display, soft 8-12px radii everywhere. Demonstrates minimalism for AI product surfaces. |
| 8 | **NVIDIA** | Media & Consumer | Bold weight 700 headings, sharp 2px radius, green-as-signal (not surface). Reference for authority and precision in tech branding. |
| 9 | **Stripe** | Fintech & Crypto | Blue-tinted multi-layer shadows, weight-300 elegance, sohne-var with `"ss01"`. The gold standard for developer-product design sophistication. |
| 10 | **Cohere** | AI & LLM | Vibrant gradients, data-rich dashboard aesthetic. Shows how AI dashboards can balance data density with visual warmth. |

### Tier 2: Design skills to incorporate

| Skill | What to Use |
|-------|------------|
| **Dark mode** | Linear's luminance stacking (`rgba(255,255,255,0.02 → 0.04 → 0.05)`) |
| **Border system** | Vercel's shadow-as-border (`0px 0px 0px 1px rgba(0,0,0,0.08)`) |
| **Pill elements** | Supabase's 9999px CTAs, Cursor's interactive pills |
| **Surface layering** | AgentHub's existing `surface-base → raised → overlay` maps cleanly to Open Design's elevation levels |
| **Code aesthetic** | Vercel's Geist Mono uppercase labels, Supabase's 1.2px letter-spacing |
| **Focus rings** | Open Design's `--focus-ring: 0 0 0 3px color-mix(in oklab, var(--accent), transparent 70%)` |

### How to use them as a resource

1. **Copy the `DESIGN.md`** for any of these 10 systems into AgentHub's design reference, or point the web app at them as the active design system.
2. **Feed a DESIGN.md to your code agent** as part of its system prompt. The agent reads sections 2-9 and applies those rules to generated HTML/CSS.
3. **Extract the `tokens.css`** from systems matching AgentHub's structure (Linear, Supabase, Vercel) and adapt variables to AgentHub's naming conventions.
4. **Mix and match**: take surface layering from Linear, shadow philosophy from Vercel, component styling from Supabase, and typography from Inter Variable (AgentHub's existing stack).
5. **Use as prompt templates**: Section 9 ("Agent Prompt Guide") of each system contains ready-to-paste component prompts that generate consistent UI elements.

---

## 8. Key Design Patterns Observed Across 10+ Systems

### Shadow philosophy spectrum

| Philosophy | Systems | Technique |
|------------|---------|-----------|
| **No shadows (flat)** | GitHub, Supabase | Borders and contrast for depth |
| **Ring shadows** | Vercel, Claude, Cursor | `0px 0px 0px 1px` instead of CSS borders |
| **Blue-tinted shadows** | Stripe | `rgba(50,50,93,0.25)` -- brand-colored elevation |
| **Atmospheric diffused** | Cursor | 28px+ blur, 70px blur for atmospheric lift |
| **Luminance stacking** | Linear | `rgba(255,255,255,0.02 → 0.04 → 0.05)` on dark |
| **Conservative drops** | OpenAI, NVIDIA | Minimal, functional shadows only |

### Border radius philosophy spectrum

| Philosophy | Systems | Values |
|------------|---------|--------|
| **Sharp engineering** | NVIDIA, GitHub | 1-6px, no pills on primary elements |
| **Comfortable round** | Most systems | 8px buttons, 12px cards |
| **Pill-heavy** | Supabase, Cursor | 9999px on CTAs, tags, badges |
| **Mixed: pills for badges, 8px for cards** | Linear, Vercel, Stripe | Role-based radius |

### Typography philosophy spectrum

| Philosophy | Systems | Characteristics |
|------------|---------|----------------|
| **Restrained weight** | Stripe (300), OpenAI (400-600), Linear (400-590) | Light weight as luxury/confidence |
| **Bold authority** | NVIDIA (700) | Bold as the default voice |
| **Aggressive compression** | Vercel (-2.88px), Cursor (-2.16px), Linear (-1.584px) | Negative tracking at display sizes |
| **System fonts only** | GitHub | No web fonts, instant rendering |
| **Three-font system** | Cursor, Claude, Vercel | Display + Body + Mono, each with distinct voice |

### AgentHub positioning on these spectrums

- **Shadows**: Currently minimal (sm/md). Maps to Linear's luminance stacking approach.
- **Border radius**: Current ~6px standard, matches Stripe/GitHub territory. Less aggressive than Cursor/Supabase pill-heavy approach.
- **Typography**: Inter Variable at 7 levels + 3 weights. Closer to Linear's restraint than NVIDIA's boldness.
- **Colors**: OKLCH with fixed hue 260. More systematic than hex-based DESIGN.md files. ALREADY ahead of the Open Design ecosystem in color science.

---

## Appendix: Quick Reference -- Complete 9-Section Template

```markdown
# Design System Name

> Category: Group Name
> One-line description.

## 1. Visual Theme & Atmosphere
[Narrative prose: mood, material feeling, key differentiators, 5-10 bullet characteristics]

## 2. Color Palette & Roles
### Primary
- **Role** (`#hex`): Description, `--token-name`.
### Accent
### Semantic
### Neutral Scale
### Surface & Border
### Shadows

## 3. Typography Rules
### Font Family
- Display: `FontName`, fallback
- Body: `FontName`, fallback
- Mono: `FontName`, fallback
### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
### Principles

## 4. Component Stylings
### Buttons (Primary / Secondary / Ghost / Pill / Small)
### Cards & Containers
### Inputs & Forms
### Navigation
### (Optional) Distinctive Components

## 5. Layout Principles
### Spacing System
### Grid & Container
### Whitespace Philosophy
### Border Radius Scale

## 6. Depth & Elevation
| Level | Treatment | Use |
### Shadow Philosophy

## 7. Do's and Don'ts (or Interaction & Motion)
### Do
### Don't

## 8. Responsive Behavior
### Breakpoints
### Touch Targets
### Collapsing Strategy

## 9. Agent Prompt Guide
### Quick Color Reference
### Example Component Prompts
### Iteration Guide
```
