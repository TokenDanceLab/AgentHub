/**
 * Web handling for the Hub `device.kicked` frame (#1816).
 *
 * The shared hubWS handle intentionally swallows the kicked frame before
 * typed/any handlers (it de-auths and closes the socket there), so the web
 * realtime layer observes the raw transport instead. When the frame arrives
 * the session is dead server-side: drop it locally and tell the user why
 * they need to sign in again.
 */

import { HUB_EVENTS } from '@shared/hubEvents';
import { resetWebHubSession } from '@/platform/webAuthSessionReset';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@shared/ui/toast';

/** Minimal translator surface for the kicked feedback copy. */
export type DeviceKickedTranslator = (key: 'webChat.deviceKicked' | 'webChat.deviceKicked.signIn') => string;

/** True when a raw WebSocket frame is the Hub device.kicked frame. */
export function isDeviceKickedFrame(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).type === HUB_EVENTS.DEVICE_KICKED;
}

/**
 * Fails the Hub session closed and shows user-visible feedback: an
 * explanatory toast with a sign-in action, plus the auth modal itself.
 */
export function respondToDeviceKick(translate: DeviceKickedTranslator): void {
  void resetWebHubSession();
  useToastStore.getState().addToast({
    type: 'warning',
    message: translate('webChat.deviceKicked'),
    // Persistent until dismissed — the user must sign in again.
    duration: 0,
    action: {
      label: translate('webChat.deviceKicked.signIn'),
      onClick: () => useHubStore.getState().setShowAuthModal(true),
    },
  });
}
