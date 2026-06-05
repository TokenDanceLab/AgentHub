# Desktop Codebase Full Audit

> Generated: 2026-05-25 | Auditor: Agent 1 — Full Codebase Audit

## 1. File Inventory

### 1.1 Components (with CSS modules)

| File | Lines | CSS Module | Props | Notes |
|---|---|---|---|---|
| `App.tsx` | 847 | `App.module.css` | None (root) | Shell layout, window controls, resize handles |
| `AgentList.tsx` | 118 | `AgentList.module.css` | `agents, online, selectedId, onSelect` | `React.memo`-wrapped |
| `AuthPage.tsx` | — | `AuthPage.module.css` | `onLoginSuccess, onClose` | Login/Register tab switcher |
| `ChatView.tsx` | 552 | `ChatView.module.css` | `messages, isStreaming, onRetry, onDelete` | Virtualized message list |
| `CodeBlock.tsx` | — | `CodeBlock.module.css` | `content, language` | Syntax-highlighted code |
| `ContextUsage.tsx` | — | `ContextUsage.module.css` | `metrics: SessionMetrics` | Token usage visualization |
| `DiffViewer.tsx` | — | `DiffViewer.module.css` | `files: FileDiff[]` | Diff display component |
| `EmptyState.tsx` | — | `EmptyState.module.css` | `title, description, suggestions?` | Empty state with CTA |
| `ErrorBoundary.tsx` | — | — | `children` | React error boundary |
| `LoginForm.tsx` | — | `LoginForm.module.css` | Form props | Username/Password form |
| `MarkdownRenderer.tsx` | — | `MarkdownRenderer.module.css` | `content` | Markdown-to-React renderer |
| `MentionPopover.tsx` | — | `MentionPopover.module.css` | `agents, isOpen, query, position, selectedIndex, onSelect, onClose` | @mention autocomplete |
| `ModelDropdown.tsx` | — | `ModelDropdown.module.css` | `options, value, onChange, placeholder, disabled, ariaLabel, variant, alignRight` | Model/effort dropdown |
| `NotificationBell.tsx` | — | `NotificationBell.module.css` | — | Notification indicator |
| `PermissionDialog.tsx` | — | `PermissionDialog.module.css` | `requests, onDecide` | Permission approval UI |
| `PromptInput.tsx` | 272 | `PromptInput.module.css` | `agents, selectedAgentId, onSelectAgent, onSend, isStreaming, isStarting, onCancel, disabled, threadId` | Main input composer |
| `RegisterForm.tsx` | — | `RegisterForm.module.css` | Form props | Registration form |
| `RunDetail.tsx` | 245 | `RunDetail.module.css` | `run, toolCalls, changedFiles, outputText, diffs?, onCancel?, chatMessages?` | Right panel run detail |
| `SearchDialog.tsx` | — | `SearchDialog.module.css` | `messages, onSelect` | Global search modal |
| `SettingsPage.tsx` | — | `SettingsPage.module.css` | `initialSection, onBack, onOpenAuth` | Full settings page |
| `ShortcutHelp.tsx` | — | `ShortcutHelp.module.css` | `open, onClose` | Keyboard shortcut reference |
| `Skeleton.tsx` | — | `Skeleton.module.css` | `width, height` | Loading skeleton |
| `StatusBar.tsx` | — | `StatusBar.module.css` | — | Bottom status bar |
| `ThreadPanel.tsx` | — | `ThreadPanel.module.css` | `online, selectedId, onSelect` | Thread list |
| `Toast.tsx` | — | `Toast.module.css` | (contextual) | Toast notifications |
| `WelcomeScreen.tsx` | — | `WelcomeScreen.module.css` | Various | Welcome/launch screen |
| `IM/IMContactList.tsx` | — | `IM/IMContactList.module.css` | — | IM contact list |
| `IM/IMMessageInput.tsx` | — | `IM/IMMessageInput.module.css` | — | IM message composer |
| `IM/IMMessageView.tsx` | — | `IM/IMMessageView.module.css` | — | IM message display |

### 1.2 Stores (Zustand)

