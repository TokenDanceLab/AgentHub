import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchHealth } from '@/api/edgeClient';
import { useToastStore } from '@/stores/toastStore';

export interface EdgeStatus {
  /** Whether banner should be shown (offline & not manually dismissed) */
  showBanner: boolean;
  /** Error message to display in the banner */
  lastError: string | null;
  /** Whether a retry is in flight */
  retrying: boolean;
  /** Dismiss the banner */
  dismissBanner: () => void;
  /** Retry edge connection */
  retry: () => Promise<void>;
}

/**
 * Manages the Edge disconnection banner lifecycle and connect/disconnect
 * toast notifications. Kept as a standalone hook so App.tsx stays focused
 * on layout assembly.
 */
export function useEdgeStatus(online: boolean): EdgeStatus {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const wasOnlineRef = useRef(false);

  // ── Banner lifecycle ──
  useEffect(() => {
    if (online) {
      setBannerDismissed(false);
      setLastError(null);
    } else if (wasOnlineRef.current) {
      if (!lastError) {
        setLastError(t('banner.disconnected'));
      }
    }
    wasOnlineRef.current = online;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ── Toast on transitions ──
  const prevOnlineRef = useRef(false);
  useEffect(() => {
    if (online && !prevOnlineRef.current) {
      addToast({ type: 'success', message: t('toast.connected') });
    } else if (!online && prevOnlineRef.current) {
      addToast({ type: 'warning', message: t('toast.disconnected') });
    }
    prevOnlineRef.current = online;
  }, [online, addToast, t]);

  // ── Retry ──
  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetchHealth();
    } catch (e) {
      setLastError(
        e instanceof Error ? e.message : t('banner.disconnected'),
      );
    } finally {
      setRetrying(false);
    }
  }, [t]);

  const dismissBanner = useCallback(() => setBannerDismissed(true), []);

  const showBanner = !online && !bannerDismissed;

  return { showBanner, lastError, retrying, dismissBanner, retry };
}
