import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_ID_KEY, getOrCreateDeviceId } from './deviceId';

const GENERATED_ID = '00000000-0000-0000-0000-00000000d101';

describe('desktop device id storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(GENERATED_ID);
  });

  it('reuses a persisted UUID device id', () => {
    localStorage.setItem(DEVICE_ID_KEY, '00000000-0000-0000-0000-00000000d102');

    expect(getOrCreateDeviceId()).toBe('00000000-0000-0000-0000-00000000d102');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it('normalizes uppercase UUIDs before sending them to Hub', () => {
    localStorage.setItem(DEVICE_ID_KEY, '00000000-0000-0000-0000-00000000D103');

    expect(getOrCreateDeviceId()).toBe('00000000-0000-0000-0000-00000000d103');
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe('00000000-0000-0000-0000-00000000d103');
  });

  it('repairs stale non-UUID ids from older builds', () => {
    localStorage.setItem(DEVICE_ID_KEY, 'desktop_legacy_001');

    expect(getOrCreateDeviceId()).toBe(GENERATED_ID);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(GENERATED_ID);
  });
});
