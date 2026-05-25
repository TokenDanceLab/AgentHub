# Desktop Fix & Redesign Master Plan

> Generated: 2026-05-25 | Team Lead Synthesis
> Based on audits from: Agent 1 (Codebase), Agent 2 (Icons/Visual), Agent 3 (UX Flow), Agent 4 (Edge Adapters), Agent 5 (Architecture Alignment)

---

## Executive Summary

**Total actionable items across all 5 audits: 66**
- P0 (Immediate fixes): 8 items
- P1 (Short-term improvements): 17 items
- P2 (Medium-term polish): 18 items
- P3 (Long-term redesign): 23 items

**Top 3 user-facing problems:**
1. Right panel auto-opens when run starts (most common complaint)
2. Emoji-based tool icons instead of proper icon components
3. Window control labels hardcoded in Chinese

---

## 1. Immediate Fixes (P0 — Do Now)

These are bugs or obvious defects. No design deliberation needed.

### P0-1: Remove Right Panel Auto-Open Behavior

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:270`, `App.tsx:294`, `App.tsx:303` |
| **Change:** | Delete or comment out `setRightPanelOpen(true)` on these three lines |
| **Risk:** | None — users can still open the panel manually (workspace header button or Ctrl+J) |
| **Effort:** | 5 minutes |
| **Impact:** | Eliminates the most common UX complaint |

```tsx
// App.tsx:270 — REMOVE
- setRightPanelOpen(true);  // ← DELETE THIS LINE

// App.tsx:294 — REMOVE
- setRightPanelOpen(true);  // ← DELETE THIS LINE

// App.tsx:303 — REMOVE
- setRightPanelOpen(true);  // ← DELETE THIS LINE
```

### P0-2: i18n Window Control Labels

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:479`, `App.tsx:485`, `App.tsx:488` |
| **Change:** | Replace hardcoded Chinese strings with `t()` calls; add i18n keys |
| **Effort:** | 10 minutes |

```tsx
// BEFORE:
label="最小化"
label="最大化"
label="关闭"

// AFTER:
label={t('window.minimize')}
label={t('window.maximize')}
label={t('window.close')}
```

Add i18n keys to `en.json` and `zh.json`:
```json
"window.minimize": "Minimize",
"window.maximize": "Maximize",
"window.close": "Close"
```

### P0-3: Replace Emoji Tool Icons with Lucide Icons

| Detail | Value |
|---|---|
| **Files:** | `ChatView.tsx:25-36` (TOOL_ICONS constant); `ChatView.tsx:133` (icon rendering) |
| **Change:** | Replace emoji strings with Lucide React component references; update ToolUseBlock to render `<IconComponent size={16} />` |
| **Effort:** | 20 minutes |
| **Impact:** | Professional icon rendering; consistent with the rest of the app |

```tsx
// BEFORE:
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', ...
};

// AFTER:
import { FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare } from 'lucide-react';

const TOOL_ICON_MAP: Record<string, typeof FileText> = {
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

### P0-4: Fix Hardcoded Search Icon Color

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:593` |
| **Change:** | Replace `color="#B0B0B5"` with `color="var(--text-weakest)"` or remove inline color (inherit from CSS) |
| **Effort:** | 1 minute |

