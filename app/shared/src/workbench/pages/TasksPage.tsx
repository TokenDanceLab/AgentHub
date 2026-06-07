import React, { useCallback } from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../designIcons';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../profileRegistry';
import styles from './TasksPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   TasksPage — pure presentational workbench page
   ═══════════════════════════════════════════════════════════════════════ */

// ── Data shapes ──

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
}

export interface TaskGroup {
  /** Group display name */
  label: string;
  /** Tasks in this group */
  tasks: TaskItem[];
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
}

// ── Nav definitions ──

interface NavPrimaryItem {
  id: TasksPane;
  label: string;
  icon: DesignNavIconName;
  badge?: number;
}

interface NavQuickItem {
  id: TasksPane;
  label: string;
  icon: DesignNavIconName;
}

// ── Design icons ──

function NavGlyph({ name }: { name: DesignNavIconName }) {
  return (
    <span className={styles.navGlyph}>
      <DesignNavIcon
        name={name}
        size={DESIGN_NAV_GLYPH_SIZE}
        strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
      />
    </span>
  );
}

// ── Nav items ──

const NAV_PRIMARY: NavPrimaryItem[] = [
  { id: 'owned', label: '我负责的', icon: 'users', badge: 3 },
  { id: 'watching', label: '我关注的', icon: 'star' },
  { id: 'activity', label: '动态', icon: 'running' },
];

const NAV_QUICK: NavQuickItem[] = [
  { id: 'all', label: '全部任务', icon: 'folder' },
  { id: 'created', label: '我创建的', icon: 'folder' },
  { id: 'assigned', label: '我分配的', icon: 'folder' },
  { id: 'done', label: '已完成', icon: 'done' },
];

const PANE_TITLES: Record<TasksPane, string> = {
  owned: '我负责的',
  watching: '我关注的',
  activity: '动态',
  all: '全部任务',
  created: '我创建的',
  assigned: '我分配的',
  done: '已完成',
};

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'list', label: '列表' },
  { id: 'board', label: '看板' },
  { id: 'dashboard', label: '仪表盘' },
];

// ── Sub-components ──

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
    </article>
  );
}

function TaskNavMenu({ open }: { open: boolean }) {
  if (!open) return null;

  return (
    <div className={styles.navMenu} role="menu" aria-label="任务更多操作菜单">
      <button type="button" role="menuitem">
        <DesignNavIcon name="fileText" size={14} />
        导入任务
      </button>
      <button type="button" role="menuitem">
        <DesignNavIcon name="folder" size={14} />
        导出当前视图
      </button>
      <button type="button" role="menuitem">
        <DesignNavIcon name="settings" size={14} />
        管理任务字段
      </button>
    </div>
  );
}

