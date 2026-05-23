# Agent Command Centers: Source Adoption Map

> Generated 2026-05-24 from actual source code of 7 projects mapped against AgentHub `app/desktop/src/`.

## Quick Reference: Projects Studied

| Project | Stack | Type | Key Differentiator |
|---|---|---|---|
| **crush** | Go + Charmbracelet | Terminal TUI | Coordinator pattern, multi-provider |
| **eca** | Clojure + Babashka | Desktop app | Plugin architecture, feature flags |
| **emdash** | Electron + React + MobX | Desktop app | View registry, cmd palette, agent hooks |
| **jean** | Tauri + React + Zustand | Desktop app | Uncontrolled input, mentions, 3 backends |
| **orca** | Electron + TypeScript | Desktop orchestrator | Browser integration, automations, VCS |
| **picoclaw** | Go + React (web) | Web app | Skill marketplace, import/export |
| **ruflo** | TypeScript plugins | Plugin framework | Federation protocol, graph intelligence |

---

## P0 -- Must Adopt

### 1. Uncontrolled Input with DOM Refs (Performance)

**Source:** `jean/src/components/chat/ChatInput.tsx:104` -- `valueRef` + direct DOM manipulation

Jean's ChatInput avoids React re-renders on every keystroke by using an uncontrolled pattern: a `valueRef` mirroring the textarea, with direct `.value` writes on the DOM node. The `onChange` handler updates the ref and only triggers `setState` at the empty/non-empty boundary for the hint toggle.

**Current AgentHub:** `PromptInput.tsx:64` uses controlled `useState(prompt)` -- every keystroke triggers a full component re-render including the agent selector popover, model/reasoning selects, and send button.

