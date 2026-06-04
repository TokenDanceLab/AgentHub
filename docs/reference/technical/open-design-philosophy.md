# open-design Philosophy & Patterns

> Source: `reference/open-design/` — Local-first design workspace with agent-driven generation
> Author: Researcher 2 — open-design Philosophy & Patterns
> Date: 2026-05-25

---

## 1. Executive Summary

Open Design (OD) is an open-source local-first design workspace where projects contain generated design files and agent conversations. Its core philosophy is **"an integration shell that refuses to own the agent, the model, or the skill catalog"** — everything is external and pluggable.

**Key takeaway for AgentHub**: OD's philosophy of being agent-agnostic, file-based, and skill-driven is directly applicable to AgentHub. The DESIGN.md schema for codifying design systems, the 4-mode workflow pattern, and the agent adapter architecture are all patterns AgentHub should learn from.

---

## 2. Core Design Philosophy

### 2.1 Five Core Bets

OD's differentiation is built on 5 strategic bets:

| # | Bet | Meaning for AgentHub |
|---|-----|---------------------|
| 1 | Web app + local daemon, not cloud-only | AgentHub Desktop = Tauri local-first; keep this |
| 2 | User's own agent CLI, not proprietary | AgentHub already does this — continue |
| 3 | File-based skills (SKILL.md), not baked-in code | AgentHub should adopt SKILL.md pattern for skills |
| 4 | DESIGN.md files for design systems | AgentHub should adopt DESIGN.md for themes |
| 5 | Drop a folder to extend, not custom PRs | AgentHub plugin/skill system should be folder-based |

### 2.2 Product in One Sentence

> "A web app that turns natural-language briefs into editable, previewable design artifacts by orchestrating the code agent already installed on the user's machine."

For AgentHub, this translates to: **"A desktop app that orchestrates code agents already installed on the user's machine to accomplish tasks, with a design system that makes the experience feel premium."**

### 2.3 Guiding Principles

1. **Agent-agnostic**: Don't marry a specific CLI or model. The adapter pattern ensures portability.
2. **File-first**: Everything is files on disk — skills, design systems, artifacts. Git-friendly, forkable.
3. **Composable**: Skills compose. Design systems compose. Templates compose. Nothing is monolithic.
4. **Local-first**: The daemon runs locally. Keys stay local. No cloud dependency.
5. **Extensible by convention**: Drop a folder, follow the schema, it works. No registration, no config files.

---

## 3. Design System Architecture

### 3.1 DESIGN.md — The 9-Section Schema

OD's design system format is a Markdown file with 9 sections:

```
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings (buttons, cards, inputs, etc.)
5. Spacing & Layout
6. Iconography
7. Animation & Motion
8. Imagery & Illustration
9. Design Principles & Constraints
```

### 3.2 Design System Catalog

OD bundles an extraordinary catalog of design systems:

- **3 hand-authored starters**: default, warm-editorial, atelier-zero
- **57 design skills** from awesome-design-skills
- **72 product design systems** from awesome-design-md (one per brand: Claude, Cursor, OpenAI, Stripe, Linear, Vercel, etc.)

Each is a self-contained `DESIGN.md` with full color palettes, typography hierarchies, component specifications, and design principles. Together they form a design reference library of unprecedented breadth.

### 3.3 Design System Project Shape

```
design-systems/<slug>/
├── manifest.json       ← machine-readable project entry
├── DESIGN.md           ← canonical design prose for agents
├── tokens.css          ← compiled CSS custom properties
├── components.html     ← optional standalone component fixture
├── assets/             ← optional brand assets
├── fonts/              ← optional webfont files
└── preview/            ← optional static preview pages
```

**For AgentHub**: This is the template for how AgentHub should package its design system. A single `DESIGN.md` describing the system, a `tokens.css` with all CSS variables, and optional component fixtures.

---

## 4. Workflow Modes

OD defines 4 distinct modes, each with unique UI affordances:

### 4.1 Prototype Mode
- **Purpose**: One high-fidelity screen or flow
- **Time**: ~60-120s
- **UI**: Chat + streaming tool calls + iframe preview + comment mode + export
- **Lesson for AgentHub**: The "chat + live preview + refinement" loop is ideal for agent coding tasks. AgentHub should show results (diffs, file changes, test output) alongside the chat.

### 4.2 Deck Mode
- **Purpose**: Multi-slide presentations
- **Time**: ~90-180s
- **UI**: Chat + deck navigation overlay + per-slide refinement
- **Lesson for AgentHub**: Multi-output modes are a pattern. AgentHub could have "code mode" and "review mode" with different layouts.

### 4.3 Template Mode
- **Purpose**: Fast-start from pre-built templates
- **Time**: ~20-40s
- **UI**: Gallery picker → fill content → generate
- **Lesson for AgentHub**: Template mode = project scaffolding. AgentHub should let users start from templates (React app, Node API, etc.).

### 4.4 Design System Mode
- **Purpose**: Create/extract a DESIGN.md from a brand guide
- **Time**: ~60-180s
- **UI**: Upload source → agent generates DESIGN.md → preview
- **Lesson for AgentHub**: System configuration via agent conversation. "Set up my preferences" as a conversation.

