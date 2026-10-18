import { StrictMode } from 'react';
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

const { askMock } = vi.hoisted(() => ({ askMock: vi.fn().mockResolvedValue(true) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: askMock }));

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
    askMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue(undefined);
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

  it('offers and installs an available update', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'check_for_update' ? '9.9.9' : undefined),
    );
    render(<AppShell />);
    await vi.waitFor(() => expect(askMock).toHaveBeenCalledWith(
      'updater.available',
      expect.objectContaining({ title: 'updater.title', kind: 'info' }),
    ));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('install_update'));
  });

  it('prompts once under React StrictMode', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'check_for_update' ? '9.9.9' : undefined),
    );
    render(
      <StrictMode>
        <AppShell />
      </StrictMode>,
    );
    await vi.waitFor(() => expect(askMock).toHaveBeenCalledTimes(1));
    expect(invokeMock.mock.calls.filter(([command]) => command === 'check_for_update')).toHaveLength(2);
  });

  it('does not prompt when no update is available', async () => {
    render(<AppShell />);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('check_for_update'));
    await Promise.resolve();
    expect(askMock).not.toHaveBeenCalled();
  });

  it('does not install when the user declines an update', async () => {
    askMock.mockResolvedValue(false);
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'check_for_update' ? '9.9.9' : undefined),
    );
    render(<AppShell />);
    await vi.waitFor(() => expect(askMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invokeMock).not.toHaveBeenCalledWith('install_update');
  });

  it('subscribes and unsubscribes languageChanged events', () => {
    const { unmount } = render(<AppShell />);
    expect(languageChanged.on).toHaveBeenCalledTimes(1);
    unmount();
    expect(languageChanged.off).toHaveBeenCalledTimes(1);
  });
});
