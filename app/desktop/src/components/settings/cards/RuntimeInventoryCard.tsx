import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import { formatRuntimeDescription } from '../utils';
import styles from '../primitives/primitives.module.css';

export default function RuntimeInventoryCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{formatRuntimeDescription(agent, t)}</span>
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
