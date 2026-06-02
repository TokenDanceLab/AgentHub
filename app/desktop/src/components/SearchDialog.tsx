import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Bot, MessageSquareText } from 'lucide-react';
import { useSearchStore } from '@/stores/searchStore';
import { useShallow } from 'zustand/shallow';
import type { ChatMessage } from '@/components/ChatView.types';
import type { ThreadInfo } from '@shared/types';
import { matchesBinding, getBinding } from '@/utils/keyboardShortcuts';
import styles from './SearchDialog.module.css';

interface Props {
  messages: ChatMessage[];
  onSelect: (messageId: string) => void;
  threads?: ThreadInfo[];
  onSelectThread?: (thread: ThreadInfo) => void;
}

// ── Helpers ──────────────────────────────────

function extractText(msg: ChatMessage): string {
  return msg.blocks
    .map((b) => {
      if (b.kind === 'text' || b.kind === 'code') return b.content;
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

type UnifiedResult =
  | {
      kind: 'thread';
      id: string;
      title: string;
      snippet: string;
      timestamp: string;
      thread: ThreadInfo;
    }
  | {
      kind: 'message';
      id: string;
      title: string;
      snippet: string;
      timestamp: string;
      message: ChatMessage;
    };

function threadText(thread: ThreadInfo): string {
  return [thread.title, thread.threadId, thread.projectId].filter(Boolean).join(' ');
}

function threadSnippet(thread: ThreadInfo): string {
  return thread.threadId ? `Thread ${thread.threadId}` : '';
}

function messageTitle(message: ChatMessage): string {
  return message.role === 'user' ? 'User' : 'Agent';
}

// ── Component ────────────────────────────────

export default function SearchDialog({ messages, onSelect, threads = [], onSelectThread }: Props) {
  const { t } = useTranslation();
  const { open, query, selectedIndex, closeDialog, setQuery, setSelectedIndex } =
    useSearchStore(
      useShallow((s) => ({
        open: s.open,
        query: s.query,
        selectedIndex: s.selectedIndex,
        closeDialog: s.closeDialog,
        setQuery: s.setQuery,
        setSelectedIndex: s.setSelectedIndex,
      })),
    );
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K to open, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesBinding(e, getBinding('search'))) {
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
  const results: UnifiedResult[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const threadResults: UnifiedResult[] = threads
      .filter((thread) => threadText(thread).toLowerCase().includes(q))
      .map((thread) => ({
        kind: 'thread',
        id: thread.threadId,
        title: thread.title || thread.threadId,
        snippet: threadSnippet(thread),
        timestamp: thread.updatedAt || thread.createdAt,
        thread,
      }));
    const messageResults: UnifiedResult[] = messages
      .filter((msg) => extractText(msg).toLowerCase().includes(q))
      .map((msg) => ({
        kind: 'message',
        id: msg.id,
        title: messageTitle(msg),
        snippet: snippet(msg),
        timestamp: msg.timestamp,
        message: msg,
      }));
    return [...threadResults, ...messageResults];
  }, [messages, query, threads]);

  const selectResult = useCallback((result: UnifiedResult) => {
    closeDialog();
    if (result.kind === 'thread') {
      onSelectThread?.(result.thread);
      return;
    }
    onSelect(result.id);
  }, [closeDialog, onSelect, onSelectThread]);

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
        selectResult(results[selectedIndex]);
      }
    },
    [selectedIndex, results, setSelectedIndex, selectResult],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={closeDialog}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label={t('search.messages')}
            aria-controls="search-results"
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>
        {results.length > 0 && (
          <div id="search-results" className={styles.results} role="listbox" aria-label={t('search.results')}>
            {results.map((result, i) => (
              <div
                key={`${result.kind}:${result.id}`}
                role="option"
                aria-selected={i === selectedIndex}
                className={`${styles.item} ${i === selectedIndex ? styles.selected : ''}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => selectResult(result)}
              >
                <span className={styles.itemIcon}>
                  {result.kind === 'thread'
                    ? <MessageSquareText size={14} />
                    : result.message.role === 'user'
                      ? <User size={14} />
                      : <Bot size={14} />}
                </span>
                <div className={styles.itemContent}>
                  <span className={styles.itemTitle}>{result.title}</span>
                  <span className={styles.itemSnippet}>{result.snippet}</span>
                </div>
                <span className={styles.timestamp}>{formatTime(result.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
        {query && results.length === 0 && (
          <div className={styles.empty}>{t('search.empty')}</div>
        )}
      </div>
    </div>
  );
}
