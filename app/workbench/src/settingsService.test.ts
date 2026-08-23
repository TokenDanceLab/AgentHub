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

  it('rolls back writeBatch on failure and restores the previous snapshot', async () => {
    const port = createPort({
      writeSettings: vi.fn().mockRejectedValue(new Error('batch failed')),
    });
    const service = createSettingsService(port, { theme: '浅色', density: '标准' });
    await service.init();

    service.writeBatch({ theme: '深色', density: '紧凑' });
    expect(service.readAll().theme).toBe('深色');
    expect(service.readAll().density).toBe('紧凑');

    await vi.waitFor(() => {
      expect(service.error).toBe('batch failed');
    });
    expect(service.errorKind).toBe('write');
    // Rolled back to the pre-batch snapshot.
    expect(service.readAll().theme).toBe('浅色');
    expect(service.readAll().density).toBe('标准');
  });

  it('clears a prior write error when a subsequent write succeeds', async () => {
    const writeSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    const service = createSettingsService(createPort({ writeSettings }), { theme: '浅色' });
    await service.init();

    service.write('theme', '深色');
    await vi.waitFor(() => {
      expect(service.error).toBe('transient');
    });

    service.write('theme', '自动');
    await vi.waitFor(() => {
      expect(service.error).toBeNull();
    });
    expect(service.errorKind).toBeNull();
    expect(service.readAll().theme).toBe('自动');
  });

  it('clears a prior write error when a subsequent writeBatch succeeds', async () => {
    const writeSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    const service = createSettingsService(createPort({ writeSettings }), { theme: '浅色' });
    await service.init();

    service.writeBatch({ theme: '深色' });
    await vi.waitFor(() => {
      expect(service.errorKind).toBe('write');
    });

    service.writeBatch({ theme: '自动' });
    await vi.waitFor(() => {
      expect(service.error).toBeNull();
    });
    expect(service.readAll().theme).toBe('自动');
  });

  it('uses fallback messages for non-Error rejections and ignores clearError when healthy', async () => {
    const port = createPort({
      readSettings: vi.fn().mockRejectedValueOnce('').mockResolvedValueOnce({}),
      writeSettings: vi.fn().mockRejectedValue(undefined),
    });
    const service = createSettingsService(port, { theme: '浅色' });
    const listener = vi.fn();
    service.subscribe(listener);

    await service.init();
    expect(service.error).toBe('设置加载失败');

    await service.init(); // recover so we can exercise the write fallback
    service.write('theme', '深色');
    await vi.waitFor(() => {
      expect(service.error).toBe('设置保存失败');
    });

    // clearError emits only when an error is actually present.
    listener.mockClear();
    service.clearError();
    expect(service.error).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    service.clearError();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribed listeners stop receiving updates', async () => {
    const service = createSettingsService(createPort(), { theme: '浅色' });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    unsubscribe();
    service.write('theme', '深色');
    expect(listener).not.toHaveBeenCalled();
  });
});
