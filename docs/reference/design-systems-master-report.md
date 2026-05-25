# AgentHub Desktop — Design Systems Master Report

> Synthesized from 4 parallel research tracks
> Date: 2026-05-25
> Status: Complete

---

## Executive Answer

**"Given aionui's design system, open-design's philosophy, LobeHub's icon library, and modern AI desktop patterns — what should AgentHub Desktop look and feel like?"**

AgentHub Desktop should feel like a **premium AI development workspace** — warm, minimal, fast, and keyboard-driven. It should sit at the intersection of Cursor's developer polish and Claude Desktop's AI-native warmth. The design system should be codified in a `tokens.css` file with semantic CSS variables, icons should use a hybrid of lucide-react (general UI) + @lobehub/icons (AI-specific), and the UX should follow the "multi-channel feedback" pattern: show thinking, actions, and results simultaneously.

---

## 1. Design Principles for AgentHub Desktop

Derived from all four research tracks, these are the 7 principles that should guide every design decision:

### Principle 1: Agent-Agnostic, Visually Distinct
Every agent (Claude, Codex, Gemini, etc.) should be visually distinguishable. Use LobeHub's ProviderIcon and ModelIcon to give each agent and model a unique visual identity. Never show a generic "Bot" icon when a specific provider icon is available.

### Principle 2: Semantic Tokens Only
All colors, spacing, typography, and roundness must be defined as semantic CSS custom properties. No hardcoded values in components. This enables theme switching, brand customization, and design consistency.

**Source**: aionui's `uno.config.ts` semantic color system + open-design's DESIGN.md 9-section schema.

### Principle 3: Multi-Channel Feedback
Users must see three things simultaneously during agent execution:
1. **Thinking** (streaming text, reasoning — collapsible)
2. **Actions** (tool calls — status-indicated, expandable)
3. **Results** (changed files, diff output, test results)

**Source**: open-design's "chat + artifact tree + preview iframe" pattern + modern AI desktop patterns.

### Principle 4: Progressive Disclosure
Start simple, reveal complexity as needed. Welcome screen → chat → tool calls → file changes → settings → advanced configuration.

**Source**: open-design's mode system + Cursor/Claude Desktop onboarding.

### Principle 5: Keyboard-First, Mouse-Friendly
Every action should have a keyboard shortcut. The command palette (Ctrl+K) should be the fastest path to any feature. But everything should also be clickable.

**Source**: Cursor/VS Code/Raycast command palette patterns + aionui keyboard shortcut system.

### Principle 6: Warm, Not Cold
Use warm-toned neutrals, not pure grays. Aim for the "premium paper" feel of Claude Desktop and Cursor's website — warm off-white backgrounds, warm near-black text, organic border colors.

**Source**: Claude and Cursor design systems from open-design catalog.

### Principle 7: File-Based Everything
Skills, themes, agent configurations, and design tokens should all be files on disk. Follow open-design's philosophy: drop a folder, follow the schema, it works. No hidden config, no opaque databases for user-facing configuration.

**Source**: open-design's file-based skill/design-system architecture.

---

## 2. Design Token Architecture

### 2.1 Color System

Based on aionui's proven semantic token pattern, enhanced with warm-toned values inspired by Claude and Cursor:

