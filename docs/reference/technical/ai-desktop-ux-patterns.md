# Modern AI Desktop App UX Patterns

> Study of: Claude Desktop, ChatGPT Desktop, Cursor, Windsurf, and similar AI desktop apps
> Author: Researcher 4 — Modern AI Desktop App UX Patterns
> Date: 2026-05-25

---

## 1. Executive Summary

Modern AI desktop apps have converged on a set of UX patterns that users now expect. AgentHub Desktop, as a Tauri 2 + React 19 app, sits at the intersection of "AI coding assistant" (like Cursor/Windsurf) and "AI agent platform" (like Claude Desktop). The best patterns from both categories should inform AgentHub's UX design.

**Key takeaway**: AgentHub should aim for the "premium developer tool" aesthetic — warm, minimal, fast, keyboard-driven — with AI-specific flourishes that signal intelligence and capability without feeling gimmicky.

---

## 2. Chat Input Patterns

### 2.1 What the Best Apps Do

| App | Input Style | Key Features |
|-----|------------|--------------|
| **Claude Desktop** | Multi-line textarea, grows vertically | File attachments, project context selector, model picker |
| **ChatGPT Desktop** | Single-line expands to multi-line | Voice input, image upload, web search toggle, reasoning toggle |
| **Cursor** | Command palette + inline editing | Ctrl+K for quick edits, inline code generation |
| **Windsurf** | Chat panel + inline suggestions | Cascade (agentic) vs manual mode toggle, context @-mentions |

### 2.2 Common Patterns

1. **Multi-line input that auto-grows**: Single-line by default, expands as content grows. Shift+Enter for newline, Enter to send.
2. **Context injection via @-mentions**: @file, @folder, @agent, @model — mention anything to inject context.
3. **Mode toggles in/near input**: Agent mode vs chat mode, reasoning on/off, web search on/off.
4. **Attachment buttons**: Upload files, images, code snippets. Drag-and-drop support.
5. **Stop generation button**: Visible while streaming, replaces send button.
6. **Character/token counter**: Optional, shown near long inputs.

### 2.3 What AgentHub Should Do

Current state: AgentHub has a basic prompt input via the `prompt-input` slot. It supports agent selection and model options but lacks context injection and mode toggles.

**Recommended improvements (in priority order):**
1. **@-file mention** — Inject file/folder context into prompt (P0)
2. **Mode toggles** — Reasoning effort, auto-review, web access near input (P1)
3. **Attachment support** — Drag-drop files, images into chat (P1)
4. **Model/provider picker in input area** — Quick switch without going to settings (P1)
5. **Token counter** — Show estimated token count for long prompts (P2)

---

## 3. Message Display Patterns

### 3.1 What the Best Apps Do

| App | Message Style | Key Features |
|-----|--------------|--------------|
| **Claude Desktop** | Clean, minimal | Collapsible thinking, artifact cards, code blocks with copy, tool calls inline |
| **ChatGPT Desktop** | Bubbles with avatars | Image rendering, code with syntax highlighting, canvas mode for editing |
| **Cursor** | Chat panel, diff-focused | Inline diffs, apply/discard buttons, "Accept all" for changes |
| **Windsurf** | Chat with explicit actions | "Apply to file" buttons, diff preview, suggested next actions |

### 3.2 Common Patterns

1. **User messages**: Right-aligned or clearly distinguished from agent messages. Usually minimal — just the text, no avatar needed.
2. **Agent messages**: Left-aligned with a small agent/model indicator. Markdown rendering with code blocks, tables, lists.
3. **Streaming text**: Character-by-character or chunk-by-chunk with a blinking cursor at the end. Smooth animation, no jarring jumps.
4. **Tool calls**: Collapsible cards showing tool name, input summary, and status. Expand for full details.
5. **Thinking/reasoning**: Collapsible section, often with a "Thinking..." header. Content is the model's chain-of-thought.
6. **Code blocks**: Syntax highlighting, language label, copy button on hover, optional line numbers.
7. **File diffs**: Side-by-side or unified view with color-coded additions (green) and deletions (red).
8. **Citations/sources**: Inline links or footnotes when the model references specific files or URLs.

### 3.3 What AgentHub Should Do

Current state: ChatView.tsx renders messages with MarkdownRenderer, CodeBlock, and tool call cards. It supports streaming text and thinking display.

