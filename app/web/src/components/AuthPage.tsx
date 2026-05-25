import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown } from 'lucide-react';
import type { UserProfile } from '@/api/hubClient';
import { HUB_URL } from '@/config';
import LoginForm from '@/components/LoginForm';
import RegisterForm from '@/components/RegisterForm';
import styles from './AuthPage.module.css';

type Page = 'login' | 'register';
type HubStatus = 'connected' | 'disconnected' | 'checking';

interface Props {
  onLoginSuccess: (user: UserProfile) => void;
  onClose?: () => void;
}

export default function AuthPage({ onLoginSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>('login');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hubUrl, setHubUrl] = useState(() => {
    try {
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem('agenthub_hub_url') || HUB_URL
        : HUB_URL;
    } catch {
      return HUB_URL;
    }
  });
  const [hubStatus, setHubStatus] = useState<HubStatus>('checking');
  const checkRef = useRef<ReturnType<typeof setTimeout>>(null);

  const checkHub = useCallback(async (url: string) => {
    setHubStatus('checking');
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      setHubStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setHubStatus('disconnected');
    }
  }, []);

  // Check Hub connection on mount and URL change (debounced)
  useEffect(() => {
    if (checkRef.current) clearTimeout(checkRef.current);
    checkRef.current = setTimeout(() => checkHub(hubUrl), 400);
    return () => {
      if (checkRef.current) clearTimeout(checkRef.current);
    };
  }, [hubUrl, checkHub]);

  const handleHubUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setHubUrl(url);
    try {
      localStorage.setItem('agenthub_hub_url', url);
    } catch { /* ignore */ }
  }, []);

  const handleLoginSuccess = useCallback(
    (user: UserProfile) => {
      onLoginSuccess(user);
    },
    [onLoginSuccess],
  );

  const handleRegisterSuccess = useCallback(() => {
    setPage('login');
  }, []);

  const hubDotClass = [
    styles.hubStatusDot,
    hubStatus === 'connected'
      ? styles.hubStatusDotConnected
      : hubStatus === 'disconnected'
        ? styles.hubStatusDotDisconnected
        : styles.hubStatusDotChecking,
  ].join(' ');

  return (
    <div className={styles.page}>
      {/* Close button */}
      {onClose && (
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} />
        </button>
      )}

      {/* Clean header — no dark background */}
      <div className={styles.header}>
        <div className={styles.logo} aria-hidden="true">
          AH
        </div>
        <h1 className={styles.appName}>{t('auth.title')}</h1>
        <p className={styles.tagline}>{t('auth.tagline')}</p>
      </div>

      {/* Segmented tab switcher */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${page === 'login' ? styles.tabActive : ''}`}
          onClick={() => setPage('login')}
        >
          {t('auth.login')}
        </button>
        <button
          className={`${styles.tab} ${page === 'register' ? styles.tabActive : ''}`}
          onClick={() => setPage('register')}
        >
          {t('auth.register')}
        </button>
      </div>

      {page === 'login' ? (
        <LoginForm
          onSuccess={handleLoginSuccess}
          onSwitchToRegister={() => setPage('register')}
        />
      ) : (
        <RegisterForm
          onSuccess={handleRegisterSuccess}
          onSwitchToLogin={() => setPage('login')}
        />
      )}

      {/* Collapsible advanced settings */}
      <button
        className={styles.advancedToggle}
        onClick={() => setShowAdvanced((v) => !v)}
        type="button"
      >
        <span className={`${styles.advancedToggleIcon} ${showAdvanced ? styles.advancedToggleIconOpen : ''}`}>
          <ChevronDown size={14} />
        </span>
        高级设置
      </button>

      {showAdvanced && (
        <div className={styles.advancedSection}>
          <input
            className={styles.hubInput}
            type="url"
            value={hubUrl}
            onChange={handleHubUrlChange}
            placeholder="http://localhost:8080"
            aria-label={t('auth.hubUrl')}
          />
          <div className={styles.hubStatus}>
            <span className={hubDotClass} aria-hidden="true" />
            <span className={styles.hubStatusText}>
              {hubStatus === 'connected'
                ? t('auth.hubConnected')
                : hubStatus === 'disconnected'
                  ? t('auth.hubDisconnected')
                  : t('auth.hubChecking')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
