import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TeamTaskBoard.module.css';

export interface TeamTaskDisplay {
  taskId: string;
  objective: string;
  status: string;
  assigneeMemberId?: string;
  assigneeName?: string;
  runId?: string;
  riskLevel?: string;
  attempt?: number;
}

interface TeamTaskBoardProps {
  tasks: TeamTaskDisplay[];
  activeTasks: TeamTaskDisplay[];
  completedTasks: TeamTaskDisplay[];
  loading?: boolean;
  error?: string | null;
  memberNames?: Record<string, string>;
}

const STATUS_CLASS: Record<string, string> = {
  pending: styles.statusPending!,
  dispatched: styles.statusDispatched!,
  running: styles.statusRunning!,
  done: styles.statusDone!,
  failed: styles.statusFailed!,
  cancelled: styles.statusCancelled!,
};

const TaskCard: FC<{ task: TeamTaskDisplay; memberName?: string }> = ({ task, memberName }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={`${styles.statusDot} ${STATUS_CLASS[task.status] ?? styles.statusPending}`} />
        <span className={styles.cardTitle}>
          {task.objective || t('teamRun.untitledTask', 'Untitled task')}
        </span>
      </div>
      <div className={styles.cardMeta}>
        <span>
          {t(`settings.teamTaskStatus.${task.status}`, task.status)}
        </span>
        {memberName && (
          <span>{memberName}</span>
        )}
        {task.riskLevel && (
          <span className={`${styles.riskBadge} ${task.riskLevel === 'high' ? styles.riskHigh : styles.riskNormal}`}>
            {task.riskLevel === 'high' ? t('teamRun.highRisk', 'High') : t('teamRun.normalRisk', 'Normal')}
          </span>
        )}
        {task.attempt && task.attempt > 1 && (
          <span>{t('teamRun.attempt', 'Attempt {{count}}', { count: task.attempt })}</span>
        )}
      </div>
    </div>
  );
};

export const TeamTaskBoard: FC<TeamTaskBoardProps> = ({
  tasks,
  activeTasks,
  completedTasks,
  loading,
  error,
  memberNames,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={styles.loading}>
        {t('teamRun.loading', 'Loading tasks...')}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        {error}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.empty}>
        {t('teamRun.noTasks', 'No tasks yet. Start a TeamRun to create tasks.')}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {activeTasks.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            {t('teamRun.activeTasksHeader', 'Active ({{count}})', { count: activeTasks.length })}
          </h4>
          {activeTasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              memberName={task.assigneeMemberId ? memberNames?.[task.assigneeMemberId] : undefined}
            />
          ))}
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>
            {t('teamRun.completedTasksHeader', 'Completed ({{count}})', { count: completedTasks.length })}
          </h4>
          {completedTasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              memberName={task.assigneeMemberId ? memberNames?.[task.assigneeMemberId] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};
