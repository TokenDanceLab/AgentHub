import React from 'react';
import type { RuntimeSessionImportItem } from './types';
import styles from './SessionImportList.module.css';

export type SessionImportListProps = {
  items: RuntimeSessionImportItem[];
  emptyLabel?: string;
  sourceModeLabel?: (mode: string | undefined) => string;
  className?: string;
};

function defaultSourceLabel(mode: string | undefined): string {
  if (mode === 'import' || mode === 'observed') return '导入/观察';
  return mode ?? '—';
}

/**
 * Presentational list of local runtime session summaries (#1183).
 * Data is supplied by the host via `HostDiagnosticsPort.listRuntimeSessions`;
 * no foreign store mutation.
 */
export function SessionImportList({
  items,
  emptyLabel = '暂无本地可导入会话',
  sourceModeLabel = defaultSourceLabel,
  className,
}: SessionImportListProps): React.ReactElement {
  if (!items.length) {
    return (
      <div
        className={[styles.root, className].filter(Boolean).join(' ')}
        data-testid="session-import-list"
      >
        <div className={styles.empty}>{emptyLabel}</div>
      </div>
    );
  }

  return (
    <ul
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-testid="session-import-list"
    >
      {items.map((item) => (
        <li key={`${item.runtime}:${item.id}`} className={styles.row}>
          <div className={styles.title}>{item.title || item.id}</div>
          <div className={styles.meta}>
            <span className={styles.runtime}>{item.runtime}</span>
            <span className={styles.mode}>{sourceModeLabel(item.sourceMode)}</span>
            {item.updatedAt ? <span className={styles.time}>{item.updatedAt}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
