import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { CustomAgentMarketItem } from '../sections/AgentMarketSection';
import { formatTimestamp } from '../utils';
import styles from '../../SettingsPage.module.css';

export default function AgentMarketCard({ agent }: { agent: CustomAgentMarketItem }) {
  const { t } = useTranslation();
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.systemPrompt || t('settings.marketProfileDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles.profileStatus_available}`}>
          {t('settings.statusReady')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.marketCustomAgentId')}: {agent.id}</span>
        <span>{t('settings.marketAgentType')}: {agent.agentType}</span>
        <span>{t('settings.marketInstallSource')}: {agent.source}</span>
        <span>{t('settings.marketPublishStatus')}: {t('settings.statusReady')}</span>
        {agent.updatedAt ? <span>{t('settings.marketUpdatedAt')}: {formatTimestamp(agent.updatedAt)}</span> : null}
      </div>
      <div className={styles.profileMeta}>
        {agent.capabilities.length > 0 ? (
          agent.capabilities.map((name) => <span key={name}>{name}</span>)
        ) : (
          <span>{t('settings.marketNoCapabilityTags')}</span>
        )}
      </div>
    </div>
  );
}
