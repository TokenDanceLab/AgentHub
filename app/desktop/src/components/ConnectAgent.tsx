import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Globe } from 'lucide-react';
import styles from './ConnectAgent.module.css';

interface Props {
  downloadUrl?: string;
  webClientUrl?: string;
}

export default memo(function ConnectAgent({ downloadUrl, webClientUrl }: Props) {
  const { t } = useTranslation();

  return (
    <section className={styles.container} aria-label={t('connectAgent.title')}>
      <div className={styles.content}>
        <h2 className={styles.title}>{t('connectAgent.title')}</h2>
        <p className={styles.description}>{t('connectAgent.description')}</p>

        <div className={styles.actions}>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className={styles.primaryButton}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className={styles.icon} size={16} />
              {t('connectAgent.download')}
            </a>
          ) : (
            <button className={styles.primaryButton} disabled type="button">
              <Download className={styles.icon} size={16} />
              {t('connectAgent.download')}
            </button>
          )}

          {webClientUrl ? (
            <a
              href={webClientUrl}
              className={styles.secondaryButton}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe className={styles.icon} size={16} />
              {t('connectAgent.webClient')}
            </a>
          ) : (
            <button className={styles.secondaryButton} disabled type="button">
              <Globe className={styles.icon} size={16} />
              {t('connectAgent.webClient')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
});
