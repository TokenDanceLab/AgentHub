/* ═══════════════════════════════════════════════════════════════════════
   Feed panel — residual extract from ProjectPanelParts for #696.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../ProjectsPage.module.css';
import { ProjectSectionHead } from './ProjectPanelHelpers';
import type { ProjectFeedItem } from './types';

export function ProjectFeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel`} data-card-surface>
      <ProjectSectionHead icon="notes" title={t("projects.section.recentActivity")} meta="Today" />
      {feed.map((item) => (
        <div key={item.id} className={styles.feedRow}>
          <time className={styles.feedTime}>{item.time}</time>
          <span>{item.text}</span>
        </div>
      ))}
    </section>
  );
}
