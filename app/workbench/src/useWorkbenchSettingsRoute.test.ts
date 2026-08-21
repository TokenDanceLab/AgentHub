// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
  readWorkbenchDataModeOverride,
} from '@shared/demo/dataMode';
import type { SettingsPort } from '@shared/platform/types';
import { WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import { createSettingsService } from './settingsService';
import type { SettingsService } from './settingsService';
import {
  createSettingsDefaults,
  useWorkbenchSettingsRoute,
} from './useWorkbenchSettingsRoute';
import {
  WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY,
  readComposerSubmitBehavior,
} from './workbenchPreferences';

/**
 * Controllable SettingsService double: same surface as the real service but
 * with mutable loading/error fields and inspectable listener set, so the hook
 * wiring (subscribe/init/emit) can be asserted directly.
 */
interface FakeSettingsService {
  listeners: Set<() => void>;
  emit: () => void;
  init: () => Promise<void>;
  readAll: () => Record<string, unknown>;
  write: (key: string, value: unknown) => void;
  writeBatch: (values: Record<string, unknown>) => void;
  subscribe: (listener: () => void) => () => void;
  clearError: () => void;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  errorKind: SettingsService['errorKind'];
}

function createFakeSettingsService(
  initial: Record<string, unknown> = {},
  overrides: {
    loading?: boolean;
    error?: string | null;
    errorKind?: SettingsService['errorKind'];
  } = {},
): FakeSettingsService {
  let snapshot: Record<string, unknown> = { ...initial };
  const listeners = new Set<() => void>();
  const service: FakeSettingsService = {
    listeners,
    emit: () => {
      for (const listener of listeners) listener();
    },
    init: vi.fn(async () => {
      service.initialized = true;
      service.emit();
    }),
    readAll: vi.fn(() => snapshot),
    write: vi.fn((key: string, value: unknown) => {
      snapshot = { ...snapshot, [key]: value };
      service.emit();
    }),
    writeBatch: vi.fn((values: Record<string, unknown>) => {
      snapshot = { ...snapshot, ...values };
      service.emit();
    }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    clearError: vi.fn(() => {
      service.error = null;
      service.errorKind = null;
      service.emit();
    }),
    initialized: false,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    errorKind: overrides.errorKind ?? null,
  };
  return service;
}

function createPort(overrides?: Partial<SettingsPort>): SettingsPort {
  return {
    readSettings: vi.fn(async () => ({})),
    writeSettings: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('useWorkbenchSettingsRoute without a settingsService', () => {
  it('returns mock defaults and a neutral status', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    expect(result.current.hasSettingsService).toBe(false);
    expect(result.current.realDataMode).toBe(false);
    expect(result.current.settingsPane).toBe('appearance');
    expect(result.current.settingsLoading).toBe(false);
    expect(result.current.settingsError).toBeNull();
    expect(result.current.settingsErrorKind).toBeNull();
    expect(result.current.settings).toEqual(createSettingsDefaults());
    expect(result.current.settings.theme).toBe('浅色');
    expect(result.current.settings.dataMode).toBe('Auto');
    expect(result.current.settings.composerSubmitBehavior).toBe('Enter 发送');
    expect(result.current.settings.permissions.Read).toBe('允许');
    expect(result.current.settings.stateStrategies.empty).toBe(true);
  });

  it('starts on the appearance pane and switches panes', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    expect(result.current.settingsPane).toBe('appearance');

    act(() => {
      result.current.setSettingsPane('notify');
    });
    expect(result.current.settingsPane).toBe('notify');

    act(() => {
      result.current.setSettingsPane('states');
    });
    expect(result.current.settingsPane).toBe('states');
  });

  it('treats observed/approved-real (and their aliases) as real data mode', () => {
    for (const dataMode of ['observed', 'approved-real', 'real', '正常']) {
      const { result } = renderHook(() => useWorkbenchSettingsRoute({ dataMode }));
      expect(result.current.realDataMode).toBe(true);
    }
  });

  it('treats mock/fixture/auto/undefined as non-real data mode', () => {
    for (const dataMode of ['mock', 'fixture', 'auto', undefined]) {
      const { result } = renderHook(() => useWorkbenchSettingsRoute({ dataMode }));
      expect(result.current.realDataMode).toBe(false);
    }
  });

  it('updates settings locally via handleSettingChange', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    act(() => {
      result.current.handleSettingChange('theme', '深色');
    });
    expect(result.current.settings.theme).toBe('深色');

    act(() => {
      result.current.handleSettingChange('stackedAvatars', false);
    });
    expect(result.current.settings.stackedAvatars).toBe(false);

    act(() => {
      result.current.handleSettingChange('perm_Shell', '允许');
    });
    expect(result.current.settings.permissions.Shell).toBe('允许');
    expect(result.current.settings.permissions.Read).toBe('允许');
    expect(result.current.settings.permissions.Write).toBe('需确认');

    act(() => {
      result.current.handleSettingChange('stateStrategy_invalid', false);
    });
    expect(result.current.settings.stateStrategies.invalid).toBe(false);
    expect(result.current.settings.stateStrategies.empty).toBe(true);
    expect(result.current.settings.stateStrategies.missing).toBe(true);
  });

  it('persists dataMode changes to the localStorage override', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    act(() => {
      result.current.handleSettingChange('dataMode', '模拟');
    });
    expect(result.current.settings.dataMode).toBe('模拟');
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('mock');
    expect(readWorkbenchDataModeOverride()).toBe('mock');
  });

  it('persists composerSubmitBehavior changes to localStorage', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    act(() => {
      result.current.handleSettingChange('composerSubmitBehavior', 'Ctrl+Enter 发送');
    });
    expect(result.current.settings.composerSubmitBehavior).toBe('Ctrl+Enter 发送');
    expect(
      window.localStorage.getItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY),
    ).toBe('ctrl-enter-send');
    expect(readComposerSubmitBehavior()).toBe('ctrl-enter-send');
  });

  it('seeds defaults from localStorage overrides', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'fixture');
    window.localStorage.setItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY, 'ctrl-enter-send');

    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    expect(result.current.settings.dataMode).toBe('Fixture');
    expect(result.current.settings.composerSubmitBehavior).toBe('Ctrl+Enter 发送');
  });

  it('keeps retry and dismiss inert without a settingsService', () => {
    const { result } = renderHook(() => useWorkbenchSettingsRoute({}));

    act(() => {
      result.current.handleRetrySettingsLoad();
      result.current.handleDismissSettingsError();
    });
    expect(result.current.settingsError).toBeNull();
    expect(result.current.settingsErrorKind).toBeNull();
    expect(result.current.settings).toEqual(createSettingsDefaults());
  });
});

