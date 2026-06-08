import { CheckSquare, FileText, GitFork, Route, Wrench } from 'lucide-react';
import { RuntimeBrandIcon } from '../workbench/RuntimeBrandIcon';
import styles from './ToolTimeline.module.css';

// ── Minimal block shapes for the timeline ──────────────────────────
// These are structurally compatible with Desktop's MessageBlock union.

export interface ToolTimelineToolUse {
  kind: 'tool_use';
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'draining' | 'completed' | 'failed';
}

export interface ToolTimelineFileChange {
  kind: 'file_change';
  path: string;
  action: 'created' | 'modified' | 'deleted';
}

export interface ToolTimelineAgentTask {
  kind: 'agent_task';
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  worker?: string;
}

export interface ToolTimelineChildAgent {
  kind: 'child_agent';
  childId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentName?: string;
  childRunId?: string;
}

export interface ToolTimelineRouteDecision {
  kind: 'route_decision';
  action: string;
  instructions?: string;
  summary?: string;
  nextWorker?: string;
  blockedReason?: string;
}

export type ToolTimelineBlock =
  | ToolTimelineToolUse
  | ToolTimelineFileChange
  | ToolTimelineAgentTask
  | ToolTimelineChildAgent
  | ToolTimelineRouteDecision;

// Internal: any object with a kind discriminator (accepts unknown block shapes
// from Desktop/Web that include extra kinds like 'text', 'code', etc.)
type AnyTimelineBlock = { kind?: string; [key: string]: unknown };

type TimelineStatus = 'pending' | 'running' | 'draining' | 'completed' | 'failed';

interface TimelineEntry {
  key: string;
  kind: 'tool' | 'file' | 'task' | 'child' | 'route';
  label: string;
  meta?: string;
  status: TimelineStatus;
}

export interface ToolTimelineLabels {
  header?: string;
  headerCount?: string | ((count: number) => string);
  statusPending?: string;
  statusRunning?: string;
  statusDraining?: string;
  statusCompleted?: string;
  statusFailed?: string;
}

export interface ToolTimelineProps {
  /** Accepts any array of objects with a `kind` discriminator (MessageBlock[], ToolTimelineBlock[], etc.) */
  blocks: readonly AnyTimelineBlock[];
  labels?: ToolTimelineLabels;
  className?: string;
  headerClassName?: string;
  entryClassName?: string;
  statusClassName?: string;
  maxEntries?: number;
}

const DEFAULT_LABELS: Omit<Required<ToolTimelineLabels>, 'headerCount'> & { headerCount: (count: number) => string } = {
  header: 'Tool Timeline',
  headerCount: (count: number) => `${count} items`,
  statusPending: 'pending',
  statusRunning: 'running',
  statusDraining: 'draining',
  statusCompleted: 'done',
  statusFailed: 'failed',
};

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
  if (kind === 'tool') return null;

  switch (kind) {
    case 'file':
      return <FileText size={13} />;
    case 'task':
      return <CheckSquare size={13} />;
    case 'child':
      return <GitFork size={13} />;
    case 'route':
      return <Route size={13} />;
    default:
      return <Wrench size={13} />;
  }
}

function toTimelineEntries(blocks: readonly AnyTimelineBlock[]): TimelineEntry[] {
  return blocks.flatMap((block, index): TimelineEntry[] => {
    const kind = block.kind as string | undefined;
    switch (kind) {
      case 'tool_use': {
        const b = block as unknown as ToolTimelineToolUse;
        const meta = summarizeInput(b.input);
        const entry: TimelineEntry = {
          key: `tool-${b.callId}-${index}`,
          kind: 'tool',
          label: b.toolName,
          status: b.status,
        };
        if (meta) entry.meta = meta;
        return [entry];
      }
      case 'file_change': {
        const b = block as unknown as ToolTimelineFileChange;
        const entry: TimelineEntry = {
          key: `file-${b.path}-${index}`,
          kind: 'file',
          label: basename(b.path),
          status: 'completed',
        };
        if (b.action) entry.meta = b.action;
        return [entry];
      }
      case 'agent_task': {
        const b = block as unknown as ToolTimelineAgentTask;
        const entry: TimelineEntry = {
          key: `task-${b.taskId}-${index}`,
          kind: 'task',
          label: b.title || b.taskId,
          status: b.status,
        };
        if (b.worker) entry.meta = b.worker;
        return [entry];
      }
      case 'child_agent': {
        const b = block as unknown as ToolTimelineChildAgent;
        const entry: TimelineEntry = {
          key: `child-${b.childId}-${b.childRunId ?? index}`,
          kind: 'child',
          label: b.title || b.childId,
          status: b.status,
        };
        if (b.agentName) entry.meta = b.agentName;
        return [entry];
      }
      case 'route_decision': {
        const b = block as unknown as ToolTimelineRouteDecision;
        const entry: TimelineEntry = {
          key: `route-${b.action}-${index}`,
          kind: 'route',
          label: b.instructions || b.summary || b.blockedReason || b.action,
          status: b.blockedReason ? 'failed' : 'completed',
        };
        if (b.nextWorker || b.action) entry.meta = b.nextWorker || b.action;
        return [entry];
      }
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

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ToolTimeline({
  blocks,
  labels: customLabels,
  className,
  headerClassName,
  entryClassName,
  statusClassName,
  maxEntries = 8,
}: ToolTimelineProps) {
  const labels = { ...DEFAULT_LABELS, ...customLabels };
  const entries = toTimelineEntries(blocks);
  if (entries.length < 2) return null;

  const headerCountText = typeof labels.headerCount === 'function'
    ? labels.headerCount(entries.length)
    : labels.headerCount.replace('{{count}}', String(entries.length));

  const statusLabel = (status: TimelineStatus): string => {
    switch (status) {
      case 'pending': return labels.statusPending;
      case 'running': return labels.statusRunning;
      case 'draining': return labels.statusDraining;
      case 'completed': return labels.statusCompleted;
      case 'failed': return labels.statusFailed;
    }
  };

  return (
    <section className={cx(styles.root, className)} data-testid="tool-timeline" aria-label={labels.header}>
      <div className={cx(styles.header, headerClassName)}>
        <span className={styles.headerLabel}>{labels.header}</span>
        <span className={styles.headerCount}>{headerCountText}</span>
      </div>
      <ol className={styles.entries}>
        {entries.slice(0, maxEntries).map((entry) => (
          <li key={entry.key} className={cx(styles.entry, entryClassName)} data-testid="tool-timeline-entry">
            <span className={cx(styles.marker, statusClass(entry.status))} aria-hidden="true">
              {entry.kind === 'tool'
                ? <RuntimeBrandIcon kind="tool" name={entry.label} size="compact" framed={false} />
                : entryIcon(entry.kind)}
            </span>
            <span className={styles.entryText}>
              {entry.meta ? <span className={styles.entryMeta}>{entry.meta}</span> : null}
              <strong title={entry.label}>{entry.label}</strong>
            </span>
            <span className={cx(styles.status, statusClass(entry.status), statusClassName)}>
              {statusLabel(entry.status)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