```css
/* tokens.css — AgentHub Design Tokens */

:root {
  /* === Background Scale (0-10) === */
  --bg-base: #fafaf8;       /* Main page background — warm off-white */
  --bg-1: #f3f3f0;          /* Secondary surface */
  --bg-2: #ebebe8;          /* Tertiary surface */
  --bg-3: #e0e0dc;          /* Border / divider */
  --bg-4: #d4d4d0;
  --bg-5: #c5c5c0;
  --bg-6: #a0a09a;          /* Disabled / tertiary text */
  --bg-8: #6b6b65;
  --bg-9: #3d3d38;
  --bg-10: #1a1a16;
  --bg-hover: #efefeb;      /* Hover background */
  --bg-active: #e0e0dc;     /* Active/pressed background */

  /* === Text Colors === */
  --text-primary: #1a1a16;     /* Primary body text */
  --text-secondary: #6b6b65;   /* Secondary/meta text */
  --text-tertiary: #a0a09a;    /* Disabled/hint text */
  --text-disabled: #d4d4d0;    /* Disabled text */

  /* === Semantic Colors === */
  --primary: #3b6ef5;       /* Brand primary — blue */
  --primary-hover: #5b8af7;
  --success: #1a8a4a;
  --warning: #e08a20;
  --danger: #d94040;
  --info: #3b6ef5;

  /* === Border Colors === */
  --border-base: #e0e0dc;
  --border-light: #ebebe8;
  --border-strong: #c5c5c0;

  /* === Brand Colors === */
  --brand: #5b6ef5;            /* AgentHub brand blue */
  --brand-light: #eef0ff;      /* Brand tint background */
  --brand-hover: #7b8ef7;

  /* === Component-Specific === */
  --message-user-bg: #eef0ff;
  --message-agent-bg: transparent;
  --message-system-bg: #f3f3f0;
  --tool-card-bg: #f8f8f5;
  --tool-card-border: #e0e0dc;
  --sidebar-bg: #f3f3f0;
  --input-bg: #ffffff;
  --code-bg: #f3f3f0;

  /* === Shadows === */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);

  /* === Radius === */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* === Spacing (4px base) === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* === Typography === */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace;
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-base: 14px;
  --font-size-md: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 22px;
  --font-size-2xl: 28px;
  --line-height-tight: 1.25;
  --line-height-base: 1.5;
  --line-height-relaxed: 1.7;

  /* === Animation === */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* === Layout === */
  --titlebar-height: 36px;
  --sidebar-min-width: 248px;
  --sidebar-max-width: 520px;
  --right-panel-min-width: 272px;
  --right-panel-max-width: 560px;
}

/* Dark mode */
[data-theme='dark'] {
  --bg-base: #0e0e0c;
  --bg-1: #1a1a18;
  --bg-2: #262624;
  --bg-3: #333330;
  --bg-4: #40403c;
  --bg-5: #4d4d48;
  --bg-6: #6b6b65;
  --bg-8: #a0a09a;
  --bg-9: #c5c5c0;
  --bg-10: #e0e0dc;
  --bg-hover: #262624;
  --bg-active: #333330;

  --text-primary: #e0e0dc;
  --text-secondary: #a0a09a;
  --text-tertiary: #6b6b65;
  --text-disabled: #40403c;

  --border-base: #333330;
  --border-light: #262624;
  --border-strong: #4d4d48;

  --message-user-bg: #1a2040;
  --tool-card-bg: #1a1a18;
  --tool-card-border: #333330;
  --sidebar-bg: #0e0e0c;
  --input-bg: #1a1a18;
  --code-bg: #1a1a18;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.4);
}
```

### 2.2 Typography Scale

```css
/* Type Scale */
.text-display { font-size: var(--font-size-2xl); line-height: var(--line-height-tight); font-weight: 600; }
.text-heading { font-size: var(--font-size-xl); line-height: var(--line-height-tight); font-weight: 600; }
.text-subheading { font-size: var(--font-size-lg); line-height: var(--line-height-tight); font-weight: 500; }
.text-body-lg { font-size: var(--font-size-md); line-height: var(--line-height-base); }
.text-body { font-size: var(--font-size-base); line-height: var(--line-height-base); }
.text-body-sm { font-size: var(--font-size-sm); line-height: var(--line-height-base); }
.text-caption { font-size: var(--font-size-xs); line-height: var(--line-height-base); }
.text-code { font-family: var(--font-mono); font-size: var(--font-size-sm); line-height: var(--line-height-relaxed); }
```

---

## 3. Prioritized Action Plan

### BATCH 1 — Foundation (This Week, P0)

These changes establish the visual foundation. They touch the most files but are mechanical (search-and-replace patterns).

