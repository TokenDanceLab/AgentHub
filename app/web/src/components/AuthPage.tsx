import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown } from 'lucide-react';
import { TokenDanceMark } from '@shared/ui';
import type { UserProfile } from '@/api/hubClient';
import { HUB_URL } from '@/config';
import LoginForm from '@/components/LoginForm';
import { THEME_PRESETS, THEME_PRESET_META, type ThemePreset } from '@shared/theme';
import { useThemeContext } from '@/contexts/ThemeContext';
import styles from './AuthPage.module.css';

type HubStatus = 'connected' | 'disconnected' | 'checking';

interface Props {
  onLoginSuccess: (user: UserProfile) => void;
  onClose?: () => void;
}

export default function AuthPage({ onLoginSuccess, onClose }: Props) {
  const { t } = useTranslation();
  // Preset UI is a Web-theme enhancement; surfaces rendered outside the
  // ThemeProvider (tests, isolated previews) simply omit the switcher.
  const themeContext = useThemeContext();
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
        <button className={styles.closeBtn} onClick={onClose} title={t('action.close')} aria-label={t('action.close')}>
          <X size={16} />
        </button>
      )}

      <div className={styles.header}>
        <TokenDanceMark className={styles.logo} />
        <h1 className={styles.appName}>{t('auth.title')}</h1>
        <p className={styles.tagline}>{t('auth.tagline')}</p>
      </div>

      <LoginForm onSuccess={handleLoginSuccess} />

      {/* Collapsible advanced settings */}
      <button
        className={styles.advancedToggle}
        onClick={() => setShowAdvanced((v) => !v)}
        type="button"
      >
        <span className={`${styles.advancedToggleIcon} ${showAdvanced ? styles.advancedToggleIconOpen : ''}`}>
          <ChevronDown size={14} />
        </span>
        {t('auth.advancedSettings')}
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
          {/* Web theme preset switcher (#1820): CSS preset palettes load via
              styles/presets.css; shared themePresets registry drives this UI. */}
          {themeContext && (() => {
            const { theme, themePreset, setThemePreset } = themeContext;
            return (
              <div className={styles.presetSection}>
                <span className={styles.presetLabel}>{t('auth.preset.label')}</span>
                <div className={styles.presetGrid} role="group" aria-label={t('auth.preset.label')}>
                  <button
                    type="button"
                    className={themePreset === undefined ? `${styles.presetChip} ${styles.presetChipActive}` : styles.presetChip}
                    aria-pressed={themePreset === undefined}
                    onClick={() => setThemePreset(undefined)}
                  >
                    {t('auth.preset.default')}
                  </button>
                  {THEME_PRESETS.map((preset: ThemePreset) => {
                    const meta = THEME_PRESET_META[preset];
                    const swatches = meta[theme === 'dark' ? 'darkPreview' : 'lightPreview'];
                    return (
                      <button
                        key={preset}
                        type="button"
                        className={themePreset === preset ? `${styles.presetChip} ${styles.presetChipActive}` : styles.presetChip}
                        aria-pressed={themePreset === preset}
                        onClick={() => setThemePreset(preset)}
                        title={t(`auth.preset.${preset}`, { defaultValue: meta.label })}
                      >
                        <span className={styles.presetSwatches} aria-hidden="true">
                          {swatches.map((swatch) => (
                            <span key={swatch} className={styles.presetSwatch} style={{ background: swatch }} />
                          ))}
                        </span>
                        <span className={styles.presetName}>{t(`auth.preset.${preset}`, { defaultValue: meta.label })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