---

## 5. AI Agent UX Patterns

### 5.1 Streaming & Real-Time Feedback

```
User prompt
    ↓
[Streaming tool calls visible in real-time]
    ↓
[Artifact tree updates as files are written]
    ↓
[Preview iframe hot-reloads on file changes]
    ↓
[Refinement via chat, comment, or sliders]
```

**For AgentHub**: The key insight is **multi-channel feedback**. The user sees:
1. The agent's thinking (streaming text)
2. The agent's actions (tool calls)
3. The agent's results (changed files, test output)
4. The live preview (running app, rendered output)

### 5.2 Multi-Panel Layouts

OD's architecture diagram shows a sophisticated multi-panel layout:

```
┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐
│ chat pane│  │ artifact  │  │ preview   │  │ comment/     │
│          │  │ tree      │  │ iframe    │  │ slider       │
└──────────┘  └───────────┘  └───────────┘  └──────────────┘
      │             │               │               │
      └───────── session bus (in-memory) ────────────┘
```

**For AgentHub**: The current 3-panel layout (sidebar + chat + right panel) maps well. Consider adding a "live preview" pane for web projects.

### 5.3 Refinement Surfaces

OD provides three refinement surfaces, each for different precision levels:
1. **Chat**: Free-text "change the layout" — broad, creative
2. **Comment mode**: Click an element → "make this card use the secondary color" — precise, surgical
3. **Parameter sliders**: Live tweak of design parameters — instant, non-verbal

**For AgentHub**: The equivalent for code:
1. **Chat**: "Fix the bug in auth.ts" — broad request
2. **Inline suggestion**: Click a diff → "use early return here" — precise
3. **Quick actions**: Predefined buttons for common operations (format, lint, test)

### 5.4 Chat vs Workbench Modes

OD separates "conversation about design" from "working on the design":
- **Chat mode**: Full conversation thread, message history, branch/remix
- **Workbench mode**: Artifact tree, preview, inspectors, export tools

**For AgentHub**: The current viewMode toggle (`agent` vs `im`) is a primitive version of this. Consider separate layouts for:
- **Chat mode**: Full-height conversation
- **Code mode**: Split view with chat on left, code diff/preview on right
- **Review mode**: PR-like diff view with inline comments

---

## 6. State Handling Patterns

### 6.1 Empty States

OD's design is purposeful about emptiness:
- **No agent detected**: Guide to install one, with one-click installers
- **No DESIGN.md**: Offer to create one from a template or screenshot
- **No skills**: Show skill gallery with one-click install
- **No projects**: Show template gallery as entry point

**For AgentHub**: Empty states should be **actionable**, not just informative:
- No agents → "Install Claude Code" button
- No threads → Suggested prompts
- No runs → Quick start template
- Settings not configured → Guided setup wizard

### 6.2 Loading States

OD uses streaming as its primary loading pattern — rather than spinners, the user sees:
- Tool calls stream in real-time
- Files appear in the tree as they're created
- Preview updates incrementally

**For AgentHub**: Replace spinners with streaming progress where possible. Show:
- Agent boot progress (loading model, initializing tools)
- Run progress (tool calls completed / total expected)
- File generation progress (N files created)

### 6.3 Error States

OD's error handling is mode-specific:

| Mode | Error | Recovery |
|------|-------|----------|
| Prototype | Missing DESIGN.md | Offer to create one |
| Deck | slides.json missing | Fall back to page-capture export |
| All | Agent timeout | Partial artifact preserved + "resume" or "regenerate" |
| All | Preview render failure | Show raw code with error annotation |

**For AgentHub**: Error states should preserve partial work and offer clear recovery paths:
- Run failed → Show completed tool calls, offer "retry from last step"
- Connection lost → Auto-reconnect, show offline indicator
- Permission denied → Explain why, offer to grant permission

### 6.4 Progressive Disclosure

OD reveals complexity progressively:
1. **Home**: Simple prompt card with chip rail (intent chips)
2. **Generation**: Tool calls appear, artifact tree populates
3. **Refinement**: Comment mode, sliders, export options become available
4. **Advanced**: Skill editing, design system authoring, automations

**For AgentHub**:
1. **Welcome**: Simple prompt + agent selector
2. **Active run**: Tool calls, output, changed files appear
3. **Post-run**: Export, share, create skill from run
4. **Settings**: Progressive — basic → advanced → developer

---

## 7. Design Tokens Prescribed

### 7.1 The DESIGN.md Format

Every design system in OD follows a strict format. Here is the schema AgentHub should adopt:

