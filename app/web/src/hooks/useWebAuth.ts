import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, getAccessToken } from '@/hooks/useAuth';
import { OidcError } from '@/api/hubAuth';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@shared/ui/toast';
import { hubQueryKeys } from '@shared/stores/queryKeys';

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
  const [authReady, setAuthReady] = useState(false);

  // Auto-login on mount; refetch threads & agents once authenticated.
  useEffect(() => {
    let cancelled = false;
    void tryAutoLogin()
      .then((authenticated) => {
        if (authenticated && !cancelled) {
          void queryClient.refetchQueries({ queryKey: hubQueryKeys.threads.root });
          void queryClient.refetchQueries({ queryKey: hubQueryKeys.agents.root });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof OidcError) {
          // OIDC callback path (state mismatch / timeout / token exchange):
          // surface the localized error and reopen the login entry so the
          // user can retry, instead of failing silently (#1816).
          addToast({
            type: 'error',
            message: t(`auth.error.oidc.${error.code}`, {
              detail: error.detail ?? '',
              defaultValue: t('auth.error.oidc.default'),
            }),
          });
          setShowAuthModal(true);
        }
        // Non-OIDC rejections keep the previous behavior: the auth surfaces
        // handle explicit login errors.
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [addToast, queryClient, setShowAuthModal, t, tryAutoLogin]);

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

  return { ensureAuth, authReady };
}
