import { useRef, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RefreshCw, Trash2, ArrowDown, FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench, ChevronRight } from 'lucide-react';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
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
const TOOL_ICON_MAP: Record<string, typeof FileText> = {
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderOpen,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  TodoWrite: CheckSquare,
};

function resolveToolIcon(toolName: string) {
  const Icon = TOOL_ICON_MAP[toolName] ?? Wrench;
  return <Icon size={14} />;
}

function AgentAvatarIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('claude-opus') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-haiku') ||
    normalized.includes('gpt') ||
    normalized.includes('glm') ||
    normalized.includes('qwen')
  ) {
    return <Bot size={16} />;
  }
  if (normalized.includes('claude code') || normalized === 'claude') return <ClaudeCode size={18} />;
  if (normalized.includes('codex')) return <Codex size={18} />;
  if (normalized.includes('opencode')) return <OpenCode size={18} />;
  return <Bot size={15} />;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.file_path === 'string') parts.push(input.file_path);
  else if (typeof input.path === 'string') parts.push(input.path);
  if (typeof input.command === 'string') parts.push(input.command.slice(0, 60));
  if (typeof input.description === 'string') parts.push(input.description.slice(0, 60));
  const str = parts.join(' ');
  return str.length > 40 ? str.slice(0, 40) + '...' : str;
}

// ── Concrete message time formatter ─────────
function formatMessageTime(timestamp: string, language: string): { short: string; exact: string } {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { short: '', exact: '' };

  const locale = language.startsWith('zh') ? 'zh-CN' : 'en-US';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const sameYear = date.getFullYear() === now.getFullYear();

  const shortOptions: Intl.DateTimeFormatOptions = sameDay
    ? { hour: 'numeric', minute: '2-digit', hour12: language.startsWith('zh') }
    : sameYear
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: language.startsWith('zh') }
      : { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: language.startsWith('zh') };

  return {
    short: new Intl.DateTimeFormat(locale, shortOptions).format(date),
    exact: new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: language.startsWith('zh'),
    }).format(date),
  };
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? path;
}

function summarizeRawDiff(diff?: string): { additions: number; deletions: number; preview: string[] } {
  if (!diff) return { additions: 0, deletions: 0, preview: [] };
  const lines = diff.split(/\r?\n/);
  let additions = 0;
  let deletions = 0;
  const preview: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
    if (preview.length < 18 && (/^[-+ ]/.test(line) || line.startsWith('@@'))) {
      preview.push(line);
    }
  }

  return { additions, deletions, preview };
}

// ── Status badge class resolver ──────────────
function toolStatusClass(status: string): string {
  switch (status) {
    case 'pending':
      return styles.toolStatusPending ?? '';
    case 'running':
      return styles.toolStatusRunning ?? '';
    case 'completed':
      return styles.toolStatusDone ?? '';
    case 'failed':
      return styles.toolStatusFailed ?? '';
    default:
      return '';
  }
}

