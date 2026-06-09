import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DesignNavIcon } from '@shared/workbench';
import { useAuth } from '@/hooks/useAuth';
import { OidcError } from '@/api/hubAuth';
import agentHubLogo from '@/assets/agenthub-product-icon-rounded.svg';
import tokenDanceLogo from '@/assets/tokendance-product-mark-transparent.svg';
import styles from './DesktopEntryGate.module.css';

export interface DesktopEntryGateProps {
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
  useEffect(() => {
    void tryAutoLogin().catch((err: unknown) => {
      if (err instanceof OidcError) {
        setLoginError(t(`auth.error.oidc.${err.code}` as const, { detail: err.detail ?? '' }));
      }
    });
  }, [tryAutoLogin, t]);

  // If user becomes authenticated (e.g. after OIDC callback), notify parent
  if (user) {
    onLoginSuccess();
    return null;
  }

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
        setLoginError(t(`auth.error.oidc.${err.code}` as const, { detail: err.detail ?? '' }));
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
          aria-label="切换主题"
          className={styles.themeButton}
          onClick={onToggleTheme}
          title="切换主题"
          type="button"
        >
          <DesignNavIcon name="sun" size={16} />
        </button>
        <img alt="AgentHub" className={styles.mark} src={agentHubLogo} />
        <h1 id="desktop-entry-title">登录 AgentHub</h1>
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
            <span>{loginPending ? '正在跳转 TokenDance ID…' : '使用 TokenDance ID 继续'}</span>
          </button>
          <button
            className={`${styles.secondaryButton} ${styles.edgeButton}`}
            disabled={!edgeOnline}
            onClick={onConnectEdge}
            title={edgeOnline ? '连接本地 Edge Server，读取真实数据' : 'Local Edge 未运行'}
            type="button"
          >
            <DesignNavIcon name="laptop" size={16} />
            <span>{edgeOnline ? '连接 Local Edge' : 'Local Edge 未运行'}</span>
          </button>
          <button
            className={styles.secondaryButton}
            onClick={onContinueDemo}
            type="button"
          >
            使用 Demo 模式继续
          </button>
        </div>
        {loginPending ? (
          <p className={styles.status} role="status">正在等待 TokenDance ID 登录…</p>
        ) : null}
        {loginError ? (
          <p className={styles.status} role="alert" style={{ color: 'var(--error, #e53e3e)' }}>{loginError}</p>
        ) : null}
      </section>
    </main>
  );
}