### P0-5: Fix Edge Adapter Stdin Warning

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/adapters/claude_code.go:169-177`; `edge-server/internal/lifecycle/process_executor.go:332-342` |
| **Change:** | Pre-write a control protocol init message to stdin immediately after pipe creation (before `cmd.Start()`). This tells Claude Code the control channel is active. |
| **Effort:** | 20 minutes (Go code) |
| **Risk:** | Low — init message is valid control protocol |

```go
// In process_executor.go, after stdin pipe creation, BEFORE cmd.Start():
if stdin != nil {
    initMsg := `{"type":"control_request","request_id":"init-` + run.ID + `","request":{"subtype":"initialize"}}` + "\n"
    if _, err := stdin.Write([]byte(initMsg)); err != nil {
        slog.Debug("process: init write failed", "runId", run.ID, "err", err)
    }
}
// THEN: cmd.Start()
```

### P0-6: i18n ChatView Relative Time Strings

| Detail | Value |
|---|---|
| **Files:** | `ChatView.tsx:49-77` (`relativeTime()` function) |
| **Change:** | Replace hardcoded English strings with i18n keys (keys already exist: `time.justNow`, `time.minutesAgo`, `time.hoursAgo`, `time.daysAgo`) |
| **Effort:** | 15 minutes |

### P0-7: i18n Thinking Block Labels

| Detail | Value |
|---|---|
| **Files:** | `ChatView.tsx:106` |
| **Change:** | Replace "Thinking" with `t('chat.thinkingLabel')` and "(N chars)" with `t('chat.thinkingChars', { count })`. Add missing i18n keys. |
| **Effort:** | 10 minutes |

### P0-8: Fix Permission Decider Blocking Without Timeout

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/adapters/control_protocol.go:119-125` |
| **Change:** | Wrap the decider callback in a `select` with a 30-second timeout. On timeout, auto-deny the permission. |
| **Effort:** | 15 minutes (Go code) |
| **Risk:** | Low — prevents run hangs if Desktop disconnects |

---

## 2. Short-Term Improvements (P1 — Next Sprint)

### P1-1: Consolidate Theme Colors to OKLCH

| Detail | Value |
|---|---|
| **Files:** | `styles/themes.css` |
| **Change:** | Convert all hex color values to OKLCH. The design system claims to use OKLCH tokens; make it consistent. |
| **Effort:** | 2 hours (requires color math + visual verification) |

Conversions needed (dark theme):
```
#141418 → oklch(0.13 0.005 260)
#E8E8ED → oklch(0.92 0.003 260)
#7C7CE0 → oklch(0.58 0.18 280)
#34D399 → oklch(0.72 0.18 160)
#EF4444 → oklch(0.62 0.22 25)
#8E8E93 → oklch(0.58 0.005 260)
#636366 → oklch(0.45 0.005 260)
```

### P1-2: Replace Confusing Icon Metaphors

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:699` (Route icon), `App.tsx:683` (MessageSquareText icon) |
| **Change 1:** | `Route` → `Workflow` (for "Agent Scheduling" action) |
| **Change 2:** | `MessageSquareText` → `Users` (for "Switch to IM" toggle) |
| **Effort:** | 5 minutes |

### P1-3: Add Missing Keyboard Shortcuts

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:416-448` (keyboard event handler) |
| **Change:** | Add: `Ctrl+K` → open search dialog (matches industry standard); `Ctrl+N` → new thread; `Escape` in input → close mention popover |
| **Effort:** | 30 minutes |

### P1-4: Add Focus Trapping to Auth Modal

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:832-841` (modal overlay) |
| **Change:** | Add `role="dialog"`, `aria-modal="true"`, and focus trapping (focus first input on open, loop focus within modal). Either implement inline or use a library like `focus-trap-react`. |
| **Effort:** | 30 minutes |

### P1-5: Reduce Settings Page Visual Clutter

| Detail | Value |
|---|---|
| **Files:** | `SettingsPage.tsx` |
| **Change:** | Group sections into 5 categories (Workspace, Agents, Security, Sync, Advanced). Hide "reserved" sections behind an "Advanced / Coming Soon" toggle. Only show active sections by default. |
| **Effort:** | 2 hours |

### P1-6: Smooth Sidebar/Workspace Transitions

| Detail | Value |
|---|---|
| **Files:** | `App.module.css` |
| **Change:** | Add CSS transitions to sidebar expand/collapse and workspace expand/collapse. Current behavior is instant (jarring). |
| **Effort:** | 30 minutes |

### P1-7: Model Settings Store Performance

| Detail | Value |
|---|---|
| **Files:** | `stores/modelSettingsStore.ts`, `PromptInput.tsx:67-95` |
| **Change:** | Extract `resolvedRoute` computation into a derived store selector or a dedicated `useResolvedRoute` hook. This prevents PromptInput from re-rendering when unrelated fields in modelSettingsStore change. |
| **Effort:** | 45 minutes |

### P1-8: Default rightPanelOpen to False on Load

| Detail | Value |
|---|---|
| **Files:** | `stores/uiStore.ts:50-56` (persist partialize) |
| **Change:** | Remove `rightPanelOpen` from the `partialize` function so it defaults to `false` on app restart. Or add a `version` field and migration. |
| **Effort:** | 5 minutes |

### P1-9: Add TanStack Query staleTime Configuration

| Detail | Value |
|---|---|
| **Files:** | `api/agentQueries.ts`, `api/threadQueries.ts`, `api/runQueries.ts` |
| **Change:** | Add `staleTime: 30_000` (30 seconds) to agent and thread queries to reduce unnecessary refetches. Add `placeholderData: keepPreviousData` where appropriate. |
| **Effort:** | 15 minutes |

### P1-10: Add Per-Line Size Limit to NDJSON Scanner

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/adapters/scanner.go` |
| **Change:** | Set `bufio.Scanner.Buffer()` with a max token size (e.g., 10MB) to prevent OOM from malformed JSON. |
| **Effort:** | 10 minutes |

