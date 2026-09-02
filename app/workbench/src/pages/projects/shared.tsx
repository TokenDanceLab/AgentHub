/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for ProjectsPage subviews.
   Extracted for Phase 17 strangler slice #562.
   ═══════════════════════════════════════════════════════════════════════ */

import styles from '../ProjectsPage.module.css';
import type { ProjectFilter, ProjectInfo, ProjectRun, ProjectRunStatus } from './types';

export function stateDotClass(status: ProjectRunStatus): string {
  switch (status) {
    case 'running':
      return styles.stateRunning ?? '';
    case 'completed':
      return styles.stateCompleted ?? '';
    case 'thinking':
      return styles.stateThinking ?? '';
    case 'waiting':
      return styles.stateWaiting ?? '';
    case 'failed':
      return styles.stateFailed ?? '';
    case 'cancelled':
      return styles.stateCancelled ?? '';
    default:
      return '';
  }
}

export function runStatusLabel(status: ProjectRunStatus): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'thinking':
      return '思考中';
    case 'waiting':
      return '待启动';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

export function artifactTypeLabel(type: string): string {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'md':
      return 'Markdown';
    case 'xlsx':
      return '表格';
    case 'ts':
    case 'tsx':
      return 'TypeScript';
    case 'js':
    case 'jsx':
      return 'JavaScript';
    case 'css':
      return '样式';
    case 'html':
      return '页面';
    default:
      return lowerType.toUpperCase();
  }
}

export function runCount(runs: ProjectRun[], statuses: ProjectRunStatus[]): number {
  return runs.filter((run) => statuses.includes(run.status)).length;
}

export function projectSubmitErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Hub Projects 保存失败';
}

/* ═══════════════════════════════════════════════════════════════════════
   Project status filtering (#2154 P2-3).

   The projects nav rendered four filter chips (FILTER_ITEMS) that only moved
   the highlight — the list never changed, so an unfiltered list read as "you
   have no archived projects".

   `ProjectInfo.status` is a display label rather than an enum: Hub workspace
   projects arrive as 'Active' (workbench hubDataMapping) or 'Hub'/'Hub group'
   (web projection) and demo data uses the Chinese labels above. Only labels we
   can classify honestly join a bucket; everything else stays visible under
   `all` and is never guessed into a lifecycle state we do not know.
   ═══════════════════════════════════════════════════════════════════════ */

export type ProjectStatusBucket = Exclude<ProjectFilter, 'all'>;

/** Exact (trimmed, case-insensitive) label → bucket map. Deliberately exact:
 *  a substring rule would file a pending-archive label under archived, which
 *  is a different fact. */
const PROJECT_STATUS_BUCKETS: Record<string, ProjectStatusBucket> = {
  active: 'running',
  running: 'running',
  'in progress': 'running',
  '进行中': 'running',
  '运行中': 'running',
  '研究中': 'running',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  finished: 'completed',
  '已完成': 'completed',
  '完成': 'completed',
  archived: 'archived',
  '已归档': 'archived',
};

/**
 * Resolve a project's lifecycle bucket from its status label. Null when the
 * status is missing or is not a lifecycle state we know — such projects belong
 * to `all` only.
 */
export function projectStatusBucket(status: string | undefined): ProjectStatusBucket | null {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return null;
  return PROJECT_STATUS_BUCKETS[normalized] ?? null;
}

/**
 * Apply the nav filter to a project list. `all` passes the input array through
 * unchanged (referentially stable, nothing dropped); other buckets keep only
 * the projects whose status label resolves to that bucket.
 */
export function filterProjectsByStatus(
  projects: ProjectInfo[],
  filter: ProjectFilter,
): ProjectInfo[] {
  if (filter === 'all') return projects;
  return projects.filter((project) => projectStatusBucket(project.status) === filter);
}
