import { useTranslation } from 'react-i18next';
import { Monitor, Globe2, Server, Computer, Cpu } from 'lucide-react';
import type { RunnerHealthItem } from '@shared/types';
import Panel from '../primitives/Panel';
import ExecutionTargetCard from '../primitives/ExecutionTargetCard';
import Callout from '../primitives/Callout';
import RunnerRow from '../cards/RunnerRow';
import { shortId } from '../utils';
import styles from '../../SettingsPage.module.css';

interface ExecutionTargetsSectionProps {
  edgeOnline: boolean;
  health: { status?: string; checks?: { runners?: { items?: RunnerHealthItem[] } } } | null | undefined;
  hubSessionActive: boolean;
  runnerSummary: string;
  runnerItems: RunnerHealthItem[];
  availableRunners: number;
  desktopDeviceStatus: string;
  deviceId: string | null;
}

export default function ExecutionTargetsSection({
  edgeOnline, health, hubSessionActive, runnerSummary, runnerItems,
  availableRunners, desktopDeviceStatus, deviceId,
}: ExecutionTargetsSectionProps) {
  const { t } = useTranslation();
  return (
    <Panel title={t('settings.executionTargets')} description={t('settings.executionTargetsDesc')}>
      <div className={styles.targetGrid}>
        <ExecutionTargetCard
          icon={<Monitor size={18} />}
          title={t('settings.targetLocalEdge')}
          description={t('settings.targetLocalEdgeDesc')}
          status={edgeOnline ? health?.status ?? 'ok' : t('settings.offline')}
          metric={runnerSummary}
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
