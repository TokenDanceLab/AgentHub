import React from 'react';
import {
  ContextMenu,
  MultiSelectBar,
  Toast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import type { WorkbenchContextMenuState } from './useWorkbenchTranscriptChrome';

export interface WorkbenchTranscriptOverlaysProps {
  isChatPage: boolean;
  contextMenu: WorkbenchContextMenuState | null;
  contextMenuGroups: (blockId: string) => Array<Array<ContextMenuItem>>;
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
          groups={contextMenuGroups(contextMenu.blockId)}
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
      <Toast message={toastMessage} visible={toastVisible} />
    </>
  );
}
