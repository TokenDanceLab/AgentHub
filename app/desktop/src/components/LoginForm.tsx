import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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

  if (user) return null;

  const handleTokenDanceLogin = useCallback(async () => {
    setServerError(null);
    setIdentityNotice(null);
    setIdentityLoading(true);
    try {
      await loginWithTokenDance();
      setIdentityNotice(t('auth.tokenDanceCallbackPending'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setServerError(message || t('auth.error.tokenDanceUnavailable'));
    } finally {
      setIdentityLoading(false);
    }
  }, [loginWithTokenDance, t]);

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
