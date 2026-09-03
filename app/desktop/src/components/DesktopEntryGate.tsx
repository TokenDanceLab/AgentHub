import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DesignNavIcon } from '@agenthub/workbench';
import { useAuth } from '@/hooks/useAuth';
import { OidcError } from '@/api/hubAuth';
import agentHubLogo from '@/assets/agenthub-product-icon-rounded.svg';
import tokenDanceLogo from '@/assets/tokendance-product-mark-transparent.svg';
import styles from './DesktopEntryGate.module.css';

interface DesktopEntryGateProps {
  onLoginSuccess: () => void;
  onContinueDemo: () => void;
  onConnectEdge: () => void;
  onToggleTheme: () => void;
  edgeOnline: boolean;
}

export function DesktopEntryGate({ onLoginSuccess, onContinueDemo, onConnectEdge, onToggleTheme, edgeOnline }: DesktopEntryGateProps) {
  const { t } = useTranslation();
  const { loginWithTokenDance, tryAutoLogin, user } = useAuth();
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // On mount, try auto-login — this handles the OIDC callback URL case
  // where the browser returns to localhost:5173/auth/tokendance/callback?code=xxx&state=yyy
  // NOTE: tryAutoLogin is wrapped in useCallback with a stable [auth] singleton (useAuth.ts).
  // If the singleton pattern is changed, this effect may re-fire spuriously.
  useEffect(() => {
    void tryAutoLogin().catch((err: unknown) => {
      if (err instanceof OidcError) {
        setLoginError(t(`auth.error.oidc.${err.code}` as const, { detail: err.detail ?? '', defaultValue: 'Login failed' }));
      }
    });
  }, [tryAutoLogin, t]);

  // If user becomes authenticated (e.g. after OIDC callback), notify parent
  useEffect(() => {
    if (user) onLoginSuccess();
  }, [user, onLoginSuccess]);

  if (user) return null;

  async function handleTokenDanceLogin() {
    setLoginError(null);
    setLoginPending(true);
    try {
      await loginWithTokenDance();
      // In Vite dev mode, loginWithTokenDance() does window.location.assign()
      // which unloads the page. The callback page reload will trigger the
      // tryAutoLogin → user check → onLoginSuccess path above.
      // In Tauri mode, we reach this point after the callback is processed.
    } catch (err: unknown) {
      setLoginPending(false);
      if (err instanceof OidcError) {
        setLoginError(t(`auth.error.oidc.${err.code}` as const, { detail: err.detail ?? '', defaultValue: 'Login failed' }));
      } else {
        const message = err instanceof Error ? err.message : '';
        setLoginError(message || t('auth.error.tokenDanceUnavailable'));
      }
    }
  }

  return (
    <main aria-label="Desktop entry" className={styles.entry}>
      <section aria-labelledby="desktop-entry-title" className={styles.card}>
        <button
          aria-label={t('desktopEntry.toggleTheme', { defaultValue: '切换主题' })}
          className={styles.themeButton}
          onClick={onToggleTheme}
          title={t('desktopEntry.toggleTheme', { defaultValue: '切换主题' })}
          type="button"
        >
          <DesignNavIcon name="sun" size={16} />
        </button>
        <img alt="AgentHub" className={styles.mark} src={agentHubLogo} />
        <h1 id="desktop-entry-title">{t('desktopEntry.title', { defaultValue: '登录 AgentHub' })}</h1>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            onClick={handleTokenDanceLogin}
            disabled={loginPending}
            type="button"
          >
            <img
              alt=""
              aria-hidden="true"
              className={styles.identityLogo}
              data-testid="tokendance-id-logo"
              src={tokenDanceLogo}
            />
            <span>
              {loginPending
                ? t('desktopEntry.redirecting', { defaultValue: '正在跳转 TokenDance ID…' })
                : t('desktopEntry.continueWithTokenDance', { defaultValue: '使用 TokenDance ID 继续' })}
            </span>
          </button>
          <button
            className={`${styles.secondaryButton} ${styles.edgeButton}`}
            disabled={!edgeOnline}
            onClick={onConnectEdge}
            title={edgeOnline
              ? t('desktopEntry.edgeOnlineHint', { defaultValue: '连接本地 Edge Server，读取真实数据' })
              : t('desktopEntry.edgeOffline', { defaultValue: 'Local Edge 未运行' })}
            type="button"
          >
            <DesignNavIcon name="laptop" size={16} />
            <span>
              {edgeOnline
                ? t('desktopEntry.connectEdge', { defaultValue: '连接 Local Edge' })
                : t('desktopEntry.edgeOffline', { defaultValue: 'Local Edge 未运行' })}
            </span>
          </button>
          <button
            className={styles.secondaryButton}
            onClick={onContinueDemo}
            type="button"
          >
            {t('desktopEntry.continueDemo', { defaultValue: '使用 Demo 模式继续' })}
          </button>
        </div>
        {loginPending ? (
          <p className={styles.status} role="status">
            {t('desktopEntry.waitingForLogin', { defaultValue: '正在等待 TokenDance ID 登录…' })}
          </p>
        ) : null}
        {loginError ? (
          <p className={styles.status} role="alert" style={{ color: 'var(--error, #e53e3e)' }}>{loginError}</p>
        ) : null}
      </section>
    </main>
  );
}
