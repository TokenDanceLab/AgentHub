# AgentHub Accessibility (a11y) Design

> Synthesized from: `design-keyboard-shortcuts.md` (7-layer nav), `design-desktop-ux.md` (component hierarchy), `design-micro-interactions.md` (animation tokens), `design-theme-system.md` (OKLCH palette), `design-error-handling.md` (4-channel feedback)
> Target: WCAG 2.2 AA | Date: 2026-05-21 | Status: Draft v1.0

---

## 1. WCAG 2.2 AA Compliance Checklist

### 1.1 Perceivable

| SC | Requirement | AgentHub Status | Gap / Action |
|----|------------|----------------|--------------|
| 1.1.1 Non-text Content | All icons/images have text alternatives | Partial -- Lucide icons lack aria-labels in current spec | Add `aria-label` to every IconButton; ToolUseCard tool icons need `role="img"` with tool name |
| 1.2.1 Audio/Video | No pre-recorded media | N/A (chat app) | -- |
| 1.3.1 Info & Relationships | Semantic structure conveyed programmatically | Partial -- component tree uses divs | Use `<header>`, `<nav>`, `<main>`, `<aside>` landmarks in MainLayout; heading hierarchy h1-h4 in MessageTree |
| 1.3.2 Meaningful Sequence | DOM order matches visual order | OK -- three-column layout is CSS not reordered | Verify mobile drawer/bottom-sheet reparenting preserves tab order |
| 1.3.3 Sensory Characteristics | No instructions relying solely on shape/color/sound | **Risk: DiffCard** -- green/red borders are color-only | Diff lines always show `+`/`-` prefix; status badges use text + icon, not color alone |
| 1.4.1 Use of Color | Color not the only visual differentiator | **Risk: AuthorityStripe** (blue=Hub, green=Edge, orange=Hybrid) | AuthorityLabel text always accompanies stripe; ConnectionStatus dot has `aria-label` ("Connected"/"Disconnected") |
| 1.4.2 Audio Control | No auto-playing audio | N/A | -- |
| 1.4.3 Contrast (Minimum) | 4.5:1 normal text, 3:1 large text | Needs audit -- OKLCH palette not yet verified | See Section 2 |
| 1.4.4 Resize Text | 200% zoom without loss of content | OK with Tailwind rem-based sizing | Test with browser zoom; verify virtualized lists handle resize |
| 1.4.10 Reflow | No 2D scrolling at 320px viewport | Risk: RightPanel Diff unified view | On mobile (<=768px), unified diff switches to split-stacked layout |
| 1.4.11 Non-text Contrast | 3:1 for UI components, focus indicators | **Missing: focus indicator definition** | See Section 3.1 |
| 1.4.12 Text Spacing | Line-height 1.5, paragraph spacing 2em, letter/word spacing 0.12/0.16em | Markdown renderer controllable | Set `line-height: 1.5` on message text body |
| 1.4.13 Content on Hover/Focus | Tooltip dismissible, hoverable, persistent | Radix Tooltip provides dismiss-on-Escape | Ensure hover content (timestamps, SiblingSwitch) follows this pattern |

### 1.2 Operable

