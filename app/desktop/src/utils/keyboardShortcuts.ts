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
