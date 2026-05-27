import { useTranslation } from 'react-i18next';
import { Route, ClipboardList, Monitor, ShieldCheck, RefreshCw } from 'lucide-react';
import type { RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import Switch from '../primitives/Switch';
import TaskRunRow from '../cards/TaskRunRow';
import HubTaskRow from '../cards/HubTaskRow';
import { isActiveRun, getRecentRuns, getRecentTasks, formatTimestamp, writeStoredValue } from '../utils';
import styles from '../../SettingsPage.module.css';

interface TasksSectionProps {
  runs: RunInfo[];
  activeRuns: number;
  runsLoading: boolean;
  runsFetching: boolean;
  runsError: boolean;
  refetchRuns: () => void;
  cancelRunMutation: { mutateAsync: (runId: string) => void; isPending: boolean; variables: string | undefined };
  bridgedTasks: AgentTask[];
  hubSessionActive: boolean;
  taskSync: boolean;
  setTaskSync: (value: boolean) => void;
  onOpenAuth: () => void;
  latestRun: RunInfo | undefined;
}

export default function TasksSection({
  runs, activeRuns, runsLoading, runsFetching, runsError, refetchRuns,
  cancelRunMutation, bridgedTasks, hubSessionActive, taskSync, setTaskSync,
  onOpenAuth, latestRun,
}: TasksSectionProps) {
  const { t } = useTranslation();
  const activeHubTasks = bridgedTasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
  const recentRuns = getRecentRuns(runs, 5);
  const recentBridgeTasks = getRecentTasks(bridgedTasks, 5);

  return (
    <Panel title={t('settings.tasks')} description={t('settings.tasksDesc')}>
      <div className={styles.summaryGrid}>
        <SummaryCard
          icon={<Route size={18} />}
          label={t('settings.taskLocalRuns')}
          value={`${activeRuns}/${runs.length}`}
          detail={runsLoading ? t('settings.loading') : t('settings.taskLocalRunsDesc')}
        />
        <SummaryCard
          icon={<ClipboardList size={18} />}
          label={t('settings.taskHubBridge')}
          value={`${activeHubTasks}/${bridgedTasks.length}`}
          detail={hubSessionActive ? t('settings.taskHubBridgeDesc') : t('settings.taskHubBridgeSignedOut')}
        />
        <SummaryCard
          icon={<Monitor size={18} />}
          label={t('settings.taskLastRun')}
          value={latestRun ? t(`run.status.${latestRun.status}`, { defaultValue: latestRun.status }) : t('settings.noData')}
          detail={latestRun ? formatTimestamp(latestRun.finishedAt ?? latestRun.startedAt ?? latestRun.createdAt) : t('settings.taskLastRunDesc')}
        />
        <SummaryCard
          icon={<ShieldCheck size={18} />}
          label={t('settings.taskHubSnapshot')}
          value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
          detail={hubSessionActive ? t('settings.taskHubSnapshotUnavailable') : t('settings.taskHubBridgeSignedOut')}
        />
      </div>
      <SettingRow
        title={t('settings.taskSync')}
        description={t('settings.taskSyncDesc')}
        control={<Switch checked={hubSessionActive && taskSync} onChange={(v) => { setTaskSync(v); writeStoredValue('taskSync', v); }} disabled={!hubSessionActive} />}
      />
      <SettingRow
        title={t('settings.taskInbox')}
        description={t('settings.taskInboxDesc')}
        value={runsError ? t('settings.edgeOffline') : t('settings.statusInProgress')}
      />
      <SettingRow title={t('settings.taskRunBinding')} description={t('settings.taskRunBindingDesc')} value={t('settings.statusInProgress')} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <div className={styles.taskSectionTitleRow}>
            <div>
              <strong>{t('settings.taskHubSnapshot')}</strong>
              <span>{t('settings.taskHubSnapshotDesc')}</span>
            </div>
            <div className={styles.taskSectionActions}>
              <span className={styles.statusPill}>
                {hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
              </span>
            </div>
          </div>
        </div>
        {!hubSessionActive ? (
          <AuthGapBlock
            title={t('settings.hubSignInRequired')}
            description={t('settings.taskHubBridgeSignedOut')}
            actionLabel={t('settings.signIn')}
            onAction={onOpenAuth}
          />
        ) : (
          <EmptyBlock title={t('settings.status.interfaceGap')} description={t('settings.taskHubSnapshotUnavailable')} />
        )}
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <div className={styles.taskSectionTitleRow}>
            <div>
              <strong>{t('settings.taskRecentRuns')}</strong>
              <span>{runsFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRecentRunsDesc')}</span>
            </div>
            <div className={styles.taskSectionActions}>
              <span className={`${styles.statusPill} ${runsError ? '' : styles.statusPillOn}`}>
                {runsError ? t('settings.edgeOffline') : t('settings.taskRunLive')}
              </span>
              <button type="button" className={styles.secondaryBtn} onClick={refetchRuns} disabled={runsFetching}>
                <RefreshCw size={15} />
                {runsFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRefreshRuns')}
              </button>
            </div>
          </div>
        </div>
        {recentRuns.length > 0 ? (
          <div className={styles.taskList}>
            {recentRuns.map((run) => (
              <TaskRunRow
                key={run.runId}
                run={run}
                onCancel={isActiveRun(run) ? (runId) => { void cancelRunMutation.mutateAsync(runId); } : undefined}
                cancelling={cancelRunMutation.isPending && cancelRunMutation.variables === run.runId}
              />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.taskNoRuns')} description={t('settings.taskNoRunsDesc')} />
        )}
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <strong>{t('settings.taskBridgeQueue')}</strong>
          <span>{t('settings.taskBridgeQueueDesc')}</span>
        </div>
        {recentBridgeTasks.length > 0 ? (
          <div className={styles.taskList}>
            {recentBridgeTasks.map((task) => <HubTaskRow key={task.taskId} task={task} />)}
          </div>
        ) : (
          <EmptyBlock title={t('settings.taskNoHubTasks')} description={t('settings.taskNoHubTasksDesc')} />
        )}
      </div>
    </Panel>
  );
}