describe('useWorkbenchSettingsRoute with a settingsService', () => {
  it('initializes and subscribes to the service on mount', () => {
    const service = createFakeSettingsService({ theme: '深色' });
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.hasSettingsService).toBe(true);
    expect(service.subscribe).toHaveBeenCalledTimes(1);
    expect(service.init).toHaveBeenCalledTimes(1);
    expect(service.initialized).toBe(true);
    expect(result.current.settings.theme).toBe('深色');
    expect(result.current.settingsLoading).toBe(false);
    expect(result.current.settingsError).toBeNull();
  });

  it('mirrors loading and error state from the service', () => {
    const service = createFakeSettingsService(
      {},
      { loading: true, error: '设置加载失败', errorKind: 'init' },
    );
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.settingsLoading).toBe(true);
    expect(result.current.settingsError).toBe('设置加载失败');
    expect(result.current.settingsErrorKind).toBe('init');
  });

  it('writes plain setting changes through to the service', () => {
    const service = createFakeSettingsService(WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    act(() => {
      result.current.handleSettingChange('theme', '深色');
    });
    expect(service.write).toHaveBeenCalledWith('theme', '深色');
    expect(result.current.settings.theme).toBe('深色');
  });

  it('writes perm_ and stateStrategy_ changes as their parent objects', () => {
    const service = createFakeSettingsService(WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    act(() => {
      result.current.handleSettingChange('perm_Write', '允许');
    });
    expect(result.current.settings.permissions.Write).toBe('允许');
    expect(service.write).toHaveBeenCalledWith(
      'permissions',
      expect.objectContaining({ Write: '允许', Read: '允许' }),
    );

    act(() => {
      result.current.handleSettingChange('stateStrategy_empty', false);
    });
    expect(result.current.settings.stateStrategies.empty).toBe(false);
    expect(service.write).toHaveBeenCalledWith(
      'stateStrategies',
      expect.objectContaining({ empty: false, invalid: true }),
    );
  });

  it('persists dataMode to both localStorage and the service when present', () => {
    const service = createFakeSettingsService(WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    act(() => {
      result.current.handleSettingChange('dataMode', '模拟');
    });
    expect(result.current.settings.dataMode).toBe('模拟');
    expect(service.write).toHaveBeenCalledWith('dataMode', '模拟');
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('mock');
  });

  it('picks up external service writes via subscription', () => {
    const service = createFakeSettingsService({ density: '标准' });
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.settings.density).toBe('标准');

    act(() => {
      service.write('density', '紧凑');
    });
    expect(result.current.settings.density).toBe('紧凑');
  });

  it('re-inits the service on handleRetrySettingsLoad', async () => {
    const service = createFakeSettingsService({ theme: '深色' });
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    await act(async () => {
      result.current.handleRetrySettingsLoad();
    });
    expect(service.init).toHaveBeenCalledTimes(2);
  });

  it('dismisses the settings error via handleDismissSettingsError', () => {
    const service = createFakeSettingsService(
      {},
      { error: '设置保存失败', errorKind: 'write' },
    );
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.settingsError).toBe('设置保存失败');
    expect(result.current.settingsErrorKind).toBe('write');

    act(() => {
      result.current.handleDismissSettingsError();
    });
    expect(service.clearError).toHaveBeenCalledTimes(1);
    expect(result.current.settingsError).toBeNull();
    expect(result.current.settingsErrorKind).toBeNull();
  });

  it('unsubscribes from the service on unmount', () => {
    const service = createFakeSettingsService();
    const { unmount } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(service.listeners.size).toBe(1);

    unmount();
    expect(service.listeners.size).toBe(0);
  });
});

