import { useEffect, useRef } from 'react';
import { Circle } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import styles from './MentionPopover.module.css';

interface Props {
  agents: AgentInfo[];
  isOpen: boolean;
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelect: (agent: AgentInfo) => void;
  onClose: () => void;
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

export default function MentionPopover({
  agents,
  isOpen,
  query,
  position,
  selectedIndex,
  onSelect,
  onClose,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);

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

  if (!isOpen || agents.length === 0) return null;

  return (
    <div
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
      role="listbox"
      aria-label="Agent suggestions"
    >
      <ul ref={listRef} className={styles.list}>
        {agents.map((agent, i) => (
          <li key={agent.id} role="option" aria-selected={i === selectedIndex}>
            <button
              className={`${styles.item} ${i === selectedIndex ? styles.itemSelected : ''}`}
              onClick={() => onSelect(agent)}
              onMouseEnter={() => {
                // Mouse move can update selectedIndex — handled by parent
              }}
              type="button"
            >
              <span className={styles.statusDot}>
                <Circle
                  size={8}
                  fill="currentColor"
                  style={{
                    color:
                      agent.status === 'available'
                        ? 'var(--color-success)'
                        : 'var(--color-danger)',
                  }}
                />
              </span>
              <span className={styles.info}>
                <span className={styles.name}>
                  <HighlightedName name={agent.name} query={query} />
                </span>
                {agent.description && (
                  <span className={styles.description}>{agent.description}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
