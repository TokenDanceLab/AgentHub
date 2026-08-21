import type { EmptyStateAction, EmptyStateProps } from '@shared/ui';
import styles from '../TasksPage.module.css';
import type { TaskEditDraft, TaskGroup, TaskStatus } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   TaskTableHelpers — pure residual slices from TaskTableViews (#745).

   Status icon class packing, table/row class names, empty-state optional
   props (exactOptionalPropertyTypes-safe), edit-field configs, and group
   task counts. No React / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export type TaskTableCss = Record<string, string>;

export type ClassNamePart = string | undefined | null | false;

/** Join class names without empty/false parts or double spaces. */
export function joinClassNames(...parts: ClassNamePart[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Status-specific modifier for the task name icon.
 * Only '已完成' and '进行中' carry a visual modifier; others return ''.
 */
export function taskStatusIconModifier(
  status: TaskStatus,
  css: TaskTableCss = styles,
): string {
  if (status === '已完成') return css.nameIconDone ?? '';
  if (status === '进行中') return css.nameIconRunning ?? '';
  return '';
}

/** Full className for TaskStatusIcon. */
export function taskStatusIconClassName(
  status: TaskStatus,
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.nameIcon ?? '', taskStatusIconModifier(status, css));
}

/** Table surface class: five-column layout when creator is hidden. */
export function taskTableClassName(
  showCreatorColumn: boolean,
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.table ?? '', !showCreatorColumn && (css.tableFiveColumns ?? ''), 'task-table');
}

/** Display-row className including selected state. */
export function taskDisplayRowClassName(
  selected: boolean,
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.row ?? '', selected && (css.rowSelected ?? ''), 'task-row');
}

/** Edit-row className (always selected + edit surface). */
export function taskEditRowClassName(
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.row ?? '', css.rowSelected ?? '', css.editRow ?? '', 'task-row');
}

/** Group title className. */
export function taskGroupTitleClassName(
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.groupTitle ?? '', 'task-group-title');
}

/** Add-row button className. */
export function taskAddRowClassName(
  css: TaskTableCss = styles,
): string {
  return joinClassNames(css.addRow ?? '', 'task-add-row');
}

/** Aria label for the selection strip region. */
export function taskSelectionAriaLabel(title: string): string {
  return `${title} 任务详情`;
}

/** Selection strip muted meta line: project · assignee · 截止 dueDate. */
export function taskSelectionMetaLine(
  task: Pick<{ project: string; assignee: string; dueDate: string }, 'project' | 'assignee' | 'dueDate'>,
): string {
  return `${task.project} · ${task.assignee} · 截止 ${task.dueDate}`;
}

/** Flattened task count across groups. */
export function countTasksInGroups(groups: readonly TaskGroup[]): number {
  return groups.reduce((sum, g) => sum + g.tasks.length, 0);
}

export type TaskEditFieldKey = keyof TaskEditDraft;

export type TaskEditFieldConfig = {
  key: TaskEditFieldKey;
  label: string;
  ariaLabel: string;
};

/** Inline edit-row field configs (title → dueDate). */
export const TASK_EDIT_FIELD_CONFIGS: readonly TaskEditFieldConfig[] = [
  { key: 'title', label: '任务标题', ariaLabel: '编辑任务标题' },
  { key: 'project', label: '所属项目', ariaLabel: '编辑所属项目' },
  { key: 'assignee', label: '负责人', ariaLabel: '编辑负责人' },
  { key: 'startTime', label: '开始时间', ariaLabel: '编辑开始时间' },
  { key: 'dueDate', label: '截止时间', ariaLabel: '编辑截止时间' },
];

export type TaskEmptyStateClassProps = Pick<
  EmptyStateProps,
  | 'className'
  | 'contentClassName'
  | 'titleClassName'
  | 'descriptionClassName'
  | 'actionClassName'
>;

/**
 * exactOptionalPropertyTypes-safe optional className props for the tasks
 * EmptyState. Only defined keys are present when CSS modules expose the class.
 */
export function taskEmptyStateClassProps(
  css: Record<string, string | undefined> = styles,
): TaskEmptyStateClassProps {
  const props: TaskEmptyStateClassProps = {};
  if (css['tasks-empty-compact']) {
    props.className = css['tasks-empty-compact'];
  }
  if (css['tasks-empty-compact-content']) {
    props.contentClassName = css['tasks-empty-compact-content'];
  }
  if (css['tasks-empty-compact-title']) {
    props.titleClassName = css['tasks-empty-compact-title'];
  }
  if (css['tasks-empty-compact-description']) {
    props.descriptionClassName = css['tasks-empty-compact-description'];
  }
  if (css['tasks-empty-compact-action']) {
    props.actionClassName = css['tasks-empty-compact-action'];
  }
  return props;
}

/**
 * exactOptionalPropertyTypes-safe optional description for EmptyState.
 * Key is omitted when the label is empty/undefined.
 */
export function taskEmptyStateDescriptionProps(
  emptyStateLabel?: string | undefined,
): Pick<EmptyStateProps, 'description'> {
  if (!emptyStateLabel) return {};
  return { description: emptyStateLabel };
}

/**
 * exactOptionalPropertyTypes-safe optional action for EmptyState.
 * Key is omitted when onAddRow is not provided.
 */
export function taskEmptyStateActionProps(
  actionLabel: string,
  onAddRow?: (() => void) | undefined,
): Pick<EmptyStateProps, 'action'> {
  if (!onAddRow) return {};
  const action: EmptyStateAction = { label: actionLabel, onClick: onAddRow };
  return { action };
}
