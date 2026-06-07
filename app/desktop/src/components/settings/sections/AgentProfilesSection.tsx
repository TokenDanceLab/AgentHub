import { useTranslation } from 'react-i18next';
import { Bot, Cpu } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { ResolvedRunModelSettings } from '@/stores/modelSettingsStore';
import Panel from '../primitives/Panel';
import SummaryCard from '../primitives/SummaryCard';
import EmptyBlock from '../primitives/EmptyBlock';
import RuntimeInventoryCard from '../cards/RuntimeInventoryCard';
import LocalAgentProfileCard from '../cards/LocalAgentProfileCard';
import styles from '../primitives/primitives.module.css';

interface AgentProfilesSectionProps {
  agents: AgentInfo[];
  edgeOnline: boolean;
  runnerSummary: string;
  localAgentProfiles: Array<{ agent: AgentInfo; alias: string | undefined; route: ResolvedRunModelSettings }>;
}

export default function AgentProfilesSection({ agents, edgeOnline, runnerSummary, localAgentProfiles }: AgentProfilesSectionProps) {
  const { t } = useTranslation();
  const availableRuntimes = agents.filter((agent) => agent.status === 'available').length;
  return (
    <>
      <Panel title={t('settings.runtimeInventory')} description={t('settings.runtimeInventoryDesc')}>
        <div className={`${styles.summaryGrid} ${styles.profileGridSpacious}`}>
          <SummaryCard
            icon={<Bot size={18} />}
            label={t('settings.profileAvailable')}
            value={`${availableRuntimes}/${agents.length}`}
            detail={edgeOnline ? t('settings.runtimeInventoryDesc') : t('settings.edgeOffline')}
          />
          <SummaryCard
            icon={<Cpu size={18} />}
            label={t('settings.profileRuntimeCoverage')}
            value={runnerSummary}
            detail={t('settings.profileRuntimeCoverageDesc')}
          />
        </div>
        {agents.length > 0 ? (
          <div className={`${styles.profileGrid} ${styles.profileGridSpacious}`}>
            {agents.map((agent) => <RuntimeInventoryCard key={agent.id} agent={agent} />)}
          </div>
        ) : (
          <EmptyBlock title={t('settings.noRuntimes')} description={t('settings.noRuntimesDesc')} />
        )}
      </Panel>

      <Panel title={t('settings.agentProfiles')} description={t('settings.profileCompositionDesc')}>
        {localAgentProfiles.length > 0 ? (
          <div className={`${styles.profileGrid} ${styles.profileGridSpacious}`}>
            {localAgentProfiles.map((profile) => (
              <LocalAgentProfileCard
                key={`profile-${profile.agent.id}`}
                agent={profile.agent}
                {...(profile.alias ? { alias: profile.alias } : {})}
                route={profile.route}
                edgeOnline={edgeOnline}
              />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.noProfiles')} description={t('settings.noProfilesDesc')} />
        )}
      </Panel>
    </>
  );
}