**Recommended improvements:**
1. **Tool call cards redesign** — Status indicators, expandable details, color coding (P0)
2. **Thinking display** — Animated "Thinking..." with expandable chain-of-thought (P0)
3. **Diff view integration** — Inline diffs in messages with "Apply" button (P1)
4. **Message actions** — Copy, retry, delete, "Continue generating" per message (partially done)
5. **Code block enhancements** — Language detection, copy feedback animation, line numbers (P1)

---

## 4. Tool Call Visualization

### 4.1 Common Approaches

| App | Tool Display | Visual Style |
|-----|-------------|--------------|
| **Claude Desktop** | Inline cards in chat | Tool name + status icon + collapsible details |
| **Cursor** | Progress indicators | Spinner + "Applying changes..." with file names |
| **ChatGPT** | Inline with function name | "Used code_interpreter" with expandable output |
| **Windsurf** | Explicit action cards | "Cascade is editing file.ts" with diff preview |

### 4.2 Recommended Pattern for AgentHub

```
┌─────────────────────────────────────────────────┐
│ 🔍 Grep — Completed (0.3s)            [Expand]  │
│ Searching for "useAuth" in src/                  │
├─────────────────────────────────────────────────┤
│ Results: 5 matches in 3 files                    │
│ src/hooks/useAuth.ts:12                          │
│ src/components/AuthPage.tsx:8                    │
│ src/components/LoginForm.tsx:23                  │
└─────────────────────────────────────────────────┘
```

- **Status indicator**: Spinner for running, check for completed, X for failed
- **Duration**: Show elapsed time for each tool call
- **Summary line**: One-line description of what the tool is doing
- **Expand/collapse**: Click to see full input/output
- **Color coding**: Running = blue/amber, success = green, error = red

---

## 5. Diff Viewing Patterns

### 5.1 What the Best Apps Do

| App | Diff Style | Key Features |
|-----|-----------|--------------|
| **Cursor** | Side-by-side + unified | "Accept" / "Reject" per hunk, "Accept All", keyboard navigation |
| **Windsurf** | Inline in chat | Diff preview before applying, "Apply" / "Discard" buttons |
| **GitHub Copilot** | Inline suggestions | Ghost text, Tab to accept, "Accept all" for bulk changes |

### 5.2 Recommended Pattern for AgentHub

- **Unified diff by default** with line numbers and color-coded changes
- **Per-hunk actions**: Apply / Discard / Edit
- **Bulk actions**: "Accept All Changes" / "Discard All"
- **File-level summary**: "3 files changed: +45 -12"
- **Keyboard navigation**: j/k to move between hunks, Enter to apply, Escape to dismiss
- **Preview mode**: Before applying, show a side-by-side view

---

## 6. File Browsing Patterns

### 6.1 What the Best Apps Do

| App | File UI | Key Features |
|-----|---------|--------------|
| **Cursor** | Explorer panel + tabs | File tree, open editors, search across files |
| **Windsurf** | File tree + context | @-mention files, file context in chat |
| **VS Code** | Full IDE file browser | Workspace folders, git decorations, file icons |

### 6.2 Recommended Pattern for AgentHub

- **File tree in left sidebar**: Collapsible, with file type icons and git status badges
- **Changed files list in right panel**: During/after agent runs, show modified files
- **Click to preview**: Click a file to see its content or diff in the main area
- **@-mention support**: Type @ in chat to search and select files from the tree

---

## 7. Sidebar Navigation Patterns

### 7.1 What the Best Apps Do

| App | Sidebar Style | Contents |
|-----|-------------|----------|
| **Claude Desktop** | Left sidebar with project selector | Projects, conversations, settings |
| **ChatGPT Desktop** | Left sidebar | Chat history, GPTs, settings |
| **Cursor** | Left sidebar (explorer) + right sidebar (chat) | Files, search, source control, extensions |
| **Windsurf** | Left sidebar (explorer) + right panel (chat) | Files, cascade panel |

### 7.2 Common Patterns

1. **Collapsible sidebar**: Icon rail when collapsed, full sidebar when expanded
2. **Resizable**: Drag handle to resize, with min/max constraints
3. **Sections with labels**: Agents, Threads, Files — each with a section header
4. **Search at top**: Quick filter/search within the sidebar
5. **Context-sensitive**: Content changes based on active mode

### 7.3 AgentHub Assessment

Current state: Good. The left sidebar has agents section + threads section + search. It supports collapse to rail and resize. The right rail/panel has task and scheduling shortcuts.

**Recommended improvements:**
1. **File tree section** — Add a file tree to the left sidebar (P1)
2. **Section reordering** — Allow users to reorder sidebar sections (P2)
3. **Context indicators** — Show active agent/model in sidebar header (P1)
4. **Quick actions footer** — Settings, theme, hub connection in a consistent footer (done)

