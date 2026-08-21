import { describe, expect, it, vi } from 'vitest';
import { createSettingsService } from './settingsService';
import type { SettingsPort } from '@shared/platform/types';

function createPort(overrides?: Partial<SettingsPort>): SettingsPort {
  return {
    readSettings: vi.fn(async () => ({})),
    writeSettings: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createSettingsService', () => {
  it('exposes loading/error while init fails, then recovers on retry', async () => {
    const port = createPort({
      readSettings: vi
        .fn()
        .mockRejectedValueOnce(new Error('backend down'))
        .mockResolvedValueOnce({ theme: '深色' }),
    });
    const service = createSettingsService(port, { theme: '浅色', density: '标准' });
    const listener = vi.fn();
    service.subscribe(listener);

    const first = service.init();
    expect(service.loading).toBe(true);
    expect(service.error).toBeNull();
    await first;

    expect(service.initialized).toBe(true);
    expect(service.loading).toBe(false);
    expect(service.error).toBe('backend down');
    expect(service.errorKind).toBe('init');
    expect(service.readAll().theme).toBe('浅色');
    expect(listener).toHaveBeenCalled();

    await service.init();
    expect(service.error).toBeNull();
    expect(service.errorKind).toBeNull();
    expect(service.readAll().theme).toBe('深色');
  });

  it('rolls back writes and surfaces write errors until clearError', async () => {
    const port = createPort({
      writeSettings: vi.fn().mockRejectedValue(new Error('persist failed')),
    });
    const service = createSettingsService(port, { theme: '浅色' });
    await service.init();

    service.write('theme', '深色');
    expect(service.readAll().theme).toBe('深色');

    await vi.waitFor(() => {
      expect(service.error).toBe('persist failed');
    });
    expect(service.errorKind).toBe('write');
    expect(service.readAll().theme).toBe('浅色');

    service.clearError();
    expect(service.error).toBeNull();
    expect(service.errorKind).toBeNull();
  });
});
