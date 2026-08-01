import { describe, expect, it } from 'vitest';
import { deriveKeysFromEvent, matchesBinding } from './keyboardShortcuts';

function event(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('desktop keyboard shortcut helpers', () => {
  it('derives canonical modifier and main-key tokens', () => {
    expect(deriveKeysFromEvent(event({ ctrlKey: true, shiftKey: true, key: 'k' }))).toEqual(['Ctrl', 'Shift', 'K']);
    expect(deriveKeysFromEvent(event({ metaKey: true, altKey: true, key: 'Enter' }))).toEqual(['⌘', 'Alt', 'Enter']);
    expect(deriveKeysFromEvent(event({ key: 'Control' }))).toEqual([]);
  });

  it('matches exact modifiers and the cross-platform Ctrl/Command token', () => {
    expect(matchesBinding(event({ ctrlKey: true, key: 'k' }), ['Ctrl', 'K'])).toBe(true);
    expect(matchesBinding(event({ ctrlKey: true, key: 'k' }), ['Ctrl', 'Shift', 'K'])).toBe(false);
    expect(matchesBinding(event({ metaKey: true, key: 'k' }), ['Ctrl/⌘', 'K'])).toBe(true);
    expect(matchesBinding(event({ key: 'k' }), ['Ctrl/⌘', 'K'])).toBe(false);
    expect(matchesBinding(event({ key: 'k' }), undefined)).toBe(false);
    expect(matchesBinding(event({ key: 'Control' }), ['Ctrl'])).toBe(false);
  });
});
