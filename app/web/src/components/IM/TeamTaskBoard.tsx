import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, Circle, ListTodo, Loader, XCircle } from 'lucide-react';
import styles from './TeamTaskBoard.module.css';

export interface TeamTaskDisplay {
  taskId: string;
  objective: string;
  status: string;
  assigneeMemberId?: string | undefined;
  assigneeName?: string | undefined;
  runId?: string | null | undefined;
  riskLevel?: string | undefined;
  attempt?: number | undefined;
}

interface TeamTaskBoardProps {
  tasks: TeamTaskDisplay[];
  activeTasks: TeamTaskDisplay[];
  completedTasks: TeamTaskDisplay[];
  loading: boolean;
  error: string | null;
  memberNames: Record<string, string>;
}

const STATUS_ICONS: Record<string, typeof Circle> = {
  pending: Circle,
  dispatched: Loader,
  running: Loader,
  done: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
};

function statusIcon(status: string) {
  return STATUS_ICONS[status] ?? Circle;
}

function statusClass(status: string): string {
  const base = (styles as Record<string, string>).statusBadge ?? '';
  const extra = (styles as Record<string, string>)[`status${status.charAt(0).toUpperCase()}${status.slice(1)}`] ?? '';
  return extra ? `${base} ${extra}` : base;
}

function TaskCard({ task, memberNames }: { task: TeamTaskDisplay; memberNames: Record<string, string> }) {
  const { t } = useTranslation();
  const Icon = statusIcon(task.status);
  const isHighRisk = task.riskLevel === 'high';
  const assigneeName = task.assigneeName ?? (task.assigneeMemberId ? memberNames[task.assigneeMemberId] : undefined) ?? '-';

  return (
    <div className={styles.taskCard}>
      <div className={styles.taskHeader}>
        <Icon size={14} className={statusClass(task.status)} />
        <span className={styles.objective}>{task.objective || t('teamRun.untitledTask', 'Untitled task')}</span>
      </div>
      <div className={styles.taskMeta}>
        <span className={styles.assignee}>{assigneeName}</span>
        <span className={statusClass(task.status)}>
          {t(`teamRun.taskStatus.${task.status}`, task.status)}
        </span>
        {isHighRisk && (
          <span className={styles.highRisk}>
            <AlertTriangle size={10} />
            {t('teamRun.highRisk', 'High risk')}
          </span>
        )}
        {task.attempt && task.attempt > 1 && (
          <span className={styles.attempt}>#{task.attempt}</span>
        )}
      </div>
    </div>
  );
}

export const TeamTaskBoard = memo(function TeamTaskBoard({
  tasks,
  activeTasks,
  completedTasks,
  loading,
  error,
  memberNames,
}: TeamTaskBoardProps) {
  const { t } = useTranslation();

  if (loading && tasks.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.hint}>{t('teamRun.loading', 'Loading...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <ListTodo size={32} className={styles.emptyIcon} />
          <span>{t('teamRun.noTasks', 'No tasks in this run.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Loader size={14} className={styles.sectionIconActive} />
            <span className={styles.sectionTitle}>{t('teamRun.activeTasks', 'Active tasks')}</span>
            <span className={styles.sectionCount}>{activeTasks.length}</span>
          </div>
          <div className={styles.taskList}>
            {activeTasks.map((task) => (
              <TaskCard key={task.taskId} task={task} memberNames={memberNames} />
            ))}
          </div>
        </section>
      )}

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <CheckCircle size={14} className={styles.sectionIconDone} />
            <span className={styles.sectionTitle}>{t('teamRun.completedTasks', 'Completed tasks')}</span>
            <span className={styles.sectionCount}>{completedTasks.length}</span>
          </div>
          <div className={styles.taskList}>
            {completedTasks.map((task) => (
              <TaskCard key={task.taskId} task={task} memberNames={memberNames} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
});

export default TeamTaskBoard;
