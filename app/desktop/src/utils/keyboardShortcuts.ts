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

export function deriveKeysFromEvent(e: KeyboardEvent): string[] {
  const result: string[] = [];
  if (e.ctrlKey || e.metaKey) result.push(e.ctrlKey ? 'Ctrl' : '⌘');
  if (e.altKey) result.push('Alt');
  if (e.shiftKey) result.push('Shift');
  const mainKey = e.key;
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key) && mainKey) {
    result.push(mainKey.length === 1 ? mainKey.toUpperCase() : mainKey);
  }
  return result;
}

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

export function getBinding(id: string): string[] | undefined {
  return KEYBOARD_SHORTCUTS.find((s) => s.id === id)?.keys;
}

export function matchesBinding(e: KeyboardEvent, keys: string[] | undefined): boolean {
  if (!keys || keys.length === 0) return false;
  const actual = deriveKeysFromEvent(e);
  if (!actual || actual.length === 0) return false;
  return actual.join('+') === keys.join('+');
}
