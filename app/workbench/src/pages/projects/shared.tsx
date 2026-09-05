/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for ProjectsPage subviews.
   Extracted for Phase 17 strangler slice #562.
   ═══════════════════════════════════════════════════════════════════════ */

import styles from '../ProjectsPage.module.css';
import type { ProjectRun, ProjectRunStatus } from './types';

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