#### 1.1 Create Design Token File
**File**: `app/desktop/src/styles/tokens.css`
**Action**: Create the CSS custom properties file shown in Section 2 above.
**Dependencies**: None.
**Validation**: Open app in light and dark mode, verify all colors resolve correctly.

#### 1.2 Install @lobehub/icons
**File**: `app/desktop/package.json`
**Action**: `pnpm add @lobehub/icons`
**Dependencies**: None.
**Validation**: Import `ModelIcon` and `ProviderIcon`, render without errors.

#### 1.3 Add Model/Provider Icons to Settings
**Files**: `app/desktop/src/components/SettingsPage.tsx`
**Action**: Replace generic model/provider text in dropdowns with `ModelIcon` and `ProviderIcon` components.
**Specific changes**:
- Models section (lines 1255-1296): Add `ModelIcon` next to each model option
- Model Mapping section (lines 1298-1329): Add `ProviderIcon` next to each provider
- ccSwitch section (lines 1331-1360): Add `ProviderIcon` next to each provider
**Dependencies**: 1.2.

#### 1.4 Replace Emoji Tool Icons with SVG Icons
**File**: `app/desktop/src/components/ChatView.tsx` (lines 25-36)
**Action**: Replace the `TOOL_ICONS` Record<string, string> with proper lucide-react SVG components.
**Specific mapping**:
- Read → `FileText`
- Write/Edit → `Pencil`
- Bash → `Terminal`
- Grep → `Search`
- Glob → `FolderOpen`
- WebFetch/WebSearch → `Globe`
- Task → `Bot`
- TodoWrite → `CheckSquare`
**Dependencies**: None.

#### 1.5 Redesign Tool Call Cards
**File**: `app/desktop/src/components/ChatView.tsx` (tool call rendering section)
**Action**: Enhance tool call cards with:
- Status indicator (spinner/check/X)
- Elapsed time display
- Color coding (running=amber, success=green, error=red)
- Better expand/collapse UX
**Dependencies**: 1.4.

#### 1.6 Add Thinking Block Auto-Collapse
**File**: `app/desktop/src/components/ChatView.tsx` (ThinkingBlock component, lines 96+)
**Action**: Add auto-collapse behavior — thinking block starts expanded, auto-collapses when actual response text begins streaming.
**Dependencies**: None.

### BATCH 2 — Polish (Next Week, P1)

#### 2.1 Command Palette (Ctrl+K)
**New file**: `app/desktop/src/components/CommandPalette.tsx`
**Action**: Create Cmd+K command palette with:
- Search across agents, threads, settings sections
- Quick actions (new thread, toggle theme, open settings)
- Keyboard shortcut display
**Dependencies**: None.

#### 2.2 @-File Mention in Chat Input
**Files**: Prompt input component (slot-based, need to locate exact file)
**Action**: Add @-mention support that searches the workspace file tree and injects file context.
**Dependencies**: Need file tree data from Rust backend.

#### 2.3 Keyboard Shortcut Expansion
**File**: `app/desktop/src/App.tsx` (useEffect around line 415)
**Action**: Add standard AI desktop shortcuts:
- `Ctrl/Cmd+K` → Open command palette
- `Ctrl/Cmd+L` → New thread
- `Ctrl/Cmd+,` → Open settings
**Dependencies**: 2.1 for Cmd+K.

#### 2.4 Mode Toggles Near Input
**Files**: Prompt input component
**Action**: Add quick toggles near the chat input for:
- Reasoning effort (low/medium/high/max)
- Auto-review (on/off)
- Web access (on/off)
**Dependencies**: None.

#### 2.5 Settings Search
**File**: `app/desktop/src/components/SettingsPage.tsx`
**Action**: Add search input that filters sidebar nav items by name.
**Dependencies**: None.