---

## 8. Settings Page Patterns

### 8.1 What the Best Apps Do

| App | Settings Style | Key Features |
|-----|---------------|--------------|
| **Claude Desktop** | Modal/popover | Theme, model, API key |
| **Cursor** | Full-page settings | Tabbed categories, search, import/export |
| **VS Code** | Full-page JSON/text settings | GUI + JSON editor, search, extensions |

### 8.2 Common Patterns

1. **Sidebar navigation**: Categories → sections, with group labels
2. **Search**: Search across all settings
3. **Toggle switches**: For boolean settings with clear labels and descriptions
4. **Dropdowns**: For enumerated options
5. **Cards**: For grouped, related settings
6. **Import/export**: JSON export of settings configuration

### 8.3 AgentHub Assessment

Current state: SettingsPage.tsx is comprehensive with 30+ sections, sidebar navigation, toggle switches, select dropdowns, summary cards, and capability cards. This is well-implemented.

**Recommended improvements:**
1. **Settings search** — Search across all section names and descriptions (P1)
2. **Settings groups** — Collapse "Workspace", "Automation", "System" groups (P2)
3. **Import/export** — Export settings as JSON, import from file (P2)
4. **Reset to defaults** — Per-section or global reset (P2)

---

## 9. Command Palette Patterns

### 9.1 What the Best Apps Do

| App | Trigger | Features |
|-----|---------|----------|
| **Cursor** | Ctrl+K / Cmd+K | File search, symbol search, commands, AI chat |
| **VS Code** | Ctrl+Shift+P | All commands with keyboard shortcuts shown |
| **Raycast** | Opt+Space | Everything — files, apps, clipboard, snippets |
| **Linear** | Cmd+K | Issue search, command execution, quick nav |

### 9.2 Recommended Pattern for AgentHub

- **Trigger**: Ctrl+K / Cmd+K (standard for developer tools)
- **Contents**: Agents, threads, settings sections, recent files, commands
- **Actions**: "New Thread", "Open Settings → Models", "Switch to Dark Mode"
- **Preview**: Show keyboard shortcut next to each command
- **Recent/Frequent**: Sort by usage, show recent items first
- **Empty state**: "Type to search agents, threads, settings..."

---

## 10. Keyboard Shortcuts

### 10.1 Standard AI Desktop Shortcuts

| Shortcut | Action | Universal? |
|----------|--------|------------|
| `Enter` | Send message | Yes |
| `Shift+Enter` | New line in chat | Yes |
| `Ctrl/Cmd+K` | Command palette | Yes |
| `Ctrl/Cmd+B` | Toggle sidebar | Common |
| `Ctrl/Cmd+J` | Toggle right panel | Common |
| `Escape` | Close/dismiss | Yes |
| `Ctrl/Cmd+Shift+C` | Copy last response | Claude |
| `Ctrl/Cmd+/` | Show keyboard shortcuts | Common |
| `Ctrl/Cmd+L` | New thread | Common |
| `Ctrl/Cmd+,` | Open settings | Common |

### 10.2 AgentHub Assessment

Current shortcuts from App.tsx:
- `Enter`: Send (via prompt-input)
- `Shift+Enter`: Newline (via prompt-input)
- `Ctrl/Cmd+B`: Toggle left sidebar
- `Ctrl/Cmd+J`: Toggle right panel
- `Escape`: Close nav panel
- `?`: Toggle shortcut help

**Recommended additions:**
1. `Ctrl/Cmd+K`: Command palette (P0)
2. `Ctrl/Cmd+L`: New thread (P1)
3. `Ctrl/Cmd+,`: Open settings (P1)
4. `Ctrl/Cmd+Shift+R`: Retry last run (P2)
5. `Ctrl/Cmd+.`: Cancel current run (P2)

---

## 11. What Makes an AI Desktop App Feel "Premium"

### 11.1 The "Premium Developer Tool" Aesthetic

After studying Cursor, Linear, Raycast, and Claude Desktop, these are the factors that make an app feel premium:

1. **Typography**: Custom or carefully-chosen fonts. Cursor's CursorGothic + jjannon serif, Claude's Anthropic Serif. The right typography elevates everything.

2. **Color warmth**: Premium developer tools avoid pure grays. Cursor uses warm off-white (`#f2f1ed`), Claude uses parchment (`#f5f4ed`), Linear uses warm dark surfaces. Pure #000 and #fff feel cheap.