| Store | File | Persisted | Key Pattern |
|---|---|---|---|
| `connectionStore` | `stores/connectionStore.ts` | No | `subscribeWithSelector` |
| `hubStore` | `stores/hubStore.ts` | Partial | Auth state, showAuthModal |
| `modelSettingsStore` | `stores/modelSettingsStore.ts` | Yes | Model mapping, aliases, fallback |
| `notificationStore` | `stores/notificationStore.ts` | No | Notification queue |
| `runStore` | `stores/runStore.ts` | No | `subscribeWithSelector`, state machine |
| `searchStore` | `stores/searchStore.ts` | No | Search state |
| `taskBridgeStore` | `stores/taskBridgeStore.ts` | No | Hub task bridge |
| `threadStore` | `stores/threadStore.ts` | Partial | Selected thread |
| `toastStore` | `stores/toastStore.ts` | No | Toast queue |
| `uiStore` | `stores/uiStore.ts` | Yes | `subscribeWithSelector` + `persist` |

### 1.3 Hooks

| Hook | File | Purpose |
|---|---|---|
| `useAuth` | `hooks/useAuth.ts` | Hub login/logout |
| `useAutoScroll` | `hooks/useAutoScroll.ts` | Smart auto-scroll (OpenCode pattern) |
| `useChatMessages` | `hooks/useChatMessages.ts` | WebSocket event reducer (682 lines) |
| `useDeviceRegistration` | `hooks/useDeviceRegistration.ts` | Device registration |
| `useEdgeStatus` | `hooks/useEdgeStatus.ts` | Edge health + banner management |
| `useEventStream` | `hooks/useEventStream.ts` | WebSocket event stream |
| `useHealth` | `hooks/useHealth.ts` | Edge health polling |
| `useHubEventStream` | `hooks/useHubEventStream.ts` | Hub WebSocket events |
| `useHubIntegration` | `hooks/useHubIntegration.ts` | Hub integration |
| `useIMChat` | `hooks/useIMChat.ts` | IM chat logic |
| `useInputDraft` | `hooks/useInputDraft.ts` | Per-thread draft persistence |
| `useMediaQuery` | `hooks/useMediaQuery.ts` | Responsive breakpoints |
| `useMention` | `hooks/useMention.ts` | @mention parsing |
| `useRunners` | `hooks/useRunners.ts` | Runner list/status |
| `useStreamingText` | `hooks/useStreamingText.ts` | Character-by-character streaming |
| `useToast` | `hooks/useToast.ts` | Toast management |

### 1.4 API Layer (TanStack Query)

| File | Purpose |
|---|---|
| `api/agentQueries.ts` | Agent list queries |
| `api/deviceId.ts` | Device ID management |
| `api/edgeAuth.ts` | Edge auth |
| `api/edgeClient.ts` | Edge REST client (startRun, cancelRun, decidePermission) |
| `api/eventClient.ts` | WebSocket event stream client |
| `api/hubAuth.ts` | Hub auth |
| `api/hubClient.ts` | Hub REST client |
| `api/hubEvents.ts` | Hub event stream |
| `api/hubTokenStorage.ts` | Hub token storage |
| `api/hubWS.ts` | Hub WebSocket |
| `api/queryClient.ts` | TanStack Query client config |
| `api/runQueries.ts` | Run list queries |
| `api/threadQueries.ts` | Thread list/create/update/delete queries |

### 1.5 Views

| File | Purpose |
|---|---|
| `views/MainView.tsx` | Main chat view |
| `views/IMView.tsx` | IM layout |
| `views/viewRegistry.tsx` | Slot-based view registry |
| `config/viewRegistry.ts` | View configuration |

### 1.6 Styles

| File | Purpose |
|---|---|
| `styles/tokens.css` | Design tokens (typography, spacing, radius, z-index, animation) |
| `styles/themes.css` | Dark + Light theme variables |

---

## 2. Critical Issues

### 2.1 BUG: Hardcoded Chinese Labels in Window Controls

