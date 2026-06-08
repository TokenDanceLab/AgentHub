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
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';

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
  registeredLocalEdgeTarget?: ExecutionTargetInventoryItem | null;
  hubTargetsLoading?: boolean;
  hubTargetsError?: boolean;
  hubTargetsPaginationLimited?: boolean;
}

export default function ExecutionTargetsSection({
  edgeOnline, health, hubSessionActive, runnerSummary, runnerItems,
  availableRunners, localEdgeTarget, desktopDeviceStatus, deviceId,
  registeredLocalEdgeTarget = null, hubTargetsLoading = false, hubTargetsError = false,
  hubTargetsPaginationLimited = false,
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
  const readinessBody = (() => {
    if (!hubSessionActive) return t('settings.localEdgeTargetReadinessSignedOut');
    if (hubTargetsLoading) return t('settings.localEdgeTargetReadinessLoading');
    if (hubTargetsError) return t('settings.localEdgeTargetReadinessError');
    if (!deviceId) return t('settings.localEdgeTargetReadinessNoDevice');
    if (!edgeOnline) return t('settings.localEdgeTargetReadinessOffline');
    if (registeredLocalEdgeTarget) {
      if (!registeredLocalEdgeTarget.is_online || registeredLocalEdgeTarget.health_state === 'offline') {
        return t('settings.localEdgeTargetReadinessHubOffline');
      }
      if (registeredLocalEdgeTarget.health_state === 'degraded') {
        return t('settings.localEdgeTargetReadinessHubDegraded');
      }
      if (registeredLocalEdgeTarget.health_state === 'unknown') {
        return t('settings.localEdgeTargetReadinessHubUnknown');
      }
      return t('settings.localEdgeTargetReadinessRegistered', {
        name: registeredLocalEdgeTarget.name,
        targetId: shortId(registeredLocalEdgeTarget.id),
      });
    }
    if (hubTargetsPaginationLimited) return t('settings.localEdgeTargetReadinessPaginationLimited');
    return t('settings.localEdgeTargetReadinessMissing');
  })();

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
      <Callout title={t('settings.localEdgeTargetReadiness')} body={readinessBody} />
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