#### 2.6 Apply tokens.css to Existing Components
**Files**: All `.module.css` files under `app/desktop/src/`
**Action**: Replace hardcoded color values with `var(--token-name)` references.
**Specific files** (highest impact first):
- `App.module.css` — Shell colors, sidebar, top bar
- `SettingsPage.module.css` — Panel colors, card colors
- `ChatView.module.css` — Message bubbles, tool cards, code blocks
- `WelcomeScreen.module.css` — Launcher panel, mode pills
- `AgentList.module.css` — List items, status badges
**Dependencies**: 1.1.

### BATCH 3 — Premium Feel (This Month, P2)

#### 3.1 Typography System
**Files**: `app/desktop/index.html` or global CSS
**Action**: Import Inter and JetBrains Mono fonts, apply font stack to body.
**Dependencies**: None.

#### 3.2 Micro-Interaction System
**Files**: CSS modules and component files
**Action**: Add consistent hover/press/focus transitions:
- Buttons: scale(0.98) on press, background transition on hover
- Cards: subtle shadow lift on hover
- Messages: fade-in on arrival
- Tool calls: slide-down expand animation
**Dependencies**: 1.1 (animation tokens).

#### 3.3 Color Warmth Migration
**Files**: `tokens.css`
**Action**: Shift from pure grays to warm-toned neutrals as specified in Section 2.1.
**Dependencies**: 1.1.

#### 3.4 Empty State Illustrations
**Files**: `EmptyState.tsx`, `WelcomeScreen.tsx`
**Action**: Replace or enhance empty state text with simple SVG illustrations.
**Dependencies**: Design assets from TokenDance brand team.

#### 3.5 File Tree in Sidebar
**New files**: `app/desktop/src/components/FileTree.tsx`
**Action**: Add collapsible file tree section to left sidebar.
**Dependencies**: File system data from Tauri backend.

---

## 4. Component-by-Component Migration Map

### 4.1 WelcomeScreen.tsx
**Current state**: 16 lucide-react icons, CSS Modules, hardcoded colors.
**Target state**: Consistent with design tokens, model/provider icons where applicable.
**Changes**:
| Line(s) | Change | Priority |
|---------|--------|----------|
| 17-19 | Add `ProviderIcon` import | P0 |
| 114 | Replace `Sparkles` with brand icon | P1 |
| 128 | `Cpu` → keep | — |
| 137 | `Bot` → `ProviderIcon` based on agent runtime | P0 |
| 146 | `Route` → keep | — |
| 250 | `Braces` → keep | — |
| All icons | Standardize to 15px inline, 18px display | P0 |
| CSS | Replace hardcoded colors with var() references | P1 |

### 4.2 SettingsPage.tsx
**Current state**: 35+ lucide-react icons, comprehensive sidebar nav, well-structured.
**Target state**: Add model/provider icons, settings search, keyboard shortcut completeness.
**Changes**:
| Line(s) | Change | Priority |
|---------|--------|----------|
| Top | Add `ModelIcon`, `ProviderIcon` imports | P0 |
| 1256-1295 | Add model icons to model select options | P0 |
| 1300-1328 | Add provider icons to mapping rows | P0 |
| 1341-1357 | Add provider icons to ccSwitch provider rows | P0 |
| 439-457 | Add search input above nav | P1 |
| 1400-1405 | Environment section: add platform-specific icons | P2 |

### 4.3 ChatView.tsx
**Current state**: 5 lucide-react icons, emoji tool icons, basic thinking block.
**Target state**: SVG tool icons, enhanced tool cards, auto-collapse thinking, streaming polish.
**Changes**:
| Line(s) | Change | Priority |
|---------|--------|----------|
| 25-36 | Replace emoji tool icons with lucide-react components | P0 |
| Tool card rendering | Add status indicator, elapsed time, color coding | P0 |
| 96+ | Auto-collapse thinking when response starts | P0 |
| 4 | Keep lucide-react: Copy, RefreshCw, Trash2, ArrowDown | — |

### 4.4 App.tsx
**Current state**: 20+ lucide-react icons, solid shell layout.
**Target state**: Add command palette trigger, keyboard shortcuts, use design tokens.
**Changes**:
| Line(s) | Change | Priority |
|---------|--------|----------|
| 415-448 | Add Ctrl+K, Ctrl+L, Ctrl+, shortcuts | P1 |
| New | Add CommandPalette component rendering | P1 |
| CSS | Replace hardcoded sidebar/panel colors with tokens | P1 |

