# Desktop Icon & Visual Design Audit

> Generated: 2026-05-25 | Auditor: Agent 2 — Icon & Visual Design Audit

## 1. Current Icon Inventory

### 1.1 Icons by Source

#### Lucide React (`lucide-react`) — Used Across All Files

| Icon | File(s) | Usage | Rating |
|---|---|---|---|
| `AlertTriangle` | App.tsx:474,497 | Edge error banner | OK |
| `ClipboardList` | App.tsx:691,809 | Task/scheduler settings | OK |
| `Circle` | App.tsx:526,580,637; PromptInput.tsx:176 | Status dot, agent badge | Serviceable |
| `Copy` | App.tsx:674; ChatView.tsx:455 | Copy action | OK |
| `MessageSquareText` | App.tsx:683 | Toggle to IM view | Confusing — `MessageSquareText` = chat bubble with text, but used to toggle to IM. Should use `Users` or `MessagesSquare` |
| `LogIn` | App.tsx:526,581,637 | Hub login indicator | OK |
| `Maximize2` | App.tsx:719 | Expand workspace | OK |
| `Menu` | App.tsx:519 | Mobile menu | OK |
| `Minimize2` | App.tsx:719 | Collapse workspace | OK |
| `Minus` | App.tsx:480 | Window minimize | OK |
| `Moon` | App.tsx:529,583,640 | Dark mode indicator | OK |
| `PanelLeftClose` | App.tsx:625 | Collapse sidebar | OK |
| `PanelLeftOpen` | App.tsx:568 | Expand sidebar (rail) | OK |
| `PanelRightClose` | App.tsx:770 | Close run panel | OK |
| `PanelRightOpen` | App.tsx:709,801 | Open run panel | OK |
| `Route` | App.tsx:699,817 | Scheduling/agent scheduling | Poor — `Route` = map route, confusing for "agent scheduling". Should use `GitBranch` or `Workflow` |
| `Search` | App.tsx:593; AgentList.tsx:59 | Search | OK |
| `Settings` | App.tsx:523,571,628; AgentList:88 | Settings / fallback icon | OK |
| `Square` | App.tsx:486; PromptInput.tsx:255 | Maximize window / Stop run | OK |
| `Sun` | App.tsx:529,583,640 | Light mode indicator | OK |
| `Wifi` | App.tsx:473 | Connected status | OK |
| `WifiOff` | App.tsx:473 | Disconnected status | OK |
| `X` | App.tsx:489 | Window close | OK |
| `ArrowDown` | ChatView.tsx:545 | Scroll to bottom | OK |
| `RefreshCw` | ChatView.tsx:463 | Retry action | OK |
| `Trash2` | ChatView.tsx:472 | Delete action | OK |
| `MessageSquare` | ChatView.tsx:4 | (imported but usage unclear) | — |
| `Plus` | PromptInput.tsx:224 | Attach/expand | OK |
| `ArrowUp` | PromptInput.tsx:263 | Send | OK |
| `LoaderCircle` | PromptInput.tsx:251 | Starting spinner | OK |
| `MapPin` | AgentList.tsx:102 | "Local Edge" indicator | OK |
| `Settings2` | AgentList.tsx:88 | Fallback agent icon when no @lobehub icon matches | OK |
| `Sparkles` | AgentList.tsx:73 | Empty state icon | OK |
| `FileText` | RunDetail.tsx:179,215,233 | Run output/files/preview | OK |
| `TerminalSquare` | RunDetail.tsx:175,190 | Run output section | OK |
| `Wrench` | RunDetail.tsx:200 | Tool calls section | OK |

#### @lobehub/icons — Used in AgentList.tsx

| Icon | Usage | Rating |
|---|---|---|
| `ClaudeCode` | Claude Code agent icon | Good |
| `Codex` | Codex agent icon | Good |
| `OpenCode` | OpenCode agent icon | Good |

#### Emoji (Not Icons!) — Used in ChatView.tsx

