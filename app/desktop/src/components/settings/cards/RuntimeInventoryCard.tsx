import { useTranslation } from 'react-i18next';
import { RuntimeBrandIcon } from '@shared/workbench';
import type { AgentInfo } from '@shared/types';
import styles from '../primitives/primitives.module.css';

export default function RuntimeInventoryCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <RuntimeBrandIcon kind="runtime" name={agent.id || agent.name} size="compact" framed={false} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.description || t('settings.runtimeDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles[`profileStatus_${agent.status}`]}`}>
          {t(`agent.status.${agent.status}`)}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.runtimeAdapter')}: {agent.id}</span>
      </div>
    </div>
  );
}