### P1-11: i18n Model Descriptions in PromptInput

| Detail | Value |
|---|---|
| **Files:** | `PromptInput.tsx:38-53` |
| **Change:** | Replace hardcoded English strings in `modelDesc()` and `modelMeta()` with i18n keys. |
| **Effort:** | 15 minutes |

### P1-12: Add Run Cancel Confirmation

| Detail | Value |
|---|---|
| **Files:** | `PromptInput.tsx:254` (stop button handler) |
| **Change:** | Add a brief confirmation step before canceling an active run ("Stop agent execution? Unsaved changes may be lost."). Or make it a two-click pattern (click once to show "Click again to confirm"). |
| **Effort:** | 20 minutes |

### P1-13: Fix ChatView Virtualizer estimateSize

| Detail | Value |
|---|---|
| **Files:** | `ChatView.tsx:375` |
| **Change:** | Replace fixed `() => 200` with a dynamic estimate: `_use measureElement refs for actual sizing after first render, with 200 as initial fallback` |
| **Effort:** | 15 minutes |

### P1-14: Add ARIA Live Region to Toast Container

| Detail | Value |
|---|---|
| **Files:** | `Toast.tsx` |
| **Change:** | Add `aria-live="polite"` and `role="status"` to the toast container element. |
| **Effort:** | 3 minutes |

### P1-15: Add Offline Indicator in MentionPopover

| Detail | Value |
|---|---|
| **Files:** | `MentionPopover.tsx` |
| **Change:** | Show a grey dot or "offline" text next to agents that are unavailable in the mention list. |
| **Effort:** | 10 minutes |

### P1-16: Fix Text-Weakest Color Contrast

| Detail | Value |
|---|---|
| **Files:** | `themes.css` — dark theme `--text-weakest` |
| **Change:** | Change `#636366` (contrast ~3.5:1 on dark bg) to `#787880` (~4.8:1) to pass WCAG AA for normal text. |
| **Effort:** | 2 minutes |

### P1-17: Extract useChatMessages into Smaller Modules

| Detail | Value |
|---|---|
| **Files:** | `hooks/useChatMessages.ts` (682 lines) |
| **Change:** | Split into: `eventReducer.ts` (pure reducer), `loopDetector.ts` (loop detection logic), `useEventStreamListener.ts` (stream lifecycle hook). Keep `useChatMessages` as the orchestrating hook. |
| **Effort:** | 1.5 hours |
| **Risk:** | Medium — this is a refactor of the core state management. Needs thorough testing. |

---

## 3. Medium-Term Polish (P2 — This Month)