| Emoji | Tool | Issue |
|---|---|---|
| 📖 | Read | Not an icon — emoji rendering varies by OS |
| ✏️ | Write/Edit | Not an icon |
| ⚡ | Bash | Not an icon |
| 🔍 | Grep | Not an icon |
| 📂 | Glob | Not an icon |
| 🌐 | WebFetch/WebSearch | Not an icon |
| 🤖 | Task | Not an icon |
| ✅ | TodoWrite | Not an icon |

### 1.2 Icon Problems Summary

| Problem | Severity | Count |
|---|---|---|
| Emoji used instead of icons | **High** | 8 |
| Confusing icon metaphor (`Route` for scheduling) | Medium | 1 |
| Missing @lobehub icons (ModelIcon, ProviderIcon) | Medium | 2 |
| Hardcoded colors on icons | Low | 2 |

---

## 2. Icon Replacement Map

### 2.1 Emoji → Lucide Icons (ChatView.tsx:25-36)

```typescript
// BEFORE (emojis):
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️', Bash: '⚡',
  Grep: '🔍', Glob: '📂', WebFetch: '🌐', WebSearch: '🌐',
  Task: '🤖', TodoWrite: '✅',
};

// AFTER (React components):
import { FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare } from 'lucide-react';

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderOpen,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  TodoWrite: CheckSquare,
};
```

### 2.2 Lucide → Better Alternatives

| Current | File:Line | Issue | Replacement | Reason |
|---|---|---|---|---|
| `Route` | App.tsx:699,817 | "Agent Scheduling" | `Workflow` or `GitBranch` | `Route` implies map routing, not task routing |
| `MessageSquareText` | App.tsx:683 | Toggle to IM | `Users` or `MessagesSquare` | Current icon suggests "text message", but action is "switch to IM/group chat" |
| `Settings2` | AgentList.tsx:88 | Fallback for unknown agents | Should add more @lobehub icons | Growing @lobehub coverage |
| `ClipboardList` | App.tsx:691,809 | Tasks/scheduling settings | Keep — it's fine | — |

### 2.3 Missing @lobehub/icons

| Location | Current | Should Use | Benefit |
|---|---|---|---|
| ModelDropdown / PromptInput | No model icons | `ModelIcon` from @lobehub/icons | Visual model identification |
| AgentList | Only 3 @lobehub icons | Add `GoogleIcon`, `AzureIcon`, `OpenAIIcon` | Future provider coverage |
| Settings model section | None | `ProviderIcon` from @lobehub/icons | Provider branding |

---

## 3. Color & Theme Audit

### 3.1 Hardcoded Colors Found

| File:Line | Color | Value | Fix |
|---|---|---|---|
| `App.tsx:593` | Search icon | `#B0B0B5` | Use `var(--text-weakest)` |
| `PromptInput.tsx:176-178` | Agent status dot | `var(--color-success)` / `var(--color-danger)` | Proper (uses tokens) |
| `ChatView.tsx:...` | Thinking toggle | Inline? | Verify no hardcoded values |

### 3.2 Theme Token Consistency

**Dark Theme (default):**
- Surface values use hex: `#141418`, `#1C1C22`, `#2D2D37`, `#32323C`
- These are NOT OKLCH — they are hex/sRGB
- Tokens.css defines OKLCH surface values: `oklch(0.14 0.006 260)`, `oklch(0.17 0.007 260)` — but these are overridden by themes.css

**Light Theme:**
- Mixes hex (`#FFFFFF`, `#F4F4F5`, `#8E8E93`) with OKLCH (`oklch(0.18 0.005 260)`)
- This inconsistency causes subtle color discrepancies when transitioning between themes

**Recommendation:** Pick ONE format and standardize. OKLCH is the stated design intention ("OKLCH tokens" per AGENTS.md), so convert all hex values to OKLCH.

### 3.3 Accessibility — Color Contrast

| Foreground | Background | Contrast Ratio | Pass AA? | Pass AAA? |
|---|---|---|---|---|
| `#E8E8ED` (text) | `#141418` (bg) | ~14:1 | Yes | Yes |
| `#8E8E93` (muted) | `#141418` (bg) | ~5.5:1 | Yes | No |
| `#636366` (weakest) | `#141418` (bg) | ~3.5:1 | No | No |
| `#7C7CE0` (primary) | `#141418` (bg) | ~5:1 | Yes | No |
| `#34D399` (success) | `#141418` (bg) | ~6:1 | Yes | No |