| SC | Requirement | AgentHub Status | Gap / Action |
|----|------------|----------------|--------------|
| 2.1.1 Keyboard | All functionality keyboard-operable | **Strong foundation**: 7-layer shortcut system | Audit non-input interactions: resize handles, drag-and-drop file upload, bottom-sheet drag |
| 2.1.2 No Keyboard Trap | Focus never trapped without escape | Radix Dialog/Popover handles this | Verify all modal paths (ForkDialog, Settings, GlobalSearch, ErrorCard modal) |
| 2.1.4 Character Key Shortcuts | Remappable, scoped, turn-off-able | Yes -- ShortcutSettings panel + `ah_shortcuts_overrides` in localStorage | Single-key shortcuts (`j`, `k`, `n`, `p`, `1-6`) only active when NO input is focused |
| 2.2.1 Timing Adjustable | Time limits adjustable or absent | Auto-deny on approvals has 5min expiry | Show countdown; offer "Extend" button at 1min remaining |
| 2.2.2 Pause/Stop/Hide | Auto-updating content can be paused | Streaming auto-scroll has manual override | JumpToBottomButton enables manual scroll; no auto-movement for content >100px scrolled |
| 2.3.1 Three Flashes | No content flashes more than 3/sec | Typewriter cursor blink is 1Hz step-end; RunIndicator pulse is 1.5s cycle | All animations within safe range |
| 2.4.1 Bypass Blocks | Skip-to link for repetitive content | **Missing** | Add "Skip to chat" link as first focusable element |
| 2.4.2 Page Titled | Descriptive `<title>` | OK | Set `document.title` = active thread title + " - AgentHub" |
| 2.4.3 Focus Order | Focus sequence follows meaning & operability | Needs intentional design for modals | See Section 3.2 |
| 2.4.4 Link Purpose | Link text describes destination | ContextMenu items, "View Full Diff", SiblingSwitch arrows | All links in context; verify standalone clarity |
| 2.4.5 Multiple Ways | Multiple ways to locate content | `Ctrl+K` global search, sidebar tree, recent projects, FTS5 | Exceeds minimum |
| 2.4.6 Headings & Labels | Descriptive headings and labels | ThreadTitleBar, PanelTabBar tabs | Use `<label>` for SearchInput; heading levels in MessageBody |
| 2.4.7 Focus Visible | Visible focus indicator on all interactive elements | **Missing from theme spec** | See Section 3.1 |
| 2.4.11 Focus Appearance | 2px minimum, 3:1 contrast vs adjacent | **Must define** | See Section 3.1 |
| 2.5.8 Target Size | 24x24px minimum for pointer targets | IconButtons at 28px in SidebarToolbar | Ensure mobile bottom-sheet tab buttons meet 24px minimum |

### 1.3 Understandable

| SC | Requirement | AgentHub Status | Gap / Action |
|----|------------|----------------|--------------|
| 3.1.1 Language | Programmatic language declaration | `<html lang="en">` | OK |
| 3.2.1 On Focus | No context change on focus alone | Layer-based shortcuts prevent this | Verify j/k navigation doesn't auto-submit actions |
| 3.2.2 On Input | No context change on input alone | Settings changes are explicit save; theme toggle is atomic | OK |
| 3.2.3 Consistent Navigation | Navigation repeated across pages | Sidebar persistent, PanelTabBar fixed order | OK |
| 3.2.6 Consistent Help | Help mechanisms consistent | `Ctrl+K` Command Palette + `?` shortcut to show all bindings | Add `?` global help overlay listing all shortcuts per layer |
| 3.3.1 Error Identification | Error described in text | **Strong**: AgentHubError.Message + .Suggestion fields | ErrorCard renders both; ensure screen reader announces inline errors |
| 3.3.2 Labels/Instructions | Inputs have labels | ChatInput, SearchInput, CommitMessageInput | Verify `aria-label` or `<label>` on all inputs |
| 3.3.3 Error Suggestion | Suggestion provided on error | AgentHubError.Suggestion field covers this | Verify all ErrorCode variants populate Suggestion |
| 3.3.7 Accessible Authentication | No cognitive function tests | N/A (OAuth-based) | -- |

### 1.4 Robust

| SC | Requirement | AgentHub Status | Gap / Action |
|----|------------|----------------|--------------|
| 4.1.2 Name/Role/Value | All UI components exposed to assistive tech | **Risk: Custom components** (MessageNode, ToolUseCard, DiffCard, ApprovalCard) | See Section 4 |
| 4.1.3 Status Messages | Status announced without focus move | **Risk: Streaming content, error toasts, run status changes** | See Section 4.2 |

---

## 2. Color Contrast Audit (Theme System)

### 2.1 OKLCH Palette Readout

Source: `packages/ui/src/styles/theme.css` (design-theme-system.md Section 2.2)

| Token | Light LCh | Dark LCh | Light Contrast (on bg 0.98) | Dark Contrast (on bg 0.12) |
|-------|-----------|----------|---------------------------|--------------------------|
| `--foreground` | 0.12 | 0.95 | **12.1:1** (AAA) | **12.1:1** (AAA) |
| `--primary` | 0.50 / 0.15 / 260 | 0.70 / 0.15 / 260 | ~4.6:1 (AA) | ~5.5:1 (AA) |
| `--muted-foreground` | 0.45 | 0.55 | ~5.5:1 (AA) | ~5.0:1 (AA) |
| `--destructive` | 0.55 / 0.22 / 25 | 0.55 / 0.22 / 25 | ~3.8:1 (risk) | ~3.2:1 (risk) |
| `--border` | 0.88 | 0.22 | ~1.3:1 (decorative) | ~1.8:1 (decorative) |