### P2-1: Thread-First Sidebar Restructure

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:588-657` (sidebar layout) |
| **Change:** | Restructure sidebar: Threads first (with "New Thread" button), then Agent Profiles (composed entities), then Runtimes collapsed under an expandable "Runtime Inventory" section. |
| **Effort:** | 3 hours |
| **Design needed:** | Yes — new layout wireframes |

### P2-2: Agent Profile Composition UI

| Detail | Value |
|---|---|
| **Files:** | New component `AgentProfileComposer.tsx` |
| **Change:** | Create a UI that lets users compose Agent Profiles: select Runtime → configure model → set config sources → choose execution target. This bridges the architecture gap #1. |
| **Effort:** | 4 hours |
| **Design needed:** | Yes — new component |

### P2-3: IM View Integration into Agent Flow

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:726-730`, `views/IMView.tsx` |
| **Change:** | Option A: Remove the IM toggle and merge IM contacts into the agent flow as a sidebar tab. Option B: Add @mention support in IM view to dispatch agents from group chats. |
| **Effort:** | 4-6 hours |
| **Design needed:** | Yes |

### P2-4: Execution Target Selector in Run Flow

| Detail | Value |
|---|---|
| **Files:** | `WelcomeScreen.tsx`, `PromptInput.tsx`, `App.tsx` |
| **Change:** | Add an execution target selector (Local Edge is the only active one, but the selector should exist for future targets). Show in both WelcomeScreen and in the chat header/input area. |
| **Effort:** | 2 hours |

### P2-5: Mobile/Tablet Responsive Polish

| Detail | Value |
|---|---|
| **Files:** | `App.module.css`, all component CSS modules |
| **Change:** | Add tablet breakpoint (768px-1024px) with intermediate layout. Add slide animations to mobile overlays. Fix IM view on mobile (stack contacts + messages vertically). |
| **Effort:** | 3 hours |

### P2-6: Add Missing Component Test Coverage

| Detail | Value |
|---|---|
| **Files:** | Tests for: CodeBlock, ContextUsage, EmptyState, MarkdownRenderer, ModelDropdown, StatusBar |
| **Change:** | Write basic render tests + interaction tests for each untested component. |
| **Effort:** | 4 hours |

### P2-7: Standardize CSS Variable Naming

| Detail | Value |
|---|---|
| **Files:** | `tokens.css`, `themes.css`, all `*.module.css` |
| **Change:** | Rename inconsistent variables: `--color-success` → `--status-success`, `--color-danger` → `--status-danger`. Rename font sizes: `--font-size-2xs` → `--font-size-3xs` (or use numeric scale). |
| **Effort:** | 1 hour |
| **Risk:** | Medium — must find-and-replace across all CSS files |

### P2-8: Add `React.memo` to ChatView and PromptInput

| Detail | Value |
|---|---|
| **Files:** | `ChatView.tsx`, `PromptInput.tsx` |
| **Change:** | Wrap both components with `React.memo` and verify prop stability. |
| **Effort:** | 15 minutes |

### P2-9: Make Run Timeout and Max Concurrency Configurable

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/lifecycle/process_executor.go:98,101` |
| **Change:** | Add `RunTimeout` and `MaxConcurrentRuns` fields to `ProcessExecutorConfig`. Read from environment variables or config file. |
| **Effort:** | 30 minutes (Go code) |

### P2-10: Add Context Cancellation Check Between Scan Lines

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/adapters/scanner.go` |
| **Change:** | Check `ctx.Done()` every N lines in the scanner loop to allow faster run cancellation. |
| **Effort:** | 10 minutes (Go code) |

### P2-11: Log Auto-Approve Permission Decisions

| Detail | Value |
|---|---|
| **Files:** | `edge-server/internal/adapters/control_protocol.go:126-128` |
| **Change:** | Add `slog.Debug("control: auto-approving", "tool", inner.ToolName)` when no decider is configured. |
| **Effort:** | 2 minutes |

### P2-12: Add Placeholder Data for TanStack Queries

| Detail | Value |
|---|---|
| **Files:** | `api/agentQueries.ts`, `api/threadQueries.ts` |
| **Change:** | Use `placeholderData: keepPreviousData` to prevent layout shifts during refetch. |
| **Effort:** | 10 minutes |

### P2-13: Normalize Font Size Token Naming

