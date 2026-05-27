import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { ResolvedRunModelSettings } from '@/stores/modelSettingsStore';
import styles from '../../SettingsPage.module.css';

interface LocalAgentProfileCardProps {
  agent: AgentInfo;
  alias?: string;
  route: ResolvedRunModelSettings;
  edgeOnline: boolean;
}

export default function LocalAgentProfileCard({ agent, alias, route, edgeOnline }: LocalAgentProfileCardProps) {
  const { t } = useTranslation();
  const profileReady = edgeOnline && agent.status === 'available';
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{t('settings.localProfileName', { runtime: agent.name })}</strong>
          <span>{t('settings.localProfileDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${profileReady ? styles.profileStatus_available : styles.profileStatus_configuring}`}>
          {profileReady ? t('settings.enabled') : t('settings.notConfigured')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.profileModel')}: {route.model ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasProvider')}: {route.provider ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasReasoning')}: {route.reasoningEffort ?? t('prompt.routeAuto')}</span>
        {alias ? <span>{t('settings.profileAlias')}: {alias}</span> : null}
        <span>{t('settings.executionTargets')}: {t('settings.targetLocalEdge')}</span>
        <span>{t('settings.profileConfigSource')}: AGENTS.md / memory / skills</span>
      </div>
    </div>
  );
}
