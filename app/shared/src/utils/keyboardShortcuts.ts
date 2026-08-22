/* ═══════════════════════════════════════════════════════════════════════
   Shared keyboard shortcut declarations — types, canonical groups, and
   localStorage-backed custom-binding helpers.

   This file lives in shared so the Settings page can render shortcut
   groups without depending on the desktop layer.  Desktop-layer code
   (matchesBinding, deriveKeysFromEvent, useGlobalKeyboardShortcuts)
   imports from @/utils/keyboardShortcuts which re-exports from here
   and adds event-specific helpers.
   ═══════════════════════════════════════════════════════════════════════ */

export type ShortcutGroupId = 'conversation' | 'composer' | 'navigation' | 'workspace' | 'selection';

export interface KeyboardShortcut {
  /** Unique shortcut id (kebab-case). */
  id: string;
  /** Canonical key tokens, e.g. ['Ctrl/⌘', 'K'] or ['Shift', 'Enter']. */
  keys: string[];
  /** i18n key for the human-readable label. */
  labelKey: string;
  /** Optional i18n key for a longer description. */
  detailKey?: string;
}

export interface KeyboardShortcutGroup {
  id: ShortcutGroupId;
  labelKey: string;
  shortcuts: KeyboardShortcut[];
}

/** Canonical shortcut groups — single source of truth for all keyboard bindings. */
export const KEYBOARD_SHORTCUT_GROUPS: KeyboardShortcutGroup[] = [
  {
    id: 'conversation',
    labelKey: 'shortcut.group.conversation',
    shortcuts: [
      { id: 'new-thread', keys: ['Ctrl/⌘', 'N'], labelKey: 'shortcut.newThread', detailKey: 'shortcut.newThread.detail' },
      { id: 'quick-chat', keys: ['Ctrl/⌘', 'Alt', 'N'], labelKey: 'shortcut.quickChat', detailKey: 'shortcut.quickChat.detail' },
      { id: 'search', keys: ['Ctrl/⌘', 'K'], labelKey: 'shortcut.search', detailKey: 'shortcut.search.detail' },
      { id: 'chat-search', keys: ['Ctrl/⌘', 'F'], labelKey: 'shortcut.chatSearch', detailKey: 'shortcut.chatSearch.detail' },
    ],
  },
  {
    id: 'composer',
    labelKey: 'shortcut.group.composer',
    shortcuts: [
      { id: 'send', keys: ['Enter'], labelKey: 'shortcut.send', detailKey: 'shortcut.send.detail' },
      { id: 'newline', keys: ['Shift', 'Enter'], labelKey: 'shortcut.newline', detailKey: 'shortcut.newline.detail' },
      { id: 'slash', keys: ['/'], labelKey: 'shortcut.slashCommands', detailKey: 'shortcut.slashCommands.detail' },
      { id: 'mention', keys: ['@'], labelKey: 'shortcut.mention', detailKey: 'shortcut.mention.detail' },
    ],
  },
  {
    id: 'navigation',
    labelKey: 'shortcut.group.navigation',
    shortcuts: [
      { id: 'help', keys: ['?'], labelKey: 'shortcut.help', detailKey: 'shortcut.help.detail' },
      { id: 'close', keys: ['Esc'], labelKey: 'shortcut.close', detailKey: 'shortcut.close.detail' },
      { id: 'toggle-sidebar', keys: ['Ctrl/⌘', 'B'], labelKey: 'shortcut.toggleSidebar', detailKey: 'shortcut.toggleSidebar.detail' },
      { id: 'toggle-run-panel', keys: ['Ctrl/⌘', 'J'], labelKey: 'shortcut.toggleRunPanel', detailKey: 'shortcut.toggleRunPanel.detail' },
    ],
  },
  {
    id: 'workspace',
    labelKey: 'shortcut.group.workspace',
    shortcuts: [
      { id: 'open-folder', keys: ['Ctrl/⌘', 'O'], labelKey: 'shortcut.openFolder', detailKey: 'shortcut.openFolder.detail' },
      { id: 'settings', keys: ['Ctrl/⌘', ','], labelKey: 'shortcut.settings', detailKey: 'shortcut.settings.detail' },
      { id: 'close-window', keys: ['Ctrl/⌘', 'W'], labelKey: 'shortcut.closeWindow', detailKey: 'shortcut.closeWindow.detail' },
    ],
  },
  {
    // #1823: box-selection transcript hotkeys (registered for the Settings
    // registry; they are selection-mode scoped, not rebindable — resolveSelectionHotkey
    // in the workbench chrome owns the bindings).
    id: 'selection',
    labelKey: 'shortcut.group.selection',
    shortcuts: [
      { id: 'select-all-messages', keys: ['Ctrl/⌘', 'A'], labelKey: 'shortcut.selectAll', detailKey: 'shortcut.selectAll.detail' },
      { id: 'copy-selected-messages', keys: ['Ctrl/⌘', 'C'], labelKey: 'shortcut.copySelected', detailKey: 'shortcut.copySelected.detail' },
      { id: 'delete-selected-messages', keys: ['Delete'], labelKey: 'shortcut.deleteSelected', detailKey: 'shortcut.deleteSelected.detail' },
    ],
  },
];

/** Flattened array of all keyboard shortcuts. */
export const KEYBOARD_SHORTCUTS = KEYBOARD_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

// ── Custom keybinding overrides (localStorage-backed) ──────

export interface CustomKeybinding {
  id: string;
  keys: string[];
}

const CUSTOM_BINDINGS_KEY = 'agenthub-custom-keybindings';

function loadCustomBindings(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CUSTOM_BINDINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Resolve shortcut groups with any user-customized bindings applied.
 * Custom bindings are stored in localStorage under `agenthub-custom-keybindings`.
 */
export function getResolvedShortcutGroups(): KeyboardShortcutGroup[] {
  const custom = loadCustomBindings();
  return KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.map((s) =>
      s.id in custom ? { ...s, keys: custom[s.id]! } : s,
    ),
  }));
}

export function hasCustomKeybindings(): boolean {
  return Object.keys(loadCustomBindings()).length > 0;
}

export function saveCustomKeybindings(bindings: CustomKeybinding[]): void {
  const obj: Record<string, string[]> = {};
  for (const b of bindings) {
    obj[b.id] = b.keys;
  }
  localStorage.setItem(CUSTOM_BINDINGS_KEY, JSON.stringify(obj));
}

export function resetKeybindings(): void {
  localStorage.removeItem(CUSTOM_BINDINGS_KEY);
}

/** Look up the canonical binding for a shortcut by id. */
export function getBinding(id: string): string[] | undefined {
  return KEYBOARD_SHORTCUTS.find((s) => s.id === id)?.keys;
}

/**
 * Check for binding conflicts against the canonical shortcut config.
 * Returns the conflicting shortcut, or null if no conflict.
 */
export function checkConflicts(keys: string[], capturingId: string): KeyboardShortcut | null {
  const keyStr = keys.join('+');
  for (const group of KEYBOARD_SHORTCUT_GROUPS) {
    for (const s of group.shortcuts) {
      if (s.id === capturingId) continue;
      if (s.keys.join('+') === keyStr) return s;
    }
  }
  return null;
}