function TaskSelectionStrip({
  task,
  actionLabel,
  onCycleStatus,
  onAssignToMe,
  onGroupByProject,
  onFilterByAssignee,
  onEdit,
  onDelete,
}: {
  task?: TaskItem | null | undefined;
  actionLabel?: string | undefined;
  onCycleStatus?: (() => void) | undefined;
  onAssignToMe?: (() => void) | undefined;
  onGroupByProject?: (() => void) | undefined;
  onFilterByAssignee?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  if (!task) {
    return null;
  }

  return (
    <div className={styles.selectionStrip} role="region" aria-label={`${task.title} 任务详情`}>
      <div className={styles.selectionMeta}>
        <span className={styles.selectionKicker}>当前选中</span>
        <strong>{task.title}</strong>
        <em>{task.status}</em>
      </div>
      <span className={styles.selectionMuted}>{task.project} · {task.assignee} · 截止 {task.dueDate}</span>
      <div className={styles.selectionActions}>
        {actionLabel && <strong className={styles.selectionFeedback}>{actionLabel}</strong>}
        <button type="button" onClick={onCycleStatus}>推进状态</button>
        <button type="button" onClick={onAssignToMe}>指派给我</button>
        <button type="button" onClick={onGroupByProject}>按项目分组</button>
        <button type="button" onClick={onFilterByAssignee}>看负责人任务</button>
        <button type="button" onClick={onEdit}>编辑</button>
        <button type="button" className={styles.dangerAction} onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const modifier =
    status === '已完成'
      ? styles.nameIconDone
      : status === '进行中'
        ? styles.nameIconRunning
        : '';
  const cls = [styles.nameIcon, modifier].filter(Boolean).join(' ');

  return <i className={cls} />;
}

function ProfileCell({
  name,
  profiles = [],
}: {
  name: string;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const profile = resolveWorkbenchProfile(name, profiles);
  return (
    <span className={styles.profileCell} data-profile-kind={profile.kind}>
      <span
        className={styles.profileAvatar}
        style={{ '--profile-avatar-color': profile.color } as React.CSSProperties}
      >
        {profile.initials}
      </span>
      <span className={styles.profileName}>{profile.name}</span>
    </span>
  );
}

function TaskRow({
  task,
  onClick,
  selected,
  showCreatorColumn,
  profiles = [],
  editing,
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
}: {
  task: TaskItem;
  onClick?: ((task: TaskItem) => void) | undefined;
  selected: boolean;
  showCreatorColumn: boolean;
  profiles?: WorkbenchProfileSource[] | undefined;
  editing: boolean;
  editDraft?: TaskEditDraft | null | undefined;
  onEditDraftChange?: ((field: keyof TaskEditDraft, value: string) => void) | undefined;
  onSaveEdit?: (() => void) | undefined;
  onCancelEdit?: (() => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(task);
  }, [task, onClick]);

  if (editing && editDraft) {
    return (
      <div
        className={`${styles.row} ${styles.rowSelected} ${styles.editRow} task-row`}
        data-card-surface
        data-task-id={task.id}
      >
        <label className={styles.editField}>
          <span>任务标题</span>
          <input
            aria-label="编辑任务标题"
            value={editDraft.title}
            onChange={(event) => onEditDraftChange?.('title', event.currentTarget.value)}
          />
        </label>
        <label className={styles.editField}>
          <span>所属项目</span>
          <input
            aria-label="编辑所属项目"
            value={editDraft.project}
            onChange={(event) => onEditDraftChange?.('project', event.currentTarget.value)}
          />
        </label>
        <label className={styles.editField}>
          <span>负责人</span>
          <input
            aria-label="编辑负责人"
            value={editDraft.assignee}
            onChange={(event) => onEditDraftChange?.('assignee', event.currentTarget.value)}
          />
        </label>
        <label className={styles.editField}>
          <span>开始时间</span>
          <input
            aria-label="编辑开始时间"
            value={editDraft.startTime}
            onChange={(event) => onEditDraftChange?.('startTime', event.currentTarget.value)}
          />
        </label>
        <label className={styles.editField}>
          <span>截止时间</span>
          <input
            aria-label="编辑截止时间"
            value={editDraft.dueDate}
            onChange={(event) => onEditDraftChange?.('dueDate', event.currentTarget.value)}
          />
        </label>
        <span className={styles.editActions}>
          <button type="button" onClick={onSaveEdit}>保存</button>
          <button type="button" onClick={onCancelEdit}>取消</button>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.row} ${selected ? styles.rowSelected : ''} task-row`}
      aria-pressed={selected}
      data-card-surface
      data-task-id={task.id}
      onClick={handleClick}
    >
      <span className={styles.name}>
        <TaskStatusIcon status={task.status} />
        <span className={styles.nameLabel}>{task.title}</span>
        <em className={styles.nameBadge}>{task.status}</em>
      </span>
      <span>{task.project}</span>
      <ProfileCell name={task.assignee} profiles={profiles} />
      <span>{task.startTime}</span>
      <span>{task.dueDate}</span>
      {showCreatorColumn && <ProfileCell name={task.creator} profiles={profiles} />}
    </button>
  );
}

function TaskTable({
  groups,
  onTaskClick,
  onAddRow,
  selectedTaskId,
  showCreatorColumn,
  profiles = [],
  editingTaskId,
  editingDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
}: {
  groups: TaskGroup[];
  onTaskClick?: ((task: TaskItem) => void) | undefined;
  onAddRow?: (() => void) | undefined;
  selectedTaskId?: string | null | undefined;
  showCreatorColumn: boolean;
  profiles?: WorkbenchProfileSource[] | undefined;
  editingTaskId?: string | null | undefined;
  editingDraft?: TaskEditDraft | null | undefined;
  onEditDraftChange?: ((field: keyof TaskEditDraft, value: string) => void) | undefined;
  onSaveEdit?: (() => void) | undefined;
  onCancelEdit?: (() => void) | undefined;
}) {
  // Flatten all tasks across groups for the default group title
  const totalTasks = groups.reduce((sum, g) => sum + g.tasks.length, 0);

  return (
    <div className={`${styles.table} ${showCreatorColumn ? '' : styles.tableFiveColumns} task-table`}>
      <div className={`${styles.tableHead} task-table-head`}>
        <span>任务标题</span>
        <span>所属项目</span>
        <span>负责人</span>
        <span>开始时间</span>
        <span>截止时间</span>
        {showCreatorColumn && <span>创建人</span>}
      </div>

      {groups.map((group) => (
        <React.Fragment key={group.label}>
          <div className={`${styles.groupTitle} task-group-title`}>
            <DesignNavIcon name="running" size={14} />
            {group.label}
            {' '}
            <em className={styles.groupCount}>{group.tasks.length}</em>
          </div>
          {group.tasks.map((task) => (
            <TaskRow
              key={task.id}
              editing={task.id === editingTaskId}
              editDraft={task.id === editingTaskId ? editingDraft : null}
              selected={task.id === selectedTaskId}
              showCreatorColumn={showCreatorColumn}
              task={task}
              profiles={profiles}
              onCancelEdit={onCancelEdit}
              onClick={onTaskClick}
              onEditDraftChange={onEditDraftChange}
              onSaveEdit={onSaveEdit}
            />
          ))}
        </React.Fragment>
      ))}

      {/* Fallback: if no groups, show single group with all tasks */}
      {groups.length === 0 && (
        <>
          <div className={`${styles.groupTitle} task-group-title`}>
            <DesignNavIcon name="running" size={14} />
            默认分组
            {' '}
            <em className={styles.groupCount}>{totalTasks}</em>
          </div>
        </>
      )}

      <button type="button" className={`${styles.addRow} task-add-row`} onClick={onAddRow}>
        <DesignNavIcon name="plus" size={15} />
        新建任务
      </button>
    </div>
  );
}

// ── Main component ──

export function TasksPage({
  activePane,
  onPaneChange,
  viewMode,
  onViewModeChange,
  groups,
  profiles,
  selectedTask,
  taskActionLabel,
  navMenuOpen = false,
  editingTaskId = null,
  editingDraft = null,
  incompleteCount,
  dueTodayCount,
  crossProjectCount,
  activeFilterCount = 0,
  sortLabel = '排序：拖拽自定义',
  groupLabel = '分组：自定义分组',
  fieldConfigLabel = '字段配置',
  sortActive = false,
  groupActive = false,
  fieldConfigActive = false,
  showCreatorColumn = true,
  selectedTaskId = null,
  onCreateTask,
  onNavMore,
  onNewGroup,
  onTaskList,
  onTaskClick,
  onAddTaskRow,
  onToolbarFilter,
  onToolbarSort,
  onToolbarGroup,
  onToolbarFieldConfig,
  onCycleSelectedTaskStatus,
  onAssignSelectedTaskToMe,
  onGroupBySelectedTaskProject,
  onFilterBySelectedTaskAssignee,
  onEditSelectedTask,
  onDeleteSelectedTask,
  onEditDraftChange,
  onSaveTaskEdit,
  onCancelTaskEdit,
}: TasksPageProps): React.ReactElement {
  const title = PANE_TITLES[activePane] ?? '我负责的';

  return (
    <section className={`${styles.page} workbench tasks-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav`}>
        <div className={`${styles.navTitle} workbench-title`}>任务</div>

        <button
          type="button"
          className={`${styles.navMore} ${navMenuOpen ? styles.navMoreActive : ''}`}
          aria-label="任务更多操作"
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
          任务清单
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

      {/* ── Right main ── */}
      <main className={`${styles.main} workbench-main`}>
        {/* Head */}
        <div className={`${styles.head} workbench-head`}>
          <div>
            <h1 className={styles.headTitle}>{title}</h1>
            <p className={styles.headSubcopy}>
              跨项目任务中心；项目页只展示当前项目内任务和运行。
            </p>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={`${styles.createBtn} btn btn-p`} onClick={onCreateTask}>
              新建任务
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} icon-action`}
              aria-label="切换视图"
              onClick={() =>
                onViewModeChange(viewMode === 'list' ? 'board' : 'list')
              }
            >
              <DesignNavIcon name="grid" size={16} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          <StatCard label="未完成" value={incompleteCount} />
          <StatCard label="今天截止" value={dueTodayCount} />
          <StatCard label="跨项目" value={crossProjectCount} />
        </div>

        {/* View tabs */}
        <div className={styles.viewTabs} role="tablist">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              className={`${styles.viewTab} ${
                viewMode === mode.id ? styles.viewTabActive : ''
              }`}
              aria-selected={viewMode === mode.id}
              onClick={() => onViewModeChange(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className={`${styles.toolbar} task-toolbar`}>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onCreateTask}
          >
            <DesignNavIcon name="plus" size={15} />
            新建任务
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${
              activeFilterCount > 0 ? styles.toolbarBtnActive : ''
            }`}
            onClick={onToolbarFilter}
          >
            <DesignNavIcon name="filter" size={15} />
            筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${
              sortActive ? styles.toolbarBtnActive : ''
            }`}
            onClick={onToolbarSort}
          >
            {sortLabel}
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${
              groupActive ? styles.toolbarBtnActive : ''
            }`}
            onClick={onToolbarGroup}
          >
            {groupLabel}
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${
              fieldConfigActive ? styles.toolbarBtnActive : ''
            }`}
            onClick={onToolbarFieldConfig}
          >
            {fieldConfigLabel}
          </button>
          {!selectedTask && taskActionLabel && taskActionLabel !== '筛选已启用' && (
            <span className={styles.toolbarStatus} role="status">{taskActionLabel}</span>
          )}
        </div>

        <TaskSelectionStrip
          actionLabel={taskActionLabel}
          task={selectedTask}
          onAssignToMe={onAssignSelectedTaskToMe}
          onCycleStatus={onCycleSelectedTaskStatus}
          onDelete={onDeleteSelectedTask}
          onEdit={onEditSelectedTask}
          onFilterByAssignee={onFilterBySelectedTaskAssignee}
          onGroupByProject={onGroupBySelectedTaskProject}
        />

        {/* Task table */}
        <TaskTable
          groups={groups}
          editingDraft={editingDraft}
          editingTaskId={editingTaskId}
          selectedTaskId={selectedTaskId}
          showCreatorColumn={showCreatorColumn}
          profiles={profiles}
          onAddRow={onAddTaskRow}
          onCancelEdit={onCancelTaskEdit}
          onEditDraftChange={onEditDraftChange}
          onSaveEdit={onSaveTaskEdit}
          onTaskClick={onTaskClick}
        />
      </main>
    </section>
  );
}
