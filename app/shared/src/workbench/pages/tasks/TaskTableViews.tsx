/* ═══════════════════════════════════════════════════════════════════════
   Tasks table / selection subviews — extracted for Phase 18 #571.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../../profileRegistry';
import { EmptyState } from '../../../ui';
import styles from '../TasksPage.module.css';
import type { TaskEditDraft, TaskGroup, TaskItem, TaskStatus } from './types';

export function TaskSelectionStrip({
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

export function TaskTable({
  groups,
  emptyStateLabel,
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
  emptyStateLabel?: string | undefined;
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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

      {totalTasks === 0 && (
        <EmptyState
          title={t('tasks.empty.title')}
          titleLevel={3}
          {...(emptyStateLabel ? { description: emptyStateLabel } : {})}
          {...(styles['tasks-empty-compact']
            ? { className: styles['tasks-empty-compact'] }
            : {})}
          {...(styles['tasks-empty-compact-content']
            ? { contentClassName: styles['tasks-empty-compact-content'] }
            : {})}
          {...(styles['tasks-empty-compact-title']
            ? { titleClassName: styles['tasks-empty-compact-title'] }
            : {})}
          {...(styles['tasks-empty-compact-description']
            ? { descriptionClassName: styles['tasks-empty-compact-description'] }
            : {})}
          {...(styles['tasks-empty-compact-action']
            ? { actionClassName: styles['tasks-empty-compact-action'] }
            : {})}
          {...(onAddRow
            ? { action: { label: t('tasks.newTask'), onClick: onAddRow } }
            : {})}
        />
      )}

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
        {t('tasks.newTask')}
      </button>
    </div>
  );
}
