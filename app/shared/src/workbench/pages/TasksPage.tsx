import React, { useCallback } from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
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

  /** Stat values */
  incompleteCount: number;
  dueTodayCount: number;
  crossProjectCount: number;

  /** Active filter count shown on filter button */
  activeFilterCount?: number;

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
      <DesignNavIcon name={name} size={17} />
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

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const cls =
    status === '已完成'
      ? styles.nameIconDone
      : status === '进行中'
        ? styles.nameIconRunning
        : styles.nameIcon;

  return <i className={cls} />;
}

function TaskRow({
  task,
  onClick,
}: {
  task: TaskItem;
  onClick?: ((task: TaskItem) => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(task);
  }, [task, onClick]);

  return (
    <button type="button" className={styles.row} onClick={handleClick}>
      <span className={styles.name}>
        <TaskStatusIcon status={task.status} />
        <span className={styles.nameLabel}>{task.title}</span>
        <em className={styles.nameBadge}>{task.status}</em>
      </span>
      <span>{task.project}</span>
      <span>{task.assignee}</span>
      <span>{task.startTime}</span>
      <span>{task.dueDate}</span>
      <span>{task.creator}</span>
    </button>
  );
}

function TaskTable({
  groups,
  onTaskClick,
  onAddRow,
}: {
  groups: TaskGroup[];
  onTaskClick?: ((task: TaskItem) => void) | undefined;
  onAddRow?: (() => void) | undefined;
}) {
  // Flatten all tasks across groups for the default group title
  const totalTasks = groups.reduce((sum, g) => sum + g.tasks.length, 0);

  return (
    <div className={styles.table}>
      <div className={styles.tableHead}>
        <span>任务标题</span>
        <span>所属项目</span>
        <span>负责人</span>
        <span>开始时间</span>
        <span>截止时间</span>
        <span>创建人</span>
      </div>

      {groups.map((group) => (
        <React.Fragment key={group.label}>
          <div className={styles.groupTitle}>
            <DesignNavIcon name="running" size={14} />
            {group.label}
            {' '}
            <em className={styles.groupCount}>{group.tasks.length}</em>
          </div>
          {group.tasks.map((task) => (
            <TaskRow key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </React.Fragment>
      ))}

      {/* Fallback: if no groups, show single group with all tasks */}
      {groups.length === 0 && (
        <>
          <div className={styles.groupTitle}>
            <DesignNavIcon name="running" size={14} />
            默认分组
            {' '}
            <em className={styles.groupCount}>{totalTasks}</em>
          </div>
        </>
      )}

      <button type="button" className={styles.addRow} onClick={onAddRow}>
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
  incompleteCount,
  dueTodayCount,
  crossProjectCount,
  activeFilterCount = 0,
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
}: TasksPageProps): React.ReactElement {
  const title = PANE_TITLES[activePane] ?? '我负责的';

  return (
    <section className={styles.page}>
      {/* ── Left nav ── */}
      <aside className={styles.nav}>
        <div className={styles.navTitle}>任务</div>

        <button
          type="button"
          className={styles.navMore}
          aria-label="任务更多操作"
          onClick={onNavMore}
        >
          <DesignNavIcon name="more" size={16} />
        </button>

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
      <main className={styles.main}>
        {/* Head */}
        <div className={styles.head}>
          <div>
            <h1 className={styles.headTitle}>{title}</h1>
            <p className={styles.headSubcopy}>
              跨项目任务中心；项目页只展示当前项目内任务和运行。
            </p>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={styles.createBtn} onClick={onCreateTask}>
              新建任务
            </button>
            <button
              type="button"
              className={styles.iconBtn}
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
        <div className={styles.toolbar}>
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
            className={styles.toolbarBtn}
            onClick={onToolbarSort}
          >
            排序：拖拽自定义
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onToolbarGroup}
          >
            分组：自定义分组
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onToolbarFieldConfig}
          >
            字段配置
          </button>
        </div>

        {/* Task table */}
        <TaskTable
          groups={groups}
          onTaskClick={onTaskClick}
          onAddRow={onAddTaskRow}
        />
      </main>
    </section>
  );
}
