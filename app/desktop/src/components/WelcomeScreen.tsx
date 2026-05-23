import { useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './WelcomeScreen.module.css';

interface Props {
  online: boolean;
  onCreateThread: () => void;
  onSendMessage: (message: string) => void;
}

const SUGGESTION_KEYS = [
  'welcome.suggestion1',
  'welcome.suggestion2',
  'welcome.suggestion3',
] as const;

export default memo(function WelcomeScreen({ online: _online, onCreateThread, onSendMessage }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Fade-in animation on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.transition = `opacity var(--duration-glacial) var(--ease-out)`;
      el.style.opacity = '1';
    });
  }, []);

  const handleSuggestionClick = (prompt: string) => {
    onCreateThread();
    onSendMessage(prompt);
  };

  return (
    <div ref={containerRef} className={styles.container} role="region" aria-label={t('welcome.title')}>
      <div className={styles.content}>
        {/* ── Brand ── */}
        <div className={styles.brand}>
          <h1 className={styles.appName}>AgentHub</h1>
          <p className={styles.subtitle}>{t('welcome.subtitle')}</p>
        </div>

        {/* ── Description ── */}
        <p className={styles.description}>{t('welcome.description')}</p>

        {/* ── Create Thread ── */}
        <button className={styles.createButton} onClick={onCreateThread} type="button">
          {t('welcome.createThread')}
        </button>

        {/* ── Example Prompts ── */}
        <div className={styles.suggestions}>
          <p className={styles.suggestionsLabel}>{t('welcome.suggestionsLabel')}</p>
          <div className={styles.chips}>
            {SUGGESTION_KEYS.map((key) => (
              <button
                key={key}
                className={styles.chip}
                onClick={() => handleSuggestionClick(t(key))}
                type="button"
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