| Detail | Value |
|---|---|
| **Files:** | `tokens.css:20-28` |
| **Change:** | Rename `--font-size-2xs` to `--font-size-3xs` (correct scale: 3xs < 2xs < xs). Or switch to numeric scale. |
| **Effort:** | 5 minutes + find-and-replace |

### P2-14: Add Global Error Recovery UI

| Detail | Value |
|---|---|
| **Files:** | `ErrorBoundary.tsx` |
| **Change:** | Add a "Reload App" button and "Report Error" option to the error boundary fallback UI. |
| **Effort:** | 15 minutes |

### P2-15: Remove Tab Index from Resize Handles

| Detail | Value |
|---|---|
| **Files:** | `App.tsx:652,753` |
| **Change:** | Change `tabIndex={0}` to `tabIndex={-1}` on resize handles. These are rarely used via keyboard and add unnecessary tab stops. |
| **Effort:** | 2 minutes |

### P2-16: Fix Hardcoded Regex for Claude Code File Paths

| Detail | Value |
|---|---|
| **Files:** | `hooks/useChatMessages.ts:117-136` |
| **Change:** | Prefer explicit `path` field from events; use regex only as fallback with `slog.Warn` when a path is extracted via heuristic. |
| **Effort:** | 10 minutes |

### P2-17: SettingsPage Section Grouping

| Detail | Value |
|---|---|
| **Files:** | `SettingsPage.tsx` i18n keys |
| **Change:** | Add `settings.group.*` categories in the sidebar navigation. Group the 30+ sections into 5-6 collapsible categories. |
| **Effort:** | 1 hour |

### P2-18: WelcomeScreen Runtime-to-Profile Clarity

| Detail | Value |
|---|---|
| **Files:** | `WelcomeScreen.tsx` |
| **Change:** | Update labels: "Agent dispatch mode" → "Select a Runtime". Show runtime adapter name + description clearly. Add a badge: "Runtime: Claude Code" with model preview. |
| **Effort:** | 30 minutes |

---

## 4. Long-Term Redesign (P3 — Architecture Evolution)

### 4.1 Agent Profile System

**Goal:** Implement the architecture's Agent Profile concept as a real UI.

**Components:**
- `ProfileComposer.tsx` — modal/page to create/edit Agent Profiles
- `ProfileCard.tsx` — sidebar card showing Profile name, Runtime, Model, Target
- `ProfileStore.ts` — Zustand store for user-created profiles
- `ProfileSelector.tsx` — dropdown in PromptInput to select a profile (replaces raw model dropdown)

**Data model:**
```ts
interface AgentProfile {
  id: string;
  name: string;
  runtimeId: string;        // references an AgentInfo adapter
  modelAlias?: string;      // "opus", "sonnet", etc.
  reasoningEffort?: string; // "low" | "medium" | "high" | "max"
  configSources: string[];  // paths to AGENTS.md, memory files
  executionTarget: 'local-edge' | 'hub-relay' | 'ssh' | 'cloud';
  skills: string[];         // enabled skill IDs
  mcpServers: string[];     // enabled MCP server IDs
  approvalMode: 'ask' | 'auto' | 'manual';
}
```

**Effort:** 8-10 hours

### 4.2 IM-First Interface

**Goal:** Commit to the IM model as the primary interaction paradigm.

**Changes:**
- Make IMView the default view (not hidden behind a toggle)
- Agents appear as contacts in the IM contact list
- @mentions in group chats dispatch agent runs
- Chat history is threaded (IM-style), not linear run-output

**Effort:** 12-16 hours (significant redesign)

### 4.3 Execution Target Routing

**Goal:** Make execution targets functional and configurable in the run flow.

**Components:**
- `TargetSelector.tsx`
- `TargetHealthIndicator.tsx`
- `RemoteEdgeSetupWizard.tsx` (for SSH/Tailscale targets)

**Effort:** 6-8 hours

### 4.4 TokenDance ID OIDC Completion

**Goal:** Complete the TokenDance ID login flow.

**Changes:**
- Implement OIDC callback capture (currently stored as PKCE state but not exchanged)
- Add token refresh flow
- Add device registration with TokenDance ID
- Add session audit trail

