# AgentHub Keyboard Shortcuts System -- Design Specification

> Based on: `design-desktop-ux.md`, `opcode.md` (source analyzed), `kanna.md`, `cloudcli.md`
> Date: 2026-05-21
> Status: Draft v1.0

---

## 1. Design Principles

1. **ModKey-adaptive**: `Ctrl` on Windows/Linux, `Cmd` on macOS. All specs below use `Ctrl` as the representative.
2. **Scoped activation**: Shortcuts are dispatched to the focused context layer, not globally swallowed.
3. **Discoverable**: Command Palette (`Ctrl+K`) surfaces all actions with their bound shortcuts.
4. **Vim/J-inspired navigation**: `j/k` for list navigation in focused panels, `n/p` for next/previous file-level movement.
5. **No modifier conflict with editor**: Chat input and Diff review shortcuts use modifiers sparingly to avoid colliding with native Monaco/textarea behavior.

---

## 2. Shortcut Layers

AgentHub organizes shortcuts into 7 scoped layers. Each layer activates only when its target DOM region is focused or when its parent view is active.

| Layer | Scope | Activation |
|-------|-------|------------|
| `global` | Entire app (desktop shell) | Always, unless input is focused |
| `tab-mgmt` | Tab bar | When `view === "tabs"` and no input focused |
| `chat-input` | ComposeArea textarea | When textarea is focused |
| `message-tree` | CenterChat MessageTree | When message list container is focused |
| `diff-review` | RightPanel Diff tab | When DiffPanel is the active right-panel tab |
| `file-tree` | RightPanel Files tab | When FileTreeBody is focused |
| `code-editor` | Monaco/CodeMirror | When editor container is focused |

---

## 3. Shortcut Inventory

### 3.1 Global Layer (Desktop)

| Shortcut | Action | Conflict Check |
|----------|--------|----------------|
| `Ctrl+K` | Open Command Palette / Global Search | No native conflict |
| `Ctrl+,` | Open Settings | No native conflict |
| `Ctrl+B` | Toggle left sidebar | No native conflict |
| `Ctrl+J` | Toggle right panel | VS Code `Ctrl+J` is terminal; AgentHub uses `Ctrl+\` for terminal |
| `Ctrl+\` | Toggle Terminal (right panel) | VS Code convention |
| `Ctrl+Shift+F` | Focus global search (alternate to `Ctrl+K`) | VS Code convention |
| `F11` | Toggle fullscreen (Tauri) | Standard |
| `Escape` | Close topmost modal / overlay / dismiss focus | Standard |

### 3.2 Tab Management Layer (Opcode-derived)

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+T` | New chat tab / New thread | Opcode origin; dispatches via `CustomEvent` |
| `Ctrl+W` | Close active tab | Opcode origin |
| `Ctrl+Tab` | Next tab (cycle right) | Opcode origin |
| `Ctrl+Shift+Tab` | Previous tab (cycle left) | Opcode origin |
| `Ctrl+1` through `Ctrl+9` | Switch to tab by 1-indexed position | Opcode origin. `Ctrl+0` = last tab |

### 3.3 Chat Input Layer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Enter` | Send message | Only when not IME composing. If expanded input, requires no `Shift`. |
| `Shift+Enter` | Insert newline | Standard |
| `Ctrl+Shift+Enter` | Send with approval confirmation | Safety gate for destructive prompts |
| `Escape` | Blur input / close @mention popover / close file picker | Opcode pattern (FloatingPromptInput) |
| `Ctrl+V` | Paste (with image detection) | Paste images as inline attachments |
| `@` | Trigger @mention popover | Character trigger, not chord |
| `/` | Trigger slash command picker | Opcode pattern (SlashCommandPicker) |
| `Ctrl+Shift+E` | Expand/collapse input area | Opcode pattern |

### 3.4 Message Tree Navigation Layer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `j` / `ArrowDown` | Next message (scroll into view) | Only when message list is focused |
| `k` / `ArrowUp` | Previous message | Only when message list is focused |
| `Enter` | Expand/collapse focused message (Thinking, ToolUse) | Progressive disclosure |
| `Space` | Toggle expand/collapse tool result under cursor | Alternative to Enter |
| `Shift+Enter` | Open focused diff in RightPanel | When focused message has a diff |
| `Escape` | Collapse all expanded layers / return focus to input | Kanna pattern (keybinding action) |
| `Ctrl+Enter` | Approve / submit inline approval card | When approval card is focused |

### 3.5 Diff Review Layer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `n` | Next file in diff file list | Vim convention (`n`ext) |
| `p` | Previous file in diff file list | Vim convention (`p`revious) |
| `j` | Next hunk in current file | Context-relative to focused diff |
| `k` | Previous hunk in current file | |
| `Enter` | Expand/collapse current file diff | |
| `Ctrl+Enter` | Apply current hunk | From design-desktop-ux DiffCard |
| `Ctrl+Shift+Enter` | Apply all hunks in current file | |
| `Ctrl+A` | Select all staged files | |
| `Escape` | Dismiss diff / return to chat | |
| `Ctrl+M` | Generate AI commit message | From CloudCLI pattern |
| `Ctrl+Shift+M` | Commit with generated/typed message | |

