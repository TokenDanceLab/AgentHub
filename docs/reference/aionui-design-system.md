# aionui Design System — Deep Dive

> Source: `reference/aionui/` — Electron + React desktop AI chat interface
> Version analyzed: 1.9.25
> Author: Researcher 1 — aionui Design System Deep Dive
> Date: 2026-05-25

---

## 1. Executive Summary

aionui is a production-grade Electron desktop app that transforms CLI AI agents (Claude Code, Codex, etc.) into a modern chat interface. It is the closest architectural sibling to AgentHub Desktop — both are Electron + React apps that wrap AI agent CLIs. aionui's design system is mature, coherent, and battle-tested. Much of it can be directly adapted for AgentHub.

**Key takeaway for AgentHub**: aionui demonstrates that a clean, semantic token system plus a well-chosen component library (Arco Design) plus UnoCSS utility classes is the winning formula for AI desktop UI. AgentHub should adopt this pattern, swapping Arco for a lighter alternative if bundle size is a concern.

---

## 2. Technology Stack

| Layer | aionui | AgentHub Desktop | Recommendation |
|-------|--------|------------------|----------------|
| Desktop shell | Electron + electron-vite | Tauri 2 | Keep Tauri (smaller, faster) |
| UI framework | React 19 | React 19 | Same — good |
| Component library | @arco-design/web-react | Custom + lucide-react | Adopt Arco or shadcn/ui |
| CSS approach | UnoCSS + CSS Modules | CSS Modules only | Adopt UnoCSS utility classes |
| Icons | @icon-park/react | lucide-react | Migrate to LobeHub icons + lucide-react |
| State management | Zustand | Zustand | Same — good |
| Testing | Vitest 4 | Vitest | Same — good |
| Linting | oxlint + oxfmt | — | Adopt oxlint |
| Package manager | Bun | pnpm | Keep pnpm (Tauri compat) |

---

## 3. Component Library

### 3.1 Component Hierarchy

```
src/renderer/components/
├── agent/        # Agent-specific UI
├── base/         # Primitives (Button, Input, Modal, etc.)
├── chat/         # Chat-specific components
│   ├── AtFileMenu/
│   └── BtwOverlay/
├── layout/       # App shell layout
│   ├── Sider/    # Sidebar
│   └── Titlebar/ # Custom titlebar
├── Markdown/     # Markdown rendering
├── media/        # Media/file display
├── settings/     # Settings pages
└── workspace/    # Workbench/code views
```

### 3.2 Key Components AgentHub Should Adopt

| aionui Component | Purpose | Priority for AgentHub |
|-----------------|---------|----------------------|
| `Sider` | Collapsible sidebar with agent/task tabs | P0 — replace current sidebar |
| `Titlebar` | Custom frameless titlebar with window controls | P0 — already have; enhance |
| `Markdown` | Streaming markdown renderer with code blocks | P0 — enhance current MarkdownRenderer |
| `AtFileMenu` | @-file mention popup in chat input | P1 — new feature |
| `chat/*` | Message bubbles, tool call cards, thinking display | P0 — redesign ChatView |
| `settings/*` | Settings panel with nav + content layout | P0 — SettingsPage already good |
| `workspace/*` | File tree, diff viewer, terminal | P1 — enhance DiffViewer |

---

## 4. Design Tokens System

### 4.1 Semantic Color Architecture

aionui uses a **3-tier semantic color system** via CSS custom properties, consumed through UnoCSS utility classes:

#### Text Colors
```
text-t-primary   → var(--text-primary)    # Main body text
text-t-secondary → var(--text-secondary)  # Secondary/meta text
text-t-tertiary  → var(--bg-6)            # Disabled/hint text
text-t-disabled  → var(--text-disabled)   # Disabled text
```

#### Background Scale (numeric, 0-10)
```
bg-base  → var(--bg-base)   # Main background (white/dark)
bg-1     → var(--bg-1)      # Secondary surface
bg-2     → var(--bg-2)      # Tertiary surface
bg-3     → var(--bg-3)      # Border/divider color
bg-4..10 → progressively darker/lighter
bg-hover → var(--bg-hover)   # Hover state
bg-active → var(--bg-active) # Active/pressed state
```

#### Semantic State Colors
```
primary  → var(--primary)   # Brand primary (blue #165dff)
success  → var(--success)   # Green
warning  → var(--warning)   # Orange
danger   → var(--danger)    # Red
info     → var(--info)      # Blue
```