// ── ThinkingBlock ───────────────────────────
function ThinkingBlock({ content, active }: { content: string; active?: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!active) return null;
  return (
    <div className={styles.thinking}>
      <button
        className={styles.thinkingToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span className={active ? styles.runningText : styles.settledText}>{t('chat.thinkingLabel')}</span>
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

function PendingThinking({ label }: { label: string }) {
  return (
    <div className={styles.pendingThinking}>
      <span className={styles.pendingThinkingLabel}>{label}</span>
    </div>
  );
}

// ── ToolUseBlock ────────────────────────────
function ToolUseBlock({ block }: { block: Extract<MessageBlock, { kind: 'tool_use' }> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const iconEl = resolveToolIcon(block.toolName);

  return (
    <div className={styles.toolUseContainer}>
      <button
        className={styles.toolUseHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.toolIcon}>{iconEl}</span>
        <span className={styles.toolName}>{block.toolName}</span>
        <span className={styles.toolParamSummary}>{summarizeInput(block.input)}</span>
        <span
          className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}
        >
          {t(`chat.toolStatus.${block.status}`, { defaultValue: block.status })}
        </span>
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
      </button>

      {expanded && (
        <div className={styles.toolUseBody}>
          <button className={styles.showParamsBtn} onClick={() => setShowParams((v) => !v)}>
            {showParams ? t('chat.hideParameters') : t('chat.showParameters')}
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
  const { t } = useTranslation();

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
          <span className={styles.exitCode}>{t('chat.exitCode', { code: result.exitCode })}</span>
        </div>
      );
    case 'generic_result':
      return <pre className={styles.toolOutput}>{result.output.slice(0, 10000)}</pre>;
    default:
      return null;
  }
}

function StatusRow({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.statusRow}>
      <button
        className={styles.statusRowHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span className={styles.statusRowLabel}>{label}</span>
        {meta && <span className={styles.statusRowMeta}>{meta}</span>}
      </button>
      {expanded && children && <div className={styles.statusRowBody}>{children}</div>}
    </div>
  );
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const diff = summarizeRawDiff(block.diff);
  const actionLabel = t(`chat.fileAction.${block.action}`, { defaultValue: block.action });
  const hasDiff = diff.preview.length > 0;

  return (
    <div className={styles.fileChange}>
      <button
        className={styles.fileChangeHeader}
        type="button"
        onClick={() => hasDiff && setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={t('chat.fileChangeToggle', { path: block.path })}
      >
        <Pencil size={15} className={styles.fileChangeIcon} />
        <span className={styles.fileChangeAction}>{actionLabel}</span>
        <code className={styles.fileChangePath} title={block.path}>{basename(block.path)}</code>
        {diff.additions > 0 && <span className={styles.fileChangeAdd}>+{diff.additions}</span>}
        {diff.deletions > 0 && <span className={styles.fileChangeDel}>-{diff.deletions}</span>}
        {hasDiff && (
          <ChevronRight
            size={15}
            className={styles.fileChangeChevron + (expanded ? ' ' + styles.fileChangeChevronOpen : '')}
          />
        )}
      </button>
      {expanded && hasDiff && (
        <pre className={styles.fileChangeDiff}>
          {diff.preview.join('\n')}
          {block.diff && block.diff.split(/\r?\n/).length > diff.preview.length ? '\n...' : ''}
        </pre>
      )}
    </div>
  );
}

// ── Main BlockRenderer ──────────────────────
function BlockRenderer({
  block,
  t,
  active,
}: {
  block: MessageBlock;
  t: (key: string, vars?: Record<string, unknown>) => string;
  active?: boolean;
}) {
  switch (block.kind) {
    case 'text':
      return <MarkdownRenderer content={block.content} />;

    case 'code':
      return <CodeBlock content={block.content} language={block.language} />;

    case 'thinking':
      return <ThinkingBlock content={block.content} active={active} />;

    case 'tool_use':
      return <ToolUseBlock block={block} />;

    case 'file_change':
      return <FileChangeBlock block={block} />;

    case 'session_init':
      return null;

    case 'result':
      if (block.success) return null;
      return <StatusRow label={t('chat.result.failed', { error: block.error ?? 'unknown error' })} meta="failed" />;

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
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // ── Virtualizer ──────────────────────────────
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index: number) => {
      const msg = messages[index];
      if (!msg) return 200;
      if (msg.role === 'system') return 80;
      if (msg.blocks.some((b) => b.kind === 'tool_use')) return 300;
      return 160;
    },
    overscan: 5,
    getItemKey: (index: number) => messages[index]?.id ?? index,
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

  const lastMsg = messages[messages.length - 1];
  const lastMessageId = lastMsg?.id ?? null;
  const lastMessageSignature = lastMsg
    ? `${lastMsg.id}:${lastMsg.blocks.map((block) => {
        if ('content' in block && typeof block.content === 'string') return block.content.length;
        if (block.kind === 'tool_use') return `${block.status}:${block.children?.length ?? 0}`;
        if (block.kind === 'result') return block.success ? 'success' : block.error ?? 'failed';
        return block.kind;
      }).join('|')}`
    : '';

  useEffect(() => {
    if (!lastMessageId || lastMessageIdRef.current === lastMessageId) return;
    lastMessageIdRef.current = lastMessageId;

    const frame = requestAnimationFrame(() => {
      scrollToBottom(true);
      requestAnimationFrame(() => scrollToBottom(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [lastMessageId, scrollToBottom]);

  useEffect(() => {
    if (!lastMessageSignature) return;
    const timers = [
      window.setTimeout(() => scrollToBottom(true), 0),
      window.setTimeout(() => scrollToBottom(true), 80),
      window.setTimeout(() => scrollToBottom(true), 220),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [lastMessageSignature, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let frame: number | null = null;
    const scheduleBottom = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        scrollToBottom(true);
        requestAnimationFrame(() => scrollToBottom(true));
      });
    };

    scheduleBottom();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleBottom);
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        window.removeEventListener('resize', scheduleBottom);
      };
    }

    const observer = new ResizeObserver(scheduleBottom);
    observer.observe(el);
    window.addEventListener('resize', scheduleBottom);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleBottom);
    };
  }, [scrollToBottom]);

  useEffect(() => {
    if (messages.length === 0) return;
    virtualizer.measure();
    const frame = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(frame);
  }, [messages.length, scrollToBottom, virtualizer]);

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

  const lastMsgHasText =
    lastMsg?.role === 'agent' && lastMsg.blocks.some((b) => b.kind === 'text');

  const renderMessage = useCallback(
    (msg: ChatMessage) => {
      const messageTime = formatMessageTime(msg.timestamp, i18n.language);
      return (
        <div
          className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : msg.role === 'system' ? styles.systemMsg : styles.agentMsg}`}
        >
          {msg.role === 'agent' && msg.agentName && (
            <div className={styles.agentAvatar}>
              <div className={styles.avatarCircle}>
                <AgentAvatarIcon name={msg.agentName} />
              </div>
              <span className={styles.agentNameLabel}>{msg.agentName}</span>
            </div>
          )}

          {msg.blocks.map((block, i) => {
            if (block.kind === 'text' && isStreaming && msg.id === lastMsg?.id) {
              return <StreamingTextBlock key={i} content={block.content} isStreaming={true} />;
            }
            return (
              <BlockRenderer
                key={i}
                block={block}
                t={t}
                active={Boolean(isStreaming && msg.id === lastMsg?.id)}
              />
            );
          })}

          {msg.role !== 'user' && (
            <div className={styles.messageFooter}>
              <div className={styles.actionBar}>
                <button
                  className={styles.actionBtn}
                  title={t('chat.copy')}
                  aria-label={t('chat.copy')}
                  onClick={() => handleCopy(msg)}
                >
                  <Copy size={14} />
                </button>
                {onRetry && (
                  <button
                    className={styles.actionBtn}
                    title={t('chat.retry')}
                    aria-label={t('chat.retry')}
                    onClick={() => onRetry(msg.id)}
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    className={styles.actionBtn}
                    title={t('chat.delete')}
                    aria-label={t('chat.delete')}
                    onClick={() => onDelete(msg.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <span
                className={styles.timestamp}
                title={messageTime.exact}
                aria-label={messageTime.exact}
              >
                {messageTime.short}
              </span>
            </div>
          )}
          {copiedMessageId === msg.id && (
            <span className={styles.copyToast}>{t('chat.copied')}</span>
          )}
        </div>
      );
    },
    [t, i18n.language, isStreaming, lastMsg?.id, copiedMessageId, handleCopy, onRetry, onDelete],
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
            title={t('chat.emptyTitle')}
            description={t('chat.emptyDescription')}
            suggestions={[
              { label: t('chat.suggestion.newTask'), onClick: () => {} },
              { label: t('chat.suggestion.explainCode'), onClick: () => {} },
              { label: t('chat.suggestion.fixBugs'), onClick: () => {} },
            ]}
          />
        ) : (
          <div className={styles.virtualContent} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              if (!msg) return null;
              const isLast = virtualRow.index === messages.length - 1;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={`${styles.virtualItem} ${msg.role === 'user' ? styles.virtualItemUser : ''}`}
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
            <PendingThinking label={t('chat.thinkingLabel')} />
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
