import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, Terminal } from 'lucide-react';
import type { UserProfile } from '@/api/hubClient';
import { HUB_URL, HUB_WS_URL } from '@/config';
import { Input } from '@shared/ui';
import LoginForm from '@/components/LoginForm';
import tokenDanceLogo from '@/assets/tokendance-icon-rounded.svg';
import styles from './AuthPage.module.css';

type HubStatus = 'connected' | 'disconnected' | 'checking';

interface Props {
  onLoginSuccess: (user: UserProfile) => void;
  onClose?: () => void;
}

export default function AuthPage({ onLoginSuccess, onClose }: Props) {
  const { t } = useTranslation();
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
        <button className={styles.closeBtn} onClick={onClose} title={t('auth.close')}>
          <X size={16} />
        </button>
      )}

      {/* Clean header without the old dark auth shell. */}
      <div className={styles.header}>
        <img className={styles.logo} src={tokenDanceLogo} alt="TokenDance" />
        <h1 className={styles.appName}>{t('auth.title')}</h1>
        <p className={styles.tagline}>{t('auth.tagline')}</p>
      </div>

      <LoginForm onSuccess={handleLoginSuccess} />

      {/* Developer mode toggle */}
      <button
        className={styles.devToggle}
        onClick={() => setShowAdvanced((v) => !v)}
        type="button"
      >
        <span className={styles.devToggleIcon}>
          <Terminal size={12} />
        </span>
        <span>{t('auth.advancedSettings')}</span>
        <span className={`${styles.devChevron} ${showAdvanced ? styles.devChevronOpen : ''}`}>
          <ChevronDown size={12} />
        </span>
      </button>

      {showAdvanced && (
        <div className={styles.devPanel}>
          <div className={styles.devRow}>
            <span className={styles.devLabel}>{t('auth.hubRest')}</span>
            <span className={styles.devValue}>{hubUrl}</span>
            <span className={hubDotClass} aria-hidden="true" />
          </div>
          <div className={styles.devRow}>
            <span className={styles.devLabel}>{t('auth.hubWs')}</span>
            <span className={styles.devValue}>{HUB_WS_URL}</span>
          </div>
          <div className={styles.devRow}>
            <span className={styles.devLabel}>{t('auth.hubStatus')}</span>
            <span className={styles.devValue}>
              {hubStatus === 'connected' ? t('auth.hubConnected')
                : hubStatus === 'disconnected' ? t('auth.hubDisconnected')
                  : t('auth.hubChecking')}
            </span>
          </div>
          {/* #1827: unified shared Input (replaces the hand-rolled .devInput). */}
          <Input
            size="sm"
            mono
            type="url"
            value={hubUrl}
            onChange={handleHubUrlChange}
            placeholder="http://localhost:8080"
            aria-label={t('auth.hubUrl')}
            className={styles.devInputMargin}
          />
        </div>
      )}
    </div>
  );
}