describe('useWorkbenchSettingsRoute with createSettingsService', () => {
  it('loads remote settings once init resolves', async () => {
    let resolveRead!: (value: Record<string, string>) => void;
    const port = createPort({
      readSettings: vi.fn(
        () =>
          new Promise<Record<string, string>>((resolve) => {
            resolveRead = resolve;
          }),
      ),
    });
    const service = createSettingsService(port, WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.hasSettingsService).toBe(true);
    expect(result.current.settingsLoading).toBe(true);
    expect(result.current.settings.theme).toBe('浅色');

    await act(async () => {
      resolveRead({ theme: '深色', density: '紧凑' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.settingsLoading).toBe(false);
    expect(result.current.settings.theme).toBe('深色');
    expect(result.current.settings.density).toBe('紧凑');
    expect(result.current.settingsError).toBeNull();
  });

  it('surfaces an init error and recovers on retry', async () => {
    let rejectFirstRead!: (reason: unknown) => void;
    let resolveSecondRead!: (value: Record<string, string>) => void;
    let readCallCount = 0;
    const readSettings = vi.fn(
      () =>
        new Promise<Record<string, string>>((resolve, reject) => {
          readCallCount += 1;
          if (readCallCount === 1) {
            rejectFirstRead = reject;
          } else {
            resolveSecondRead = resolve;
          }
        }),
    );
    const port = createPort({ readSettings });
    const service = createSettingsService(port, WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    expect(result.current.settingsLoading).toBe(true);

    await act(async () => {
      rejectFirstRead(new Error('backend down'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.settingsError).toBe('backend down');
    expect(result.current.settingsErrorKind).toBe('init');
    expect(result.current.settingsLoading).toBe(false);
    expect(result.current.settings.theme).toBe('浅色');

    act(() => {
      result.current.handleRetrySettingsLoad();
    });

    await act(async () => {
      resolveSecondRead({ theme: '深色' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readSettings).toHaveBeenCalledTimes(2);
    expect(result.current.settingsError).toBeNull();
    expect(result.current.settingsErrorKind).toBeNull();
    expect(result.current.settings.theme).toBe('深色');

    consoleErrorSpy.mockRestore();
  });

  it('surfaces a write error, rolls back the value, and dismiss clears it', async () => {
    let rejectWrite!: (reason: unknown) => void;
    const port = createPort({
      writeSettings: vi.fn(
        () =>
          new Promise<void>((_, reject) => {
            rejectWrite = reject;
          }),
      ),
    });
    const service = createSettingsService(port, WORKBENCH_MOCK_SETTINGS_DEFAULTS);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useWorkbenchSettingsRoute({ settingsService: service }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.settingsLoading).toBe(false);

    act(() => {
      result.current.handleSettingChange('theme', '深色');
    });
    expect(result.current.settings.theme).toBe('深色');
    expect(port.writeSettings).toHaveBeenCalledWith({ theme: '深色' });

    await act(async () => {
      rejectWrite(new Error('persist failed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.settingsError).toBe('persist failed');
    expect(result.current.settingsErrorKind).toBe('write');
    expect(result.current.settings.theme).toBe('浅色');

    act(() => {
      result.current.handleDismissSettingsError();
    });
    expect(result.current.settingsError).toBeNull();
    expect(result.current.settingsErrorKind).toBeNull();
    expect(result.current.settings.theme).toBe('浅色');

    consoleErrorSpy.mockRestore();
  });
});
