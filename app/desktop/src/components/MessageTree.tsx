import { useMemo, memo } from 'react';
import { buildTree } from '@shared/tree';
import type { TreeNode } from '@shared/tree';
import type { ChatMessage } from './ChatView.types';
import styles from './MessageTree.module.css';

interface MessageTreeProps {
  messages: ChatMessage[];
  renderMessage: (message: ChatMessage, depth: number) => React.ReactNode;
}

/** Returns true if any message in the list has a parentId reference. */
function hasTreeRelations(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.parentId != null);
}

interface TreeNodeRowProps {
  node: TreeNode<ChatMessage>;
  renderMessage: (message: ChatMessage, depth: number) => React.ReactNode;
  isLastSibling: boolean;
  /** For each ancestor depth, whether its vertical connector line should continue. */
  ancestorConnectors: boolean[];
}

function TreeNodeRow({
  node,
  renderMessage,
  isLastSibling,
  ancestorConnectors,
}: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;

  return (
    <div className={styles.treeNode}>
      <div className={styles.treeRow}>
        {/* Indent column with tree connector lines */}
        <div className={styles.treeIndent} style={{ width: node.depth * 20 }}>
          {ancestorConnectors.map((show, i) =>
            show ? (
              <span key={i} className={styles.treeConnector} aria-hidden="true" />
            ) : (
              <span key={i} className={styles.treeSpacer} aria-hidden="true" />
            ),
          )}
          {node.depth > 0 && (
            <span
              className={`${styles.treeConnector} ${isLastSibling ? styles.treeConnectorLast : ''}`}
              aria-hidden="true"
            />
          )}
        </div>
        {/* Message content */}
        <div className={styles.treeContent}>{renderMessage(node.item, node.depth)}</div>
      </div>
      {/* Render children recursively */}
      {hasChildren &&
        node.children.map((child, idx) => (
          <TreeNodeRow
            key={child.item.id}
            node={child}
            renderMessage={renderMessage}
            isLastSibling={idx === node.children.length - 1}
            ancestorConnectors={[...ancestorConnectors, !isLastSibling]}
          />
        ))}
    </div>
  );
}

/**
 * Renders ChatMessages as a tree, with visual indentation and connector lines
 * based on each message's optional `parentId` field.
 *
 * Falls back to flat rendering when no messages have a parentId set.
 */
const MessageTree = memo(function MessageTree({ messages, renderMessage }: MessageTreeProps) {
  const useTree = useMemo(() => hasTreeRelations(messages), [messages]);
  const roots = useMemo(() => buildTree(messages), [messages]);

  if (!useTree) {
    return <>{messages.map((msg) => renderMessage(msg, 0))}</>;
  }

  return (
    <div className={styles.treeRoot}>
      {roots.map((root, idx) => (
        <TreeNodeRow
          key={root.item.id}
          node={root}
          renderMessage={renderMessage}
          isLastSibling={idx === roots.length - 1}
          ancestorConnectors={[]}
        />
      ))}
    </div>
  );
});

export default MessageTree;
