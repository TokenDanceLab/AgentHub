// real_tested=true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENTHUB_THEME_STORAGE_KEY,
  applyAgentHubTheme,
  getAppliedAgentHubTheme,
  getStoredAgentHubThemeMode,
  getSystemAgentHubTheme,
  persistAgentHubThemeMode,
  resolveAgentHubTheme,
  toggleAppliedAgentHubTheme,
} from './theme';

function stubSystemTheme(matchesLight: boolean): ReturnType<typeof vi.fn> {
  const matchMediaStub = vi.fn().mockReturnValue({ matches: matchesLight });
  vi.stubGlobal('matchMedia', matchMediaStub);
  return matchMediaStub;
}

describe('theme storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the stable storage key', () => {
    expect(AGENTHUB_THEME_STORAGE_KEY).toBe('agenthub-v4-theme');
  });

  it('defaults the stored mode to light when nothing is saved', () => {
    expect(getStoredAgentHubThemeMode()).toBe('light');
  });

  it('round-trips dark / light / system modes', () => {
    for (const mode of ['dark', 'light', 'system'] as const) {
      persistAgentHubThemeMode(mode);
      expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBe(mode);
      expect(getStoredAgentHubThemeMode()).toBe(mode);
    }
  });

  it('falls back to light for a corrupt stored value', () => {
    localStorage.setItem(AGENTHUB_THEME_STORAGE_KEY, 'neon');
    expect(getStoredAgentHubThemeMode()).toBe('light');
  });

  it('returns light when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(getStoredAgentHubThemeMode()).toBe('light');
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(() => persistAgentHubThemeMode('dark')).not.toThrow();
  });
});

describe('theme resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves explicit dark / light modes without consulting the system', () => {
    stubSystemTheme(false);
    expect(resolveAgentHubTheme('dark')).toBe('dark');
    expect(resolveAgentHubTheme('light')).toBe('light');
  });

  it('resolves system mode to light when the OS prefers light', () => {
    stubSystemTheme(true);
    expect(getSystemAgentHubTheme()).toBe('light');
    expect(resolveAgentHubTheme('system')).toBe('light');
  });

  it('resolves system mode to dark when the OS prefers dark', () => {
    stubSystemTheme(false);
    expect(getSystemAgentHubTheme()).toBe('dark');
    expect(resolveAgentHubTheme('system')).toBe('dark');
  });
});

describe('applied theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-sync');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads light when no data-theme attribute is set', () => {
    expect(getAppliedAgentHubTheme()).toBe('light');
  });

  it('reads dark from the data-theme attribute', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(getAppliedAgentHubTheme()).toBe('dark');
  });

  it('treats an unknown data-theme value as light', () => {
    document.documentElement.setAttribute('data-theme', 'sepia');
    expect(getAppliedAgentHubTheme()).toBe('light');
  });

  it('applyAgentHubTheme sets the attribute and colorScheme without persisting', () => {
    applyAgentHubTheme('dark', { syncTransitions: false });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBeNull();
  });

  it('applyAgentHubTheme persists the requested mode when given', () => {
    applyAgentHubTheme('dark', { persistMode: 'system', syncTransitions: false });
    expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBe('system');
  });

  it('skips the transition-sync attribute when syncTransitions is false', () => {
    applyAgentHubTheme('dark', { syncTransitions: false });
    expect(document.documentElement.hasAttribute('data-theme-sync')).toBe(false);
  });

  it('toggles from light to dark and persists the new mode', () => {
    applyAgentHubTheme('light', { syncTransitions: false });
    const next = toggleAppliedAgentHubTheme();
    expect(next).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggles from dark to light and persists the new mode', () => {
    applyAgentHubTheme('dark', { syncTransitions: false });
    const next = toggleAppliedAgentHubTheme();
    expect(next).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBe('light');
  });

  it('toggles to dark when no theme has been applied yet', () => {
    const next = toggleAppliedAgentHubTheme();
    expect(next).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY)).toBe('dark');
  });
});

describe('applyAgentHubTheme transition sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-sync');
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** jsdom's rAF ignores fake timers, so queue frames and flush them manually. */
  function stubRequestAnimationFrame(): FrameRequestCallback[] {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return 1;
    });
    return queuedFrames;
  }

  function flushQueuedFrames(queuedFrames: FrameRequestCallback[]): void {
    while (queuedFrames.length > 0) {
      queuedFrames.shift()!(performance.now());
    }
  }

  it('sets the sync attribute and removes it after the release window', () => {
    const queuedFrames = stubRequestAnimationFrame();
    applyAgentHubTheme('dark');
    expect(document.documentElement.getAttribute('data-theme-sync')).toBe('true');

    flushQueuedFrames(queuedFrames);
    expect(document.documentElement.getAttribute('data-theme-sync')).toBe('true');

    vi.advanceTimersByTime(100);
    expect(document.documentElement.hasAttribute('data-theme-sync')).toBe(false);
  });

  it('keeps the sync attribute while the release window is still open', () => {
    const queuedFrames = stubRequestAnimationFrame();
    applyAgentHubTheme('dark');
    flushQueuedFrames(queuedFrames);

    vi.advanceTimersByTime(79);
    expect(document.documentElement.getAttribute('data-theme-sync')).toBe('true');
    vi.advanceTimersByTime(1);
    expect(document.documentElement.hasAttribute('data-theme-sync')).toBe(false);
  });
});