### 4.5 AgentList.tsx
**Current state**: Generic `Bot` icons for all agents.
**Target state**: Provider-specific icons based on agent type.
**Changes**:
| Change | Priority |
|--------|----------|
| Import `ProviderIcon` from @lobehub/icons | P0 |
| Map agent ID to provider key | P0 |
| Show `ProviderIcon` instead of `Bot` | P0 |

---

## 5. Icon Migration Summary

### Files that need @lobehub/icons:
1. **SettingsPage.tsx** — Model select, provider mapping, ccSwitch providers
2. **AgentList.tsx** — Agent list items
3. **WelcomeScreen.tsx** — Agent runtime selector
4. **ModelDropdown.tsx** — Model picker
5. **ThreadPanel.tsx** — Thread agent indicators (future)

### Files that keep lucide-react only:
- **App.tsx** — Window controls, navigation, status
- **ChatView.tsx** — Message actions, scroll control
- **All form components** — Inputs, toggles, selects
- **NotificationBell.tsx** — Bell icon
- **SearchDialog.tsx** — Search icon

### New custom icons needed:
- **TokenDance brand icon** — For cloud/hub indicators (custom SVG)
- **AgentHub app icon** — For titlebar and about dialog (custom SVG)

---

## 6. References

### Documents Produced by This Research
1. [aionui Design System Deep Dive](./aionui-design-system.md)
2. [open-design Philosophy & Patterns](./open-design-philosophy.md)
3. [LobeHub Icons Full Audit & Migration Guide](./lobehub-icon-audit.md)
4. [Modern AI Desktop App UX Patterns](./ai-desktop-ux-patterns.md)

### External References
- aionui: `reference/aionui/` — Electron + React AI chat desktop app
- open-design: `reference/open-design/` — Local-first design workspace
  - `design-systems/` — 72 brand design systems in DESIGN.md format
  - `docs/architecture.md` — System topology and component diagram
  - `docs/modes.md` — 4 workflow modes (Prototype, Deck, Template, Design System)
  - `docs/spec.md` — Product specification and core bets
- LobeHub: `reference/lobehub/` — Multi-agent AI platform
  - `@lobehub/icons` v5.x — AI model/provider icon library
  - `src/components/ModelSelect/` — Reference implementation of icon usage
- AgentHub Desktop: `app/desktop/src/` — Current codebase
  - `App.tsx` — App shell with 3-panel layout
  - `SettingsPage.tsx` — Comprehensive settings with 30+ sections
  - `ChatView.tsx` — Chat message display with tool calls
  - `WelcomeScreen.tsx` — Onboarding/launcher screen

### Design Systems Referenced
- Claude (Anthropic): Warm parchment, terracotta accent, serif typography
- Cursor: Warm cream, compressed gothic, oklab borders, jjannon serif
- Linear: Minimal, fast, keyboard-driven
- Raycast: Command palette, quick actions
- aionui (AOU Purple): Semantic token system, 3-tier color architecture

---

## 7. Success Metrics

After implementing this plan, AgentHub Desktop should:

1. **Look cohesive**: Every component uses design tokens, no hardcoded colors
2. **Feel AI-native**: Model/provider icons everywhere agents/models appear
3. **Be fast to navigate**: Command palette (Ctrl+K) reaches anywhere in < 2 keystrokes
4. **Show intelligence**: Tool calls with status/duration, thinking display with auto-collapse
5. **Scale gracefully**: Dark mode works flawlessly, responsive to window sizes
6. **Feel premium**: Warm-toned neutrals, smooth transitions, generous spacing

---

*This report was synthesized from 4 parallel research tracks analyzing aionui, open-design, LobeHub icons, and modern AI desktop app UX patterns. All referenced code is in the TokenDance AgentHub repository.*
