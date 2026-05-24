import { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RefreshCw, Trash2, ArrowDown, MessageSquare } from 'lucide-react';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff } from './ChatView.types';
import MarkdownRenderer from './MarkdownRenderer';
import CodeBlock from './CodeBlock';
import EmptyState from './EmptyState';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useToastStore } from '@/stores/toastStore';
import styles from './ChatView.module.css';

export type { ChatMessage, MessageBlock };

interface Props {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

// ── Tool icons ───────────────────────────────
const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  Bash: '⚡',
  Grep: '🔍',
  Glob: '📂',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Task: '🤖',
  TodoWrite: '✅',
};

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.file_path === 'string') parts.push(input.file_path);
  else if (typeof input.path === 'string') parts.push(input.path);
  if (typeof input.command === 'string') parts.push(input.command.slice(0, 60));
  if (typeof input.description === 'string') parts.push(input.description.slice(0, 60));
  const str = parts.join(' ');
  return str.length > 40 ? str.slice(0, 40) + '...' : str;
}

// ── Relative time formatter ──────────────────
function relativeTime(timestamp: string): { relative: string; exact: string } {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const exact = new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (minutes < 1) return { relative: 'Just now', exact };
  if (minutes < 60) return { relative: `${minutes} min ago`, exact };
  if (hours < 24) return { relative: `${hours}h ago`, exact };
  if (days === 1) return { relative: 'Yesterday', exact };
  if (days < 7) return { relative: `${days}d ago`, exact };

  const shortDate = new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return { relative: shortDate, exact };
}

// ── Status badge class resolver ──────────────
function toolStatusClass(status: string): string {
  switch (status) {
    case 'pending':
      return styles.toolStatusPending;
    case 'running':
      return styles.toolStatusRunning;
    case 'completed':
      return styles.toolStatusDone;
    case 'failed':
      return styles.toolStatusFailed;
    default:
      return '';
  }
}

// ── ThinkingBlock ───────────────────────────
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.thinking}>
      <button
        className={styles.thinkingToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span>Thinking</span>
        <span className={styles.thinkingLen}>({content.length} chars)</span>
      </button>
      {expanded && <div className={styles.thinkingContent}>{content}</div>}
    </div>
  );
}

// ── StreamingTextBlock ───────────────────────
function StreamingTextBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const displayed = useStreamingText(content, isStreaming);
  return <MarkdownRenderer content={displayed} />;
}

