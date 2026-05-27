import { useTranslation } from 'react-i18next';
import { Bot, ShieldCheck, Code2, Globe2, RefreshCw } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import Panel from '../primitives/Panel';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import Callout from '../primitives/Callout';
import AgentMarketCard from '../cards/AgentMarketCard';
import { countAgentCapabilities, statusLabelFromQuery, readUnknownString, readUnknownArray } from '../utils';
import styles from '../../SettingsPage.module.css';

export interface CustomAgentMarketItem {
  id: string;
  name: string;
  agentType: string;
  systemPrompt: string;
  capabilities: string[];
  source: string;
  updatedAt?: string;
}

function normalizeCustomAgent(raw: Record<string, unknown>): CustomAgentMarketItem {
  const id = readUnknownString(raw.id) ?? readUnknownString(raw.agent_id) ?? readUnknownString(raw.custom_agent_id) ?? 'custom-agent';
  const capabilityTags = readUnknownArray(raw.capability_tags);
  return {
    id,
    name: readUnknownString(raw.name) ?? id,
    agentType: readUnknownString(raw.agent_type) ?? readUnknownString(raw.type) ?? 'custom',
    systemPrompt: readUnknownString(raw.system_prompt) ?? readUnknownString(raw.description) ?? '',
    capabilities: capabilityTags.length > 0 ? capabilityTags : readUnknownArray(raw.capabilities),
    source: '/web/custom-agents',
    updatedAt: readUnknownString(raw.updated_at) ?? readUnknownString(raw.created_at),
  };
}

interface AgentMarketSectionProps {
  hubSessionActive: boolean;
  agents: AgentInfo[];
  edgeOnline: boolean;
  customAgents: Record<string, unknown>[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
  onOpenAuth: () => void;
}

export default function AgentMarketSection({
  hubSessionActive, agents, edgeOnline, customAgents: rawAgents,
  isLoading, isFetching, isError, isSuccess, refetch, onOpenAuth,
}: AgentMarketSectionProps) {
  const { t } = useTranslation();
  const customAgents = rawAgents.map(normalizeCustomAgent);
  const marketPublishReady = customAgents.length;
  const marketCapabilityCount = countAgentCapabilities(agents as unknown as { capabilities: Record<string, boolean | undefined> }[]);

  const marketSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive, isLoading, isFetching, isError, isSuccess, t,
  });

  return (
    <Panel title={t('settings.agentMarket')} description={t('settings.agentMarketDesc')}>
      {!hubSessionActive ? (
        <AuthGapBlock title={t('settings.hubSignInRequired')} description={t('settings.marketSignedOutDesc')} actionLabel={t('settings.signIn')} onAction={onOpenAuth} />
      ) : isError ? (
        <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.marketHubErrorDesc')} />
      ) : null}
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<Bot size={18} />} label={t('settings.marketLocalProfiles')} value={`${agents.length}`} detail={edgeOnline ? t('settings.marketLocalProfilesDesc') : t('settings.edgeOffline')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.marketPublishReady')} value={isLoading ? t('settings.loading') : `${marketPublishReady}`} detail={t('settings.marketPublishReadyDesc')} />
        <SummaryCard icon={<Code2 size={18} />} label={t('settings.marketCapabilities')} value={`${marketCapabilityCount}`} detail={t('settings.marketCapabilitiesDesc')} />
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.marketHubSync')} value={marketSnapshotStatus} detail={hubSessionActive ? t('settings.marketHubSyncDesc') : t('settings.marketHubSyncSignedOut')} />
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <div className={styles.taskSectionTitleRow}>
            <div>
              <strong>{t('settings.marketInstalledProfiles')}</strong>
              <span>{t('settings.marketInstalledProfilesDesc')}</span>
            </div>
            <div className={styles.taskSectionActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => void refetch()} disabled={!hubSessionActive || isFetching}>
                <RefreshCw size={15} />
                {isFetching ? t('settings.marketRefreshing') : t('settings.marketRefresh')}
              </button>
            </div>
          </div>
        </div>
        {isLoading ? (
          <EmptyBlock title={t('settings.loading')} description={t('settings.marketLoadingDesc')} />
        ) : customAgents.length > 0 ? (
          <div className={styles.profileGrid}>{customAgents.map((agent) => <AgentMarketCard key={`market-${agent.id}`} agent={agent} />)}</div>
        ) : (
          <EmptyBlock title={t('settings.marketNoProfiles')} description={hubSessionActive ? t('settings.marketNoProfilesDesc') : t('settings.marketSignedOutDesc')} />
        )}
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.marketReleaseReadiness')}</strong><span>{t('settings.marketReleaseReadinessDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title={t('settings.agentTemplates')} description={t('settings.agentTemplatesDesc')} status={customAgents.length > 0 ? t('settings.statusReady') : t('settings.notConfigured')} />
          <CapabilityCard title={t('settings.agentCapabilityTags')} description={t('settings.agentCapabilityTagsDesc')} status={marketCapabilityCount > 0 ? t('settings.statusReady') : t('settings.statusPlanned')} />
          <CapabilityCard title={t('settings.agentReviewFlow')} description={t('settings.agentReviewFlowDesc')} status={t('settings.status.interfaceGap')} />
          <CapabilityCard title={t('settings.marketTokenDancePublish')} description={t('settings.marketTokenDancePublishDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
        </div>
      </div>
      <Callout title={t('settings.marketGuard')} body={t('settings.marketGuardDesc')} />
    </Panel>
  );
}
