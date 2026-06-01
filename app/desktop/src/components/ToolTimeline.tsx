import { CheckSquare, FileText, GitFork, Route, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MessageBlock } from './ChatView.types';
import styles from './ToolTimeline.module.css';

type TimelineStatus = 'pending' | 'running' | 'draining' | 'completed' | 'failed';

interface TimelineEntry {
  key: string;
  kind: 'tool' | 'file' | 'task' | 'child' | 'route';
  label: string;
  meta?: string;
  status: TimelineStatus;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? path;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.file_path === 'string') parts.push(input.file_path);
  else if (typeof input.path === 'string') parts.push(input.path);
  if (typeof input.command === 'string') parts.push(input.command.slice(0, 72));
  if (typeof input.description === 'string') parts.push(input.description.slice(0, 72));
  return parts.join(' ').trim();
}

function entryIcon(kind: TimelineEntry['kind']) {
  switch (kind) {
    case 'file':
      return <FileText size={13} />;
    case 'task':
      return <CheckSquare size={13} />;
    case 'child':
      return <GitFork size={13} />;
    case 'route':
      return <Route size={13} />;
    case 'tool':
    default:
      return <Wrench size={13} />;
  }
}

function toTimelineEntries(blocks: MessageBlock[]): TimelineEntry[] {
  return blocks.flatMap((block, index): TimelineEntry[] => {
    switch (block.kind) {
      case 'tool_use':
        return [{
          key: `tool-${block.callId}-${index}`,
          kind: 'tool',
          label: block.toolName,
          meta: summarizeInput(block.input),
          status: block.status,
        }];
      case 'file_change':
        return [{
          key: `file-${block.path}-${index}`,
          kind: 'file',
          label: basename(block.path),
          meta: block.action,
          status: 'completed',
        }];
      case 'agent_task':
        return [{
          key: `task-${block.taskId}-${index}`,
          kind: 'task',
          label: block.title || block.taskId,
          meta: block.worker,
          status: block.status,
        }];
      case 'child_agent':
        return [{
          key: `child-${block.childId}-${block.childRunId ?? index}`,
          kind: 'child',
          label: block.title || block.childId,
          meta: block.agentName,
          status: block.status,
        }];
      case 'route_decision':
        return [{
          key: `route-${block.action}-${index}`,
          kind: 'route',
          label: block.instructions || block.summary || block.blockedReason || block.action,
          meta: block.nextWorker || block.action,
          status: block.blockedReason ? 'failed' : 'completed',
        }];
      default:
        return [];
    }
  });
}

function statusClass(status: TimelineStatus): string {
  switch (status) {
    case 'pending':
      return styles.statusPending ?? '';
    case 'running':
      return styles.statusRunning ?? '';
    case 'draining':
      return styles.statusDraining ?? '';
    case 'failed':
      return styles.statusFailed ?? '';
    case 'completed':
    default:
      return styles.statusCompleted ?? '';
  }
}

export default function ToolTimeline({ blocks }: { blocks: MessageBlock[] }) {
  const { t } = useTranslation();
  const entries = toTimelineEntries(blocks);
  if (entries.length < 2) return null;

  return (
    <section className={styles.root} data-testid="tool-timeline" aria-label={t('chat.toolTimeline')}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{t('chat.toolTimeline')}</span>
        <span className={styles.headerCount}>{t('chat.toolTimelineCount', { count: entries.length })}</span>
      </div>
      <ol className={styles.entries}>
        {entries.slice(0, 8).map((entry) => (
          <li key={entry.key} className={styles.entry} data-testid="tool-timeline-entry">
            <span className={`${styles.marker} ${statusClass(entry.status)}`} aria-hidden="true">
              {entryIcon(entry.kind)}
            </span>
            <span className={styles.entryText}>
              {entry.meta ? <span className={styles.entryMeta}>{entry.meta}</span> : null}
              <strong title={entry.label}>{entry.label}</strong>
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
