# Desktop UX Flow & Interaction Audit

> Generated: 2026-05-25 | Auditor: Agent 3 — Interaction & UX Flow Audit

## 1. User Flow Map

### 1.1 Primary Flow: First-Time User

```
App Launch
  → WelcomeScreen (if no agents/threads)
  → Select Agent from AgentList sidebar
  → Type prompt in PromptInput
  → Send (click ArrowUp or press Enter)
  → Run starts → Right panel auto-opens [ANNOYING]
  → Messages stream in ChatView
  → Run complete → Right panel stays open
  → Click another agent → New run
```

### 1.2 Flow: Returning User

```
App Launch
  → Auth check (auto-connect to Edge)
  → Previous state restored (selected agent, thread, collapsed panels)
  → Type prompt → Send
  → Run starts → Right panel may already be open (persisted state)
```

### 1.3 Flow: Login/Auth

```
App Launch → Hub disconnected
  → Click login button (sidebar/rail Hub icon or settings)
  → Auth modal opens
  → AuthPage: Login tab (username + password) or Register tab
  → Option: "Continue with TokenDance ID" (OIDC flow — pending)
  → Login success → Modal closes
  → Hub connected status visible
```

### 1.4 Flow: Switch to IM View

```
Agent chat view active
  → Click MessageSquareText icon in workspace header
  → View toggles to IMView
  → Shows IMContactList (left) + IMMessageView (right) + IMMessageInput (bottom)
  → Not a modal/overlay — replaces entire chat area
  → Click MessageSquareText again → back to agent view
```

### 1.5 Flow: Settings Navigation

```
Click Settings icon (sidebar/rail)
  → Full-screen SettingsPage replaces app shell
  → Left sidebar: categorized sections (General, Account, Appearance, etc.)
  → Select section → Scroll to content area
  → "Back to app" button → Return to main view
```

### 1.6 Flow: Search

```
Press Ctrl+K or ?
  → SearchDialog opens (global search)
  → Search messages, commands, agents
  → Select result → Navigate / scroll to item
```

---

## 2. Critical UX Issues

### 2.1 P0: Right Panel Auto-Opens When Run Starts

**Location:** `App.tsx:270`, `App.tsx:294`, `App.tsx:303`

**Problem:** The right panel (RunDetail) auto-opens on three conditions:
1. **Line 270:** When user tries to send while a run is already active — shows info toast AND opens right panel.
2. **Line 294:** After successfully starting a run — always opens right panel.
3. **Line 303:** When catching an "active run exists" error — opens right panel.

**User pain:** The right panel takes ~360px of screen real estate (default width). For many tasks, users don't need to see tool calls or file changes — they just want to see the chat output. The auto-open is jarring and forces window management.

**Data:** The `rightPanelOpen` state is also persisted to localStorage (uiStore.ts:50-56), meaning it can survive app restarts.

**Proposed fix options:**
- **Option A (Recommended):** Remove auto-open entirely. Let users open the panel manually when they want to inspect run details.
- **Option B:** Auto-open only if `rightPanelOpen` was previously `true` (respect user preference).
- **Option C:** Auto-open but with a minimized/compact mode that only shows a small status indicator.
- **Option D:** Show a subtle non-intrusive indicator ("Run started — click to view details") instead of auto-opening.

### 2.2 P1: Sidebar Agents Section Clearer Than Threads

**Location:** `App.tsx:597-614`

**Issue:** The sidebar shows "Agent Runtimes" as the primary section, with threads below. But from a user workflow perspective, users typically:
1. Select a thread (conversation context)
2. Then interact with an agent within that thread

The current layout inverts this: agents are prominent, threads are secondary.