**Effort:** 8-10 hours (backend + frontend)

### 4.5 Settings Progressive Disclosure

**Goal:** Restructure settings to show only active features by default.

**Changes:**
- Move all "reserved/planned" sections behind a "Labs" toggle
- Add feature flags to control visibility
- Show active state: "Configured", "Not configured", "Coming soon"

**Effort:** 4-6 hours

### 4.6 Design System Token Migration

**Goal:** Full migration to OKLCH tokens, enforced by linting.

**Changes:**
- Convert ALL hex colors in themes.css to OKLCH
- Add stylelint rule to ban hardcoded colors and spacing
- Add CSS custom property type definitions
- Document the token system for future contributors

**Effort:** 4-6 hours

### 4.7 Accessibility Audit & Remediation

**Goal:** WCAG 2.2 AA compliance.

**Changes:**
- Full keyboard navigation pass
- Screen reader testing with NVDA/VoiceOver
- Add skip-to-content link
- Add ARIA landmarks (role="banner", role="main", role="complementary")
- Test with 200% zoom and reflow
- Color contrast full pass

**Effort:** 8-12 hours

### 4.8 Performance Optimization

**Goal:** Sub-100ms interaction latency, < 1s initial load.

**Changes:**
- Code splitting: lazy-load SettingsPage, IMView, RunDetail
- Add `React.Suspense` boundaries with skeleton fallbacks
- Memoize expensive selectors in Zustand stores
- Virtual list optimization (dynamic height estimation)
- WebSocket message batching

**Effort:** 8-10 hours

---

## 5. Priority Matrix

### Impact vs Effort Map

```
High Impact │
            │ P1-1 (OKLCH)        P0-1 (auto-open) ★
            │ P2-1 (thread-first) P0-3 (emoji icons) ★
            │ P2-2 (profiles)     P0-5 (stdin fix)
            │                     P0-6 (i18n time)
            │
            │ P4.1 (profile sys)  P1-5 (settings clutter)
            │ P4.2 (IM-first)     P1-7 (store perf)
            │                     P1-17 (split hook)
            │
Medium     │ P2-14 (error UI)    P0-2 (i18n labels)
Impact     │ P2-15 (tab index)   P0-4 (color fix)
            │                     P0-7 (thinking i18n)
            │                     P0-8 (perm timeout)
            │                     P1-2 (icon swap)
            │                     P1-8 (persist fix)
            │
Low Impact │ P3 items...         P2-16 (regex fix)
            │                     P2-13 (token naming)
            │
            └──────────────────────────────────────
              Tiny     Small    Medium    Large
                         Effort →
```

### Ordered Task List (Recommended Sequence)

**Sprint 1 (Week 1): P0 fixes**
1. P0-1: Remove right panel auto-open (5 min)
2. P0-4: Fix hardcoded search icon color (1 min)
3. P0-3: Replace emoji tool icons (20 min)
4. P0-2: i18n window control labels (10 min)
5. P0-6: i18n relative time strings (15 min)
6. P0-7: i18n thinking block labels (10 min)
7. P0-5: Fix edge adapter stdin warning (20 min)
8. P0-8: Fix permission decider timeout (15 min)

**Total: ~1.5 hours**

**Sprint 2 (Week 1-2): P1 improvements**
1. P1-16: Fix text-weakest contrast (2 min)
2. P1-14: Add aria-live to toast (3 min)
3. P1-2: Replace confusing icons (5 min)
4. P1-8: Default rightPanelOpen to false (5 min)
5. P1-13: Fix virtualizer estimateSize (15 min)
6. P1-9: Add TanStack staleTime (15 min)
7. P1-15: Add offline indicator in mentions (10 min)
8. P1-12: Add cancel confirmation (20 min)
9. P1-11: i18n model descriptions (15 min)
10. P1-6: Smooth transitions (30 min)
11. P1-4: Focus trapping in auth modal (30 min)
12. P1-10: Scanner line limit (10 min)
13. P1-7: Model settings store perf (45 min)
14. P1-3: Missing keyboard shortcuts (30 min)
15. P1-17: Split useChatMessages (1.5 hr)
16. P1-1: OKLCH color consolidation (2 hr)
17. P1-5: Reduce settings clutter (2 hr)

