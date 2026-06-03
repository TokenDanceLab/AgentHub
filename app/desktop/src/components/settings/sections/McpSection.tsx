import { useTranslation } from 'react-i18next';
import { Plug, ShieldCheck, Bot, Globe2 } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import EmptyBlock from '../primitives/EmptyBlock';
import Callout from '../primitives/Callout';
import Switch from '../primitives/Switch';
import McpRuntimeCard from '../cards/McpRuntimeCard';
import { writeStoredValue } from '../utils';
import styles from '../primitives/primitives.module.css';

interface McpSectionProps {
  agents: AgentInfo[];
  edgeOnline: boolean;
  hubSessionActive: boolean;
  enableMcp: boolean;
  setEnableMcp: (value: boolean) => void;
}

export default function McpSection({ agents, edgeOnline, hubSessionActive, enableMcp, setEnableMcp }: McpSectionProps) {
  const { t } = useTranslation();
  const mcpCapableAgents = agents.filter((a) => a.capabilities.mcpIntegration).length;
  const mcpPermissionHookAgents = agents.filter((a) => a.capabilities.permissionHooks).length;
  const mcpSubAgentAgents = agents.filter((a) => a.capabilities.subAgentSpawn).length;

  return (
    <Panel title={t('settings.mcp')} description={t('settings.mcpDesc')}>
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<Plug size={18} />} label={t('settings.mcpRuntimeSupport')} value={`${mcpCapableAgents}/${agents.length}`} detail={edgeOnline ? t('settings.mcpRuntimeSupportDesc') : t('settings.edgeOffline')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.mcpPermissionHooks')} value={`${mcpPermissionHookAgents}`} detail={t('settings.mcpPermissionHooksDesc')} />
        <SummaryCard icon={<Bot size={18} />} label={t('settings.mcpSubAgentSpawn')} value={`${mcpSubAgentAgents}`} detail={t('settings.mcpSubAgentSpawnDesc')} />
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.mcpHubSync')} value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} detail={hubSessionActive ? t('settings.mcpHubSyncNoInterface') : t('settings.mcpHubSyncSignedOut')} />
      </div>
      <SettingRow title={t('settings.enableMcp')} description={t('settings.enableMcpDesc')} control={<Switch checked={enableMcp && edgeOnline} onChange={(v) => { setEnableMcp(v); writeStoredValue('enableMcp', v); }} disabled={!edgeOnline} />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.mcpRuntimeMatrix')}</strong><span>{t('settings.mcpRuntimeMatrixDesc')}</span></div>
        {agents.length > 0 ? (
          <div className={styles.profileGrid}>{agents.map((agent) => <McpRuntimeCard key={`mcp-${agent.id}`} agent={agent} />)}</div>
        ) : <EmptyBlock title={t('settings.mcpNoRuntimes')} description={t('settings.mcpNoRuntimesDesc')} />}
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.mcpTemplates')}</strong><span>{t('settings.mcpTemplatesDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title="Filesystem" description={t('settings.mcpFilesystem')} status={t('settings.mcpTemplate')} />
          <CapabilityCard title="GitHub" description={t('settings.mcpGitHub')} status={t('settings.notConfigured')} />
          <CapabilityCard title={t('settings.mcpTokenDanceHub')} description={t('settings.mcpTokenDanceHubDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
          <CapabilityCard title={t('settings.mcpRemoteServer')} description={t('settings.mcpRemoteServerDesc')} status={t('settings.status.interfaceGap')} />
        </div>
      </div>
      <Callout title={t('settings.mcpGuard')} body={t('settings.mcpGuardDesc')} />
    </Panel>
  );
}