**Recommendation:** Consider making threads the primary navigation element (similar to ChatGPT's conversation history), with agent selection happening within the chat context rather than the sidebar.

### 2.3 P1: IM View Toggle Feels Disconnected

**Location:** `App.tsx:726-730`

**Issue:** The "switch to IM" button in the workspace header toggles the entire chat area between agent mode and IM mode. These feel like completely different applications sharing the same shell. The transition is abrupt (no animation).

**Recommendation:** 
- Add a subtle crossfade transition
- Or merge IM into the agent flow (e.g., @mentions in the main chat could trigger agent collaboration without leaving the view)

### 2.4 P2: Settings Page is Overwhelming

**Location:** `SettingsPage.tsx`

**Issue:** The settings page has 30+ sections (General, Account, Appearance, Configuration, Personalization, Tasks, Permissions, Agent Profiles, Execution Targets, Online IM, Group Chat, Agent Scheduling, Agent Market, MCP Servers, Skills, Hooks, Models, Model Mapping, cc-switch, Connections, Remote Control, Git, Environment, Worktree, Browser, Computer Use, Multi-platform, Security Audit, Archived).

This is information overload. Many sections are "reserved" or "planned" with placeholder content, which creates a feeling of an incomplete product.

**Recommendation:** 
- Hide placeholder/reserved sections behind a "Show advanced" toggle
- Group sections into expandable categories with only active sections visible
- Show "Coming soon" badge on reserved sections rather than full placeholder content

### 2.5 P2: Window Controls Use Hardcoded Chinese

**Location:** `App.tsx:479-490`

**Issue:** "最小化", "最大化", "关闭" are hardcoded Chinese. These labels appear in tooltips. An English-speaking user would see Chinese tooltips on window controls.

---

## 3. Keyboard Navigation Audit

### 3.1 Current Keyboard Shortcuts

| Shortcut | Action | File:Line |
|---|---|---|
| `?` (no modifier) | Toggle shortcut help | App.tsx:424 |
| `Ctrl/Cmd + B` | Toggle left sidebar | App.tsx:428-431 |
| `Ctrl/Cmd + J` | Toggle right panel | App.tsx:432-435 |
| `Escape` | Close mobile nav overlay | App.tsx:417 |
| `Enter` (in input) | Send message | PromptInput.tsx:154 |
| `Shift+Enter` (in input) | New line | PromptInput.tsx:154 |
| `ArrowLeft/Right` (resize handles) | Resize panels | App.tsx:356-379 |
| `Shift+Arrow` (resize handles) | Resize faster (40px) | App.tsx:356 |
| `Home/End` (resize handles) | Min/max panel width | App.tsx:363-364 |

### 3.2 Missing Keyboard Shortcuts

| Missing Shortcut | Why Needed |
|---|---|
| `Ctrl/Cmd + K` | Open search dialog (industry standard) |
| `Ctrl/Cmd + Enter` | Send message (alternative to Enter) |
| `Ctrl/Cmd + /` | Toggle settings |
| `Ctrl/Cmd + N` | New thread |
| `Tab` in input | Accept @mention suggestion |
| `Up/Down Arrow` in input | Navigate @mention list |
| `Escape` in input | Close @mention popover |
| `Ctrl/Cmd + 1-9` | Switch to tab/section |

### 3.3 Focus Management Issues

1. **No focus trapping in modals:** The auth modal (App.tsx:832-841) does not trap focus. A keyboard user could tab behind the overlay.
2. **No focus return:** When the settings page closes, focus is not returned to the originating button.
3. **No focus indicator for search:** The search input in the sidebar (App.tsx:593-594) has no auto-focus on sidebar expand.

---

## 4. Loading & Empty State Audit

### 4.1 Loading States

| State | Component | Implementation | Quality |
|---|---|---|---|
| App boot | App.tsx | No dedicated loading screen | Poor |
| Agents loading | AgentList.tsx | Shows "Waiting for Edge..." when offline | OK |
| Messages loading | ChatView.tsx | `TextShimmer` (thinking animation) | Good |
| Run starting | PromptInput.tsx | `LoaderCircle` spinner on send button | Good |
| Run streaming | ChatView.tsx | `StreamingTextBlock` with character animation | Good |
| Settings loading | SettingsPage.tsx | `SkeletonLine` in some sections | OK |
| Thread loading | ThreadPanel.tsx | Empty hint message | OK |

### 4.2 Empty States

| State | Component | Implementation | Quality |
|---|---|---|---|
| No agents | AgentList.tsx | "No runtimes available" / "Waiting for Edge..." | OK |
| No messages | ChatView.tsx | EmptyState with suggestions | Good |
| No threads | ThreadPanel.tsx | "No recent threads" hint | OK |
| No run | RunDetail.tsx | "No active run" | OK |
| No contacts | IMContactList | "No conversations yet" | OK |
| No IM messages | IMMessageView | "No messages yet" | OK |

### 4.3 Error States

| State | Component | Implementation | Quality |
|---|---|---|---|
| Edge disconnected | App.tsx | Banner with retry button | Good |
| Run failed | ChatView.tsx | Result block with error message | OK |
| Network error | Various | Toast notification | OK |
| Stream error | useChatMessages | Console warn, toast | OK |
| Permission needed | PermissionDialog | Modal with allow/deny | Good |

**Gap:** There is no global "app crashed" recovery UI. The ErrorBoundary catches render errors but there is no user-facing prompt to reload or recover.

---

## 5. Responsive Behavior

### 5.1 Mobile (< 768px)

**Implementation:** `useIsMobile()` hook → triggers overlay-based navigation

**Current mobile layout:**
1. Top toolbar with: Menu button, Agent name, Settings, Hub login, Theme toggle
2. Menu button opens left overlay panel (agents + threads)
3. No right panel on mobile

**Issues:**
1. No tablet-specific layout — 768px-1024px uses full desktop layout which can feel cramped
2. Mobile overlay has no slide animation — just appears/disappears
3. PromptInput may be too small on mobile for complex prompts
4. The IM view's two-panel layout likely breaks on mobile

### 5.2 Desktop Expanded Mode

When `workspaceExpanded` is true:
- Both sidebars hidden
- Main area takes full width
- Used via Maximize2/Minimize2 button in workspace header

This is a good pattern but the transition is abrupt (no animation).

---

## 6. Interaction Patterns — Detailed Audit

### 6.1 @Mention (useMention hook)

**Flow:**
1. User types `@` in the textarea
2. MentionPopover appears above/below the cursor
3. Shows filtered agent list
4. Arrow keys navigate, Enter selects
5. Selected agent becomes the target

**Issues:**
- MentionPopover position calculation may be off when textarea scrolls
- No visual indication of which agents are available vs offline in the mention list
- Mention is only for agent selection — does not support @mentioning files, threads, or other entities

### 6.2 Permission Dialog

**Flow:**
1. Agent requests tool permission (e.g., "Claude Code wants to run: bash command...")
2. PermissionDialog appears (likely as a modal/overlay)
3. User can Allow or Deny
4. Decision is sent back to agent via WebSocket

**Issues:**
- Cannot auto-dismiss after decision — stays visible
- No "Allow all for this session" option
- No "Always deny this tool" option
- Permission queue can stack up without user noticing

### 6.3 Chat Scroll Behavior

**Implementation:** `useAutoScroll` (ported from OpenCode pattern)

**Behavior:**
1. When streaming — auto-scroll to see latest content
2. When user scrolls up 200px — "pause" auto-scroll (user is reading history)
3. "Scroll to bottom" button appears when new messages arrive while scrolled up
4. Using `@tanstack/react-virtual` for virtualized message list

**Assessment:** Well-implemented. The OpenCode auto-scroll pattern is the gold standard and this implementation follows it correctly.

### 6.4 Run Cancellation

**Flow:**
1. User clicks Square (stop) button in PromptInput
2. `handleCancel()` is called
3. Cancels local optimistic run
4. Sends cancel request to Edge (REST)
5. Edge sends interrupt via stdin to adapter
6. Process is killed if it doesn't respond

**Issues:**
- No confirmation dialog ("Are you sure?")
- No feedback during cancellation (between "cancelling" and "cancelled")
- If the agent is in the middle of a file write, cancellation may leave the workspace in a dirty state

---

## 7. Screen Reader / Accessibility Audit

### 7.1 ARIA Attributes

| Element | ARIA | Status |
|---|---|---|
| Shell layout divs | None | Missing `role="region"` and `aria-label` on sidebar, main, right panel |
| Resize handles | `role="separator"`, `aria-orientation`, `aria-label`, `aria-valuemin/max/now` | Excellent |
| Chat stream | `role="log"`, `aria-live="polite"` | Good |
| Modal overlay | None | Missing `role="dialog"`, `aria-modal="true"`, `aria-labelledby` |
| Toast container | None | Missing `aria-live="polite"`, `role="status"` |
| Sidebar toggle buttons | `aria-expanded` | Good |
| Theme toggle | `aria-pressed` | Good |
| Hub login indicator | `aria-pressed` on some, missing on others | Inconsistent |

### 7.2 Tab Order

**Natural tab order:**
1. Left sidebar → Main content → Right panel (LTR reading order)
2. Keyboard trap potential: when resize handles have `tabIndex={0}`, they enter the tab order

**Issue:** The resize handles being tabbable adds two extra stops to the tab order that most users will never need. Consider using `tabIndex={-1}` and adding a keyboard shortcut to activate resize mode.

---

## 8. Summary & Priority Matrix

| # | Issue | Severity | User Impact | Effort |
|---|---|---|---|---|
| 1 | Right panel auto-opens on run start | **P0** | High — core complaint | Small |
| 2 | Window control labels hardcoded Chinese | **P0** | Medium — i18n | Tiny |
| 3 | Settings page overwhelming (30+ sections) | P1 | Medium — discoverability | Medium |
| 4 | IM toggle feels disconnected from agent flow | P1 | Medium — UX coherence | Medium |
| 5 | Missing standard keyboard shortcuts | P1 | Medium — power users | Small |
| 6 | No focus trapping in auth modal | P1 | Medium — a11y | Small |
| 7 | MentionPopover shows offline agents without indication | P2 | Low | Tiny |
| 8 | No "Allow all" option for permissions | P2 | Low — power users | Medium |
| 9 | No cancel confirmation | P2 | Low | Tiny |
| 10 | Abrupt workspace expand/collapse (no animation) | P3 | Low | Small |
| 11 | Missing aria-live on toast | P3 | Low — a11y | Tiny |
| 12 | Sidebar agent-first vs thread-first inverted | P3 | Low — design decision | Large |

**Total actionable items: 12**
