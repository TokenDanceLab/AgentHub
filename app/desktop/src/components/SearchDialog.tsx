import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, User, Bot } from 'lucide-react';
import { useSearchStore } from '@/stores/searchStore';
import type { ChatMessage } from '@/components/ChatView.types';
import styles from './SearchDialog.module.css';

interface Props {
  messages: ChatMessage[];
  onSelect: (messageId: string) => void;
}

// ── Helpers ──────────────────────────────────

function extractText(msg: ChatMessage): string {
  return msg.blocks
    .map((b) => {
      if (b.kind === 'text' || b.kind === 'code' || b.kind === 'thinking') return b.content;
      if (b.kind === 'tool_use') return b.toolName;
      return '';
    })
    .join(' ');
}

function snippet(msg: ChatMessage, max = 80): string {
  const text = extractText(msg).trim();
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return '';
  }
}

interface ResultItem extends ChatMessage {
  _snippet: string;
}

// ── Component ────────────────────────────────

export default function SearchDialog({ messages, onSelect }: Props) {
  const { open, query, selectedIndex, closeDialog, setQuery, setSelectedIndex } =
    useSearchStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K to open, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        useSearchStore.getState().openDialog();
      }
      if (e.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeDialog]);

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Filter messages by query (case-insensitive)
  const results: ResultItem[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return messages
      .filter((msg) => extractText(msg).toLowerCase().includes(q))
      .map((msg) => ({ ...msg, _snippet: snippet(msg) }));
  }, [messages, query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        closeDialog();
        onSelect(results[selectedIndex].id);
      }
    },
    [selectedIndex, results, setSelectedIndex, closeDialog, onSelect],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={closeDialog}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            autoFocus
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>
        {results.length > 0 && (
          <div className={styles.results}>
            {results.map((msg, i) => (
              <div
                key={msg.id}
                className={`${styles.item} ${i === selectedIndex ? styles.selected : ''}`}
                onClick={() => {
                  closeDialog();
                  onSelect(msg.id);
                }}
              >
                <span className={styles.itemIcon}>
                  {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </span>
                <div className={styles.itemContent}>
                  <span className={styles.itemTitle}>
                    {msg.role === 'user' ? 'User' : 'Agent'}
                  </span>
                  <span className={styles.itemSnippet}>{msg._snippet}</span>
                </div>
                <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
        {query && results.length === 0 && (
          <div className={styles.empty}>No messages found</div>
        )}
      </div>
    </div>
  );
}
