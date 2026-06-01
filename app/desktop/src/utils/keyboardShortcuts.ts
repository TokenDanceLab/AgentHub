export type ShortcutGroupId = 'conversation' | 'composer' | 'navigation' | 'workspace';

export interface KeyboardShortcut {
  id: string;
  keys: string[];
  labelKey: string;
  detailKey?: string;
}

export interface KeyboardShortcutGroup {
  id: ShortcutGroupId;
  labelKey: string;
  shortcuts: KeyboardShortcut[];
}

export const KEYBOARD_SHORTCUT_GROUPS: KeyboardShortcutGroup[] = [
  {
    id: 'conversation',
    labelKey: 'shortcut.group.conversation',
    shortcuts: [
      { id: 'new-thread', keys: ['Ctrl/⌘', 'N'], labelKey: 'shortcut.newThread', detailKey: 'shortcut.newThread.detail' },
      { id: 'quick-chat', keys: ['Ctrl/⌘', 'Alt', 'N'], labelKey: 'shortcut.quickChat', detailKey: 'shortcut.quickChat.detail' },
      { id: 'search', keys: ['Ctrl/⌘', 'K'], labelKey: 'shortcut.search', detailKey: 'shortcut.search.detail' },
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
];

export const KEYBOARD_SHORTCUTS = KEYBOARD_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

// ---------------------------------------------------------------------------
// Custom keybinding persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'agenthub-keybindings';

export interface CustomKeybinding {
  id: string;
  keys: string[];
}

function loadCustomKeybindings(): CustomKeybinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b: unknown) =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as CustomKeybinding).id === 'string' &&
        Array.isArray((b as CustomKeybinding).keys),
    ) as CustomKeybinding[];
  } catch {
    return [];
  }
}

export function saveCustomKeybindings(bindings: CustomKeybinding[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function resetKeybindings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasCustomKeybindings(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Build a map of shortcut id → default keys from the canonical groups. */
function defaultKeysMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of KEYBOARD_SHORTCUT_GROUPS) {
    for (const s of group.shortcuts) {
      map.set(s.id, [...s.keys]);
    }
  }
  return map;
}

/** Resolve effective keybinding for a single shortcut (custom override or default). */
export function getResolvedKeys(shortcutId: string): string[] {
  const custom = loadCustomKeybindings();
  const override = custom.find((b) => b.id === shortcutId);
  if (override) return [...override.keys];
  const defaults = defaultKeysMap();
  return defaults.get(shortcutId) ?? [];
}

/** Return the shortcut groups with custom overrides applied in-place. */
export function getResolvedShortcutGroups(): KeyboardShortcutGroup[] {
  const customMap = new Map(loadCustomKeybindings().map((b) => [b.id, b.keys]));
  return KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.map((s) => ({
      ...s,
      keys: customMap.get(s.id) ?? s.keys,
    })),
  }));
}

/** Normalize a keys array into a stable string for conflict comparison. */
function normalizeKeys(keys: string[]): string {
  return keys
    .map((k) => k.toLowerCase().replace('ctrl/⌘', 'ctrl'))
    .sort()
    .join('+');
}

/**
 * Check whether `newKeys` conflicts with any existing shortcut binding.
 * Returns the conflicting shortcut or null.
 */
export function checkConflicts(newKeys: string[], excludeId: string): KeyboardShortcut | null {
  const norm = normalizeKeys(newKeys);
  const groups = getResolvedShortcutGroups();
  for (const group of groups) {
    for (const s of group.shortcuts) {
      if (s.id === excludeId) continue;
      if (normalizeKeys(s.keys) === norm) return s;
    }
  }
  return null;
}

/** Derive a canonical keys array from a keyboard event. */
export function deriveKeysFromEvent(e: KeyboardEvent): string[] | null {
  const key = e.key;

  // Ignore standalone modifier presses
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift' || key === 'AltGraph' || key === 'Symbol') {
    return null;
  }

  const parts: string[] = [];

  // Platform-adaptive primary modifier (Ctrl on Win/Linux, Cmd on Mac)
  if (e.ctrlKey || e.metaKey) {
    parts.push('Ctrl/⌘');
  }

  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Normalise the main key
  let mainKey = key;
  if (mainKey === 'Escape') mainKey = 'Esc';
  else if (mainKey === 'ArrowUp') mainKey = '↑';
  else if (mainKey === 'ArrowDown') mainKey = '↓';
  else if (mainKey === 'ArrowLeft') mainKey = '←';
  else if (mainKey === 'ArrowRight') mainKey = '→';
  else if (mainKey === ' ') mainKey = 'Space';
  else if (mainKey === 'Backspace') mainKey = '⌫';
  else if (mainKey === 'Delete') mainKey = '⌦';
  else if (mainKey === 'Enter') mainKey = 'Enter';
  else if (mainKey === 'Tab') mainKey = 'Tab';
  else if (mainKey === 'CapsLock') return null;
  else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
  // Function keys and other named keys kept as-is

  parts.push(mainKey);

  // Single key without modifiers
  if (parts.length === 1) return [mainKey];

  return parts;
}