#### Border Colors
```
border-b-base  → var(--border-base)   # Standard border
border-b-light → var(--border-light)  # Subtle border
border-b-1..3  → mapped to bg-3..5
```

#### Component-Specific Tokens
```
--message-user-bg    # User message bubble background
--message-tips-bg    # System tip/info message background
--workspace-btn-bg   # Workspace toolbar button background
```

#### Brand Colors (AOU Purple theme)
```
--brand       → #7583b2  (muted blue-purple)
--brand-light → #eff0f6  (very light, near-white purple)
--brand-hover → #b5bcd6  (medium purple hover)
```

### 4.2 Dark/Light Theme

aionui supports a complete dark mode via `[data-theme='dark']` on `[data-color-scheme='default']`:

**Light mode key values:**
- bg-base: `#ffffff`, bg-1: `#f9fafb`, bg-2: `#f2f3f5`
- text-primary: `#1d2129`, text-secondary: `#86909c`
- border-base: `#e5e6eb`

**Dark mode key values:**
- bg-base: `#0e0e0e`, bg-1: `#1a1a1a`, bg-2: `#262626`
- text-primary: `#d9d9d9` (inverse of light bg-10)
- border-base: `#333333`

The AOU brand colors invert in dark mode (10 becomes 1, 9 becomes 2, etc.), creating a smart "scale flip" approach rather than simple inversion.

### 4.3 Spacing & Layout Tokens

```css
--app-min-width: 360px;
--titlebar-height: 36px;
```

UnoCSS provides utility-based spacing. No formal spacing scale documented — uses UnoCSS defaults (4px base unit).

### 4.4 Typography

Arco Design provides the typography system. No custom font stack; uses system fonts:
- System UI font stack for body/UI
- Monospace for code (SF Mono / Cascadia / Fira Code)

### 4.5 Roundness

Arco Design defaults (moderate rounding ~6-8px). No custom roundness tokens exposed.

---

## 5. Theme System Architecture

### 5.1 File Structure

```
src/renderer/styles/
├── themes/
│   ├── base.css                  # Theme-independent base styles
│   ├── default-color-scheme.css  # AOU Purple light + dark tokens
│   └── index.css                 # Theme entry point
├── arco-override.css             # Arco component overrides
└── layout.css                    # App shell layout
```

### 5.2 How It Works

1. CSS custom properties defined in `default-color-scheme.css` under `:root` (light) and `[data-color-scheme='default'][data-theme='dark']` (dark)
2. UnoCSS references these via `var()` in `uno.config.ts` semantic color definitions
3. Components use UnoCSS classes like `bg-1`, `text-t-primary`, `border-b-base`
4. Complex component styles use CSS Modules with `var()` references
5. No runtime theme calculation — pure CSS variable swap when `data-theme` attribute changes

### 5.3 What AgentHub Should Adopt

1. **Semantic token naming**: `--bg-base`, `--bg-1..10`, `--text-primary/secondary`, `--border-base`
2. **Scale-flip dark mode**: Instead of computing dark values separately, mirror the scale
3. **CSS-variable-only theming**: No JS theme objects, no CSS-in-JS runtime
4. **Component-specific tokens**: `--message-user-bg`, `--message-tips-bg` style tokens for specialized surfaces

---

## 6. Layout Patterns

### 6.1 App Shell

aionui uses a 3-panel layout:
- **Left sidebar** (Sider): Agent list, task tabs, collapsible
- **Center** (main): Chat area with message list + input
- **Right panel** (optional): Task details, file diff, tool output

### 6.2 Sidebar (Sider)

Features:
- Agent/team selector at top
- Collapsible to icon rail (32-48px)
- Resizable (drag handle)
- Task/tab bar at bottom

### 6.3 Chat Layout

- Messages scroll vertically with virtual scrolling
- User messages: right-aligned, colored background
- Agent messages: left-aligned, with agent avatar
- Tool calls: collapsible cards within agent messages
- Thinking/streaming: animated dots or streaming text
- Input area: pinned to bottom with @-file mention support

### 6.4 Settings Layout

- Sidebar navigation (categories → sections)
- Content area with panels/cards
- Consistent card pattern for settings groups
- Toggle switches, select dropdowns, text inputs

### 6.5 Responsive Breakpoints

Minimal responsive support (desktop-first). Mobile has a breakpoint at 767px. No tablet-specific layout. This is appropriate for AgentHub Desktop too — desktop-first is the right call.

