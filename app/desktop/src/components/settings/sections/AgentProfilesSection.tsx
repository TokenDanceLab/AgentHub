import { useTranslation } from 'react-i18next';
import { Bot, Cpu } from 'lucide-react';
import type { AgentInfo, RunnerHealthItem } from '@shared/types';
import type { ResolvedRunModelSettings } from '@/stores/modelSettingsStore';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import EmptyBlock from '../primitives/EmptyBlock';
import RuntimeInventoryCard from '../cards/RuntimeInventoryCard';
import LocalAgentProfileCard from '../cards/LocalAgentProfileCard';

interface AgentProfilesSectionProps {
  agents: AgentInfo[];
  edgeOnline: boolean;
  runnerSummary: string;
  runnerItems: RunnerHealthItem[];
  localAgentProfiles: Array<{ agent: AgentInfo; alias: string; route: ResolvedRunModelSettings }>;
}

export default function AgentProfilesSection({ agents, edgeOnline, runnerSummary, runnerItems, localAgentProfiles }: AgentProfilesSectionProps) {
  const { t } = useTranslation();
  const availableRuntimes = agents.filter((agent) => agent.status === 'available').length;
  return (
    <Panel title={t('settings.agentProfiles')} description={t('settings.agentProfilesDesc')}>
      <div className="summaryGrid">
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
      <div className="taskSection">
        <div className="taskSectionHeader">
          <strong>{t('settings.runtimeInventory')}</strong>
          <span>{t('settings.runtimeInventoryDesc')}</span>
        </div>
        {agents.length > 0 ? (
          <div className="profileGrid">
            {agents.map((agent) => <RuntimeInventoryCard key={agent.id} agent={agent} />)}
          </div>
        ) : (
          <EmptyBlock title={t('settings.noRuntimes')} description={t('settings.noRuntimesDesc')} />
        )}
      </div>
      <div className="taskSection">
        <div className="taskSectionHeader">
          <strong>{t('settings.profileComposition')}</strong>
          <span>{t('settings.profileCompositionDesc')}</span>
        </div>
        {localAgentProfiles.length > 0 ? (
          <div className="profileGrid">
            {localAgentProfiles.map((profile) => (
              <LocalAgentProfileCard
                key={`profile-${profile.agent.id}`}
                agent={profile.agent}
                alias={profile.alias}
                route={profile.route}
                edgeOnline={edgeOnline}
              />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.noProfiles')} description={t('settings.noProfilesDesc')} />
        )}
        <div className="capabilityGrid">
          <CapabilityCard
            title={t('settings.profileRuntime')}
            description={t('settings.profileRuntimeDesc')}
            status={agents.length > 0 ? t('settings.statusReady') : t('settings.notConfigured')}
          />
          <CapabilityCard
            title={t('settings.profileModel')}
            description={t('settings.profileModelDesc')}
            status={t('settings.statusInProgress')}
          />
          <CapabilityCard
            title={t('settings.profileConfig')}
            description={t('settings.profileConfigDesc')}
            status={t('settings.statusInProgress')}
          />
          <CapabilityCard
            title={t('settings.executionTargets')}
            description={t('settings.profileExecutionTargetDesc')}
            status={edgeOnline ? t('settings.statusReady') : t('settings.notConfigured')}
          />
        </div>
      </div>
      <SettingRow title={t('settings.profileConfigSource')} description={t('settings.profileConfigSourceDesc')} value="AGENTS.md / memory / skills" />
      <SettingRow title={t('settings.profilePublish')} description={t('settings.profilePublishDesc')} value={t('settings.statusPlanned')} />
    </Panel>
  );
}
