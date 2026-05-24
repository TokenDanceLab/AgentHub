import { useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Braces, Cloud, Cpu, HardDrive, LockKeyhole, MessageSquareText, Route, Sparkles } from 'lucide-react';
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
        <div className={styles.header}>
          <div className={styles.brandMark} aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <span>{t('welcome.eyebrow')}</span>
          <h1>{t('welcome.headline')}</h1>
        </div>

        <div className={styles.launcher}>
          <div className={styles.modeRow} aria-label={t('welcome.launcherLabel')}>
            <button type="button" className={styles.modePill}>
              <Cpu size={15} />
              <span>{t('welcome.runtime')}</span>
            </button>
            <button type="button" className={`${styles.modePill} ${styles.modePillActive}`}>
              <Bot size={15} />
              <span>{t('welcome.profile')}</span>
            </button>
            <button type="button" className={styles.modePill}>
              <Route size={15} />
              <span>{t('welcome.target')}</span>
            </button>
          </div>

          <button className={styles.commandBox} onClick={onCreateThread} type="button">
            <MessageSquareText size={19} />
            <span>{t('welcome.commandPlaceholder')}</span>
          </button>

          <div className={styles.controlRow}>
            <span><HardDrive size={14} />{t('welcome.localEdge')}</span>
            <span><LockKeyhole size={14} />{t('welcome.approval')}</span>
            <span><Cloud size={14} />{t('welcome.tokendance')}</span>
          </div>
        </div>

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
                <Braces size={14} />
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
