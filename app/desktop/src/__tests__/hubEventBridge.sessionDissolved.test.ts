import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS, type HubEventType } from '@shared/hubEvents';
import { useToastStore } from '@shared/ui/toast';
import { createDesktopHubEventBridge } from '@/stores/hubEventBridge';

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

describe('desktop hub event bridge — session.dissolved (#2072 P2-⑰)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('shows an info toast with dedicated sessionDissolved message', () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const hubWS = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(hubWS, queryClient);

    hubWS.emit(HUB_EVENTS.SESSION_DISSOLVED, { session_id: 'sess-123' });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('info');
    // Must show the dedicated i18n message, not a generic runtime error
    const msg = String(toasts[0]?.message);
    expect(msg).not.toMatch(/runtime error|unknown error/i);
    expect(msg.trim().length).toBeGreaterThan(0);

    bridge.destroy();
  });

  it('invalidates thread caches for the dissolved session', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const hubWS = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(hubWS, queryClient);

    hubWS.emit(HUB_EVENTS.SESSION_DISSOLVED, { session_id: 'sess-456' });

    // Should invalidate detail + messages + root threads
    expect(invalidateQueries).toHaveBeenCalled();

    bridge.destroy();
  });
});
