import { Bot, CheckSquare, GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MessageBlock } from './ChatView.types';
import styles from './TaskList.module.css';

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface TaskEntry {
  key: string;
  title: string;
  meta?: string;
  kind: 'task' | 'child';
  status: TaskStatus;
}

function toTaskEntries(blocks: MessageBlock[]): TaskEntry[] {
  return blocks.flatMap((block): TaskEntry[] => {
    if (block.kind === 'agent_task') {
      return [{
        key: `task-${block.taskId}`,
        title: block.title.trim() || block.taskId,
        meta: block.worker || block.taskId,
        kind: 'task',
        status: block.status,
      }];
    }

    if (block.kind === 'child_agent') {
      return [{
        key: `child-${block.childId}-${block.childRunId ?? ''}`,
        title: block.title.trim() || block.childId,
        meta: block.childRunId || block.agentName || block.childId,
        kind: 'child',
        status: block.status,
      }];
    }

    return [];
  });
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return styles.statusPending ?? '';
    case 'running':
      return styles.statusRunning ?? '';
    case 'failed':
      return styles.statusFailed ?? '';
    case 'completed':
    default:
      return styles.statusCompleted ?? '';
  }
}

function taskIcon(kind: TaskEntry['kind']) {
  if (kind === 'child') return <GitFork size={13} />;
  return <Bot size={13} />;
}

export default function TaskList({ blocks }: { blocks: MessageBlock[] }) {
  const { t } = useTranslation();
  const entries = toTaskEntries(blocks);
  if (entries.length < 2) return null;

  const running = entries.filter((entry) => entry.status === 'running').length;
  const completed = entries.filter((entry) => entry.status === 'completed').length;
  const failed = entries.filter((entry) => entry.status === 'failed').length;

  return (
    <section className={styles.root} data-testid="agent-task-list" aria-label={t('chat.agentTaskList')}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          <CheckSquare size={13} aria-hidden="true" />
          {t('chat.agentTaskList')}
        </span>
        <span className={styles.headerCount}>
          {t('chat.agentTaskListCount', { count: entries.length, running, completed, failed })}
        </span>
      </div>
      <ol className={styles.entries}>
        {entries.slice(0, 6).map((entry) => (
          <li key={entry.key} className={styles.entry} data-testid="agent-task-list-item">
            <span className={`${styles.marker} ${statusClass(entry.status)}`} aria-hidden="true">
              {taskIcon(entry.kind)}
            </span>
            <span className={styles.entryText}>
              <strong title={entry.title}>{entry.title}</strong>
              {entry.meta ? <code title={entry.meta}>{entry.meta}</code> : null}
            </span>
            <span className={`${styles.status} ${statusClass(entry.status)}`}>
              {t(`chat.taskStatus.${entry.status}`, { defaultValue: entry.status })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
