import React from 'react';
import { RuntimeBrandIcon } from '../RuntimeBrandIcon';
import styles from './ToolCardBlock.module.css';

/** Status labels matching the demo's statusLabel() mapping */
export const STATUS_LABELS: Record<string, string> = {
  completed: '完成',
  running: '运行中',
  failed: '失败',
  pending: '待执行',
};

interface ToolCardBlockProps {
  /** Tool name displayed in the card (e.g. "Read", "Shell", "rg") */
  toolName: string;
  /** File path or target the tool operated on */
  path?: string | undefined;
  /** Execution status determining icon/badge color */
  status: 'completed' | 'running' | 'failed' | 'pending';
  /** Single-character glyph displayed inside the icon box; defaults to first letter of toolName */
  icon?: string | undefined;
  /** Optional description shown below the name and path */
  description?: string | undefined;
}

const statusClassMap: Record<string, string> = {
  completed: styles.statusCompleted ?? '',
  running: styles.statusRunning ?? '',
  failed: styles.statusFailed ?? '',
  pending: styles.statusPending ?? '',
};

/**
 * ToolCardBlock — horizontal card showing a tool execution with
 * colored icon, name, path, and status badge.
 *
 * Mirrors the `.agent-tool-card` variant from the v4 desktop prototype.
 */
export const ToolCardBlock: React.FC<ToolCardBlockProps> = ({
  toolName,
  path,
  status,
  icon,
  description,
}) => {
  const glyph = icon;
  const statusClass = statusClassMap[status] ?? '';

  return (
    <div className={`${styles.card} tool-card agent-tool-card`} data-card-surface>
      <div className={styles.icon}>
        {glyph ? glyph : (
          <RuntimeBrandIcon kind="tool" name={toolName} size="compact" framed={false} />
        )}
      </div>

      <div className={styles.main}>
        <div className={styles.name}>{toolName}</div>
        {path && <div className={styles.path}>{path}</div>}
        {description && <p className={styles.description}>{description}</p>}
      </div>

      <span className={`${styles.status} ${statusClass}`}>
        {STATUS_LABELS[status] ?? status}
      </span>
    </div>
  );
};
