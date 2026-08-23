import React from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import {
  ContextMenu,
  MultiSelectBar,
  SelectionDeleteConfirm,
  DemoToast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import type {
  DeleteConfirmRequest,
  WorkbenchContextMenuState,
} from './useWorkbenchTranscriptChrome';

export interface WorkbenchTranscriptOverlaysProps {
  isChatPage: boolean;
  contextMenu: WorkbenchContextMenuState | null;
  contextMenuGroups: (
    blockId: string,
    conversations?: WorkbenchConversation[],
  ) => Array<Array<ContextMenuItem>>;
  /** Forward target candidates (#1385) — passed into the menu builder so the
   *  forward item can render its picker submenu. */
  conversations?: WorkbenchConversation[] | undefined;
  onCloseContextMenu: () => void;
  selectionMode: boolean;
  multiSelectActions: Array<MultiSelectBarAction>;
  selectedCount: number;
  totalCount: number;
  selectBarRect: { left: number; width: number } | null;
  /** #1823: destructive multi-delete gate is pending (awaiting confirm).
   *  Carries the count + blockIds snapshot the dialog promises to delete. */
  deleteConfirmPending: DeleteConfirmRequest | null;
  /** #1823: confirms the pending destructive multi-delete. */
  onConfirmDelete: () => void;
  /** #1823: dismisses the pending confirm without deleting. */
  onCancelDelete: () => void;
  toastMessage: string;
  toastVisible: boolean;
}

export function WorkbenchTranscriptOverlays({
  isChatPage,
  contextMenu,
  contextMenuGroups,
  conversations,
  onCloseContextMenu,
  selectionMode,
  multiSelectActions,
  selectedCount,
  totalCount,
  selectBarRect,
  deleteConfirmPending,
  onConfirmDelete,
  onCancelDelete,
  toastMessage,
  toastVisible,
}: WorkbenchTranscriptOverlaysProps): React.ReactElement {
  return (
    <>
      {isChatPage && contextMenu && (
        <ContextMenu
          groups={contextMenuGroups(contextMenu.blockId, conversations)}
          isOpen={Boolean(contextMenu)}
          title={contextMenu.title}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        />
      )}
      {isChatPage && selectionMode && (
        <MultiSelectBar
          actions={multiSelectActions}
          count={selectedCount}
          total={totalCount}
          workspaceLeft={selectBarRect?.left}
          workspaceWidth={selectBarRect?.width}
        />
      )}
      {isChatPage && selectionMode && deleteConfirmPending && (
        <SelectionDeleteConfirm
          count={deleteConfirmPending.count}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
          workspaceLeft={selectBarRect?.left}
          workspaceWidth={selectBarRect?.width}
        />
      )}
      <DemoToast message={toastMessage} visible={toastVisible} />
    </>
  );
}