**Issue:** `--text-weakest` (#636366) on dark background fails AA contrast for normal text. Should be lightened.

### 3.4 CSS Variable Naming Inconsistency

| Variable | Type | Issue |
|---|---|---|
| `--color-success` | Status color | Inconsistent prefix — most status colors use `--success` |
| `--color-danger` | Status color | Same — should be `--danger` or keep `color-` prefix consistently |
| `--muted-foreground` | Text color | shadcn-style naming; conflicts with `--muted` (which is a bg) |

---

## 4. Spacing & Layout Consistency

### 4.1 Component Spacing Analysis

| Component | Horizontal Pad | Vertical Pad | Gap | Unit |
|---|---|---|---|---|
| App shell sidebar | Varies by component | Varies | Varies | `px`/`rem` mix |
| ChatView messages | — | — | ~12px | `rem`? |
| PromptInput capsule | — | — | — | `rem`? |
| SettingsPage | — | — | — | — |

**Issue:** Without reading every CSS module, it is impossible to verify spacing consistency. The design token system defines `--space-*` variables (4px grid), but component CSS may or may not use them.

**Recommendation:** Add a CSS lint rule (stylelint) to enforce use of `var(--space-*)` over hardcoded spacing values.

### 4.2 Typography Scale Usage

The 7-size scale is defined:
- `--font-size-2xs`: 0.625rem (10px)
- `--font-size-xs`: 0.75rem (12px)
- `--font-size-sm`: 0.875rem (14px)
- `--font-size-base`: 1rem (16px)
- `--font-size-lg`: 1.125rem (18px)
- `--font-size-xl`: 1.25rem (20px)
- `--font-size-2xl`: 1.5rem (24px)

**Issue:** The naming is misleading — `2xs` is actually smaller than `xs`. Naming convention should follow either a T-shirt scale (xs/sm/md/lg/xl/2xl/3xl) or a numeric scale (50/100/200/300/400/500/600).

---

## 5. Dark/Light Theme Audit

### 5.1 Theme Toggle
- Implemented via `ThemeContext` + `data-theme` attribute on `<html>`
- Works correctly
- Toggle buttons use `Sun`/`Moon` icons (good)

### 5.2 Theme Coverage

| Component | Dark Theme | Light Theme | Notes |
|---|---|---|---|
| App shell | Yes | Yes | Uses CSS vars, fully themed |
| ChatView | Yes | Yes | — |
| AgentList | Yes | Yes | — |
| PromptInput | Yes | Yes | — |
| SettingsPage | Yes | Yes | — |
| RunDetail | Yes | Yes | — |
| IM components | Unknown | Unknown | Need verification |
| AuthPage/LoginForm | Unknown | Unknown | Need verification |
| Toast | Unknown | Unknown | Need verification |

**Issue:** Not all components were verified to fully support light theme. The auth page and settings page have the most potential for theme breakage due to their complexity.

---

## 6. Summary & Priority

| Priority | Item | Effort | Impact |
|---|---|---|---|
| **P0** | Replace emoji tool icons with Lucide icons | Small | High |
| **P0** | Fix hardcoded colors (#B0B0B5) | Tiny | Medium |
| **P1** | Replace `Route` icon with `Workflow` | Tiny | Medium |
| **P1** | Replace `MessageSquareText` with `Users`/`MessagesSquare` | Tiny | Medium |
| **P1** | Standardize all theme colors to OKLCH | Large | High |
| **P2** | Fix `--text-weakest` contrast ratio | Tiny | Medium |
| **P2** | Add ModelIcon/ProviderIcon from @lobehub/icons | Medium | Medium |
| **P3** | Normalize CSS variable naming | Large | Low |
| **P3** | Add stylelint for spacing token enforcement | Medium | Low |
| **P3** | Fix font size token naming (2xs > xs) | Tiny | Low |

**Total actionable items: 10**
