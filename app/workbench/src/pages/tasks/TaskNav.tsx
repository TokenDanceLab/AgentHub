/* ═══════════════════════════════════════════════════════════════════════
   Tasks left-nav shell — primary/quick panes, list shortcuts.

   Extracted from TasksPage as Phase 20 residual thin #596.
   CSS remains on shared TasksPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../TasksPage.module.css';
import { buildNavPrimary, buildNavQuick, NavGlyph } from './shared';
import type { TasksPageProps } from './types';

export type TaskNavProps = Pick<
  TasksPageProps,
  | 'activePane'
  | 'onPaneChange'
  | 'onTaskList'
  | 'onNewGroup'
>;

export function TaskNav({
  activePane,
  onPaneChange,
  onTaskList,
  onNewGroup,
}: TaskNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const navPrimary = buildNavPrimary(t);
  const navQuick = buildNavQuick(t);

  return (
    <aside className={`${styles.nav} workbench-nav`}>
      <div className={`${styles.navTitle} workbench-title`}>{t('tasks.navTasks')}</div>

      {/* Primary nav: 我负责的 / 我关注的 / 动态 */}
      {navPrimary.map((item) => (
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
      <div className={styles.navCaption}>{t('tasks.quickAccess')}</div>
      {navQuick.map((item) => (
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
        {t('tasks.navTaskList')}
        <small className={styles.navBadgePlus}>+</small>
      </button>

      {onNewGroup && (
        <button
          type="button"
          className={`${styles.navRow} ${styles.navRowSlim}`}
          onClick={onNewGroup}
        >
          <NavGlyph name="plus" />
          {t('tasks.newGroup')}
        </button>
      )}
    </aside>
  );
}
