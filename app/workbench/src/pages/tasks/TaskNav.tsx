/* ═══════════════════════════════════════════════════════════════════════
   Tasks left-nav shell — more menu, primary/quick panes, list shortcuts.

   Extracted from TasksPage as Phase 20 residual thin #596.
   CSS remains on shared TasksPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignNavIcon } from '../../designIcons';
import styles from '../TasksPage.module.css';
import { NAV_PRIMARY, NAV_QUICK, NavGlyph, TaskNavMenu } from './shared';
import type { TasksPageProps } from './types';

export type TaskNavProps = Pick<
  TasksPageProps,
  | 'activePane'
  | 'onPaneChange'
  | 'navMenuOpen'
  | 'onNavMore'
  | 'onTaskList'
  | 'onNewGroup'
>;

export function TaskNav({
  activePane,
  onPaneChange,
  navMenuOpen = false,
  onNavMore,
  onTaskList,
  onNewGroup,
}: TaskNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <aside className={`${styles.nav} workbench-nav`}>
      <div className={`${styles.navTitle} workbench-title`}>任务</div>

      <button
        type="button"
        className={`${styles.navMore} ${navMenuOpen ? styles.navMoreActive : ''}`}
        aria-label={t("aria.taskMoreActions")}
        aria-expanded={navMenuOpen}
        onClick={onNavMore}
      >
        <DesignNavIcon name="more" size={16} />
      </button>
      <TaskNavMenu open={navMenuOpen} />

      {/* Primary nav: 我负责的 / 我关注的 / 动态 */}
      {NAV_PRIMARY.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.navRow} ${
            activePane === item.id ? styles.navRowActive : ''
          }`}
          onClick={() => onPaneChange(item.id)}
        >
          <NavGlyph name={item.icon} />
          {item.label}
          {item.badge != null && (
            <small className={styles.navBadge}>{item.badge}</small>
          )}
        </button>
      ))}

      <div className={styles.navDivider} />

      {/* Quick access: 全部 / 我创建的 / 我分配的 / 已完成 */}
      <div className={styles.navCaption}>快速访问</div>
      {NAV_QUICK.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.navRow} ${styles.navRowSlim} ${
            activePane === item.id
              ? styles.navRowActiveSoft
              : ''
          }`}
          onClick={() => onPaneChange(item.id)}
        >
          <NavGlyph name={item.icon} />
          {item.label}
        </button>
      ))}

      <div className={styles.navDivider} />

      <button
        type="button"
        className={`${styles.navRow} ${styles.navRowSlim}`}
        onClick={onTaskList}
      >
        <NavGlyph name="fileText" />
        {t('nav.tasks')}清单
        <small className={styles.navBadgePlus}>+</small>
      </button>

      <button
        type="button"
        className={`${styles.navRow} ${styles.navRowSlim}`}
        onClick={onNewGroup}
      >
        <NavGlyph name="plus" />
        新建分组
      </button>
    </aside>
  );
}