**File:** `App.tsx:479-490`  
**Problem:** Window control buttons use hardcoded Chinese strings ("最小化", "最大化", "关闭") instead of i18n keys.  
**Fix:** Replace with `t('window.minimize')`, `t('window.maximize')`, `t('window.close')` — and add i18n keys.

### 2.2 BUG: Hardcoded Color Value

**File:** `App.tsx:593`  
**Problem:** Inline `color="#B0B0B5"` on Search icon. Should use a CSS variable.  
**Fix:** Use `var(--text-weakest)` or equivalent token.

### 2.3 BUG: Relative Time Strings Not i18n'd

**File:** `ChatView.tsx:49-77`  
**Problem:** `relativeTime()` function uses hardcoded English strings: "Just now", "min ago", "h ago", "Yesterday", "d ago".  
**Fix:** Replace with `t('time.justNow')`, `t('time.minutesAgo', { count })`, etc. (i18n keys already exist — `time.justNow`, `time.minutesAgo`, `time.hoursAgo`, `time.daysAgo`).

### 2.4 BUG: Tool Icons Are Emoji-Based

**File:** `ChatView.tsx:25-36`  
**Problem:** `TOOL_ICONS` uses emoji characters (e.g., '' for Read, '✏️' for Write/Edit, '⚡' for Bash) instead of proper icons.  
**Fix:** Map tool names to Lucide icons (e.g., `FileText` for Read, `Pencil` for Write/Edit, `Terminal` for Bash, `Search` for Grep, `Globe` for WebFetch/WebSearch).

### 2.5 BUG: Hardcoded "Thinking" Label

**File:** `ChatView.tsx:106`  
**Problem:** The ThinkingBlock collapse toggle uses hardcoded "Thinking" and "(N chars)" strings.  
**Fix:** Use `t('chat.thinkingLabel')` and `t('chat.thinkingChars', { count: content.length })`.

### 2.6 BUG: Model Descriptions Not i18n'd

**File:** `PromptInput.tsx:38-53`  
**Problem:** `modelDesc()` and `modelMeta()` return hardcoded English strings.  
**Fix:** Use i18n keys or move to a shared config.

### 2.7 BUG: Hardcoded Regex for File Path Extraction

**File:** `useChatMessages.ts:117-136`  
**Problem:** `extractPathFromContent()` hardcodes regex patterns for Claude Code's output format. This is fragile — if Claude changes output format, file change detection breaks silently.  
**Fix:** Prefer explicit `path` field from events; use regex as fallback with error logging.

### 2.8 DESIGN: Inconsistent CSS Variable Usage

**Files:** `themes.css`, component CSS modules  
**Problem:** Themes mix OKLCH and hex colors. For example, dark theme uses `#141418`, `#E8E8ED`, `#7C7CE0`, `#34D399`, `#EF4444` — these are hex colors, not OKLCH. The tokens.css defines OKLCH values for some surfaces but themes.css overrides them with hex.  
**Fix:** Standardize on OKLCH throughout OR use one consistent format; document the choice.

### 2.9 DESIGN: Missing React.memo on Heavy Components

- `ChatView` (552 lines) could benefit from `React.memo`
- `PromptInput` (272 lines) re-renders on every model settings change due to `useModelSettingsStore`  
  **Fix:** Consider selectors that only pull relevant values, or `React.memo` with `useShallow`.

### 2.10 STATE: Model Settings Store Triggers Unnecessary Re-renders

**File:** `PromptInput.tsx:67-95`  
**Problem:** `useModelSettingsStore` uses `useShallow` but pulls 7 fields from the store. The `resolvedRoute` useMemo depends on all 7. Any change to `aliases` triggers a re-render of PromptInput.  
**Fix:** Extract model resolution into a derived store or a dedicated hook.

### 2.11 STATE: UI Store uses `persist` for `rightPanelOpen`

**File:** `stores/uiStore.ts:50-56`  
**Problem:** `rightPanelOpen` is persisted across sessions. When a user closes the app with the right panel open, it reopens on next launch — even if no run is active. This contributes to the "annoying auto-open" experience.  
**Fix:** Either always default `rightPanelOpen` to `false`, or only persist it when a run is active.

### 2.12 ACCESSIBILITY: Missing ARIA Labels on Interactive Elements