---

## 7. AI Chat UI Patterns

### 7.1 Message Display

- Messages rendered in a virtual list (react-virtuoso or custom)
- Auto-scroll to bottom on new messages
- User messages: right-aligned bubble with `--message-user-bg` background
- Agent messages: left-aligned with agent name/avatar, markdown body
- System messages: centered, muted style

### 7.2 Tool Call Display

Tool calls rendered inline within agent messages:
- **Collapsible card** with tool name, status icon, and summary
- Expand to see full input/output
- Status indicators: pending (spinner), running (animated), completed (check), failed (X)
- Color-coded: running = blue, success = green, error = red

### 7.3 Code Blocks

- Syntax highlighting (likely via Shiki or Prism)
- Copy button on hover
- Language label in top-right
- Proper monospace font
- Line numbers optional

### 7.4 Streaming / Thinking Display

- Animated dots for "thinking" state
- Streaming text character-by-character or chunk-by-chunk
- Cursor indicator at end of streaming text
- Smooth fade-in for completed blocks

### 7.5 File Tree / Diff

- File tree: collapsible folders, file icons, indent guides
- Diff viewer: side-by-side or unified, with color-coded additions/deletions
- File change summary (N files changed)

---

## 8. Interaction Patterns

### 8.1 Keyboard Shortcuts

aionui has an extensive keyboard shortcut system:
- Global shortcuts via `useHotkeys` hook
- Command palette (Ctrl+K / Cmd+K)
- Settings pages include keyboard customization

### 8.2 Drag & Resize

- Sidebar resizable via drag handle
- Right panel resizable via drag handle
- Resize handles have keyboard alternatives (arrow keys)

### 8.3 Context Menus

- Right-click on messages: copy, retry, delete
- Right-click on files: open, reveal in finder, copy path
- Right-click on agents: settings, disable

### 8.4 Toast Notifications

- Success/error/info/warning toast types
- Stack from top-right or bottom-right
- Auto-dismiss with configurable duration
- Action buttons on toasts (undo, retry)

### 8.5 Command Palette

- Ctrl+K / Cmd+K to open
- Search agents, settings, recent threads
- Quick actions: new thread, toggle theme, etc.

---

## 9. Code Conventions (from AGENTS.md)

### File Structure
- Max 10 children per directory (files + subdirectories)
- Components: PascalCase
- Utilities: camelCase
- Hooks: camelCase with `use` prefix
- CSS: kebab-case or `ComponentName.module.css`

### CSS Rules
- Prefer UnoCSS utility classes
- Complex styles use CSS Modules
- Colors must use semantic tokens only
- No hardcoded color values
- Arco overrides in component CSS Module via `:global()`

### TypeScript
- Strict mode (no `any`, no implicit returns)
- Path aliases: `@/*`, `@process/*`, `@renderer/*`, `@worker/*`
- Prefer `type` over `interface`

---

## 10. What AgentHub Should Copy from aionui

### P0 (Immediate)
1. **Semantic color token system** — the `--bg-1..10`, `--text-primary/secondary`, `--border-base` pattern
2. **UnoCSS integration** — utility classes referencing CSS variables
3. **Dark/light theme via data attributes** — pure CSS, no JS runtime
4. **Tool call display cards** — collapsible, status-indicated, color-coded
5. **Settings page layout** — sidebar nav + content panels pattern (already partially adopted)

### P1 (This week)
6. **Command palette** — Ctrl+K global search/action
7. **Keyboard shortcut system** — `useHotkeys` hook
8. **Resizable panels** — drag handles with keyboard alternatives
9. **Toast notification system** — typed toasts with actions (already partially adopted)
10. **Context menus** — right-click actions on messages/files

### P2 (Later)
11. **@-file mention** in chat input — context injection
12. **Custom titlebar** — frameless with window controls (already partially adopted)
13. **Agent profile cards** — consistent agent display across the app

---

## 11. What AgentHub Should Do Differently

1. **Component library**: Use shadcn/ui instead of Arco Design — lighter, more customizable, better Tauri compat
2. **Icons**: Use LobeHub icons for AI-specific icons + lucide-react for general UI (see LobeHub audit)
3. **Typography**: Define an actual typography scale (aionui relies on Arco defaults)
4. **Roundness**: Expose roundness tokens (aionui has none)
5. **Spacing scale**: Define explicit 4px-based spacing scale
6. **Animation tokens**: Define duration/easing tokens for consistent motion
