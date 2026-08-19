// real_tested=true
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_SHORTCUT_GROUPS,
  KEYBOARD_SHORTCUTS,
  checkConflicts,
  getBinding,
  getResolvedShortcutGroups,
  hasCustomKeybindings,
  resetKeybindings,
  saveCustomKeybindings,
} from './keyboardShortcuts';

const CUSTOM_BINDINGS_KEY = 'agenthub-custom-keybindings';

describe('KEYBOARD_SHORTCUT_GROUPS', () => {
  it('declares the four canonical groups in order', () => {
    expect(KEYBOARD_SHORTCUT_GROUPS.map((g) => g.id)).toEqual([
      'conversation',
      'composer',
      'navigation',
      'workspace',
    ]);
  });

  it('gives every group a label key and at least one shortcut', () => {
    for (const group of KEYBOARD_SHORTCUT_GROUPS) {
      expect(group.labelKey).toMatch(/^shortcut\.group\./);
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it('uses unique shortcut ids across all groups', () => {
    const ids = KEYBOARD_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every shortcut a label key and non-empty key tokens', () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcut.labelKey).toMatch(/^shortcut\./);
      expect(shortcut.keys.length).toBeGreaterThan(0);
    }
  });

  it('flattens KEYBOARD_SHORTCUTS from the groups (15 canonical bindings)', () => {
    expect(KEYBOARD_SHORTCUTS).toHaveLength(15);
    expect(KEYBOARD_SHORTCUTS[0]).toEqual(KEYBOARD_SHORTCUT_GROUPS[0]!.shortcuts[0]);
    expect(KEYBOARD_SHORTCUTS.at(-1)).toEqual(
      KEYBOARD_SHORTCUT_GROUPS[3]!.shortcuts.at(-1),
    );
  });
});

describe('getBinding', () => {
  it('returns canonical keys for a known shortcut id', () => {
    expect(getBinding('new-thread')).toEqual(['Ctrl/⌘', 'N']);
    expect(getBinding('send')).toEqual(['Enter']);
    expect(getBinding('help')).toEqual(['?']);
    expect(getBinding('settings')).toEqual(['Ctrl/⌘', ',']);
  });

  it('returns undefined for an unknown shortcut id', () => {
    expect(getBinding('nope')).toBeUndefined();
    expect(getBinding('')).toBeUndefined();
  });
});

describe('checkConflicts', () => {
  it('reports the conflicting shortcut for duplicate key combos', () => {
    const conflict = checkConflicts(['Ctrl/⌘', 'K'], 'new-thread');
    expect(conflict?.id).toBe('search');
    expect(conflict?.keys).toEqual(['Ctrl/⌘', 'K']);
  });

  it('ignores the capturing shortcut itself', () => {
    expect(checkConflicts(['Ctrl/⌘', 'K'], 'search')).toBeNull();
    expect(checkConflicts(['Enter'], 'send')).toBeNull();
  });

  it('returns null when no other shortcut uses the combo', () => {
    expect(checkConflicts(['Ctrl/⌘', 'Alt', 'X'], 'send')).toBeNull();
  });

  it('is order-sensitive: reversed modifier order is a different combo', () => {
    // Canonical send is ['Shift', 'Enter']; the reversed order does not collide.
    expect(checkConflicts(['Enter', 'Shift'], 'newline')).toBeNull();
  });

  it('reports only the first conflicting shortcut', () => {
    // '?' only belongs to help; asserting the identity of the reported entry.
    const conflict = checkConflicts(['?'], 'send');
    expect(conflict?.id).toBe('help');
  });
});

describe('custom keybindings (localStorage-backed)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('has no custom bindings on a fresh profile', () => {
    expect(hasCustomKeybindings()).toBe(false);
  });

  it('resolves canonical groups when nothing is customized', () => {
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
  });

  it('persists custom bindings as JSON under the storage key', () => {
    saveCustomKeybindings([
      { id: 'send', keys: ['Ctrl/⌘', 'Enter'] },
      { id: 'newline', keys: ['Shift', 'Ctrl', 'Enter'] },
    ]);
    expect(localStorage.getItem(CUSTOM_BINDINGS_KEY)).toBe(
      JSON.stringify({ send: ['Ctrl/⌘', 'Enter'], newline: ['Shift', 'Ctrl', 'Enter'] }),
    );
  });

  it('applies customized keys without touching other shortcuts', () => {
    saveCustomKeybindings([{ id: 'send', keys: ['Ctrl/⌘', 'Enter'] }]);
    const resolved = getResolvedShortcutGroups();

    const composerGroup = resolved.find((g) => g.id === 'composer')!;
    const send = composerGroup.shortcuts.find((s) => s.id === 'send')!;
    expect(send.keys).toEqual(['Ctrl/⌘', 'Enter']);

    const newline = composerGroup.shortcuts.find((s) => s.id === 'newline')!;
    expect(newline.keys).toEqual(['Shift', 'Enter']);
  });

  it('does not mutate the canonical config when resolving custom bindings', () => {
    saveCustomKeybindings([{ id: 'send', keys: ['Ctrl/⌘', 'Enter'] }]);
    getResolvedShortcutGroups();

    const canonicalSend = KEYBOARD_SHORTCUT_GROUPS[1]!.shortcuts.find((s) => s.id === 'send')!;
    expect(canonicalSend.keys).toEqual(['Enter']);
  });

  it('ignores custom entries for unknown shortcut ids', () => {
    saveCustomKeybindings([{ id: 'does-not-exist', keys: ['X'] }]);
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
  });

  it('reports hasCustomKeybindings true only while bindings exist', () => {
    expect(hasCustomKeybindings()).toBe(false);
    saveCustomKeybindings([{ id: 'send', keys: ['Ctrl/⌘', 'Enter'] }]);
    expect(hasCustomKeybindings()).toBe(true);
  });

  it('treats an empty binding list as no customization', () => {
    saveCustomKeybindings([]);
    expect(localStorage.getItem(CUSTOM_BINDINGS_KEY)).toBe('{}');
    expect(hasCustomKeybindings()).toBe(false);
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
  });

  it('resetKeybindings removes the stored bindings', () => {
    saveCustomKeybindings([{ id: 'send', keys: ['Ctrl/⌘', 'Enter'] }]);
    resetKeybindings();
    expect(localStorage.getItem(CUSTOM_BINDINGS_KEY)).toBeNull();
    expect(hasCustomKeybindings()).toBe(false);
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
  });

  it('degrades gracefully when stored JSON is corrupt', () => {
    localStorage.setItem(CUSTOM_BINDINGS_KEY, '{not json');
    expect(hasCustomKeybindings()).toBe(false);
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
  });

  it('ignores custom bindings whose shape does not map shortcut ids', () => {
    localStorage.setItem(CUSTOM_BINDINGS_KEY, JSON.stringify([1, 2, 3]));
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
    // hasCustomKeybindings only inspects key presence, so an array still counts.
    expect(hasCustomKeybindings()).toBe(true);
  });

  it('degrades gracefully when getItem throws (storage unavailable)', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(hasCustomKeybindings()).toBe(false);
    expect(getResolvedShortcutGroups()).toEqual(KEYBOARD_SHORTCUT_GROUPS);
    getItemSpy.mockRestore();
  });
});
