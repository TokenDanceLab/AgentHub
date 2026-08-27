/* ═══════════════════════════════════════════════════════════════════════
   Tasks page public types — extracted for Phase 18 strangler slice #571.
   ═══════════════════════════════════════════════════════════════════════ */

import type { WorkbenchProfileSource } from '../../profileRegistry';
import type { BoardColumnTone, TaskReviewMergePort } from '../../workbenchBoardColumns';
import type { AgentHubSurface } from '@shared/platform';

export type TaskStatus =
  | '未开始'
  | '进行中'
  | '待评审'
  | '待确认'
  | '已完成';

export type TasksPane =
  | 'owned'
  | 'watching'
  | 'activity'
  | 'all'
  | 'created'
  | 'assigned'
  | 'done';

export type ViewMode = 'list' | 'board' | 'dashboard';

export interface TaskItem {
  /** Unique task id */
  id: string;
  /** Task title */
  title: string;
  /** Owning project name */
  project: string;
  /** Assignee name */
  assignee: string;
  /** Start time label (e.g. "今天 14:49") */
  startTime: string;
  /** Due date label (e.g. "明天 18:00") */
  dueDate: string;
  /** Creator name */
  creator: string;
  /** Task status */
  status: TaskStatus;
  /**
   * Hosting conversation id (#1963): the conversation this task runs in.
   * Optional — absent until the task source binds a conversation; task
   * cards without it offer no conversation deep link.
   */
  conversationId?: string | undefined;
}

export interface TaskGroup {
  /** Group display name */
  label: string;
  /** Tasks in this group */
  tasks: TaskItem[];
  /**
   * Board column id from the board-column SSOT (#1999) — present only for
   * status-grouped (board) groups; carries the column tone for chrome.
   */
  columnId?: string | undefined;
  /** Board column tone (#1999); present together with columnId. */
  tone?: BoardColumnTone | undefined;
}

export type TaskEditDraft = Pick<TaskItem, 'title' | 'project' | 'assignee' | 'startTime' | 'dueDate' | 'creator'>;

export interface TasksPageProps {
  /** Currently active nav pane */
  activePane: TasksPane;
  /** Called when user clicks a nav item */
  onPaneChange: (pane: TasksPane) => void;

  /** Active view mode */
  viewMode: ViewMode;
  /** Called when user switches view mode */
  onViewModeChange: (mode: ViewMode) => void;

  /** Task groups to render in the table */
  groups: TaskGroup[];
  /** Status line to show when no tasks are available from the active data source. */
  emptyStateLabel?: string | undefined;
  /**
   * Real data mode without a task backend (#1818): the empty state explains
   * that the task list is coming soon instead of implying tasks were loaded.
   */
  comingSoonEmptyState?: boolean | undefined;
  /**
   * Marks mock/demo task data with an explicit badge so demo rows are never
   * mistaken for real workspace tasks (#1818).
   */
  demoDataActive?: boolean | undefined;
  /**
   * Workbench surface (#1999): Hub-only surfaces (web/mobile) never render
   * merge controls and state that merging requires Desktop / Local Edge.
   */
  platformSurface?: AgentHubSurface | undefined;
  /**
   * Real review-before-merge capability port (#1999). Absent port = zero
   * approve/merge controls (fail-closed); the Tasks route never invents one.
   */
  reviewMergePort?: TaskReviewMergePort | null | undefined;
  /** Agent/user profiles available for assignee and creator avatar resolution */
  profiles?: WorkbenchProfileSource[] | undefined;
  /** Selected task details, rendered as a compact in-page action strip */
  selectedTask?: TaskItem | null | undefined;
  /** Current lightweight feedback/status message for task operations */
  taskActionLabel?: string | undefined;
  /** Whether the nav "more" menu is open */
  navMenuOpen?: boolean | undefined;
  /** Current row being edited */
  editingTaskId?: string | null | undefined;
  /** Draft values for the editing row */
  editingDraft?: TaskEditDraft | null | undefined;

  /** Stat values */
  incompleteCount: number;
  dueTodayCount: number;
  crossProjectCount: number;

  /** Active filter count shown on filter button */
  activeFilterCount?: number;
  sortLabel?: string | undefined;
  groupLabel?: string | undefined;
  fieldConfigLabel?: string | undefined;
  sortActive?: boolean | undefined;
  groupActive?: boolean | undefined;
  fieldConfigActive?: boolean | undefined;
  showCreatorColumn?: boolean | undefined;
  selectedTaskId?: string | null | undefined;

  /** Called when "create task" is clicked */
  onCreateTask?: (() => void) | undefined;
  /** Called when "more" in nav is clicked */
  onNavMore?: (() => void) | undefined;
  /** Called when "new group" is clicked */
  onNewGroup?: (() => void) | undefined;
  /** Called when "task list" is clicked */
  onTaskList?: (() => void) | undefined;
  /** Called when a task row is clicked */
  onTaskClick?: ((task: TaskItem) => void) | undefined;
  /** Called when "add row" is clicked at the bottom of the table */
  onAddTaskRow?: (() => void) | undefined;
  /** Called when selected task status should advance */
  onCycleSelectedTaskStatus?: (() => void) | undefined;
  /** Called when selected task should be assigned to current user */
  onAssignSelectedTaskToMe?: (() => void) | undefined;
  /** Called when selected task project should become the current grouping */
  onGroupBySelectedTaskProject?: (() => void) | undefined;
  /** Called when selected task assignee should become the active pane/filter */
  onFilterBySelectedTaskAssignee?: (() => void) | undefined;
  /** Called when selected task enters edit mode */
  onEditSelectedTask?: (() => void) | undefined;
  /** Called when selected task is deleted */
  onDeleteSelectedTask?: (() => void) | undefined;
  /** Called when an edit field changes */
  onEditDraftChange?: ((field: keyof TaskEditDraft, value: string) => void) | undefined;
  /** Called when the edit draft is saved */
  onSaveTaskEdit?: (() => void) | undefined;
  /** Called when row editing is cancelled */
  onCancelTaskEdit?: (() => void) | undefined;

  /** Called when a toolbar button is clicked */
  onToolbarFilter?: (() => void) | undefined;
  onToolbarSort?: (() => void) | undefined;
  onToolbarGroup?: (() => void) | undefined;
  onToolbarFieldConfig?: (() => void) | undefined;

  // ── Infinite scroll (T14 pattern; mock data-layer cursor pagination, #1510) ──
  /** Whether more tasks are available via pagination (pageCursor). */
  hasMore?: boolean | undefined;
  /** Whether a load-more page fetch is in flight. */
  loadingMore?: boolean | undefined;
  /** Triggered when the scroll sentinel enters the viewport (or fallback button). */
  onLoadMore?: (() => void) | undefined;
}
