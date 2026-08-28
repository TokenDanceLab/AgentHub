import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../AgentsPage.module.css';
import type { PaneDataSource } from './types';

/* ═══════════════════════════════════════════════════════════════════════════════════════
   DataSourceBadge — page-level provenance indicator for the Agents page.
   real mode renders nothing; demo/unavailable show a prominent pill so
   fixture data is never mistaken for live data (#1872).
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export const DataSourceBadge: React.FC<{ source: PaneDataSource }> = ({ source }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  if (source === 'real') return null;
  const label = source === 'demo'
    ? t('agents.dataSource.demo')
    : t('agents.dataSource.unavailable');
  return (
    <span
      className={styles['data-source-badge']}
      data-data-source={source}
      role="status"
    >
      {label}
    </span>
  );
};
