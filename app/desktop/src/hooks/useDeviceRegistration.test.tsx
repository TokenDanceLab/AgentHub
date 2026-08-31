import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubClient } from '@/api/hubClient';
import { DEVICE_ID_KEY } from '@shared/api/deviceId';
import { useDeviceRegistration } from './useDeviceRegistration';

describe('useDeviceRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-00000000d001');
  });

  it('registers the stable Desktop device as a local-edge dispatch target capability', async () => {
    const hubClient = {
      registerDevice: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-00000000d001',
        user_id: 'user-1',
        device_type: 'desktop',
        app_version: '0.1.0',
        capabilities: {},
      }),
    } as unknown as HubClient;

    const { result } = renderHook(() => useDeviceRegistration(hubClient));

    await waitFor(() => expect(result.current.status).toBe('registered'));

    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe('00000000-0000-4000-8000-00000000d001');
    expect(hubClient.registerDevice).toHaveBeenCalledWith({
      device_id: '00000000-0000-4000-8000-00000000d001',
      app_version: '0.6.1',
      capabilities: ['local_edge', 'agent.dispatch', 'agent.control'],
    });
    expect(result.current.deviceId).toBe('00000000-0000-4000-8000-00000000d001');
  });
});
