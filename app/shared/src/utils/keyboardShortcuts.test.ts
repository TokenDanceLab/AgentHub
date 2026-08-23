// real_tested=true
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_SHORTCUT_GROUPS,
  KEYBOARD_SHORTCUTS,
  checkConflicts,
  deriveKeysFromEvent,
  getBinding,
  getCustomKeybindings,
  getResolvedBinding,
  getResolvedShortcutGroups,
  hasCustomKeybindings,
  resetKeybindings,
  saveCustomKeybindings,
} from './keyboardShortcuts';

const CUSTOM_BINDINGS_KEY = 'agenthub-custom-keybindings';

describe('KEYBOARD_SHORTCUT_GROUPS', () => {
  it('declares the five canonical groups in order', () => {
    expect(KEYBOARD_SHORTCUT_GROUPS.map((g) => g.id)).toEqual([
      'conversation',
      'composer',
      'navigation',
      'workspace',
      'selection',
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

  it('flattens KEYBOARD_SHORTCUTS from the groups (19 bindings incl. quick-open)', () => {
    // 18 canonical bindings after the #1823 selection group + #1822's
    // quick-open entry (#1853 review: the live Ctrl/⌘+P binding is canonical).
    expect(KEYBOARD_SHORTCUTS).toHaveLength(19);
    expect(KEYBOARD_SHORTCUTS[0]).toEqual(KEYBOARD_SHORTCUT_GROUPS[0]!.shortcuts[0]);
    expect(KEYBOARD_SHORTCUTS.at(-1)).toEqual(
      KEYBOARD_SHORTCUT_GROUPS[4]!.shortcuts.at(-1),
    );
  });

  it('#1823: selection-mode hotkeys are marked non-rebindable', () => {
    const selection = KEYBOARD_SHORTCUT_GROUPS.find((g) => g.id === 'selection')!;
    expect(selection.shortcuts.every((s) => s.rebindable === false)).toBe(true);
    // quick-open and every pre-existing entry stay rebindable.
    expect(KEYBOARD_SHORTCUTS.find((s) => s.id === 'quick-open')?.rebindable).not.toBe(false);
  });
});

describe('getBinding', () => {
  it('returns canonical keys for a known shortcut id', () => {
    expect(getBinding('new-thread')).toEqual(['Ctrl/⌘', 'N']);
    expect(getBinding('send')).toEqual(['Enter']);
    expect(getBinding('help')).toEqual(['?']);
    expect(getBinding('settings')).toEqual(['Ctrl/⌘', ',']);
    expect(getBinding('quick-open')).toEqual(['Ctrl/⌘', 'P']);
  });

  it('returns undefined for an unknown shortcut id', () => {
    expect(getBinding('nope')).toBeUndefined();
    expect(getBinding('')).toBeUndefined();
  });
});

describe('getResolvedBinding', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('falls back to canonical keys without custom bindings', () => {
    expect(getResolvedBinding('search')).toEqual(['Ctrl/⌘', 'K']);
  });

  it('returns customized keys when a binding was remapped', () => {
    saveCustomKeybindings([{ id: 'search', keys: ['Ctrl/⌘', 'L'] }]);
    expect(getResolvedBinding('search')).toEqual(['Ctrl/⌘', 'L']);
  });
});

describe('deriveKeysFromEvent', () => {
  it('derives a canonical token array from a Ctrl+Shift+K event', () => {
    expect(deriveKeysFromEvent({ key: 'k', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false }))
      .toEqual(['Ctrl', 'Shift', 'K']);
  });

  it('uses the ⌘ token for macOS meta', () => {
    expect(deriveKeysFromEvent({ key: 'k', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }))
      .toEqual(['⌘', 'K']);
  });

  it('rejects a chord of modifier-only keys (#1853 review)', () => {
    expect(deriveKeysFromEvent({ key: 'Control', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }))
      .toEqual([]);
    expect(deriveKeysFromEvent({ key: 'Shift', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }))
      .toEqual([]);
    expect(deriveKeysFromEvent({ key: 'Meta', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false }))
      .toEqual([]);
  });

  it('derives a bare main key as uppercase single char', () => {
    expect(deriveKeysFromEvent({ key: 'g', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }))
      .toEqual(['G']);
  });

  it('preserves named keys (Enter, ArrowUp)', () => {
    expect(deriveKeysFromEvent({ key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }))
      .toEqual(['Shift', 'Enter']);
  });
});

describe('checkConflicts', () => {
  // checkConflicts reads RESOLVED groups — earlier describes may leave
  // custom bindings behind, so isolate storage per test.
  beforeEach(() => {
    localStorage.clear();
  });

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

  it('#1853 review: normalizes recorder-derived Ctrl/⌘ against canonical Ctrl/⌘', () => {
    // The recorder derives 'Ctrl' (Windows) — it must conflict with the
    // canonical 'Ctrl/⌘+B' binding, not bypass the check.
    expect(checkConflicts(['Ctrl', 'B'], 'settings')?.id).toBe('toggle-sidebar');
    expect(checkConflicts(['⌘', 'B'], 'settings')?.id).toBe('toggle-sidebar');
    // quick-open is canonical — recording Ctrl+P for search conflicts.
    expect(checkConflicts(['Ctrl', 'P'], 'search')?.id).toBe('quick-open');
  });

  it('#1853 review: conflicts are detected against resolved bindings', () => {
    // Remap search to Ctrl+L: the freed Ctrl+K combo must no longer conflict.
    try {
      saveCustomKeybindings([{ id: 'search', keys: ['Ctrl/⌘', 'L'] }]);
      expect(checkConflicts(['Ctrl', 'K'], 'settings')).toBeNull();
      // ...while the remapped Ctrl+L now does.
      expect(checkConflicts(['Ctrl', 'L'], 'settings')?.id).toBe('search');
    } finally {
      resetKeybindings();
    }
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

  it('#1853 review: getCustomKeybindings reads back saved entries for merging', () => {
    expect(getCustomKeybindings()).toEqual([]);
    saveCustomKeybindings([
      { id: 'send', keys: ['Ctrl/⌘', 'Enter'] },
      { id: 'newline', keys: ['Ctrl/⌘', 'Shift', 'Enter'] },
    ]);
    expect(getCustomKeybindings()).toEqual([
      { id: 'send', keys: ['Ctrl/⌘', 'Enter'] },
      { id: 'newline', keys: ['Ctrl/⌘', 'Shift', 'Enter'] },
    ]);
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

  it('never applies custom bindings to non-rebindable selection shortcuts (#1823)', () => {
    // Simulate a stored override for the selection-mode hotkeys.
    localStorage.setItem(
      CUSTOM_BINDINGS_KEY,
      JSON.stringify({
        'select-all-messages': ['Ctrl/⌘', 'Shift', 'A'],
        'delete-selected-messages': ['Backspace'],
        send: ['Ctrl/⌘', 'Enter'],
      }),
    );

    const resolved = getResolvedShortcutGroups();
    const selectionGroup = resolved.find((g) => g.id === 'selection')!;
    expect(selectionGroup.shortcuts.find((s) => s.id === 'select-all-messages')!.keys)
      .toEqual(['Ctrl/⌘', 'A']);
    expect(selectionGroup.shortcuts.find((s) => s.id === 'delete-selected-messages')!.keys)
      .toEqual(['Delete']);
    // Rebinding still works for rebindable shortcuts in the same store.
    expect(resolved.find((g) => g.id === 'composer')!.shortcuts.find((s) => s.id === 'send')!.keys)
      .toEqual(['Ctrl/⌘', 'Enter']);
  });

  it('filters non-rebindable selection shortcuts out of persistence (#1823)', () => {
    saveCustomKeybindings([
      { id: 'select-all-messages', keys: ['Ctrl/⌘', 'Shift', 'A'] },
      { id: 'send', keys: ['Ctrl/⌘', 'Enter'] },
    ]);
    expect(localStorage.getItem(CUSTOM_BINDINGS_KEY)).toBe(
      JSON.stringify({ send: ['Ctrl/⌘', 'Enter'] }),
    );
    expect(hasCustomKeybindings()).toBe(true);

    // Only non-rebindable entries stored → no customization remains.
    localStorage.clear();
    saveCustomKeybindings([{ id: 'delete-selected-messages', keys: ['Backspace'] }]);
    expect(localStorage.getItem(CUSTOM_BINDINGS_KEY)).toBe('{}');
    expect(hasCustomKeybindings()).toBe(false);
  });
});