3. **Micro-interactions**: Smooth 150-200ms transitions on hover/press. Scale transforms on buttons. Subtle shadows. Animated checkmarks. These small details add up.

4. **Spacing generosity**: Premium apps use generous padding and margins. Things breathe. Crowded UIs feel "dev tool" rather than "premium tool."

5. **Consistent depth**: Shadows, borders, and elevation are consistent. Cursor uses oklab borders at consistent alpha levels. Claude uses ring-based shadows.

6. **Sound design**: Subtle audio feedback for actions (Cursor has distinct sounds for accept/reject). Optional but powerful.

7. **Smooth animations**: Page transitions, panel slides, message entries all animated. Not gimmicky — purposeful and fast (150-300ms).

8. **Empty state design**: Premium apps invest in empty states — illustrations, helpful text, clear CTAs. Not just "No results found."

### 11.2 What to Avoid (Dev Tool Feel)

1. **System default everything**: Default fonts, default colors, default spacing = "I didn't design this."
2. **Inconsistent spacing**: Some things tight, some loose, no system.
3. **Raw unstyled HTML elements**: Unstyled selects, checkboxes, scrollbars.
4. **Jarring layout shifts**: Content jumping as things load.
5. **Generic error messages**: "An error occurred" vs "Connection to Claude Code lost. The process may have crashed. Retry?"

---

## 12. Streaming Response Patterns

### 12.1 Common Approaches

| App | Streaming Style | User Experience |
|-----|----------------|-----------------|
| **Claude Desktop** | Token-by-token | Smooth text appearing, thinking section collapses when done |
| **ChatGPT Desktop** | Word-by-word | Fast chunks, cursor at end, markdown renders progressively |
| **Cursor** | Block-by-block | Code blocks appear fully, text streams in between |
| **Windsurf** | Tool-first | Shows tool being used, then streams result |

### 12.2 Recommended Pattern for AgentHub

- **Text streaming**: Character-by-character with 30-50ms delay, smooth appearance
- **Thinking display**: Collapsible "Thinking..." section that auto-collapses when the actual response starts
- **Tool calls**: Appear as cards during streaming, update status in real-time
- **Code blocks**: Stream line by line, apply syntax highlighting after streaming completes
- **Markdown**: Progressive rendering — don't wait for full response to render

---

## 13. Thinking/Reasoning Display

### 13.1 What the Best Apps Do

| App | Thinking Display | Notes |
|-----|-----------------|-------|
| **Claude Desktop** | "Thinking..." collapsible block | Shows reasoning, auto-collapses when response starts |
| **ChatGPT Desktop** | "Thinking..." indicator | Minimal — just shows it's processing |
| **DeepSeek** | Full chain-of-thought display | Shows complete reasoning with R1 models |
| **Cursor** | Inline reasoning in chat | Brief thinking summary, expandable |

### 13.2 Recommended Pattern for AgentHub

```tsx
// ThinkingBlock component with auto-collapse
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true); // Start expanded

  return (
    <div className={styles.thinking}>
      <button onClick={() => setExpanded(!expanded)}>
        <BrainIcon size={14} />
        <span>Thinking</span>
        <ChevronIcon expanded={expanded} />
      </button>
      {expanded && <pre>{content}</pre>}
    </div>
  );
}
```

- **Start expanded**: Users want to see thinking at first
- **Auto-collapse**: When the actual response starts streaming, collapse thinking
- **Re-expandable**: Click to see thinking again
- **Duration**: Show how long thinking took

---

## 14. Summary — AgentHub Desktop UX Roadmap

### P0 (This Week) — Foundation
1. Tool call card redesign (status, duration, expand, color coding)
2. Thinking block with auto-collapse
3. Emoji tool icons → SVG icons
4. @lobehub/icons integration for model/provider icons
5. Consistent icon sizing (15px inline, 17px nav, 20px cards)

### P1 (Next Week) — Polish
6. Command palette (Ctrl+K)
7. @-file mention in chat input
8. Mode toggles near input (reasoning, auto-review, web)
9. Diff view with accept/reject per hunk
10. Settings search
11. Additional keyboard shortcuts (Ctrl+L, Ctrl+,)
12. Streaming animation polish

### P2 (This Month) — Premium Feel
13. Typography system (custom font stack, type scale)
14. Micro-interaction system (hover/press transitions, easing tokens)
15. Color warmth (move from pure grays to warm-toned neutrals)
16. Sound design (optional audio feedback)
17. Illustrated empty states
18. Settings import/export
19. Token counter in input
20. File tree in sidebar
