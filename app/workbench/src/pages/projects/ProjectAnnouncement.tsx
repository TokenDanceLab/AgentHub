/* ═══════════════════════════════════════════════════════════════════════
   Announcement panel — residual extract from ProjectPanelParts for #696.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignNavIcon } from '../../designIcons';
import styles from '../ProjectsPage.module.css';

export function ProjectAnnouncement({
  text,
  onEdit,
}: {
  text: string;
  onEdit?: (() => void) | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.announcement} project-announcement`} data-card-surface>
      <span className={styles.announcementMark} />
      <div className={styles.announcementBody}>
        <strong className={styles.announcementLabel}>
          <DesignNavIcon name="notes" size={15} />{t('projects.announcement')}
        </strong>
        <p className={styles.announcementText}>{text}</p>
      </div>
      {onEdit ? (
        <button
          type="button"
          className={styles.announcementEditBtn}
          onClick={onEdit}
        >
          {t('projects.editAnnouncement')}
        </button>
      ) : null}
    </section>
  );
}
