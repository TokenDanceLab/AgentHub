import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff } from './ChatView.types';
import MarkdownRenderer from './MarkdownRenderer';
import { useStreamingText } from '@/hooks/useStreamingText';
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
  Edit: '📝',
  Bash: '>_',
  Grep: '🔍',
  Glob: '📂',
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
  return str.length > 80 ? str.slice(0, 80) + '...' : str;
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
          className={`${styles.toolStatus} ${block.status === 'completed' ? styles.toolDone : block.status === 'running' ? styles.toolRunning : ''}`}
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
      return (
        <pre className={styles.codeBlock}>
          {block.language && <span className={styles.codeLang}>{block.language}</span>}
          <code>{block.content}</code>
        </pre>
      );

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleCopy = useCallback(async (msg: ChatMessage) => {
    const text = extractMessageText(msg);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      // clipboard write failed — silently ignore
    }
  }, []);

  const lastMsg = messages[messages.length - 1];

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.stream} role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>{t('chat.empty')}</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : msg.role === 'system' ? styles.systemMsg : styles.agentMsg}`}
            >
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
          ))
        )}
        {isStreaming && <div className={styles.cursor} />}
      </div>
    </div>
  );
}
