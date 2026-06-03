import { useTranslation } from 'react-i18next';
import { ClipboardList, Bot, Server, ShieldCheck, Monitor, Globe2, Computer } from 'lucide-react';
import type { RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';
import type { AgentInfo } from '@shared/types';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import CapabilityCard from '../primitives/CapabilityCard';
import EmptyBlock from '../primitives/EmptyBlock';
import Callout from '../primitives/Callout';
import Switch from '../primitives/Switch';
import ExecutionTargetCard from '../primitives/ExecutionTargetCard';
import TaskRunRow from '../cards/TaskRunRow';
import HubTaskRow from '../cards/HubTaskRow';
import { getRecentRuns, getRecentTasks, writeStoredValue } from '../utils';
import styles from '../primitives/primitives.module.css';

interface AgentSchedulingSectionProps {
  runs: RunInfo[];
  activeRuns: number;
  runsLoading: boolean;
  bridgedTasks: AgentTask[];
  agents: AgentInfo[];
  edgeOnline: boolean;
  hubSessionActive: boolean;
  totalRunners: number;
  runnerSummary: string;
  modelMappingEnabled: boolean;
  ccSwitchBridge: boolean;
  autoReview: boolean;
  agentSchedulingEnabled: boolean;
  setAgentSchedulingEnabled: (value: boolean) => void;
}

export default function AgentSchedulingSection({
  runs, activeRuns, runsLoading, bridgedTasks, agents, edgeOnline, hubSessionActive,
  totalRunners, runnerSummary, modelMappingEnabled, ccSwitchBridge, autoReview,
  agentSchedulingEnabled, setAgentSchedulingEnabled,
}: AgentSchedulingSectionProps) {
  const { t } = useTranslation();
  const activeHubTasks = bridgedTasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
  const availableRuntimes = agents.filter((a) => a.status === 'available').length;
  const remoteControlReady = false;
  const schedulerActiveItems = activeRuns + activeHubTasks;
  const schedulerTotalItems = runs.length + bridgedTasks.length;
  const schedulerTargetReadyCount = [edgeOnline, hubSessionActive, remoteControlReady, false].filter(Boolean).length;
  const schedulerPolicyReadyCount = [modelMappingEnabled, ccSwitchBridge, autoReview, remoteControlReady].filter(Boolean).length;
  const schedulerLocalMetric = totalRunners > 0 ? runnerSummary : edgeOnline ? t('settings.edgeOnline') : t('settings.edgeOffline');
  const recentRuns = getRecentRuns(runs, 3);
  const recentBridgeTasks = getRecentTasks(bridgedTasks, 3);

  return (
    <Panel title={t('settings.agentScheduling')} description={t('settings.agentSchedulingDesc')}>
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<ClipboardList size={18} />} label={t('settings.schedulerQueueLive')} value={`${schedulerActiveItems}/${schedulerTotalItems}`} detail={runsLoading ? t('settings.loading') : t('settings.schedulerQueueLiveDesc')} />
        <SummaryCard icon={<Bot size={18} />} label={t('settings.schedulerProfiles')} value={`${availableRuntimes}/${agents.length}`} detail={edgeOnline ? t('settings.schedulerProfilesDesc') : t('settings.edgeOffline')} />
        <SummaryCard icon={<Server size={18} />} label={t('settings.schedulerTargets')} value={`${schedulerTargetReadyCount}/4`} detail={t('settings.schedulerTargetsDesc')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.schedulerPolicyReady')} value={`${schedulerPolicyReadyCount}/4`} detail={t('settings.schedulerPolicyReadyDesc')} />
      </div>
      <SettingRow title={t('settings.enableAgentScheduling')} description={t('settings.enableAgentSchedulingDesc')} control={<Switch checked={agentSchedulingEnabled} onChange={(v) => { setAgentSchedulingEnabled(v); writeStoredValue('agentScheduling', v); }} />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.schedulerLiveQueue')}</strong><span>{t('settings.schedulerLiveQueueDesc')}</span></div>
        {recentRuns.length > 0 || recentBridgeTasks.length > 0 ? (
          <div className={styles.taskList}>
            {recentRuns.map((run) => <TaskRunRow key={`scheduler-${run.runId}`} run={run} />)}
            {recentBridgeTasks.map((task) => <HubTaskRow key={`scheduler-${task.taskId}`} task={task} />)}
          </div>
        ) : <EmptyBlock title={t('settings.schedulerNoQueue')} description={t('settings.schedulerNoQueueDesc')} />}
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.schedulerTargets')}</strong><span>{t('settings.schedulerTargetsDesc')}</span></div>
        <div className={styles.targetGrid}>
          <ExecutionTargetCard icon={<Monitor size={18} />} title={t('settings.schedulerRouteLocal')} description={t('settings.schedulerRouteLocalDesc')} status={edgeOnline ? t('settings.enabled') : t('settings.offline')} metric={schedulerLocalMetric} connected={edgeOnline} />
          <ExecutionTargetCard icon={<Globe2 size={18} />} title={t('settings.schedulerRouteHub')} description={t('settings.schedulerRouteHubDesc')} status={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')} metric={hubSessionActive ? t('settings.targetHubSignedIn') : t('settings.targetHubSignInRequired')} connected={hubSessionActive} />
          <ExecutionTargetCard icon={<Computer size={18} />} title={t('settings.schedulerRouteRemote')} description={t('settings.schedulerRouteRemoteDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} metric="SSH / Tailscale" connected={remoteControlReady} />
          <ExecutionTargetCard icon={<Server size={18} />} title={t('settings.schedulerRouteCloud')} description={t('settings.schedulerRouteCloudDesc')} status={t('settings.statusPlanned')} metric="Cloud Edge" />
        </div>
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}><strong>{t('settings.schedulerPolicy')}</strong><span>{t('settings.schedulerPolicyDesc')}</span></div>
        <div className={styles.capabilityGrid}>
          <CapabilityCard title={t('settings.schedulerPolicyModelMapping')} description={t('settings.schedulerPolicyModelMappingDesc')} status={modelMappingEnabled ? t('settings.enabled') : t('settings.notConfigured')} />
          <CapabilityCard title={t('settings.schedulerPolicyCcSwitch')} description={t('settings.schedulerPolicyCcSwitchDesc')} status={ccSwitchBridge ? t('settings.enabled') : t('settings.statusPlanned')} />
          <CapabilityCard title={t('settings.schedulerPolicyRemote')} description={t('settings.schedulerPolicyRemoteDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
          <CapabilityCard title={t('settings.schedulerPolicyApproval')} description={t('settings.schedulerPolicyApprovalDesc')} status={autoReview ? t('settings.enabled') : t('settings.approvalMode.manual')} />
        </div>
      </div>
      <Callout title={t('settings.schedulerGuard')} body={t('settings.schedulerGuardDesc')} />
    </Panel>
  );
}
