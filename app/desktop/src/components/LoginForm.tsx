import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { OidcError } from '@/api/hubAuth';
import type { UserProfile } from '@/api/hubClient';
import tokenDanceLogo from '@/assets/tokendance-icon-rounded.svg';
import styles from './AuthPage.module.css';

interface LoginFormProps {
  onSuccess: (user: UserProfile) => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const { t } = useTranslation();
  const { loginWithTokenDance, user } = useAuth();
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (user) onSuccess(user);
  }, [onSuccess, user]);

  const handleTokenDanceLogin = useCallback(async () => {
    setServerError(null);
    setIdentityNotice(null);
    setIdentityLoading(true);
    try {
      await loginWithTokenDance();
      setIdentityNotice(t('auth.tokenDanceCallbackPending'));
    } catch (err: unknown) {
      // #2154 P2-10: never render err.message. The OIDC failures are produced
      // in English at the transport layer ("Failed to start OIDC login: fetch
      // failed"), so echoing them put a raw technical string in a localized
      // login screen. Same mapping as web's LoginForm: known codes resolve
      // through auth.error.oidc.<code>, everything else falls back to the
      // generic localized failure.
      if (err instanceof OidcError) {
        setServerError(t(`auth.error.oidc.${err.code}`, {
          detail: err.detail ?? '',
          defaultValue: t('auth.error.oidc.default'),
        }));
      } else {
        setServerError(t('auth.error.oidc.default'));
      }
    } finally {
      setIdentityLoading(false);
    }
  }, [loginWithTokenDance, t]);

  if (user) return null;

  return (
    <div className={styles.body}>
      {serverError && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {serverError}
        </div>
      )}

      <p className={styles.identityHint}>{t('auth.tokenDancePrimary')}</p>

      <button
        type="button"
        className={styles.identityButton}
        onClick={handleTokenDanceLogin}
        disabled={identityLoading}
      >
        {identityLoading ? (
          <Loader2 size={16} className={styles.spinner} aria-hidden="true" />
        ) : (
          <img className={styles.identityIcon} src={tokenDanceLogo} alt="" aria-hidden="true" />
        )}
        <span>{t('auth.tokenDanceLogin')}</span>
      </button>

      {identityNotice && (
        <div className={styles.identityNotice} role="status">
          {identityNotice}
        </div>
      )}
    </div>
  );
}
