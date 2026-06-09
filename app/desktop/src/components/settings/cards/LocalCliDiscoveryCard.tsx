import { useTranslation } from 'react-i18next';
import { RuntimeBrandIcon } from '@shared/workbench';
import type { LocalCliDiscoveryManifest } from '../cliDiscovery';
import styles from '../primitives/primitives.module.css';

export default function LocalCliDiscoveryCard({ discovery }: { discovery: LocalCliDiscoveryManifest }) {
  const { t } = useTranslation();

  return (
    <div className={styles.profileCard} aria-label={t('settings.localCliDiscovery')}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <RuntimeBrandIcon kind="runtime" name="terminal" size="compact" framed={false} />
        </div>
        <div>
          <strong>{t('settings.localCliDiscovery')}</strong>
          <span>{t('settings.localCliDiscoveryDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles.profileStatus_available}`}>
          {discovery.mode}
        </em>
      </div>

      <div className={styles.profileMeta}>
        <span>{t('settings.localCliReadinessManifest')}: {discovery.readinessManifest}</span>
        <span>{t('settings.localCliReadinessScript')}: {discovery.readinessScript}</span>
      </div>

      <div className={styles.runnerList}>
        {discovery.items.map((item) => (
          <div key={item.id} className={styles.runnerRow}>
            <div className={styles.connectionIcon}>
              <RuntimeBrandIcon kind="runtime" name={item.id} size="compact" framed={false} />
            </div>
            <div className={styles.settingCopy}>
              <strong>{item.name}</strong>
              <span>{t('settings.localCliVersion')}: {item.version || 'unknown'}</span>
              <span>{t('settings.localCliPath')}: {item.path}</span>
            </div>
            <span className={`${styles.statusPill} ${item.installed ? styles.statusPillOn : ''}`}>
              {t(item.installed ? 'settings.localCliInstalled' : 'settings.localCliMissing')}
            </span>
            <span className={`${styles.statusPill} ${item.noSpend ? styles.statusPillOn : ''}`}>
              {t('settings.localCliNoSpend')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
