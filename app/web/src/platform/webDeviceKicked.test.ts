import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@shared/ui/toast';
import { saveStoredHubAccessToken, saveStoredHubRefreshToken } from '@/api/hubTokenStorage';
import { isDeviceKickedFrame, respondToDeviceKick } from './webDeviceKicked';

describe('isDeviceKickedFrame', () => {
  it('accepts only device.kicked frames', () => {
    expect(isDeviceKickedFrame({ type: HUB_EVENTS.DEVICE_KICKED, payload: {} })).toBe(true);
    expect(isDeviceKickedFrame({ type: HUB_EVENTS.DEVICE_ONLINE, payload: {} })).toBe(false);
    expect(isDeviceKickedFrame({ type: HUB_EVENTS.MESSAGE_NEW })).toBe(false);
    expect(isDeviceKickedFrame(null)).toBe(false);
    expect(isDeviceKickedFrame('device.kicked')).toBe(false);
    expect(isDeviceKickedFrame([HUB_EVENTS.DEVICE_KICKED])).toBe(false);
  });
});

describe('respondToDeviceKick (#1816)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useHubStore.getState().clear();
    useToastStore.setState({ toasts: [] });
  });

  it('fails the session closed, shows a persistent toast, and guides the user back to sign-in', async () => {
    await saveStoredHubAccessToken('kicked-access');
    await saveStoredHubRefreshToken('kicked-refresh');
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');

    respondToDeviceKick((key) => key);

    // User-visible feedback: warning toast with a sign-in action.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual(
      expect.objectContaining({
        type: 'warning',
        message: 'webChat.deviceKicked',
        // Persistent: the user must act, no auto-dismiss.
        duration: 0,
      }),
    );
    const toastAction = toasts[0]?.action;
    expect(toastAction?.label).toBe('webChat.deviceKicked.signIn');

    // Session state is reset and the login entry is visible.
    await vi.waitFor(() => {
      expect(useHubStore.getState().authenticated).toBe(false);
      expect(useHubStore.getState().showAuthModal).toBe(true);
    });
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBeNull();

    // The toast action reopens the login entry if the modal was dismissed.
    useHubStore.getState().setShowAuthModal(false);
    toastAction?.onClick();
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });
});