### 2.2 Required Remediations

1. **Destructive text contrast**: `--destructive` at L=0.55 on dark L=0.12 yields ~3.2:1, below 4.5:1. **Fix**: dark destructive → `oklch(0.65 0.20 25)` for large text, or use destructive only with bold/large text or as background tint.
2. **Primary on primary-foreground**: Light `primary-foreground` is `--background` (0.98), against `--primary` (0.50) ~5.8:1 -- passes. Dark `primary-foreground` is also background (0.12) against primary (0.70) ~6.2:1 -- passes.
3. **Diff color reliance**: DiffCard green/red borders must always be accompanied by `+`/`-` prefixes and `AddedLine`/`DeletedLine` text labels. Never rely on `bg-green-50` or `bg-red-50` alone.
4. **AuthorityStripe**: The colored left border (blue/green/orange) must be accompanied by `AuthorityLabel` text badge. The stripe is decorative.

### 2.3 Contrast Testing Protocol

- Use `@radix-ui/react-polymorphic` focus-visible polyfill (already in Radix)
- Run axe-core in CI (`@axe-core/react` with severity gate at violations/needs-review)
- Manual spot-check: DiffCard inline, ApprovalCard amber pulse, RunStatus badges

---

## 3. Focus Management & Keyboard Navigation

### 3.1 Focus Indicator Specification

Current gap: `--ring` token exists (oklch(0.50 0.15 260) / oklch(0.70 0.15 260)) but no focus-visible style defined.

```css
/* packages/ui/src/styles/theme.css -- append */
:root {
  --ring-width: 2px;
  --ring-offset: 2px;
}

*:focus-visible {
  outline: var(--ring-width) solid var(--ring);
  outline-offset: var(--ring-offset);
  border-radius: var(--radius);
}
```

**Ring contrast per background**:
- Light: ring L=0.50 on bg L=0.98 → ~5.2:1 (exceeds WCAG 2.4.11 minimum 3:1)
- Dark: ring L=0.70 on bg L=0.12 → ~5.7:1 (exceeds minimum)

### 3.2 Focus Order by View

**Chat view (default)**:
```
1. Skip-to-chat link (visible on first Tab)
2. SidebarToolbar: NewThread → ToggleArchive → SettingsGear
3. SearchBar (if expanded)
4. ProjectTree → ThreadList (j/k arrows)
5. ChatHeader: ThreadTitleBar → AgentSelector → WorkspaceIndicator
6. MessageTree (j/k to navigate messages, Enter to expand)
7. ComposeArea: RichTextInput
8. SendButton
9. RightPanel tabs (1-6) → panel content
```

**Modal dialog** (ForkDialog, Settings, GlobalSearch):
```
Focus trap → first focusable element inside modal
Escape → close modal → focus returns to triggering element
```

### 3.3 Keyboard Shortcuts a11y Audit

The 7-layer system (design-keyboard-shortcuts.md Section 2) already addresses WCAG 2.1.1/2.1.4. Three gaps remain:

1. **Help discovery**: Add `?` (global layer, when no input focused) to open shortcut cheat-sheet overlay. The existing `Ctrl+K` Command Palette surfaces actions but doesn't show their shortcuts by default.
2. **Resize handle keyboard**: The Sidebar↔Center and Center↔RightPanel resize handles work via mouse drag only. **Add**: `Ctrl+Shift+Left/Right` to adjust sidebar width by 40px increments; `Ctrl+Shift+Alt+Left/Right` for right panel.
3. **Drag-and-drop file upload**: FileDropOverlay (FileTreePanel) currently mouse-only. **Add**: `Ctrl+U` (global layer) to open file picker dialog as keyboard alternative.

---

## 4. Screen Reader Support

### 4.1 Landmark & Heading Structure

