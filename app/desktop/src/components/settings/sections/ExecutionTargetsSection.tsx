import { useTranslation } from 'react-i18next';
import { Monitor, Globe2, Server, Computer } from 'lucide-react';
import type { RunnerHealthItem } from '@shared/types';
import Panel from '../primitives/Panel';
import ExecutionTargetCard from '../primitives/ExecutionTargetCard';
import Callout from '../primitives/Callout';
import RunnerRow from '../cards/RunnerRow';
import { shortId } from '../utils';
import styles from '../primitives/primitives.module.css';
import type { DesktopExecutionTarget } from '@/platform/edgeCapabilityMapper';

interface ExecutionTargetsSectionProps {
  edgeOnline: boolean;
  health: { status?: string; checks?: { runners?: { items?: RunnerHealthItem[] } } } | null | undefined;
  hubSessionActive: boolean;
  runnerSummary: string;
  runnerItems: RunnerHealthItem[];
  availableRunners: number;
  localEdgeTarget: DesktopExecutionTarget;
  desktopDeviceStatus: string;
  deviceId: string | null;
}

export default function ExecutionTargetsSection({
  edgeOnline, health, hubSessionActive, runnerSummary, runnerItems,
  availableRunners, localEdgeTarget, desktopDeviceStatus, deviceId,
}: ExecutionTargetsSectionProps) {
  const { t } = useTranslation();
  const localEdgeMetric = edgeOnline
    ? t('settings.localEdgeInventorySummary', {
        runners: localEdgeTarget.onlineRunnerCount,
        totalRunners: localEdgeTarget.runnerCount,
        agents: localEdgeTarget.agentCount,
        models: localEdgeTarget.modelCount,
      })
    : runnerSummary;

  return (
    <Panel title={t('settings.executionTargets')} description={t('settings.executionTargetsDesc')}>
      <div className={styles.targetGrid}>
        <ExecutionTargetCard
          icon={<Monitor size={18} />}
          title={t('settings.targetLocalEdge')}
          description={t('settings.targetLocalEdgeDesc')}
          status={edgeOnline ? health?.status ?? localEdgeTarget.status : t('settings.offline')}
          metric={localEdgeMetric}
          connected={edgeOnline && availableRunners > 0}
        />
        <ExecutionTargetCard
          icon={<Globe2 size={18} />}
          title={t('settings.targetHubRelay')}
          description={t('settings.targetHubRelayDesc')}
          status={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')}
          metric={hubSessionActive ? t('settings.targetHubSignedIn') : t('settings.targetHubSignInRequired')}
          connected={hubSessionActive}
        />
        <ExecutionTargetCard
          icon={<Monitor size={18} />}
          title={t('settings.desktopDevice')}
          description={t('settings.desktopDeviceDesc')}
          status={desktopDeviceStatus}
          metric={deviceId ? shortId(deviceId) : t('settings.desktopDeviceMissingDesc')}
          connected={false}
        />
        <ExecutionTargetCard
          icon={<Server size={18} />}
          title={t('settings.targetSsh')}
          description={t('settings.targetSshDesc')}
          status={t('settings.statusPlanned')}
          metric="SSH / Tailscale"
        />
        <ExecutionTargetCard
          icon={<Computer size={18} />}
          title={t('settings.targetCloudEdge')}
          description={t('settings.targetCloudEdgeDesc')}
          status={t('settings.statusPlanned')}
          metric="Cloud Edge"
        />
      </div>
      {runnerItems.length > 0 ? (
        <div className={styles.runnerList}>
          {runnerItems.map((runner) => <RunnerRow key={runner.id} runner={runner} />)}
        </div>
      ) : (
        <Callout title={t('settings.runnerInventory')} body={t('settings.runnerInventoryDesc')} />
      )}
    </Panel>
  );
}
