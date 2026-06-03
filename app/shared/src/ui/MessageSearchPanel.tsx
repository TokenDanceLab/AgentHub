import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ChatMessage } from './ChatView.types';
import styles from './MessageSearchPanel.module.css';

interface SearchResult {
  messageId: string;
  messageIndex: number;
  agentName?: string;
  timestamp: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

interface Props {
  messages: ChatMessage[];
  open: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string, messageIndex: number) => void;
  highlightMessageId?: string | null;
  onHighlightEnd?: () => void;
  searchLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
}

function extractMessageText(msg: ChatMessage): string {
  return msg.blocks
    .map((block) => {
      switch (block.kind) {
        case 'text': return block.content;
        case 'code': return block.content;
        case 'thinking': return block.content;
        case 'tool_use': return `${block.toolName} ${Object.values(block.input).join(' ')}`;
        case 'file_change': return `${block.action} ${block.path}`;
        case 'agent_task': return `${block.title} ${block.summary ?? ''}`;
        case 'child_agent': return `${block.title} ${block.result ?? ''} ${block.error ?? ''}`;
        case 'route_decision': return `${block.action} ${block.instructions ?? block.summary ?? ''} ${block.reasoning ?? ''}`;
        case 'error': return block.message;
        default: return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

export default function MessageSearchPanel({
  messages,
  open,
  onClose,
  onJumpToMessage,
  highlightMessageId,
  onHighlightEnd,
  searchLabel,
  searchPlaceholder,
  noResultsLabel,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useState<HTMLInputElement | null>(null);

  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef[1](el);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      const timer = setTimeout(() => {
        const el = inputRef[0];
        el?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = setTimeout(() => {
      onHighlightEnd?.();
    }, 2000);
    return () => clearTimeout(timer);
  }, [highlightMessageId, onHighlightEnd]);

  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    const items: SearchResult[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const text = extractMessageText(msg);
      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(lowerQuery);
      if (idx === -1) continue;

      const snippetStart = Math.max(0, idx - 40);
      const snippetEnd = Math.min(text.length, idx + query.length + 40);
      const snippet = (snippetStart > 0 ? '...' : '') +
        text.slice(snippetStart, snippetEnd) +
        (snippetEnd < text.length ? '...' : '');

      items.push({
        messageId: msg.id,
        messageIndex: i,
        agentName: msg.agentName,
        timestamp: msg.timestamp,
        snippet,
        matchStart: idx - snippetStart + (snippetStart > 0 ? 3 : 0),
        matchEnd: idx - snippetStart + query.length + (snippetStart > 0 ? 3 : 0),
      });
    }

    return items;
  }, [messages, query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      setQuery('');
      onJumpToMessage(result.messageId, result.messageIndex);
    },
    [onJumpToMessage],
  );

  const formatTs = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }, []);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.searchBar}>
          <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={setInputRef}
            className={styles.input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.results}>
          {query.trim() === '' && (
            <div className={styles.hint}>{searchPlaceholder}</div>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <div className={styles.empty}>{noResultsLabel}</div>
          )}
          {results.map((result, idx) => (
            <button
              key={`${result.messageId}-${idx}`}
              className={`${styles.resultItem} ${highlightMessageId === result.messageId ? styles.resultItemHighlight : ''}`}
              onClick={() => handleResultClick(result)}
              type="button"
            >
              <div className={styles.resultMeta}>
                {result.agentName && (
                  <span className={styles.resultAgent}>{result.agentName}</span>
                )}
                <span className={styles.resultTime}>{formatTs(result.timestamp)}</span>
              </div>
              <div className={styles.resultSnippet}>
                <span>{result.snippet.slice(0, result.matchStart)}</span>
                <mark className={styles.resultMark}>{result.snippet.slice(result.matchStart, result.matchEnd)}</mark>
                <span>{result.snippet.slice(result.matchEnd)}</span>
              </div>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <kbd>ESC</kbd> to close
        </div>
      </div>
    </div>
  );
}