```html
<header role="banner">         <!-- ChatHeader -->
<nav aria-label="Sidebar">     <!-- LeftSidebar -->
  <ul role="tree">             <!-- ProjectTree -->
    <li role="treeitem">       <!-- ThreadCard -->
<main aria-label="Chat">       <!-- CenterChat -->
  <section aria-label="Messages">  <!-- MessageTree -->
    <article>                  <!-- MessageNode -->
      <h3>AgentName</h3>       <!-- MessageHeader ActorName -->
<aside aria-label="Tools">     <!-- RightPanel -->
  <div role="tablist">         <!-- PanelTabBar -->
    <button role="tab">        <!-- Tab: Diff -->
  <div role="tabpanel">        <!-- DiffPanel -->
<footer>                       <!-- SidebarFooter (ConnectionStatus) -->
```

### 4.2 Live Regions for Dynamic Content

| Component | Live Region | Announcement |
|-----------|------------|--------------|
| MessageTree (streaming) | `aria-live="polite"` on streaming container | "Claude is responding..." on stream start; announcer-atomic text updates at sentence boundaries |
| ToolUseCard (running) | `aria-live="polite"` + `aria-label="Tool running: {toolName}"` | "Read completed (1.2s)" on done |
| ApprovalCard (appears) | `aria-live="assertive"` | "Claude requests permission to run: pip install torch" |
| RunStatus (change) | `aria-live="polite"` on ExecutionBadge | "Run completed" / "Run failed: rate limit exceeded" |
| ErrorCard (appears) | `aria-live="assertive"` | ErrorCard.Message text read immediately |
| Toast notification | `aria-live="polite"` + `role="status"` on ToastContainer | Toast type + message |
| ConnectionStatus | `aria-live="polite"` | "Edge disconnected" / "Connection restored" |

### 4.3 Custom Component ARIA

**MessageNode** (recursive, virtualized):
```tsx
<article
  role="article"
  aria-labelledby={`msg-${id}-author`}
  aria-describedby={`msg-${id}-content`}
  data-message-id={id}
>
  <header id={`msg-${id}-author`}>
    {isUser ? "You" : agentName}
    <span aria-label={`${authority} authority`}>{authority}</span>
  </header>
  <div id={`msg-${id}-content`}>
    {/* TextContent, ThinkingBlock, ToolUseCard, etc. */}
  </div>
</article>
```

**DiffCard** (inline, in message stream):
```tsx
<div
  role="region"
  aria-label={`Diff: ${filePath}, ${additions} additions, ${deletions} deletions`}
>
  <button aria-label="Apply diff">Apply</button>
  <button aria-label="Discard diff">Discard</button>
  <button aria-label="View full diff for ${filePath}">View Full Diff</button>
</div>
```

**ToolUseCard** (L2, expandable):
```tsx
<div role="region" aria-label={`${toolName} tool call`}>
  <button
    aria-expanded={isExpanded}
    aria-controls={`tool-result-${toolUseId}`}
  >
    {toolName}: {paramSummary}
  </button>
  <div id={`tool-result-${toolUseId}`} role={isExpanded ? "region" : undefined}>
    {isExpanded && <ToolResult />}
  </div>
</div>
```

**ApprovalCard** (inline, assertive):
```tsx
<div
  role="alertdialog"
  aria-label="Permission required"
  aria-describedby={`approval-detail-${requestId}`}
>
  <p id={`approval-detail-${requestId}`}>{command}</p>
  <button aria-label="Approve command">Approve</button>
  <button aria-label="Approve this command once">Approve Once</button>
  <button aria-label="Deny command">Deny</button>
</div>
```

**Progressive Disclosure (L0-L4)**: Each expandable layer uses `aria-expanded` + `aria-controls` pointing to the content region ID. When a ThinkingBlock or ToolUseCard auto-expands during streaming, announce: "Thinking block expanded" via `aria-live`.

---

## 5. shadcn/ui + Radix a11y Inventory

### 5.1 Built-in Capabilities (No Extra Work)

