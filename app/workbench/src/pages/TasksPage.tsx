import React from 'react';
import styles from './TasksPage.module.css';
import {
  TaskMain,
  TaskNav,
} from './tasks/index';
import type { TasksPageProps } from './tasks/index';

/* ═══════════════════════════════════════════════════════════════════════
   TasksPage — pure presentational workbench page

   Subcomponents / types extracted under ./tasks:
   - Types, shared helpers, TaskTableViews (#571).
   - TaskNav + TaskMain shell (#596).
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
} from './tasks/index';

// ── Main component ──

export function TasksPage(props: TasksPageProps): React.ReactElement {
  return (
    <section className={`${styles.page} workbench tasks-page`}>
      <TaskNav {...props} />
      <TaskMain {...props} />
    </section>
  );
}
