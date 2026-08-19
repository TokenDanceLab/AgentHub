// real_tested=true
import { describe, expect, it } from 'vitest';
import { matchesShortcut, type KeyboardEventLike } from './keyboardUtils';

function keyEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    key: 'k',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('matchesShortcut', () => {
  it('rejects an empty binding list', () => {
    expect(matchesShortcut(keyEvent({ key: 'k' }), [])).toBe(false);
    expect(matchesShortcut(keyEvent({ key: 'k' }), undefined as unknown as string[])).toBe(false);
  });

  it('matches a plain main key case-insensitively', () => {
    expect(matchesShortcut(keyEvent({ key: 'k' }), ['K'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'K' }), ['k'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'n' }), ['K'])).toBe(false);
  });

  it('matches Enter / Esc as main keys', () => {
    expect(matchesShortcut(keyEvent({ key: 'Enter' }), ['Enter'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'Escape' }), ['Esc'])).toBe(false);
    expect(matchesShortcut(keyEvent({ key: 'Esc' }), ['Esc'])).toBe(true);
  });

  it('treats Ctrl/⌘ as satisfied by either Ctrl or Cmd', () => {
    const binding = ['Ctrl/⌘', 'K'];
    expect(matchesShortcut(keyEvent({ ctrlKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ metaKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ ctrlKey: true, metaKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({}), binding)).toBe(false);
  });

  it('requires the main key even when the modifier matches', () => {
    expect(matchesShortcut(keyEvent({ ctrlKey: true, key: 'x' }), ['Ctrl/⌘', 'K'])).toBe(false);
  });

  it('distinguishes strict Ctrl from Cmd-only events', () => {
    expect(matchesShortcut(keyEvent({ key: 'f', ctrlKey: true }), ['Ctrl', 'F'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'f', metaKey: true }), ['Ctrl', 'F'])).toBe(false);
    // Strict bindings reject extra modifiers: Ctrl+Cmd does not satisfy Ctrl.
    expect(matchesShortcut(keyEvent({ key: 'f', ctrlKey: true, metaKey: true }), ['Ctrl', 'F'])).toBe(false);
  });

  it('distinguishes strict ⌘ from Ctrl-only events', () => {
    expect(matchesShortcut(keyEvent({ key: 's', metaKey: true }), ['⌘', 'S'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), ['⌘', 'S'])).toBe(false);
  });

  it('requires Shift when the binding declares it', () => {
    const binding = ['Shift', 'Enter'];
    expect(matchesShortcut(keyEvent({ key: 'Enter', shiftKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'Enter' }), binding)).toBe(false);
  });

  it('rejects extra Shift presses not declared by the binding', () => {
    expect(matchesShortcut(keyEvent({ key: 'Enter', shiftKey: true }), ['Enter'])).toBe(false);
  });

  it('requires Alt when the binding declares it', () => {
    const binding = ['Alt', 'N'];
    expect(matchesShortcut(keyEvent({ key: 'n', altKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'n' }), binding)).toBe(false);
  });

  it('rejects extra Alt presses not declared by the binding', () => {
    expect(matchesShortcut(keyEvent({ key: 'n', altKey: true }), ['Ctrl/⌘', 'N'])).toBe(false);
  });

  it('returns false for modifier-only bindings', () => {
    expect(matchesShortcut(keyEvent({ ctrlKey: true }), ['Ctrl'])).toBe(false);
    expect(matchesShortcut(keyEvent({ shiftKey: true }), ['Shift'])).toBe(false);
    expect(matchesShortcut(keyEvent({ metaKey: true }), ['Ctrl/⌘'])).toBe(false);
  });

  it('matches any of multiple main keys', () => {
    const binding = ['Ctrl/⌘', 'Enter', 'NumpadEnter'];
    expect(matchesShortcut(keyEvent({ key: 'Enter', ctrlKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'numpadenter', metaKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'k', ctrlKey: true }), binding)).toBe(false);
  });

  it('matches single-character symbols like / and @', () => {
    expect(matchesShortcut(keyEvent({ key: '/' }), ['/'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: '@' }), ['@'])).toBe(true);
    expect(matchesShortcut(keyEvent({ key: '#' }), ['@'])).toBe(false);
  });

  it('ignores modifier flags left undefined on the event', () => {
    const bareEvent = { key: 'k', ctrlKey: false, metaKey: false } as KeyboardEventLike;
    expect(matchesShortcut(bareEvent, ['K'])).toBe(true);
    expect(matchesShortcut(bareEvent, ['Ctrl', 'K'])).toBe(false);
    expect(matchesShortcut(bareEvent, ['Shift', 'K'])).toBe(false);
  });

  it('matches multi-modifier combos only when every modifier is pressed', () => {
    const binding = ['Ctrl', 'Alt', 'Delete'];
    expect(matchesShortcut(keyEvent({ key: 'Delete', ctrlKey: true, altKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'Delete', ctrlKey: true }), binding)).toBe(false);
    expect(matchesShortcut(keyEvent({ key: 'Delete', altKey: true }), binding)).toBe(false);
  });

  it('requires both modifiers when Ctrl and ⌘ are declared separately', () => {
    const binding = ['Ctrl', '⌘', 'K'];
    expect(matchesShortcut(keyEvent({ key: 'k', ctrlKey: true, metaKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'k', ctrlKey: true }), binding)).toBe(false);
    expect(matchesShortcut(keyEvent({ key: 'k', metaKey: true }), binding)).toBe(false);
  });

  it('expands Ctrl/⌘ without requiring the other modifier', () => {
    // Ctrl/⌘ only requires ONE of ctrl/meta; pressing extra Shift still fails.
    const binding = ['Ctrl/⌘', 'Shift', 'P'];
    expect(matchesShortcut(keyEvent({ key: 'p', ctrlKey: true, shiftKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'p', metaKey: true, shiftKey: true }), binding)).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'p', metaKey: true }), binding)).toBe(false);
    expect(matchesShortcut(keyEvent({ key: 'p', ctrlKey: true }), binding)).toBe(false);
  });
});
