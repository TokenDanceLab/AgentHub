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
import {
  TASK_EDIT_FIELD_CONFIGS,
  taskAddRowClassName,
  taskDisplayRowClassName,
  taskEditRowClassName,
  taskEmptyStateActionProps,
  taskEmptyStateClassProps,
  taskEmptyStateDescriptionProps,
  taskGroupTitleClassName,
  taskSelectionAriaLabel,
  taskSelectionMetaLine,
  taskStatusIconClassName,
} from './TaskTableHelpers';
import type { TaskEditDraft, TaskGroup, TaskItem, TaskStatus } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   TaskTableParts — presentational residual slices from TaskTableViews
   (#745).

   Selection strip, status icon, profile cell, task row (edit + display),
   table head, group title, empty state, and add-row button.
   CSS stays on TasksPage.module.css. No intentional UX change.
   exactOptionalPropertyTypes-safe empty-state props via helpers.
   ═══════════════════════════════════════════════════════════════════════ */

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
    <div
      className={styles.selectionStrip}
      role="region"
      aria-label={taskSelectionAriaLabel(task.title)}
    >
      <div className={styles.selectionMeta}>
        <span className={styles.selectionKicker}>当前选中</span>
        <strong>{task.title}</strong>
        <em>{task.status}</em>
      </div>
      <span className={styles.selectionMuted}>{taskSelectionMetaLine(task)}</span>
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

export function TaskStatusIcon({ status }: { status: TaskStatus }) {
  return <i className={taskStatusIconClassName(status)} />;
}

export function ProfileCell({
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

function TaskEditFields({
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
}: {
  editDraft: TaskEditDraft;
  onEditDraftChange?: ((field: keyof TaskEditDraft, value: string) => void) | undefined;
  onSaveEdit?: (() => void) | undefined;
  onCancelEdit?: (() => void) | undefined;
}) {
  return (
    <>
      {TASK_EDIT_FIELD_CONFIGS.map((field) => (
        <label key={field.key} className={styles.editField}>
          <span>{field.label}</span>
          <input
            aria-label={field.ariaLabel}
            value={editDraft[field.key]}
            onChange={(event) => onEditDraftChange?.(field.key, event.currentTarget.value)}
          />
        </label>
      ))}
      <span className={styles.editActions}>
        <button type="button" onClick={onSaveEdit}>保存</button>
        <button type="button" onClick={onCancelEdit}>取消</button>
      </span>
    </>
  );
}

export function TaskRow({
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
        className={taskEditRowClassName()}
        data-card-surface
        data-task-id={task.id}
      >
        <TaskEditFields
          editDraft={editDraft}
          onCancelEdit={onCancelEdit}
          onEditDraftChange={onEditDraftChange}
          onSaveEdit={onSaveEdit}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={taskDisplayRowClassName(selected)}
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

export function TaskTableHead({ showCreatorColumn }: { showCreatorColumn: boolean }) {
  return (
    <div className={`${styles.tableHead} task-table-head`}>
      <span>任务标题</span>
      <span>所属项目</span>
      <span>负责人</span>
      <span>开始时间</span>
      <span>截止时间</span>
      {showCreatorColumn && <span>创建人</span>}
    </div>
  );
}

export function TaskGroupTitle({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className={taskGroupTitleClassName()}>
      <DesignNavIcon name="running" size={14} />
      {label}
      {' '}
      <em className={styles.groupCount}>{count}</em>
    </div>
  );
}

export function TaskTableEmptyState({
  emptyStateLabel,
  comingSoon = false,
  onAddRow,
}: {
  emptyStateLabel?: string | undefined;
  /**
   * Honest empty state for real data mode (#1818): the task backend is not
   * connected yet, so say so explicitly and offer no create action.
   */
  comingSoon?: boolean | undefined;
  onAddRow?: (() => void) | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  if (comingSoon) {
    return (
      <EmptyState
        description={t('tasks.emptyComingSoon.description')}
        title={t('tasks.emptyComingSoon.title')}
        titleLevel={3}
        {...taskEmptyStateClassProps()}
      />
    );
  }

  return (
    <EmptyState
      title={t('tasks.empty.title')}
      titleLevel={3}
      {...taskEmptyStateDescriptionProps(emptyStateLabel)}
      {...taskEmptyStateClassProps()}
      {...taskEmptyStateActionProps(t('tasks.newTask'), onAddRow)}
    />
  );
}

export function TaskAddRowButton({ onAddRow }: { onAddRow?: (() => void) | undefined }) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <button type="button" className={taskAddRowClassName()} onClick={onAddRow}>
      <DesignNavIcon name="plus" size={15} />
      {t('tasks.newTask')}
    </button>
  );
}

export function TaskGroupRows({
  groups,
  onTaskClick,
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
  selectedTaskId?: string | null | undefined;
  showCreatorColumn: boolean;
  profiles?: WorkbenchProfileSource[] | undefined;
  editingTaskId?: string | null | undefined;
  editingDraft?: TaskEditDraft | null | undefined;
  onEditDraftChange?: ((field: keyof TaskEditDraft, value: string) => void) | undefined;
  onSaveEdit?: (() => void) | undefined;
  onCancelEdit?: (() => void) | undefined;
}) {
  return (
    <>
      {groups.map((group) => (
        <React.Fragment key={group.label}>
          <TaskGroupTitle label={group.label} count={group.tasks.length} />
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
    </>
  );
}
