/* ==========================================================================
   WorkbenchSplitHost — absolutely-positioned pane shells over computeRects
   (#1997, UX F3).

   Hard contract: layout changes never remount the active ConversationHost.
   The active pane is ALWAYS the first child of the workspace under the
   stable key `ACTIVE_PANE_KEY`; its rect follows whichever leaf holds the
   active conversation. Split/Unsplit/Move only add, remove or restyle the
   read-only sibling panes — the live transcript/WS surface keeps its React
   tree position, so streaming is never interrupted by layout changes.

   Single-group mode renders the same stable-slot div (full-bleed), so the
   first split also does not remount the host.
   ========================================================================== */

import React from 'react';
import { computeRects, listLeaves, type GroupLeaf, type SplitLayoutNode, type SplitRect } from './workbenchSplitLayout';
import styles from './AgentHubWorkbench.module.css';

/** Stable React key for the pane shell that hosts the live ConversationHost. */
export const ACTIVE_PANE_KEY = 'agenthub-split-active-pane';

/** Visual gutter between panes (each pane is inset by half from its rect). */
const SPLIT_GAP_PX = 8;

export function splitPaneStyle(rect: SplitRect | undefined): React.CSSProperties {
  const safe = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const halfGap = SPLIT_GAP_PX / 2;
  return {
    position: 'absolute',
    left: `calc(${(safe.x * 100).toFixed(4)}% + ${halfGap}px)`,
    top: `calc(${(safe.y * 100).toFixed(4)}% + ${halfGap}px)`,
    width: `calc(${(safe.w * 100).toFixed(4)}% - ${SPLIT_GAP_PX}px)`,
    height: `calc(${(safe.h * 100).toFixed(4)}% - ${SPLIT_GAP_PX}px)`,
  };
}

export interface WorkbenchSplitHostProps {
  /** Effective layout tree; null (or inactive) renders a single full pane. */
  tree: SplitLayoutNode | null;
  /** True when the tree holds at least two panes. */
  splitActive: boolean;
  activeConversationId: string;
  /** The live ConversationHost frame element (single instance, never remounted). */
  activeHost: React.ReactElement;
  /** Render the read-only surface for a non-active leaf. */
  renderReadOnlyPane: (leaf: GroupLeaf) => React.ReactElement;
  /** Pane-level conversation title for data attrs/E2E (may be empty). */
  paneTitleOf: (leaf: GroupLeaf) => string;
}

/**
 * Order panes so the active one is FIRST: its shell keeps the stable key and
 * tree position across every layout change; the rest follow in document
 * order keyed by paneId.
 */
export function orderLeavesForRender(
  tree: SplitLayoutNode,
  activeConversationId: string,
): GroupLeaf[] {
  const leaves = listLeaves(tree);
  const activeIndex = leaves.findIndex((leaf) => leaf.conversationId === activeConversationId);
  if (activeIndex <= 0) return leaves;
  const activeLeaf = leaves[activeIndex];
  if (!activeLeaf) return leaves;
  return [activeLeaf, ...leaves.filter((leaf) => leaf !== activeLeaf)];
}

export function WorkbenchSplitHost({
  tree,
  splitActive,
  activeConversationId,
  activeHost,
  renderReadOnlyPane,
  paneTitleOf,
}: WorkbenchSplitHostProps): React.ReactElement {
  // Single group: the same stable-slot shell fills the workspace. Keeping the
  // tree shape identical means entering split mode never remounts the host.
  if (!splitActive || !tree) {
    return (
      <div
        key={ACTIVE_PANE_KEY}
        className={styles.chatPane}
        data-split-pane
        data-split-active="true"
        data-conversation-id={activeConversationId}
      >
        {activeHost}
      </div>
    );
  }

  const rects = computeRects(tree);
  const ordered = orderLeavesForRender(tree, activeConversationId);
  const activeLeaf = ordered[0];

  return (
    <>
      {ordered.map((leaf, index) => {
        const isActive = index === 0 && leaf === activeLeaf;
        const rect = rects.get(leaf.paneId);
        if (isActive) {
          return (
            <div
              key={ACTIVE_PANE_KEY}
              className={styles.chatPane}
              data-split-pane
              data-split-active="true"
              data-pane-id={leaf.paneId}
              data-conversation-id={activeConversationId}
              data-pane-title={paneTitleOf(leaf)}
              style={splitPaneStyle(rect)}
            >
              {activeHost}
            </div>
          );
        }
        return (
          <div
            key={leaf.paneId}
            className={styles.chatPane}
            data-split-pane
            data-split-active="false"
            data-pane-id={leaf.paneId}
            data-conversation-id={leaf.conversationId ?? ''}
            data-pane-title={paneTitleOf(leaf)}
            style={splitPaneStyle(rect)}
          >
            {renderReadOnlyPane(leaf)}
          </div>
        );
      })}
    </>
  );
}
