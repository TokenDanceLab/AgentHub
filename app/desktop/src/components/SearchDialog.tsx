import { useEffect, useRef, useCallback } from 'react';
import { Search, MessageSquare, Wrench, FileText, Hash } from 'lucide-react';
import { useSearchStore, type SearchResult } from '@/stores/searchStore';
import styles from './SearchDialog.module.css';

export default function SearchDialog() {
  const { open, query, results, selectedIndex, closeDialog, setQuery, setSelectedIndex } =
    useSearchStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K to open
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

  // Auto-focus input
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Simple client-side search (mock — will integrate with FTS5 later)
  useEffect(() => {
    if (!query.trim()) {
      useSearchStore.getState().setResults([]);
      return;
    }
    // TODO: Replace with Edge FTS5 query
    const mock: SearchResult[] = [
      {
        id: '1',
        type: 'thread',
        title: query,
        snippet: `Thread containing "${query}"`,
        threadId: 't1',
      },
    ];
    useSearchStore.getState().setResults(mock);
  }, [query]);

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
        // TODO: Navigate to result
        closeDialog();
      }
    },
    [selectedIndex, results, setSelectedIndex, closeDialog],
  );

  if (!open) return null;

  const icons: Record<SearchResult['type'], React.ReactNode> = {
    thread: <Hash size={14} />,
    message: <MessageSquare size={14} />,
    tool_call: <Wrench size={14} />,
    file: <FileText size={14} />,
  };

  return (
    <div className={styles.overlay} onClick={closeDialog}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads, messages, tools..."
            autoFocus
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>
        {results.length > 0 && (
          <div className={styles.results}>
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`${styles.item} ${i === selectedIndex ? styles.selected : ''}`}
              >
                <span className={styles.itemIcon}>{icons[r.type]}</span>
                <div className={styles.itemContent}>
                  <span className={styles.itemTitle}>{r.title}</span>
                  <span className={styles.itemSnippet}>{r.snippet}</span>
                </div>
                <span className={styles.itemType}>{r.type}</span>
              </div>
            ))}
          </div>
        )}
        {query && results.length === 0 && (
          <div className={styles.empty}>No results for "{query}"</div>
        )}
      </div>
    </div>
  );
}
