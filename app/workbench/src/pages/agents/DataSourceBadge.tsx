import React from 'react';
import styles from '../AgentsPage.module.css';
import type { PaneDataSource } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   DataSourceBadge — page-level provenance indicator for the Agents page.
   real mode renders nothing; demo/unavailable show a prominent pill so
   fixture data is never mistaken for live data (#1872).
   ═══════════════════════════════════════════════════════════════════════ */

const SOURCE_LABELS: Record<Exclude<PaneDataSource, 'real'>, string> = {
  demo: 'Demo 数据',
  unavailable: '当前不可用',
};

export const DataSourceBadge: React.FC<{ source: PaneDataSource }> = ({ source }) => {
  if (source === 'real') return null;
  return (
    <span
      className={styles['data-source-badge']}
      data-data-source={source}
      role="status"
    >
      {SOURCE_LABELS[source]}
    </span>
  );
};
