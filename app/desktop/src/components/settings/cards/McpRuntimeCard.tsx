import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import styles from '../primitives/primitives.module.css';

export default function McpRuntimeCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const { mcpIntegration, permissionHooks, subAgentSpawn } = agent.capabilities;
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Plug size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.description || t('settings.mcpRuntimeDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${mcpIntegration ? styles.profileStatus_available : styles.profileStatus_configuring}`}>
          {mcpIntegration ? t('settings.statusReady') : t('settings.notConfigured')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.mcpIntegration')}: {mcpIntegration ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpPermissionHooks')}: {permissionHooks ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpSubAgentSpawn')}: {subAgentSpawn ? t('settings.enabled') : t('settings.notConfigured')}</span>
      </div>
    </div>
  );
}