- ChatView action buttons (Copy, Retry, Delete) use `title` but not `aria-label` (ChatView.tsx:450-474)
- The timestamp element uses `title` which is not ideal for screen readers — `aria-label` should be more descriptive
- Several ShellIconButton instances have `ariaLabel` as optional and may not set it

### 2.13 PERFORMANCE: Virtualizer with Fixed Estimate

**File:** `ChatView.tsx:373-379`  
**Problem:** `estimateSize: () => 200` is a fixed estimate. Messages vary dramatically in height (text-only vs. code block vs. diff card).  
**Fix:** Use dynamic measurement or a better heuristic based on block count.

### 2.14 CODE QUALITY: useChatMessages is 682 Lines

**File:** `hooks/useChatMessages.ts`  
**Problem:** This is the longest file in the codebase (682 lines). It combines: event reducer, loop detector, stream lifecycle, permission handling.  
**Fix:** Split into separate modules: `eventReducer.ts`, `loopDetector.ts`, `useEventStream.ts`.

### 2.15 TEST: Missing Test Coverage

The following components have no test files:
- `CodeBlock.tsx`
- `ContextUsage.tsx`
- `EmptyState.tsx`
- `MarkdownRenderer.tsx`
- `ModelDropdown.tsx`
- `StatusBar.tsx`

---

## 3. Zustand Store Audit

### 3.1 Recommended Optimizations

| Store | Current Pattern | Issue | Recommendation |
|---|---|---|---|
| `modelSettingsStore` | Pulls 7 fields in PromptInput | Unnecessary re-renders | Create derived `useResolvedRoute` hook |
| `uiStore` | `persist` with `rightPanelOpen` | Persisting ephemeral state | Default to `false` on load |
| `runStore` | State machine + loop count | Mixes concerns | Separate loop tracking into its own store |
| `connectionStore` | `setOnline(online, health)` | Two-arg setter is unusual | Use separate `setOnline`/`setHealth` |

### 3.2 Missing `useShallow` Detection

**App.tsx:141** — `useToastStore((s) => s.addToast)` — single selector, fine.  
**ChatView.tsx:368** — `useToastStore((s) => s.addToast)` — fine.  
**SettingsPage.tsx** — needs verification.

---

## 4. TanStack Query Audit

### 4.1 Query Configuration

| Query | staleTime | gcTime | refetchOnWindowFocus | Error Handling |
|---|---|---|---|---|
| `useHealth` (timer) | — | — | — | Try/catch in timer |
| `useAgentList` | Default? | Default? | ? | Error boundary |
| `useThreads` | Default? | Default? | ? | Error boundary |

**Issues:**
1. No visible `staleTime` configuration in query hooks — using TanStack defaults (0ms = always stale). This means every component mount refetches.
2. No retry configuration for network errors.
3. No `placeholderData` (keepPreviousData) — causes layout shifts on refetch.

---

## 5. Responsive Design Audit

**Breakpoints used:**
- Mobile: 375px (`useIsMobile` — likely `max-width: 767px`)
- The `useMediaQuery` hook provides boolean flags

**Issues:**
1. Only binary responsive (mobile/desktop) — no tablet breakpoint.
2. Mobile overlay pattern (App.tsx:535-554) works but lacks transitions.
3. No responsive typography — font sizes are fixed `rem` units, not fluid.
4. Touch targets: the `--touch-target-min: 44px` token exists but not consistently applied to all interactive elements.

---

## 6. Summary

| Category | Count | Severity |
|---|---|---|
| Hardcoded strings (not i18n'd) | 5 | Medium |
| Hardcoded colors (not themed) | 2 | Low |
| Missing i18n usage | 3 | Medium |
| Missing React.memo | 2 | Low |
| Store optimization needed | 3 | Medium |
| TanStack Query optimization | 3 | Medium |
| Accessibility issues | 2 | Medium |
| Performance concerns | 1 | Low |
| Test coverage gaps | 6 | Low |
| Responsive gaps | 2 | Low |
| Code organization | 1 | Low |

**Total actionable items: 30**
