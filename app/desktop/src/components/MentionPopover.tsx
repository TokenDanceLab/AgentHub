import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Circle, FileText, MessageSquareText } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { MentionItem } from '@/hooks/useMention';
import styles from './MentionPopover.module.css';

interface Props {
  agents?: AgentInfo[];
  items?: MentionItem[];
  isOpen: boolean;
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}

function agentToMentionItem(agent: AgentInfo): MentionItem {
  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    label: agent.name,
    description: agent.description,
    status: agent.status,
    agent,
  };
}

/**
 * Renders a match-highlighted agent name.
 * Splits by the query (case-insensitive) and wraps matches in a <mark>-like span.
 */
function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;

  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{name}</>;

  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);

  return (
    <>
      {before}
      <span className={styles.match}>{match}</span>
      {after}
    </>
  );
}

function MentionIcon({ item }: { item: MentionItem }) {
  if (item.kind === 'file') return <FileText size={15} />;
  if (item.kind === 'thread') return <MessageSquareText size={15} />;
  return <Bot size={15} />;
}

export default function MentionPopover({
  agents = [],
  items,
  isOpen,
  query,
  position,
  selectedIndex,
  onSelect,
  onClose,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const displayItems = items ?? agents.map(agentToMentionItem);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid firing on the same click that opened
    const id = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen || displayItems.length === 0) return null;

  return createPortal(
    <div
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
      role="listbox"
      aria-label="Agent suggestions"
    >
      <ul ref={listRef} className={styles.list}>
        {displayItems.map((item, i) => (
          <li key={item.id} role="option" aria-selected={i === selectedIndex}>
            <button
              className={`${styles.item} ${i === selectedIndex ? styles.itemSelected : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
              onMouseEnter={() => {
                // Mouse move can update selectedIndex — handled by parent
              }}
              type="button"
            >
              <span className={styles.kindIcon} aria-hidden="true">
                <MentionIcon item={item} />
                {item.kind === 'agent' && (
                  <Circle
                    size={6}
                    fill="currentColor"
                    className={styles.statusDot}
                    style={{
                      color:
                        item.status === 'available'
                          ? 'var(--color-success)'
                          : 'var(--color-danger)',
                    }}
                  />
                )}
              </span>
              <span className={styles.info}>
                <span className={styles.name}>
                  <HighlightedName name={item.label} query={query} />
                </span>
                {item.description && (
                  <span className={styles.description}>{item.description}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