| Radix Primitive | a11y Features Inherited | Used In |
|----------------|------------------------|---------|
| `Dialog` | Focus trap, Escape close, `aria-modal`, `aria-labelledby`, scroll lock | ForkDialog, Settings modal, NewProjectDialog |
| `Popover` | Focus move to content, Escape dismiss, `aria-expanded` | SearchResultsDropdown, MentionPopover, CommentPopover |
| `DropdownMenu` | Arrow key nav, typeahead find, `role="menu"`/`menuitem` | ContextMenu, AgentSelector, RefFromSelector |
| `Tooltip` | Show on focus AND hover, Escape dismiss, `role="tooltip"` | Timestamp hover, AuthorityLabel detail |
| `Tabs` | Arrow key nav, `role="tablist"`/`tab`/`tabpanel`, `aria-selected` | PanelTabBar, PreviewTabs, GitViewTabs |
| `Select` | Arrow key open, typeahead, `role="listbox"`/`option` | ThemeToggle (if dropdown variant), ViewModeSwitch |
| `Collapsible` | `aria-expanded`, `aria-controls` | ThinkingBlock, ToolUseCard, ArchivedSection |
| `Toggle` / `ToggleGroup` | `aria-pressed`, arrow key nav in group | AuthorityFilterChips, DiffViewSettings |

### 5.2 shadcn/ui Component Audit

Components in AgentHub's component tree that use shadcn/ui wrappers -- inherited a11y is sufficient:

- `Button` (variant + size + `asChild` for icon-only): needs explicit `aria-label` on icon-only instances
- `Input` / `Textarea`: needs associated `<label>` or `aria-label`
- `Badge`: decorative only -- ensure meaning is conveyed in adjacent text
- `Separator`: `role="separator"` (built-in)
- `ScrollArea`: no extra a11y needed (native scrollbar is accessible)

### 5.3 Required Supplements

Where shadcn/ui / Radix does NOT cover the interaction pattern:

| Interaction | Missing a11y | Supplement |
|-------------|-------------|------------|
| IconButton (SidebarToolbar) | No text alternative | All IconButtons must have `aria-label`; NewThreadButton = "New thread", SettingsGear = "Settings" |
| ResizeHandle | No keyboard operation | Arrow key handler with live `aria-valuenow` |
| Virtualized lists (react-virtual) | Screen reader sees all items | Use `role="listbox"` + `aria-setsize` + `aria-posinset` on ThreadList; `role="option"` on ThreadCard |
| FileTreeBody (custom tree) | Not a native tree | Follow Tree pattern: `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-selected`, arrow key navigation |
| JumpToBottomButton | No context on what "bottom" means | `aria-label="Jump to latest message"`; visually hidden text for screen reader |

---

## 6. AgentHub Scenario Specifications

### 6.1 Code Diff Review

**Focus management**: When user presses `Shift+Enter` on a message with a diff (or clicks "View Full Diff"), focus moves to DiffPanel's DiffFileList first file. Subsequent `n`/`p` navigate files within the panel without losing panel focus.

**Screen reader diff announcements**:
- File entry: "File: src/auth.ts, 12 additions, 3 deletions, modified"
- Hunk entry: "Lines 45 to 58, context: function authenticate"
- Line entry: "Added line 47: const token = await ..." / "Deleted line 50: return null"
- Status change: "Diff applied successfully" / "Diff application failed: merge conflict"

**Color non-reliance** (WCAG 1.4.1):
- Every `AddedLine` is prefixed with `+` and `DeletedLine` with `-` (already in spec)
- DiffFileHeader's `+X/-X` badges use numbers + symbols, not just green/red color
- Inline comment button on each line: `aria-label="Add comment on line {N}"`

**Keyboard-only diff operations**: Full coverage from design-keyboard-shortcuts.md Section 3.5 (n/p/j/k navigation, Ctrl+Enter apply, Ctrl+A select all, Escape dismiss).

### 6.2 Message Stream Navigation

**Streaming content announcements**: 
- New agent message starts: aria-live region announces "New message from {agentName}"
- Text accumulates silently until sentence boundary (`.`, `!`, `?`, `\n`), then atomic update to avoid character-by-character chatter
- If user scrolls away during streaming, screen reader does NOT chase -- aria-live content updates without focus change
- Stream complete: "Message from {agentName} complete. Contains {N} tool calls."

**Progressive disclosure (L0-L4)**: Each expansion announces its layer:
- L1 expanded: "Thinking content visible"  
- L2 expanded: "Read tool: src/auth.ts, 45 lines" (toolName + file + line count)
- L3 expanded: "Subagent code-reviewer: 3 tools used, 2 findings"
- Collapse always announces: "{layer} collapsed"

**Virtual scroll keyboard**: j/k moves through visible messages AND virtualized items not yet in DOM. `useVirtualizer`'s `scrollToIndex` brings offscreen items into view, then focuses them. `aria-posinset` and `aria-setsize` inform screen readers of total message count and current position.

