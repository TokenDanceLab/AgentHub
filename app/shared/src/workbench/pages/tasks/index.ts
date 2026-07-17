/* ═══ Tasks page subview barrel exports ═══ */

export { TaskSelectionStrip, TaskTable } from './TaskTableViews';

export { TaskNav } from './TaskNav';
export type { TaskNavProps } from './TaskNav';

export { TaskMain } from './TaskMainViews';
export type { TaskMainProps } from './TaskMainViews';

export {
  NavGlyph,
  NAV_PRIMARY,
  NAV_QUICK,
  PANE_TITLES,
  VIEW_MODES,
  StatCard,
  TaskNavMenu,
} from './shared';

export type {
  TaskStatus,
  TasksPane,
  ViewMode,
  TaskItem,
  TaskGroup,
  TaskEditDraft,
  TasksPageProps,
} from './types';