// ── ToolUseBlock ────────────────────────────
function ToolUseBlock({ block }: { block: Extract<MessageBlock, { kind: 'tool_use' }> }) {
  const [expanded, setExpanded] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const icon = TOOL_ICONS[block.toolName] ?? '🔧';

  return (
    <div className={styles.toolUseContainer}>
      <button
        className={styles.toolUseHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.toolIcon}>{icon}</span>
        <span className={styles.toolName}>{block.toolName}</span>
        <span className={styles.toolParamSummary}>{summarizeInput(block.input)}</span>
        <span
          className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}
        >
          {block.status}
        </span>
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
      </button>

      {expanded && (
        <div className={styles.toolUseBody}>
          <button className={styles.showParamsBtn} onClick={() => setShowParams((v) => !v)}>
            {showParams ? 'Hide parameters' : 'Show parameters'}
          </button>
          {showParams && (
            <pre className={styles.toolInput}>{JSON.stringify(block.input, null, 2)}</pre>
          )}
          {block.children?.map((child, i) => (
            <ToolResultRenderer key={i} result={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolResultRenderer({ result }: { result: ToolResultBlock }) {
  switch (result.kind) {
    case 'read_result':
      return (
        <div className={styles.readResult}>
          <code>{result.filePath}</code> — {result.lineCount} lines
        </div>
      );
    case 'write_result':
    case 'edit_result':
      return result.diff ? (
        <DiffCard diff={result.diff} />
      ) : (
        <div className={styles.readResult}>Changed: {result.filePath}</div>
      );
    case 'bash_result':
      return (
        <div className={styles.bashResult}>
          {result.stdout && <pre className={styles.toolOutput}>{result.stdout.slice(0, 5000)}</pre>}
          {result.stderr && (
            <pre className={`${styles.toolOutput} ${styles.toolStderr}`}>
              {result.stderr.slice(0, 2000)}
            </pre>
          )}
          <span className={styles.exitCode}>Exit: {result.exitCode}</span>
        </div>
      );
    case 'generic_result':
      return <pre className={styles.toolOutput}>{result.output.slice(0, 10000)}</pre>;
    default:
      return null;
  }
}

// ── DiffCard ──────────────────────────────── (参考: Cline DiffEditRow + CCViewer DiffViewer)
function DiffCard({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  const totalLines = diff.hunks.reduce((sum, h) => sum + h.lines.length, 0);

  return (
    <div className={styles.diffCard}>
      <div className={styles.diffCardHeader}>
        <code>{diff.filePath}</code>
        <span className={styles.diffAdded}>+{diff.additions}</span>
        <span className={styles.diffDeleted}>-{diff.deletions}</span>
        <button
          className={styles.viewFullDiff}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('agenthub:open-diff', { detail: { filePath: diff.filePath } }),
            )
          }
        >
          {t('chat.viewFullDiff')} →
        </button>
      </div>
      <div className={styles.diffInline}>
        {diff.hunks
          .slice(0, 3)
          .flatMap((h) => h.lines)
          .slice(0, 15)
          .map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'added'
                  ? styles.lineAdded
                  : line.type === 'deleted'
                    ? styles.lineDeleted
                    : styles.lineContext
              }
            >
              <span className={styles.linePrefix}>
                {line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '}
              </span>
              {line.content}
            </div>
          ))}
        {totalLines > 15 && (
          <div className={styles.diffTruncated}>... {totalLines - 15} more lines</div>
        )}
      </div>
    </div>
  );
}

// ── FileChangeBlock ─────────────────────────
function FileChangeBlock({ block }: { block: Extract<MessageBlock, { kind: 'file_change' }> }) {
  const actionClass =
    block.action === 'created'
      ? styles.added
      : block.action === 'deleted'
        ? styles.removed
        : styles.modified;
  return (
    <details className={`${styles.fileCard} ${actionClass}`}>
      <summary>
        {block.action} — <code>{block.path}</code>
      </summary>
      {block.diff && <pre className={styles.diff}>{block.diff.slice(0, 5000)}</pre>}
    </details>
  );
}

// ── Main BlockRenderer ──────────────────────
function BlockRenderer({
  block,
  t,
}: {
  block: MessageBlock;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  switch (block.kind) {
    case 'text':
      return <MarkdownRenderer content={block.content} />;

    case 'code':
      return <CodeBlock content={block.content} language={block.language} />;

    case 'thinking':
      return <ThinkingBlock content={block.content} />;

    case 'tool_use':
      return <ToolUseBlock block={block} />;

    case 'file_change':
      return <FileChangeBlock block={block} />;

    case 'session_init':
      return (
        <div className={styles.sessionInit}>
          {t('chat.sessionInit', { model: block.model ?? 'unknown' })}
          {block.permissionMode && <span className={styles.permBadge}>{block.permissionMode}</span>}
        </div>
      );

    case 'result':
      return (
        <div
          className={`${styles.result} ${block.success ? styles.resultSuccess : styles.resultFailed}`}
        >
          {block.success
            ? t('chat.result.success', {
                input: String(block.tokenUsage?.input ?? '?'),
                output: String(block.tokenUsage?.output ?? '?'),
              })
            : t('chat.result.failed', { error: block.error ?? 'unknown error' })}
        </div>
      );

    default:
      return null;
  }
}

// ── Message text extraction (for copy) ──────
function extractMessageText(msg: ChatMessage): string {
  return msg.blocks
    .map((block) => {
      switch (block.kind) {
        case 'text':
          return block.content;
        case 'code':
          return block.content;
        case 'thinking':
          return block.content;
        case 'tool_use':
          return `[${block.toolName}] ${summarizeInput(block.input)}`;
        case 'file_change':
          return `[${block.action}] ${block.path}`;
        case 'session_init':
          return `Session: ${block.model ?? 'unknown'}`;
        case 'result':
          return block.success
            ? `Result: success (tokens in=${block.tokenUsage?.input ?? '?'} out=${block.tokenUsage?.output ?? '?'})`
            : `Result: failed — ${block.error ?? 'unknown error'}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

// ── ChatView ────────────────────────────────
export default function ChatView({ messages, isStreaming, onRetry, onDelete }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // ── Virtualizer ──────────────────────────────
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 5,
    getItemKey: (index: number) => messages[index].id,
  });

  // Stable refs so the callback closure always sees latest values
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  const { scrollToBottom, isNearBottom } = useAutoScroll(
    scrollRef,
    { messages, isStreaming: isStreaming ?? false },
    {
      scrollToBottomFn: () => {
        const len = messagesRef.current.length;
        if (len > 0) {
          virtualizerRef.current.scrollToIndex(len - 1, { align: 'end' });
        }
      },
    },
  );

  const showScrollIndicator = isStreaming && !isNearBottom;

  const handleCopy = useCallback(async (msg: ChatMessage) => {
    const text = extractMessageText(msg);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(msg.id);
      addToast({ type: 'success', message: t('toast.copied') });
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, t]);

  const lastMsg = messages[messages.length - 1];
  const lastMsgHasText =
    lastMsg?.role === 'agent' && lastMsg.blocks.some((b) => b.kind === 'text');

  const renderMessage = useCallback(
    (msg: ChatMessage) => {
      const rt = relativeTime(msg.timestamp);
      return (
        <div
          className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : msg.role === 'system' ? styles.systemMsg : styles.agentMsg}`}
        >
          {msg.role === 'agent' && msg.agentName && (
            <div className={styles.agentAvatar}>
              <div className={styles.avatarCircle}>
                {msg.agentName.charAt(0).toUpperCase()}
              </div>
              <span className={styles.agentNameLabel}>{msg.agentName}</span>
            </div>
          )}

          <span
            className={styles.timestamp}
            title={rt.exact}
            aria-label={rt.exact}
          >
            {rt.relative}
          </span>

          <div className={styles.actionBar}>
            <button
              className={styles.actionBtn}
              title="Copy"
              onClick={() => handleCopy(msg)}
            >
              <Copy size={14} />
            </button>
            {onRetry && (
              <button
                className={styles.actionBtn}
                title="Retry"
                onClick={() => onRetry(msg.id)}
              >
                <RefreshCw size={14} />
              </button>
            )}
            {onDelete && (
              <button
                className={styles.actionBtn}
                title="Delete"
                onClick={() => onDelete(msg.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {copiedMessageId === msg.id && (
            <span className={styles.copyToast}>Copied!</span>
          )}
          {msg.blocks.map((block, i) => {
            if (block.kind === 'text' && isStreaming && msg.id === lastMsg?.id) {
              return <StreamingTextBlock key={i} content={block.content} isStreaming={true} />;
            }
            return <BlockRenderer key={i} block={block} t={t} />;
          })}
        </div>
      );
    },
    [t, isStreaming, lastMsg?.id, copiedMessageId, handleCopy, onRetry, onDelete],
  );

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  return (
    <div className={styles.root}>
      <div
        ref={scrollRef}
        className={styles.stream}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title={t('chat.emptyTitle')}
            description={t('chat.emptyDescription')}
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative', flexShrink: 0 }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              const isLast = virtualRow.index === messages.length - 1;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={styles.virtualItem}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: isLast ? 0 : undefined,
                  }}
                >
                  {renderMessage(msg)}
                </div>
              );
            })}
          </div>
        )}
        {isStreaming &&
          (lastMsgHasText ? (
            <div className={styles.streamProgress} />
          ) : (
            <div className={styles.typingDots}>
              <span />
              <span />
              <span />
            </div>
          ))}
      </div>

      {showScrollIndicator && (
        <button
          className={styles.scrollToBottomBtn}
          onClick={handleScrollToBottom}
          title={t('chat.scrollToBottom')}
          aria-label={t('chat.scrollToBottom')}
        >
          <ArrowDown size={16} />
          <span>{t('chat.newMessages')}</span>
        </button>
      )}
    </div>
  );
}