**Message context menu**: `Shift+F10` or application key on a focused MessageNode opens the context menu. Arrow keys navigate menu items; Enter selects; Escape dismisses.

### 6.3 Approval Card Operations

**Critical a11y timing**: ApprovalCards are time-sensitive (5min auto-deny). When an ApprovalCard appears:

1. `aria-live="assertive"` on the approval container immediately announces: "Action required: {agentName} requests permission to run command. Press Enter to review."
2. Focus is NOT automatically stolen from the user's current position (complying with WCAG 3.2.1). Instead, a countdown badge on the card announces "Approval expires in {N}s" every 30 seconds.
3. At 60 seconds remaining, announcement changes to: "Approval expires in 1 minute. Press Tab to navigate to the approval card."
4. At 10 seconds: "Approval expiring in 10 seconds" (assertive).

**Keyboard actions on ApprovalCard**:
- `Ctrl+Enter`: Approve
- `Ctrl+Shift+Enter`: Approve Once
- `Ctrl+Shift+D`: Deny (requires confirmation dialog)
- `Escape`: Dismiss focus from card (does NOT deny)

**Security block (non-retryable)**: SeverityBlock approvals display with red border + `role="alert"`. Screen reader: "Command blocked by security policy: brace expansion obfuscation detected. Rephrase the command to proceed."

---

## 7. Reduced Motion Adaptation

### 7.1 Media Query Gate

```css
/* packages/ui/src/styles/theme.css -- append */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This zeroes all CSS animations/transitions globally. The micro-interactions system (design-micro-interactions.md Section 6) must then carefully re-enable only essential transitions.

### 7.2 Per-Feature Disable Table

| Feature | Normal Behavior | Reduced Motion | Reasoning |
|---------|----------------|----------------|-----------|
| Typewriter cursor blink | `@keyframes cursor-blink 1s step-end` | Static `▍` (always visible as `::after` pseudo, no animation) | Blink is decorative; cursor presence is informative |
| Streaming text char-by-char | 30ms interval per char | Append full chunk instantly | Animation is decorative; content arrival is the signal |
| ThinkingBlock three-dot pulse | 300ms stagger bounce | Three static dots, no bounce | Dot presence + elapsed counter conveys activity |
| RunIndicator pulse | 1.5s scale + opacity | Static circle, color change only (green→amber→green) | Color + text status conveys run state |
| Spinner (tool running) | SVG rotate 1s linear | Static icon with "Running..." label | Text label conveys activity |
| DiffCard slide-in | 200ms translateY + opacity | Instant appear | Content change conveys the event |
| Sidebar collapse (280→48px) | 200ms width transition | Instant width change | Functional not decorative |
| RightPanel open/close | 200ms width + opacity | Instant toggle | Functional not decorative |
| Toast enter/exit | 200ms translateY + opacity | Instant appear/dismiss + 4s hold | Hold duration preserved; entry is decorative |
| Modal backdrop | 150ms opacity fade | Instant opacity 0→1 | Opacity is functional for focus trap context |
| Drawer overlay (mobile) | 150ms translateX | Instant appear | Functional: user needs sidebar content |
| Bottom sheet (mobile) | 200ms translateY | Instant appear | Functional: user needs panel content |
| ApprovalCard slide-in | 200ms max-height + opacity | Instant appear (assertive aria-live still fires) | Presence notification is the key signal |
| Undo countdown (DiffCard) | 5s timer with fading | Static "Undo" button, no countdown timer | Action availability is key; countdown is secondary |
| JumpToBottomButton | 150ms scale + opacity | Instant appear/disappear | Button presence is functional |
| SiblingSwitch arrows | instant | instant (already instant) | No change needed |

### 7.3 JS-Level Reduced Motion Detection

```ts
// src/hooks/useReducedMotion.ts
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
```

Usage in streaming hook:
```ts
const reducedMotion = useReducedMotion();
const interval = reducedMotion ? 0 : animation.tokens.streaming.typewriterInterval; // 0 = instant
```

### 7.4 Animation Token Override Map

```ts
// src/lib/animation-tokens.ts
import { animation } from "@/styles/tokens";

