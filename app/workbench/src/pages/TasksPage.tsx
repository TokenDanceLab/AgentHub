import React from 'react';
import styles from './TasksPage.module.css';
import {
  TaskMain,
  TaskNav,
} from './tasks';
import type { TasksPageProps } from './tasks';

/* ═══════════════════════════════════════════════════════════════════════
   TasksPage — pure presentational workbench page

   Subcomponents / types extracted under ./tasks:
   - Phase 18 #571: types, shared, TaskTableViews
   - Phase 20 #596: TaskNav + TaskMain residual shell thin
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  TaskStatus,
  TasksPane,
  ViewMode,
  TaskItem,
  TaskGroup,
  TaskEditDraft,
  TasksPageProps,
} from './tasks';

// ── Main component ──

export function TasksPage(props: TasksPageProps): React.ReactElement {
  return (
    <section className={`${styles.page} workbench tasks-page`}>
      <TaskNav {...props} />
      <TaskMain {...props} />
    </section>
  );
}
