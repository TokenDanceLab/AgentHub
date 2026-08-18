import { beforeEach, describe, expect, it } from 'vitest';
import {
  composerSubmitBehaviorFromLabel,
  composerSubmitBehaviorLabel,
  normalizeComposerSubmitBehavior,
  readComposerSubmitBehavior,
  subscribeWorkbenchPreference,
  WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY,
  writeComposerSubmitBehavior,
} from './workbenchPreferences';

describe('normalizeComposerSubmitBehavior', () => {
  it('keeps ctrl-enter-send as-is', () => {
    expect(normalizeComposerSubmitBehavior('ctrl-enter-send')).toBe('ctrl-enter-send');
  });

  it('maps the localized label to ctrl-enter-send', () => {
    expect(normalizeComposerSubmitBehavior('Ctrl+Enter 发送')).toBe('ctrl-enter-send');
  });

  it('defaults anything else to enter-send', () => {
    expect(normalizeComposerSubmitBehavior('enter-send')).toBe('enter-send');
    expect(normalizeComposerSubmitBehavior('')).toBe('enter-send');
    expect(normalizeComposerSubmitBehavior(null)).toBe('enter-send');
    expect(normalizeComposerSubmitBehavior(undefined)).toBe('enter-send');
    expect(normalizeComposerSubmitBehavior('something-else')).toBe('enter-send');
  });
});

describe('composerSubmitBehaviorLabel / fromLabel', () => {
  it('maps each behavior to its display label', () => {
    expect(composerSubmitBehaviorLabel('ctrl-enter-send')).toBe('Ctrl+Enter 发送');
    expect(composerSubmitBehaviorLabel('enter-send')).toBe('Enter 发送');
  });

  it('round-trips a label back to the behavior', () => {
    expect(composerSubmitBehaviorFromLabel('Ctrl+Enter 发送')).toBe('ctrl-enter-send');
    expect(composerSubmitBehaviorFromLabel('Enter 发送')).toBe('enter-send');
  });
});

describe('localStorage read/write', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads the default when nothing is stored', () => {
    expect(readComposerSubmitBehavior()).toBe('enter-send');
  });

  it('reads back a value that was written', () => {
    writeComposerSubmitBehavior('ctrl-enter-send');
    expect(window.localStorage.getItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY)).toBe('ctrl-enter-send');
    expect(readComposerSubmitBehavior()).toBe('ctrl-enter-send');
  });

  it('normalizes an unexpected stored value on read', () => {
    window.localStorage.setItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY, 'garbage');
    expect(readComposerSubmitBehavior()).toBe('enter-send');
  });
});

describe('subscribeWorkbenchPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('notifies subscribers on write and supports unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeWorkbenchPreference(() => {
      calls += 1;
    });

    writeComposerSubmitBehavior('ctrl-enter-send');
    expect(calls).toBe(1);

    unsubscribe();
    writeComposerSubmitBehavior('enter-send');
    expect(calls).toBe(1);
  });

  it('notifies multiple independent subscribers', () => {
    let first = 0;
    let second = 0;
    const unsubscribeFirst = subscribeWorkbenchPreference(() => {
      first += 1;
    });
    const unsubscribeSecond = subscribeWorkbenchPreference(() => {
      second += 1;
    });

    writeComposerSubmitBehavior('ctrl-enter-send');
    expect(first).toBe(1);
    expect(second).toBe(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });
});