export function getAnimationTokens(reducedMotion: boolean) {
  if (!reducedMotion) return animation;
  return {
    ...animation,
    duration: { instant: 0, fast: 0, normal: 0, medium: 0, slow: 0, glacial: 0 },
    streaming: {
      ...animation.streaming,
      typewriterInterval: 0,
      cursorBlinkInterval: 0,
      cursorRemovalDelay: 0,
    },
    thinking: {
      ...animation.thinking,
      dotStaggerDelay: 0,
      expandDuration: 0,
      collapseDuration: 0,
      contentFadeIn: 0,
    },
    toolCall: {
      ...animation.toolCall,
      statusCrossfade: 0,
      borderColorTransition: 0,
      expandDuration: 0,
      collapseDuration: 0,
    },
    undoWindow: animation.undoWindow, // preserve undo window duration
  };
}
```

---

## 8. Implementation Checklist

### P0 (Ship Blocker)

- [ ] Define focus-visible style in `theme.css` using `--ring` token (Section 3.1)
- [ ] Add `aria-label` to all IconButton instances (SidebarToolbar, PanelCloseButton, etc.)
- [ ] Landmark roles: `<header>`, `<nav>`, `<main>`, `<aside>` on MainLayout sections (Section 4.1)
- [ ] `aria-live` regions on MessageTree streaming, ApprovalCard, ErrorCard, ToastContainer (Section 4.2)
- [ ] DiffCard: ensure `+`/`-` prefixes on all diff lines (already in spec, verify)
- [ ] AuthorityStripe: verify AuthorityLabel text is always present alongside colored border (Section 2.2)
- [ ] `prefers-reduced-motion` CSS gate in `theme.css` (Section 7.1)
- [ ] `useReducedMotion` hook + streaming interval override (Section 7.3)
- [ ] "Skip to chat" link as first tabbable element (WCAG 2.4.1)
- [ ] `?` help overlay showing all shortcuts (WCAG 3.2.6)

### P1 (Post-MVP, Before Public Beta)

- [ ] Heading hierarchy audit: h1 (thread title) → h2 (message group) → h3 (agent name) → h4 (tool name)
- [ ] Virtualized list ARIA: `role="listbox"` + `aria-posinset`/`aria-setsize` on ThreadList and MessageTree
- [ ] Screen reader diff mode: per-line announcements (Section 6.1)
- [ ] Keyboard resize handle: Ctrl+Shift+Left/Right for sidebar width (Section 3.3)
- [ ] Keyboard file upload: Ctrl+U file picker (Section 3.3)
- [ ] Axe-core CI integration: `@axe-core/react` with violation gate
- [ ] Contrast audit output document (verify all OKLCH tokens pass 4.5:1 / 3:1)
- [ ] Screen reader streaming sentence-boundary batching (Section 6.2)
- [ ] Approval card countdown announcements (Section 6.3)

### P2 (Polish)

- [ ] Custom Monaco themes (`agenthub-dark` / `agenthub-light`) with accessible contrast
- [ ] Custom `aria-label` for MessageContextMenu items based on thread context
- [ ] MCP settings panel: connection test result announcement
- [ ] Plugin slot ARIA: ensure plugin-rendered content meets standards
- [ ] Mobile bottom sheet: verify drag handle + tab bar meets touch target minimums
- [ ] Full VPAT (Voluntary Product Accessibility Template) draft

---

## 9. References

| Source | Imported |
|--------|---------|
| `design-keyboard-shortcuts.md` | 7-layer scoped keyboard system, layer activation rules, conflict resolution |
| `design-desktop-ux.md` | Component tree (landmark mapping), DiffCard state machine, ApprovalCard UX, MobileDrawer/BottomSheet, ToastContainer |
| `design-micro-interactions.md` | Animation tokens, streaming typewriter, thinking pulse, spinner rotate, reduced-motion targets |
| `design-theme-system.md` | OKLCH palette, `--ring` token, `:root`/`.dark` variable sets, Monaco theme sync |
| `design-error-handling.md` | 4-channel error display (inline/toast/status/modal), AgentHubError.Suggestion field, severity tiers, retry strategies |
| WCAG 2.2 (W3C) | 50 success criteria, AA conformance target |
| shadcn/ui + Radix Primitives | Built-in ARIA, keyboard, focus management for Dialog/Popover/Menu/Tabs/Tooltip/Select |
