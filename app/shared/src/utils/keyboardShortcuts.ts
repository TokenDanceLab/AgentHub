/* ═══════════════════════════════════════════════════════════════════════
   Shared keyboard shortcut declarations — types, canonical groups, and
   localStorage-backed custom-binding helpers.

   This file lives in shared so the Settings page can render shortcut
   groups without depending on the desktop layer.  Desktop-layer code
   (matchesBinding, deriveKeysFromEvent, useGlobalKeyboardShortcuts)
   imports from @/utils/keyboardShortcuts which re-exports from here
   and adds event-specific helpers.
   ═══════════════════════════════════════════════════════════════════════ */

import type { KeyboardEventLike } from './keyboardUtils';

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
  /**
   * When false the shortcut is declarative only: the registry renders it,
   * but custom binding resolution and persistence ignore it (#1823
   * selection-mode hotkeys — resolveSelectionHotkey owns the fixed keys).
   */
  rebindable?: boolean;
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
      // #1822/#1853: quick-open is a live binding (inspector Files tab) — it
      // lives in the canonical table so the recorder detects conflicts with
      // its reserved combo.
      { id: 'quick-open', keys: ['Ctrl/⌘', 'P'], labelKey: 'shortcut.quickOpen', detailKey: 'shortcut.quickOpen.detail' },
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
      { id: 'select-all-messages', keys: ['Ctrl/⌘', 'A'], labelKey: 'shortcut.selectAll', detailKey: 'shortcut.selectAll.detail', rebindable: false },
      { id: 'copy-selected-messages', keys: ['Ctrl/⌘', 'C'], labelKey: 'shortcut.copySelected', detailKey: 'shortcut.copySelected.detail', rebindable: false },
      { id: 'delete-selected-messages', keys: ['Delete'], labelKey: 'shortcut.deleteSelected', detailKey: 'shortcut.deleteSelected.detail', rebindable: false },
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

function isRebindableId(id: string): boolean {
  const shortcut = KEYBOARD_SHORTCUTS.find((s) => s.id === id);
  return shortcut?.rebindable !== false;
}

/**
 * Resolve shortcut groups with any user-customized bindings applied.
 * Custom bindings are stored in localStorage under `agenthub-custom-keybindings`.
 * Non-rebindable shortcuts (`rebindable: false`, #1823 selection-mode
 * hotkeys) always keep their canonical keys.
 */
export function getResolvedShortcutGroups(): KeyboardShortcutGroup[] {
  const custom = loadCustomBindings();
  return KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.map((s) =>
      s.rebindable !== false && s.id in custom ? { ...s, keys: custom[s.id]! } : s,
    ),
  }));
}

export function hasCustomKeybindings(): boolean {
  return Object.keys(loadCustomBindings()).some((id) => isRebindableId(id));
}

/** Read all saved custom bindings (for merge-style updates; non-rebindable
 *  ids are filtered out of the persisted store anyway). */
export function getCustomKeybindings(): CustomKeybinding[] {
  return Object.entries(loadCustomBindings())
    .filter(([id]) => isRebindableId(id))
    .map(([id, keys]) => ({ id, keys }));
}

export function saveCustomKeybindings(bindings: CustomKeybinding[]): void {
  const obj: Record<string, string[]> = {};
  for (const b of bindings) {
    // #1823: non-rebindable shortcuts (selection-mode hotkeys) never enter
    // persistence — a saved override must not shadow the fixed bindings
    // resolveSelectionHotkey owns.
    if (!isRebindableId(b.id)) continue;
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
 * Look up the *resolved* binding for a shortcut by id — custom user
 * bindings from localStorage take precedence over canonical (#1822:
 * dispatchers must read resolved, not canonical, or custom keybindings
 * silently never take effect).
 */
export function getResolvedBinding(id: string): string[] | undefined {
  return getResolvedShortcutGroups()
    .flatMap((group) => group.shortcuts)
    .find((s) => s.id === id)?.keys;
}

/**
 * Derive a canonical key-token array from a live KeyboardEvent
 * (DOM-independent — accepts the KeyboardEventLike subset).
 * Used by the Settings ShortcutsPane recorder to capture keyboard combos.
 */
export function deriveKeysFromEvent(event: KeyboardEventLike): string[] {
  const result: string[] = [];
  if (event.ctrlKey) result.push('Ctrl');
  else if (event.metaKey) result.push('⌘');
  if (event.altKey) result.push('Alt');
  if (event.shiftKey) result.push('Shift');
  const mainKey = event.key;
  if (!mainKey || ['Control', 'Meta', 'Alt', 'Shift'].includes(mainKey)) {
    // Modifier-only keydown (e.g. pressing Ctrl alone) carries no main key —
    // return an empty array so the recorder never saves a modifier-only
    // binding (#1853 review).
    return [];
  }
  result.push(mainKey.length === 1 ? mainKey.toUpperCase() : mainKey);
  return result;
}

/**
 * Check for binding conflicts against the RESOLVED shortcut config.
 * Returns the conflicting shortcut, or null if no conflict.
 *
 * Token normalization: the recorder derives 'Ctrl' (Windows) or '⌘' (macOS)
 * while canonical bindings use the combined 'Ctrl/⌘' token — both must
 * compare equal, or a recorded Ctrl+P would silently shadow quick-open
 * (#1853 review). Resolved groups (not canonical) are compared so a combo
 * freed by an earlier remap no longer reports a false conflict.
 */
export function checkConflicts(keys: string[], capturingId: string): KeyboardShortcut | null {
  const normalize = (token: string): string =>
    token === 'Ctrl' || token === '⌘' ? 'Ctrl/⌘' : token;
  const keyStr = keys.map(normalize).join('+');
  for (const group of getResolvedShortcutGroups()) {
    for (const s of group.shortcuts) {
      if (s.id === capturingId) continue;
      if (s.keys.map(normalize).join('+') === keyStr) return s;
    }
  }
  return null;
}