```markdown
# Design System Name

> Category: Group Name
> One-line description of the aesthetic.

## 1. Visual Theme & Atmosphere
Mood, emotional keywords, key characteristics.

## 2. Color Palette & Roles
- Primary, Secondary, Accent colors
- Surface/Background scale
- Semantic colors (error, success, warning)
- Border colors
- Shadow system

## 3. Typography Rules
- Font families (headline, body, code)
- Type scale (sizes, weights, line-heights, letter-spacing)
- Principles

## 4. Component Stylings
- Buttons (primary, secondary, ghost, icon)
- Cards, inputs, selects, toggles
- Tooltips, popovers, dialogs
- States: hover, focus, active, disabled, loading

## 5. Spacing & Layout
- Base unit
- Spacing scale
- Breakpoints
- Grid/layout system

## 6. Iconography
- Icon library
- Sizes
- Style (outline, filled, dual-tone)

## 7. Animation & Motion
- Duration tokens
- Easing curves
- Entry/exit animations
- State transitions

## 8. Imagery & Illustration
- Illustration style
- Image treatment
- Brand marks

## 9. Design Principles & Constraints
- Core principles
- Anti-patterns
- Accessibility requirements
```

### 7.2 Example: Claude Design System Token Extract

From the Claude design system in OD's catalog:
- **Canvas**: Warm parchment `#f5f4ed`
- **Primary text**: Anthropic Near Black `#141413`
- **Brand accent**: Terracotta `#c96442`
- **Body font**: Anthropic Sans (system-ui fallback)
- **Headline font**: Anthropic Serif (Georgia fallback)
- **Code font**: Anthropic Mono
- **Body line-height**: 1.60 (book-like reading)
- **Heading line-height**: 1.10-1.30 (tight but breathable)

### 7.3 Example: Cursor Design System Token Extract

From the Cursor design system in OD's catalog:
- **Canvas**: Warm cream `#f2f1ed`
- **Primary text**: Warm near-black `#26251e`
- **Brand accent**: Cursor Orange `#f54e00`
- **Display font**: CursorGothic (compressed, negative letter-spacing)
- **Body font**: jjannon serif with contextual swash alternates
- **Code font**: berkeleyMono
- **Border system**: oklab() color space at alpha levels (0.1, 0.2, 0.55)
- **Base spacing**: 8px with fine-grained sub-8px increments

---

## 8. What AgentHub Should Adopt from open-design

### P0 (Immediate)
1. **DESIGN.md format** — Create `DESIGN.md` for AgentHub's own design system
2. **9-section schema** — Codify all design decisions in one canonical file
3. **Agent-agnostic philosophy** — Continue supporting multiple agent CLIs equally
4. **File-based extensibility** — Skills, themes, templates as folders on disk

### P1 (This week)
5. **Mode-based layouts** — Separate layouts for chat, code review, task management
6. **Multi-channel feedback** — Show thinking, actions, results simultaneously
7. **Refinement surfaces** — Chat, quick actions, and inline feedback
8. **Progressive disclosure** — Simple entry, reveal complexity as needed
9. **Actionable empty states** — Every empty state has a clear next action

### P2 (Later)
10. **Comment mode** — Click on code/diff to leave precise feedback
11. **Parameter sliders** — Quick UI controls for common agent parameters
12. **Design system mode** — Agent-driven theme/configuration generation
13. **Template gallery** — Pre-built project starters for common use cases

---

## 9. Architecture Lessons

### 9.1 Daemon Pattern

OD's architecture separates concerns cleanly:
- **Web UI**: Stateless rendering, UX concerns only
- **Daemon**: Long-running local process, manages state, spawns agents
- **Agent Adapters**: One per CLI, isolated, testable

**For AgentHub**: Tauri's Rust backend is AgentHub's equivalent of the daemon. Keep the Rust backend focused on:
- Process management (spawn CLI agents)
- File system operations
- IPC with renderer
- No UI logic in Rust

### 9.2 Contract Layer

OD uses `packages/contracts` as a pure TypeScript package with shared types between web and daemon.

**For AgentHub**: The `@shared/types` package serves this role. Ensure all IPC types, API DTOs, and event shapes live here and nowhere else.

### 9.3 Transport Layer

OD supports three topologies (local, Vercel+daemon, Vercel+direct API) sharing the same web bundle.

**For AgentHub**: Consider similar multi-topology support:
- **Local only** (current): Tauri desktop app
- **Web + local daemon**: Browser UI with local backend
- **Web only**: Browser UI with cloud API proxy (for quick demos)

---

## 10. Design System Catalog — Key References for AgentHub

From OD's 72 bundled design systems, these are most relevant:

| System | Why Relevant |
|--------|-------------|
| **claude** | AI assistant desktop — warm, editorial, serif typography |
| **cursor** | AI code editor — warm minimalism, gothic display, oklab borders |
| **openai** | AI platform — clean, modern, professional |
| **vercel** | Developer platform — geometric, dark, performance-focused |
| **linear-app** | Project management — minimal, fast, keyboard-driven |
| **raycast** | Launcher — command palette, quick actions, search-first |
| **warp** | Terminal — modern, GPU-accelerated, developer aesthetic |
| **stripe** | Developer payments — professional, trustworthy, clean |

AgentHub's design should synthesize the **"premium developer tool"** aesthetic shared by Cursor, Linear, and Raycast — warm, minimal, fast, keyboard-driven — with the **"AI assistant"** warmth of Claude and the **"professional platform"** polish of Vercel/Stripe.
