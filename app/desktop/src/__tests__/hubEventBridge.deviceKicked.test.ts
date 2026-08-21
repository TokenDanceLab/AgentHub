import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS, type HubEventType } from '@shared/hubEvents';
import { useToastStore } from '@shared/ui/toast';
import { createDesktopHubEventBridge } from '@/stores/hubEventBridge';
import { useConnectionStore } from '@/stores/connectionStore';

function createFakeHubWS() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    on: vi.fn((type: HubEventType, handler: (payload: unknown) => void) => {
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    }),
    emit(type: string, payload: unknown): void {
      handlers.get(type)?.(payload);
    },
  };
}

describe('desktop hub event bridge — device kicked (#1816 W1)', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      kickedReason: null,
      isConnected: true,
      connectionStatus: 'connected',
    });
    useToastStore.setState({ toasts: [] });
  });

  it('flags the connection store and shows a warning toast on device.kicked', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const hubWS = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(hubWS, queryClient);

    hubWS.emit(HUB_EVENTS.DEVICE_KICKED, { reason: 'logged_in_elsewhere' });

    expect(useConnectionStore.getState().kickedReason).toBe('logged_in_elsewhere');
    expect(useConnectionStore.getState().isConnected).toBe(false);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('warning');
    expect(toasts[0]?.message.trim().length).toBeGreaterThan(0);

    // Hub-scoped caches belong to the kicked session and get invalidated.
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['hub'] }),
    );

    bridge.destroy();
  });

  it('falls back to a default reason when the payload omits it', () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const hubWS = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(hubWS, queryClient);

    hubWS.emit(HUB_EVENTS.DEVICE_KICKED, {});

    expect(useConnectionStore.getState().kickedReason).toBe('logged_in_elsewhere');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    bridge.destroy();
  });
});
