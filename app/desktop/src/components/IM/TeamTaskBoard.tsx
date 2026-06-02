import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

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

const STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af',
  dispatched: '#3b82f6',
  running: '#f59e0b',
  done: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

function statusDotStyle(status: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: STATUS_COLORS[status] ?? '#9ca3af',
    flexShrink: 0,
  };
}

function riskBadge(risk: string): React.CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 9999,
    backgroundColor: risk === 'high' ? '#fee2e2' : '#f3f4f6',
    color: risk === 'high' ? '#991b1b' : '#374151',
    lineHeight: '16px',
  };
}

const TaskCard: FC<{ task: TeamTaskDisplay; memberName?: string }> = ({ task, memberName }) => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-subtle, #e5e7eb)',
        backgroundColor: 'var(--surface-raised, #f9fafb)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={statusDotStyle(task.status)} />
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, lineHeight: 1.4 }}>
          {task.objective || t('teamRun.untitledTask', 'Untitled task')}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted-foreground)' }}>
        <span>
          {t(`settings.teamTaskStatus.${task.status}`, task.status)}
        </span>
        {memberName && (
          <span>{memberName}</span>
        )}
        {task.riskLevel && (
          <span style={riskBadge(task.riskLevel)}>
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
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.loading', 'Loading tasks...')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.noTasks', 'No tasks yet. Start a TeamRun to create tasks.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {activeTasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
