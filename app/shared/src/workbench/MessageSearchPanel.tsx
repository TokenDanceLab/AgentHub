import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '../types/chat';
import type { TranscriptBlock } from '../transcript';
import { useFocusTrap } from '../ui/focusTrap';
import { Button } from '../ui/Button';
import { DesignNavIcon } from './designIcons';
import styles from './MessageSearchPanel.module.css';

const SEARCH_DEBOUNCE_MS = 300;

interface SearchResult {
  messageId: string;
  messageIndex: number;
  agentName?: string;
  timestamp: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

/** Searchable item extracted from either ChatMessage or TranscriptBlock. */
interface SearchableItem {
  id: string;
  agentName?: string;
  timestamp: string;
  text: string;
}

interface Props {
  messages?: ChatMessage[];
  transcriptBlocks?: TranscriptBlock[];
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
        case 'error': return block.message ?? '';
        case 'status': return block.content;
        default: return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

function extractTranscriptBlockText(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text': return [block.displayTitle, block.displayDetail, block.text].filter(Boolean).join(' ');
    case 'tool_call': return `${block.toolName} ${block.target ?? ''} ${block.summary ?? ''}`;
    case 'tool_result': return `${block.toolName} ${block.summary ?? ''}`;
    case 'artifact': return `${block.title} ${block.path ?? ''} ${block.artifactKind ?? ''}`;
    case 'preview': return `${block.previewId} ${block.url ?? ''}`;
    case 'file_change': return `${block.action} ${block.path}`;
    case 'diff': return `${block.title} ${block.files.join(' ')}`;
    case 'approval': return `${block.title} ${block.reason ?? ''}`;
    case 'permission_request': return `${block.title} ${block.reason ?? ''}`;
    case 'permission_result': return `${block.title} ${block.reason ?? ''}`;
    case 'thinking': return block.content ?? '';
    case 'subagent':
    case 'subtask': return `${block.title} ${block.summary ?? ''}`;
    case 'child_agent': return `${block.title} ${block.summary ?? ''}`;
    case 'route_decision': return `${block.action} ${block.summary ?? ''}`;
    case 'context_usage': return `${block.modelLabel ?? ''} token usage`;
    case 'result': return block.summary ?? '';
    case 'failure': return block.reason ?? block.title;
    case 'finished': return block.title;
    case 'agent_timeline': return block.title ?? '';
    case 'run_session': return `${block.title} ${block.runId ?? ''}`;
    case 'run_step_group': return block.title;
    case 'attachment': return block.contentType ?? '';
    case 'replay_gap': return '';
    default: return '';
  }
}

function toSearchableItems(messages?: ChatMessage[], transcriptBlocks?: TranscriptBlock[]): SearchableItem[] {
  if (transcriptBlocks && transcriptBlocks.length > 0) {
    return transcriptBlocks.map((block) => ({
      id: block.id,
      ...(block.author.role === 'agent' && block.author.name ? { agentName: block.author.name } : {}),
      timestamp: block.createdAt ?? '',
      text: extractTranscriptBlockText(block),
    }));
  }
  if (messages) {
    return messages.map((msg) => ({
      id: msg.id,
      ...(msg.agentName ? { agentName: msg.agentName } : {}),
      timestamp: msg.timestamp,
      text: extractMessageText(msg),
    }));
  }
  return [];
}

export function MessageSearchPanel({
  messages,
  transcriptBlocks,
  open,
  onClose,
  onJumpToMessage,
  highlightMessageId,
  onHighlightEnd,
  searchLabel,
  searchPlaceholder,
  noResultsLabel,
}: Props) {
  const [immediateQuery, setImmediateQuery] = useState('');
  const [query, setQuery] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useState<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panelRef, open);

  const searchableItems = useMemo(
    () => toSearchableItems(messages, transcriptBlocks),
    [messages, transcriptBlocks],
  );

  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef[1](el);
  }, []);

  useEffect(() => {
    if (open) {
      setImmediateQuery('');
      setQuery('');
      const timer = setTimeout(() => {
        const el = inputRef[0];
        el?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Debounce: sync immediateQuery → query after SEARCH_DEBOUNCE_MS of inactivity.
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setQuery(immediateQuery);
      debounceTimerRef.current = null;
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [immediateQuery]);

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

    for (let i = 0; i < searchableItems.length; i++) {
      const item = searchableItems[i];
      if (!item || !item.text) continue;
      const lowerText = item.text.toLowerCase();
      const idx = lowerText.indexOf(lowerQuery);
      if (idx === -1) continue;

      const snippetStart = Math.max(0, idx - 40);
      const snippetEnd = Math.min(item.text.length, idx + query.length + 40);
      const snippet = (snippetStart > 0 ? '...' : '') +
        item.text.slice(snippetStart, snippetEnd) +
        (snippetEnd < item.text.length ? '...' : '');

      items.push({
        messageId: item.id,
        messageIndex: i,
        ...(item.agentName != null && { agentName: item.agentName }),
        timestamp: item.timestamp,
        snippet,
        matchStart: idx - snippetStart + (snippetStart > 0 ? 3 : 0),
        matchEnd: idx - snippetStart + query.length + (snippetStart > 0 ? 3 : 0),
      });
    }

    return items;
  }, [searchableItems, query]);

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
      setImmediateQuery('');
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
      <div
        ref={panelRef}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.searchBar}>
          <DesignNavIcon
            className={styles.searchIcon}
            name="search"
            strokeWidth={2}
          />
          <input
            ref={setInputRef}
            className={styles.input}
            type="search"
            value={immediateQuery}
            onChange={(e) => setImmediateQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close search">
            <DesignNavIcon name="close" size={14} strokeWidth={2} />
          </Button>
        </div>

        <div className={styles.results}>
          {query.trim() === '' && (
            <div className={styles.hint}>{searchPlaceholder}</div>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <div className={styles.empty}>{noResultsLabel}</div>
          )}
          {results.map((result, idx) => (
            <button type="button"
              key={`${result.messageId}-${idx}`}
              className={`${styles.resultItem} ${highlightMessageId === result.messageId ? styles.resultItemHighlight : ''}`}
              onClick={() => handleResultClick(result)}
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

/*
  Migration bridge (Wave 10): keep a default export so out-of-scope consumers
  using `import MessageSearchPanel from './MessageSearchPanel'` keep compiling
  — currently workbench/ConversationHost.tsx and workbench/MessageSearchPanel.stories.tsx,
  both outside this lane's editable file set. The primary export is now the named
  `export function MessageSearchPanel` above. Remove this bridge once those
  consumers migrate to named imports.
*/
export default MessageSearchPanel;
