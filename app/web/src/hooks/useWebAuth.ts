import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';

/**
 * Web-specific auth orchestration hook.
 *
 * Encapsulates the auto-login-on-mount pattern and the repeated "ensure
 * authenticated before an action" guard used across WebLayout callbacks.
 */
export function useWebAuth() {
  const { t } = useTranslation();
  const { tryAutoLogin } = useAuth();
  const queryClient = useQueryClient();
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const setShowAuthModal = useHubStore((s) => s.setShowAuthModal);
  const addToast = useToastStore((s) => s.addToast);

  // Auto-login on mount; refetch threads & agents once authenticated.
  useEffect(() => {
    let cancelled = false;
    void tryAutoLogin()
      .then((authenticated) => {
        if (authenticated && !cancelled) {
          void queryClient.refetchQueries({ queryKey: ['threads'] });
          void queryClient.refetchQueries({ queryKey: ['agents'] });
        }
      })
      .catch(() => {
        /* Auth surfaces handle explicit login errors. */
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, tryAutoLogin]);

  /**
   * Returns `true` when the user is authenticated.
   * When not authenticated, opens the auth modal and shows a toast — caller
   * should abort the guarded operation.
   */
  const ensureAuth = useCallback((): boolean => {
    if (!hubAuthenticated || !getAccessToken()) {
      setShowAuthModal(true);
      addToast({ type: 'error', message: t('webChat.signInRequired') });
      return false;
    }
    return true;
  }, [addToast, hubAuthenticated, setShowAuthModal, t]);

  return { ensureAuth };
}
