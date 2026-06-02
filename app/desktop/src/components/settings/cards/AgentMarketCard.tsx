import { useTranslation } from 'react-i18next';
import { Bot, Pencil, Trash2, Globe2 } from 'lucide-react';
import type { CustomAgentMarketItem } from '../sections/AgentMarketSection';
import { formatTimestamp } from '../utils';
import styles from '../../SettingsPage.module.css';

export default function AgentMarketCard({
  agent,
  onEdit,
  onDelete,
  onPublish,
}: {
  agent: CustomAgentMarketItem;
  onEdit?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
  onPublish?: (agent: CustomAgentMarketItem) => void;
}) {
  const { t } = useTranslation();
  const isLocalDraft = agent.source === 'local';
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
      {isLocalDraft && (onEdit || onDelete || onPublish) && (
        <div className={styles.profileCardActions}>
          {onPublish && (
            <button
              type="button"
              className={styles.primaryBtn}
              title={t('settings.agentCreator.publishToHub')}
              onClick={() => onPublish(agent)}
            >
              <Globe2 size={13} />
              {t('settings.agentCreator.publishToHub')}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className={styles.secondaryBtn}
              title={t('settings.agentCreator.editBtn')}
              onClick={() => onEdit(agent.id)}
            >
              <Pencil size={13} />
              {t('settings.agentCreator.editBtn')}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={styles.dangerBtn}
              title={t('settings.agentCreator.deleteBtn')}
              onClick={() => onDelete(agent.id)}
            >
              <Trash2 size={13} />
              {t('settings.agentCreator.deleteBtn')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