### 3.6 File Tree Layer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `ArrowUp/Down` | Navigate file tree nodes | |
| `ArrowRight` | Expand directory | |
| `ArrowLeft` | Collapse directory | |
| `Enter` | Open file (opens diff in right panel) | |
| `Space` | Toggle expand/collapse directory | |
| `Ctrl+N` | New file dialog | VS Code convention |
| `Ctrl+Shift+N` | New folder dialog | VS Code convention |
| `F2` | Rename focused file/dir | Standard |
| `Delete` | Delete focused file/dir (confirmation modal) | |
| `Ctrl+C` | Copy file path to clipboard | When tree item focused, not text selection |

### 3.7 Code Editor Layer (Monaco-inherited)

Inherits Monaco defaults. AgentHub overrides:

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+S` | Save (if editable artifact) | Standard |
| `Ctrl+Shift+S` | Save as new version | AgentHub-specific |
| `Ctrl+Shift+R` | Open artifact preview in RightPanel Preview tab | |
| `Ctrl+Shift+D` | Open agent diff comparison | Side-by-side agent output compare |

---

## 4. Right Panel Tab Quick Switch

When right panel is open, number keys switch tabs without modifier. The mapping follows the tab bar order:

| Key | Tab |
|-----|-----|
| `1` | Files |
| `2` | Diff |
| `3` | Preview |
| `4` | Git |
| `5` | Logs |
| `6` | Terminal |

Only active when right panel is focused (not consumed when chat input is focused).

---

## 5. Implementation Architecture

### 5.1 Event Dispatch Model (Opcode Pattern)

Follow Opcode's `CustomEvent` dispatch via `window` for tab management. Layer-aware shortcuts use React `onKeyDown` in the focused component.

```
Global layer:    window.addEventListener('keydown', ...)
                 → dispatch to action registry
Tab layer:       customEvents ('create-chat-tab', 'close-current-tab', ...)
Chat input:      React onKeyDown on textarea
Message tree:    React onKeyDown on message list container
Diff/File/Editor: React onKeyDown on panel container
```

### 5.2 Hook Architecture

```ts
// src/hooks/useKeyboardShortcuts.ts
function useKeyboardShortcuts(layer: ShortcutLayer, bindings: ShortcutBinding[]) {
  // Returns { register, unregister } for the given layer
  // Non-global layers: binds to container ref via onKeyDown
  // Global layer: binds to window keydown with layer filter
}

// src/hooks/useGlobalShortcuts.ts
function useGlobalShortcuts(bindings: ShortcutBinding[]) {
  // App-level bindings: Ctrl+K, Ctrl+,, Ctrl+B, Ctrl+J, Ctrl+\, F11, Escape
}
```

### 5.3 Shortcut Registry & User Overrides

```ts
// src/lib/shortcuts.ts
interface ShortcutBinding {
  id: string                      // unique action id, e.g. "global.toggle-sidebar"
  layer: ShortcutLayer
  keys: string                    // "Ctrl+B"
  action: () => void
  label: string                   // "Toggle Sidebar"
  description?: string
  disabled?: () => boolean        // runtime guard
}

// Read from Settings > ShortcutSettings panel
// Stored in localStorage: "ah_shortcuts_overrides"
```

### 5.4 Conflict Resolution

- Editor layer (Monaco) consumes standard editing shortcuts first (`Ctrl+S`, `Ctrl+F`, `Ctrl+/`), preventing global propagation.
- Chat input captures `Enter` / `Escape` / `@` / `/` before they reach global layer.
- Global `Ctrl+K` never fires when textarea is focused (checked via `document.activeElement` tag).
- Tab `Ctrl+W` does NOT close the browser/tab when agent response is in progress; shows confirmation dialog instead.

---

## 6. Desktop-Only vs Cross-Platform

| Scope | Desktop (Tauri) | Web |
|-------|----------------|-----|
| `Ctrl+T/W/Tab/1-9` | Yes | Yes (Caveat: `Ctrl+W` may close browser tab; intercepted via `e.preventDefault()`) |
| `Ctrl+K` | Yes | Yes |
| `Ctrl+B` / `Ctrl+J` / `Ctrl+\` | Yes | Yes |
| `F11` | Yes (Tauri fullscreen) | Browser-native, not intercepted |
| Global shortcuts via Tauri plugin | `global-shortcut` plugin | N/A |
| `Ctrl+Shift+I` (DevTools) | Tauri: disabled | Browser: native |
| File tree `Ctrl+N` | Yes | Yes |

**Note**: On web, `Ctrl+W` must unconditionally `preventDefault()` to avoid closing the browser tab. Tauri desktop has no such risk.

---

## 7. Reference Summary

| Source | Patterns Imported |
|--------|------------------|
| **Opcode** (`App.tsx:101-141`, `TabManager.tsx:171-224`) | Tab management shortcuts (`Ctrl+T/W/Tab/1-9`), CustomEvent dispatch model, `Ctrl+Shift+E` expand input, Escape close pickers |
| **Kanna** (`kanna.md:68`) | Global keydown listener matching keybinding actions, per-action toggle semantics (toggle terminal, toggle sidebar) |
| **CloudCLI** (`cloudcli.md:34-43`) | `Ctrl+M` AI commit message generation pattern, no app-level shortcut conflicts |
| **design-desktop-ux.md** | `Ctrl+K` command palette, `Ctrl+Enter` comment submit, `Enter`/`Shift+Enter` input semantics, `Ctrl+N` new file |
| **VS Code / Monaco** | `Ctrl+\,` for terminal, `Ctrl+B` for sidebar, `Ctrl+J` for panel toggle, `Ctrl+,` for settings, editor-native shortcuts |