**Adoption path:**
- `app/desktop/src/components/PromptInput.tsx` -- replace `useState(prompt)` with `useRef` + direct DOM writes
- Keep `setShowHint(isEmpty)` boundary update only
- Sync to store via debounced write (see P0#2)

**Risk:** Medium -- changes the fundamental input handling; requires careful paste/undo handling.

---

### 2. Input Draft Persistence (Crash Recovery)

**Source:** `jean/src/components/chat/ChatInput.tsx:106-108` -- debounced `setInputDraft` to Zustand
**Source:** `jean/src/components/chat/ChatInput.tsx:164-184` -- draft restore on session switch

Jean persists the current input value to `chatStore.inputDrafts[sessionId]` with a 1-second debounce, then restores it when the session changes or the app reloads. This means a user never loses their typed message on crash, refresh, or accidental navigation.

**Current AgentHub:** No draft persistence -- `prompt` is component-local state, lost on every unmount.

**Adoption path:**
- Add `inputDrafts: Record<string, string>` to `threadStore.ts` or a new `draftStore.ts`
- Debounce saves on each keystroke (1s)
- Restore on session change in `PromptInput`
- Clear draft on successful send

**Risk:** Low -- additive feature, no breaking changes.

---

### 3. Rich Mention/Autocomplete System (@files, #issues, /commands)

**Source:** `jean/src/components/chat/ChatInput.tsx:316-475` -- triple trigger detection: `@`, `#`, `/`
**Source:** `jean/src/components/chat/FileMentionPopover.tsx` -- file mention popover
**Source:** `jean/src/components/chat/ContextMentionPopover.tsx` -- issue/PR context popover
**Source:** `jean/src/components/chat/SlashPopover.tsx` -- command/skill popover

Jean detects three inline triggers while typing:
- `@` -- file mentions with fuzzy search, arrow-key navigation, scope switching (Ctrl+Shift+Left/Right)
- `#` -- GitHub issues, PRs, security alerts, Linear issues with lazy loading
- `/` -- slash commands and skills with execution or inline insertion

Each trigger opens a positioned popover with keyboard navigation (ArrowUp/Down, Enter/Tab to select, Escape to close).

**Current AgentHub:** `PromptInput.tsx` has no mention/autocomplete system. Agent selection is a separate dropdown button, model selection is a `<select>`.

**Adoption path:**
- Add `FileMentionPopover` component triggered by `@` -- queries available files via Edge API
- Add `SlashCommandPopover` triggered by `/` -- maps to existing agent capabilities
- Add `#` context mention for future thread/run references
- Reuse the existing popover positioning pattern from the agent selector

**Risk:** High (effort) -- requires new popover infrastructure, file listing API, keyboard navigation.

---

### 4. View Registry with Guard System

**Source:** `emdash/src/renderer/app/view-registry.ts:23-34` -- `ViewDefinition` type with `canActivate` guards

Emdash defines all views (home, library, skills, MCP, project, task, settings) in a central registry. Each view has:
- `WrapView` -- optional layout wrapper
- `TitlebarSlot` -- custom titlebar content
- `MainPanel` -- main content component
- `commandProvider` -- per-view command palette entries
- `canActivate` -- guard that can redirect to another view

**Current AgentHub:** Views are hardcoded in `App.tsx` with conditional rendering (WelcomeScreen vs ChatView vs Skeleton). No central view registry.

**Adoption path:**
- Create `src/views/registry.ts` with view definitions
- Extract WelcomeScreen, ChatView, RunDetail as registered views
- Add `canActivate` for online requirement, thread selection requirement
- This enables adding new views (settings, agent config, logs) without modifying App.tsx

**Risk:** Medium -- architectural change to App.tsx routing.

---

### 5. Execution Mode System (Plan/Build/Yolo)

**Source:** `jean/src/components/chat/ChatToolbar.tsx:390-398` -- `ExecutionModeDropdown`
**Source:** `jean/src/components/chat/ChatInput.tsx:1224-1236` -- mode-specific placeholder text

Jean has three execution modes that control agent behavior:
- **Plan** -- agent creates a plan, waits for approval, then executes
- **Build** -- agent directly executes with permission gates
- **Yolo** -- agent runs with no approval required

Each mode has different placeholder text, different permission behavior, and different backend/model/effort overrides. The mode is displayed in the toolbar and persisted per-session.

**Current AgentHub:** No execution mode concept. The PermissionDialog exists but there is no mode that skips permissions entirely. Model/reasoning selection exists but is not mode-aware.

**Adoption path:**
- Add `executionMode: 'plan' | 'build' | 'yolo'` to run state
- Wire mode to PermissionDialog behavior (yolo = auto-allow all)
- Add mode selector to PromptInput config row
- Update placeholder text per mode

**Risk:** Low-Medium -- extends existing permission system.

---

## P1 -- Should Adopt

### 6. State Management Onion (useState -> Zustand -> TanStack Query)

**Source:** `jean/CLAUDE.md` -- state management onion pattern
**Source:** `jean/src/App.tsx:193-431` -- `seedCache` function that hydrates TanStack Query from server data

Jean layers state management:
- `useState` for component-local UI (popover open, edit states)
- `Zustand` for global UI state (sidebar widths, drafts, streaming contents)
- `TanStack Query` for server/persistent data (sessions, projects, files, git status)

**Current AgentHub:** Uses only Zustand for everything (uiStore, runStore, threadStore, connectionStore). No server-state caching layer means redundant polling and no cache invalidation.

**Adoption path:**
- Add `@tanstack/react-query` for thread list, agent list, run history
- Keep Zustand for UI state only (sidebar widths, theme, drafts)
- Replace the 10s polling `setInterval` loops with `refetchInterval` in query options
- Benefits: automatic cache deduplication, background refetch, stale-while-revalidate

**Risk:** Medium -- introduces new dependency, requires refactoring all data fetching.

---

### 7. Store Performance Pattern (getState in Callbacks)

**Source:** `jean/CLAUDE.md` -- `getState()` avoids render cascades
**Source:** `jean/CLAUDE.md` -- store mutation guards

Jean's critical performance rule: use `useStore.getState()` inside callbacks instead of subscribing via hook selector. This avoids re-creating callbacks when store values change, preventing cascading re-renders.

Additionally, mutations guard against no-op updates: `if (state.field[id] === value) return state` before spreading new objects.

**Current AgentHub:** `App.tsx:244-254` -- `handleSidebarResize` and `handleRightResize` depend on store values in useCallback deps. Every resize recreates the callback.

**Adoption path:**
- Audit all `useCallback` in App.tsx and components
- Replace `useStore(s => s.value)` in callback deps with `useStore.getState().value` inside the callback
- Add mutation guards to runStore, threadStore setters

**Risk:** Low -- mechanical refactor, safe if done carefully.

---

### 8. Full Command Palette (cmdk)

**Source:** `emdash/src/renderer/features/command-palette/command-palette-modal.tsx:1-60` -- cmdk-based palette

Emdash uses the `cmdk` library for a command palette that searches across:
- Tasks (GitBranch icon)
- Projects (FolderOpen icon)
- Conversations (MessageSquare icon)
- Commands (custom icons)
- Notifications group

Results are grouped, keyboard-navigable, and context-aware (affinity scoring based on current project/task).

**Current AgentHub:** `SearchDialog.tsx` only searches chat message text. No cross-entity search, no command execution.

**Adoption path:**
- Add `cmdk` dependency
- Extend SearchDialog to search threads, agents, and run commands
- Add group headers (Messages, Threads, Agents, Commands)
- Wire "Switch Thread", "New Run", "Cancel Run" as executable commands

**Risk:** Medium -- library dependency + UX redesign of search.

---

### 9. Agent Skills Marketplace

**Source:** `picoclaw/web/frontend/src/components/agent/hub/hub-page.tsx` -- marketplace with search
**Source:** `picoclaw/web/frontend/src/components/agent/skills/skills-page.tsx` -- skills CRUD with filters

Picoclaw has a dedicated marketplace for agent skills:
- Search panel with submit flow
- Results panel with loading states
- Install from marketplace
- View installed skills
- Skill detail sheet with detail view modes
- Import via file picker or drag-and-drop (md, zip)
- Filter by source/origin, sort, grid/list layout
- Stats bar (count summaries)
- Delete with confirmation dialog

**Current AgentHub:** `AgentList.tsx` shows static agent list with search filter and capability tags. No marketplace, no install flow, no skill management.

**Adoption path:**
- Add skill/plugin registry concept to AgentList or a new SkillsPage
- Support import of agent configurations (JSON/YAML)
- Add capability-based search (e.g., "show agents that can edit files")
- Stats row: total agents, available, by capability

**Risk:** Medium-High -- new feature area, needs backend API support.

---

### 10. Toast-Based Feedback for Background Operations

**Source:** `jean/CLAUDE.md` -- background operations with toast notifications
**Source:** `jean/src/App.tsx:126-191` -- update download with progress toast

Jean uses `toast.loading()` / `toast.success()` / `toast.error()` for all background operations:
- Git push/pull
- PR creation
- Commit with AI message
- Code review
- Context save/load
- App update download (with progress percentage)

**Current AgentHub:** `Toast.tsx` exists but is minimally used. Operations like `handleCreateThread` and `handleRetryEdge` have no user feedback beyond the banner.

**Adoption path:**
- Wire existing ToastContext to key operations: thread create, run start, run cancel, permission decisions
- Add loading/success/error toasts for Edge API calls
- Consider `sonner` (jean's choice) as a more featureful alternative

**Risk:** Low -- additive UX improvement.

---

## P2 -- Nice to Have

### 11. WebSocket Reconnect Overlay

**Source:** `jean/src/App.tsx:72-81` -- `WsReconnectOverlay` component

Jean shows a full-screen semi-transparent overlay with a spinner and "Reconnecting..." during WebSocket reconnection, preventing the user from seeing stale cached data.

**Current AgentHub:** `App.tsx:333-355` shows a dismissible banner for edge disconnection. No overlay, stale data remains visible.

**Adoption path:** Add a similar overlay component triggered by `!online && wasOnline`.

---

### 12. Centralized Modal Registry

**Source:** `emdash/src/renderer/app/modal-registry.ts` -- modal registration
**Source:** `emdash/src/renderer/App.tsx:89` -- `<ModalRenderer />`

Emdash registers all modals centrally and renders them through a single `<ModalRenderer />` component, avoiding scattered modal rendering logic.

**Current AgentHub:** `App.tsx:553-554` renders `<SearchDialog>` and `<PermissionDialog>` individually. Each new modal requires modifying App.tsx.

**Adoption path:** Create a modal registry so new modals can be added without touching App.tsx.

---

### 13. Resumable Sessions (Crash Recovery)

**Source:** `jean/src/App.tsx:946-1088` -- `check_resumable_sessions` + `resume_session`

Jean checks for running sessions on startup that survived a crash/restart, restores their streaming state, and resumes processing.

**Current AgentHub:** No session resume. A page refresh loses all run state.

**Adoption path:** Requires Edge server support for run persistence. Client-side can poll for running runs on reconnect.

---

### 14. Coordinator Pattern for Multi-Agent Management

**Source:** `crush/internal/agent/coordinator.go:73-80` -- `Coordinator` interface

Crush has a formal `Coordinator` interface with:
- `Run(ctx, sessionID, prompt, attachments)` -- start a session
- `Cancel(sessionID)` -- cancel specific session
- `CancelAll()` -- cancel all sessions
- `IsSessionBusy(sessionID)` -- check session status
- `IsBusy()` -- check if any session is running

**Current AgentHub:** Run management is implicit via `runStore` and `startRun`/`cancelRun` API calls. No formal coordinator abstraction.

**Adoption path:** Extract a `useRunCoordinator` hook that wraps `startRun`, `cancelRun`, and exposes `isBusy`, `activeRunCount`.

---

### 15. Agent Hook Classifier System

**Source:** `emdash/src/main/core/agent-hooks/classifiers/` -- 30+ agent classifiers

Emdash detects which agent is running (cline, cursor, copilot, goose, codex, devin, gemini, kiro, etc.) via terminal output pattern matching, then applies agent-specific hooks and notifications.

**Current AgentHub:** AgentList shows agent names but there is no hook/classifier system for per-agent behavior customization.

**Adoption path:** Future consideration when AgentHub supports multiple agent types with different output formats.

---

### 16. Context Viewer for Attached References

**Source:** `jean/src/components/chat/toolbar/ContextViewerDialog.tsx`

Jean has a ContextViewerDialog that shows attached GitHub issues, PRs, security alerts, Linear issues, and saved contexts in a scrollable overlay.

**Current AgentHub:** No context attachment system exists beyond the message content itself.

**Adoption path:** Future consideration when AgentHub adds GitHub/Linear integration.

---

## Cross-Cutting Architecture Recommendations

### Layout

| Pattern | Source | Priority |
|---|---|---|
| Three-panel resizable layout | **Already in AgentHub** -- App.tsx with ResizeHandle | N/A |
| Mobile responsive overlays | **Already in AgentHub** -- mobileSidebarOpen, mobileRunDetailOpen | N/A |
| Slot-based view composition | emdash view-registry.ts:23-34 | P0#4 |

### Input

| Pattern | Source | Priority |
|---|---|---|
| Uncontrolled textarea with ref | jean ChatInput.tsx:104 | P0#1 |
| Per-session draft persistence | jean ChatInput.tsx:106-108 | P0#2 |
| @file / #issue / /command mentions | jean ChatInput.tsx:316-475 | P0#3 |
| Model + reasoning effort selects | **Already in AgentHub** -- PromptInput.tsx configRow | N/A |

### Agent Management

| Pattern | Source | Priority |
|---|---|---|
| Agent list with capability tags | **Already in AgentHub** -- AgentList.tsx | N/A |
| Execution mode selector | jean ChatToolbar.tsx:390-398 | P0#5 |
| Skills marketplace | picoclaw hub-page.tsx | P1#9 |
| Coordinator interface | crush coordinator.go:73-80 | P2#14 |

### State Architecture

| Pattern | Source | Priority |
|---|---|---|
| Zustand with subscribeWithSelector | **Already in AgentHub** -- all stores | N/A |
| getState() in callbacks | jean CLAUDE.md | P1#7 |
| TanStack Query for server state | jean App.tsx:193-431 | P1#6 |
| Store mutation guards | jean CLAUDE.md | P1#7 |

### Connectivity

| Pattern | Source | Priority |
|---|---|---|
| Health polling with latency display | **Already in AgentHub** -- StatusBar.tsx | N/A |
| WebSocket event streaming | **Already in AgentHub** -- useEventStream.ts | N/A |
| Reconnect overlay | jean App.tsx:72-81 | P2#11 |
| Auth error overlay | jean App.tsx:83-110 | P2#11 |

### Permissions

| Pattern | Source | Priority |
|---|---|---|
| Auto-timeout deny (60s) | **Already in AgentHub** -- PermissionDialog.tsx:167-173 | N/A |
| Dual-channel decide (WS + REST) | **Already in AgentHub** -- App.tsx:271-281 | N/A |
| Execution-mode-aware auto-approve | jean ChatToolbar.tsx (yolo mode) | P0#5 |

### Search & Navigation

| Pattern | Source | Priority |
|---|---|---|
| Message text search | **Already in AgentHub** -- SearchDialog.tsx | N/A |
| Cross-entity command palette | emdash command-palette-modal.tsx | P1#8 |
| Branch navigation (siblings) | **Already in AgentHub** -- SiblingSwitch.tsx | N/A |

### Message Rendering

| Pattern | Source | Priority |
|---|---|---|
| Block-based message model | **Already in AgentHub** -- ChatView.types.ts | N/A |
| Streaming text via hook | **Already in AgentHub** -- useStreamingText.ts | N/A |
| Tool use expand/collapse | **Already in AgentHub** -- ChatView.tsx ToolUseBlock | N/A |
| Diff inline rendering | **Already in AgentHub** -- ChatView.tsx DiffCard | N/A |
| Auto-scroll with indicator | **Already in AgentHub** -- useAutoScroll.ts | N/A |

### Feedback & Notifications

| Pattern | Source | Priority |
|---|---|---|
| Toast system | **Already in AgentHub** -- Toast.tsx + ToastContext | N/A |
| Toast for background ops | jean CLAUDE.md | P1#10 |
| Skeleton loading states | **Already in AgentHub** -- Skeleton.tsx | N/A |
| Error badge in status bar | **Already in AgentHub** -- StatusBar.tsx errorBadge | N/A |

---

## Implementation Sequencing

### Phase 1 (low effort, high impact)
1. P0#1: Uncontrolled input -- 1 file change, immediate perf win
2. P0#2: Input draft persistence -- 2 files, prevents data loss
3. P1#7: getState() performance -- audit callbacks, low risk
4. P1#10: Toast feedback -- wire existing ToastContext to key operations

### Phase 2 (medium effort)
5. P0#5: Execution mode system -- extends permission model
6. P0#4: View registry -- architectural cleanup for future views
7. P1#6: TanStack Query -- new dependency, refactors data fetching
8. P2#11: Reconnect overlay -- improved UX during disconnections

### Phase 3 (higher effort, new features)
9. P0#3: Rich mention system -- significant new UI infrastructure
10. P1#8: Command palette -- new dependency, cross-entity search
11. P1#9: Skills marketplace -- needs backend API support
12. P2#13: Session resume -- needs Edge server support

---

## References

- [jean] `D:\Code\AgentHub\reference\jean\src\` -- Tauri + React desktop agent UI
- [emdash] `D:\Code\AgentHub\reference\emdash\src\renderer\` -- Electron + React desktop
- [crush] `D:\Code\AgentHub\reference\crush\internal\agent\` -- Go TUI agent coordinator
- [picoclaw] `D:\Code\AgentHub\reference\picoclaw\web\frontend\src\` -- React web skill marketplace
- [eca] `D:\Code\AgentHub\reference\eca\src\eca\features\` -- Clojure plugin architecture
- [orca] `D:\Code\AgentHub\reference\orca\src\main\` -- Electron agent orchestrator
- [ruflo] `D:\Code\AgentHub\reference\ruflo\plugins\` -- TypeScript plugin framework
- [AgentHub] `D:\Code\AgentHub\app\desktop\src\` -- Target codebase