**Total: ~8 hours**

**Sprint 3 (Week 3): P2 polish**
1. P2-15: Remove tab index from resize handles (2 min)
2. P2-11: Log auto-approve permissions (2 min)
3. P2-16: Fix hardcoded regex (10 min)
4. P2-12: Placeholder data for queries (10 min)
5. P2-10: Context check in scanner (10 min)
6. P2-13: Font size token naming (5 min)
7. P2-8: React.memo on ChatView/PromptInput (15 min)
8. P2-14: Global error recovery UI (15 min)
9. P2-9: Configurable run timeout (30 min)
10. P2-1: Thread-first sidebar (3 hr)
11. P2-5: Mobile/tablet polish (3 hr)
12. P2-18: WelcomeScreen clarity (30 min)
13. P2-17: Settings section grouping (1 hr)
14. P2-6: Missing test coverage (4 hr)
15. P2-7: CSS variable naming (1 hr)
16. P2-2: Agent Profile composition UI (4 hr)
17. P2-4: Execution target selector (2 hr)
18. P2-3: IM integration (4-6 hr)

**Total: ~20-24 hours**

---

## 6. Files Changed Summary

### Frontend (Desktop)

| File | Changes |
|---|---|
| `App.tsx` | P0-1 (remove auto-open x3), P0-2 (i18n labels), P0-4 (color fix), P1-2 (icon swap), P1-3 (keyboard shortcuts), P1-4 (focus trap), P2-1 (sidebar restructure), P2-15 (tabIndex) |
| `ChatView.tsx` | P0-3 (emoji→icons), P0-6 (i18n times), P0-7 (i18n thinking), P1-13 (virtualizer estimate), P2-8 (React.memo) |
| `PromptInput.tsx` | P1-11 (i18n models), P1-7 (store optimization), P1-12 (cancel confirm), P2-8 (memo) |
| `stores/uiStore.ts` | P1-8 (remove rightPanelOpen from persist) |
| `stores/modelSettingsStore.ts` | P1-7 (derived hook) |
| `styles/themes.css` | P1-1 (OKLCH conversion), P1-16 (contrast fix) |
| `styles/tokens.css` | P2-7 (variable naming), P2-13 (font size naming) |
| `i18n/locales/en.json` | P0-2 (window labels), P0-6 (time strings), P0-7 (thinking labels), P1-11 (model desc) |
| `i18n/locales/zh.json` | P0-2 (window labels), P0-6 (time strings), P0-7 (thinking labels), P1-11 (model desc) |
| `SettingsPage.tsx` | P1-5 (reduce clutter), P2-17 (section grouping) |
| `WelcomeScreen.tsx` | P2-18 (clarity) |
| `ErrorBoundary.tsx` | P2-14 (recovery UI) |
| `Toast.tsx` | P1-14 (aria-live) |
| `hooks/useChatMessages.ts` | P1-17 (split into modules) |

### Backend (Edge Server)

| File | Changes |
|---|---|
| `adapters/claude_code.go` | P0-5 (stdin init message) |
| `lifecycle/process_executor.go` | P0-5 (stdin init write), P2-9 (configurable timeout/concurrency) |
| `adapters/control_protocol.go` | P0-8 (decider timeout), P2-11 (auto-approve log) |
| `adapters/scanner.go` | P1-10 (line size limit), P2-10 (ctx.Done check) |

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Refactoring useChatMessages breaks event stream | High | Write tests BEFORE splitting; use TDD |
| OKLCH conversion causes visual regressions | Medium | Screenshot comparison; toggle both themes |
| Sidebar restructure confuses returning users | Medium | Add "What's new" toast; keep old layout as preference |
| IM-first redesign alienates coding-focused users | High | User research first; A/B test before committing |
| TokenDance OIDC incomplete → security gap | Medium | Document current state; complete before Hub goes public |

---

*Report generated by AgentHub Desktop Fix & Redesign Team, 2026-05-25.*
