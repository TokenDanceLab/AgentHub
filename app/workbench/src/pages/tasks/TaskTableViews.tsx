/* ═══════════════════════════════════════════════════════════════════════
   Tasks table / selection subviews — residual thin shell after extracting
   pure helpers to TaskTableHelpers and presentational parts to
   TaskTableParts (#745 / #571).

   CSS stays on TasksPage.module.css. No intentional UX change.
   Public API: TaskSelectionStrip, TaskTable.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import {
  countTasksInGroups,
  taskTableClassName,
} from './TaskTableHelpers';
import {
  TaskAddRowButton,
  TaskGroupRows,
  TaskGroupTitle,
  TaskSelectionStrip,
  TaskTableEmptyState,
  TaskTableHead,
} from './TaskTableParts';
import type { TaskEditDraft, TaskGroup, TaskItem } from './types';

export { TaskSelectionStrip };

export function TaskTable({
  groups,
  emptyStateLabel,
  comingSoonEmptyState = false,
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
  /** Real data mode without a task backend (#1818): coming-soon empty state. */
  comingSoonEmptyState?: boolean | undefined;
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
  const totalTasks = countTasksInGroups(groups);

  return (
    <div className={taskTableClassName(showCreatorColumn)}>
      <TaskTableHead showCreatorColumn={showCreatorColumn} />

      <TaskGroupRows
        groups={groups}
        onTaskClick={onTaskClick}
        selectedTaskId={selectedTaskId}
        showCreatorColumn={showCreatorColumn}
        profiles={profiles}
        editingTaskId={editingTaskId}
        editingDraft={editingDraft}
        onEditDraftChange={onEditDraftChange}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />

      {totalTasks === 0 && (
        <TaskTableEmptyState
          comingSoon={comingSoonEmptyState}
          emptyStateLabel={emptyStateLabel}
          onAddRow={onAddRow}
        />
      )}

      {/* Fallback: if no groups, show single group with all tasks */}
      {groups.length === 0 && (
        <TaskGroupTitle label="默认分组" count={totalTasks} />
      )}

      <TaskAddRowButton onAddRow={onAddRow} />
    </div>
  );
}
