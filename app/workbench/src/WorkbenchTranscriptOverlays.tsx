import React from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import {
  ContextMenu,
  MultiSelectBar,
  DemoToast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import type { WorkbenchContextMenuState } from './useWorkbenchTranscriptChrome';

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
      <DemoToast message={toastMessage} visible={toastVisible} />
    </>
  );
}
