import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AppShell } from '@/AppShell';

const { invokeMock, languageChanged } = vi.hoisted(() => {
  const invokeMock = vi.fn().mockResolvedValue(undefined);
  const languageChangedHandlers: Array<() => void> = [];
  const languageChanged = {
    handlers: languageChangedHandlers,
    on: vi.fn((_event: string, handler: () => void) => {
      languageChangedHandlers.push(handler);
    }),
    off: vi.fn(() => undefined),
  };
  return { invokeMock, languageChanged };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@/i18n', () => ({
  default: {
    on: languageChanged.on,
    off: languageChanged.off,
  },
}));

vi.mock('@/App', () => ({
  default: () => null,
}));

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    languageChanged.handlers.length = 0;
  });

  it('syncs tray labels on mount', () => {
    render(<AppShell />);
    expect(invokeMock).toHaveBeenCalledWith('set_tray_labels', expect.objectContaining({
      labels: expect.objectContaining({
        show: 'tray.showWindow',
        hide: 'tray.hideWindow',
        quit: 'tray.quit',
      }),
    }));
  });

  it('re-syncs tray labels when the language changes', () => {
    render(<AppShell />);
    const before = invokeMock.mock.calls.length;
    languageChanged.handlers.forEach((handler) => handler());
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(before + 1);
  });

  it('subscribes and unsubscribes languageChanged events', () => {
    const { unmount } = render(<AppShell />);
    expect(languageChanged.on).toHaveBeenCalledTimes(1);
    unmount();
    expect(languageChanged.off).toHaveBeenCalledTimes(1);
  });
});
