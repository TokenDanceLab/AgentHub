/* ═══════════════════════════════════════════════════════════════════════
   Feed panel — residual extract from ProjectPanelParts for #696.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { DesignNavIcon } from '../../designIcons';
import styles from '../ProjectsPage.module.css';
import { ProjectSectionHead } from './ProjectPanelHelpers';
import type { ProjectFeedItem } from './types';

export function ProjectFeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
  return (
    <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel`} data-card-surface>
      <ProjectSectionHead icon="notes" title="最近动态" meta="Today" />
      {feed.map((item) => (
        <div key={item.id} className={styles.feedRow}>
          <time className={styles.feedTime}>{item.time}</time>
          <span>{item.text}</span>
        </div>
      ))}
    </section>
  );
}
