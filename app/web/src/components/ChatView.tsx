import { useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RefreshCw, Trash2, ArrowDown, FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench } from 'lucide-react';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff } from './ChatView.types';
import MarkdownRenderer from './MarkdownRenderer';
import CodeBlock from './CodeBlock';
import { CodePreviewCard, DisclosureRow, EmptyState } from '@shared/ui';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useToastStore } from '@/stores/toastStore';
import { TextShimmer } from '@shared/ui';
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

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.file_path === 'string') parts.push(input.file_path);
  else if (typeof input.path === 'string') parts.push(input.path);
  if (typeof input.command === 'string') parts.push(input.command.slice(0, 60));
  if (typeof input.description === 'string') parts.push(input.description.slice(0, 60));
  const str = parts.join(' ');
  return str.length > 40 ? str.slice(0, 40) + '...' : str;
}

function localeFromLanguage(language: string | undefined): string {
  return language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

// ── Relative time formatter ──────────────────
function relativeTime(timestamp: string, t: TFunction, language: string | undefined): { relative: string; exact: string } {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const locale = localeFromLanguage(language);
  const exact = new Date(timestamp).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (minutes < 1) return { relative: t('time.justNow'), exact };
  if (minutes < 60) return { relative: t('time.minutesAgo', { count: minutes }), exact };
  if (hours < 24) return { relative: t('time.hoursAgo', { count: hours }), exact };
  if (days === 1) return { relative: t('time.yesterday'), exact };
  if (days < 7) return { relative: t('time.daysAgo', { count: days }), exact };

  const shortDate = new Date(timestamp).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
  return { relative: shortDate, exact };
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

function StatusRow({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <DisclosureRow
      className={styles.statusRow ?? ''}
      buttonClassName={styles.statusRowHeader ?? ''}
      chevronClassName={styles.chevron ?? ''}
      labelClassName={styles.statusRowLabel ?? ''}
      metaClassName={styles.statusRowMeta ?? ''}
      bodyClassName={styles.statusRowBody ?? ''}
      label={label}
      meta={meta}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {children}
    </DisclosureRow>
  );
}

// ── DiffCard ──────────────────────────────── (参考: Cline DiffEditRow + CCViewer DiffViewer)
function DiffCard({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  const totalLines = diff.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  const previewLines = diff.hunks
    .slice(0, 3)
    .flatMap((h) => h.lines)
    .slice(0, 15)
    .map((line) => `${line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '} ${line.content}`);
  const hiddenLineCount = Math.max(totalLines - previewLines.length, 0);

  return (
    <CodePreviewCard
      className={styles.diffCard ?? ''}
      headerClassName={styles.diffCardHeader ?? ''}
      titleClassName={styles.diffCardTitle ?? ''}
      metaClassName={styles.diffStats ?? ''}
      bodyClassName={styles.diffInline ?? ''}
      lineClassName={styles.diffLine ?? ''}
      actionsClassName={styles.diffActions ?? ''}
      title={diff.filePath}
      meta={`+${diff.additions} -${diff.deletions}`}
      code={[...previewLines, ...(hiddenLineCount > 0 ? [`... ${hiddenLineCount} more lines`] : [])].join('\n')}
      actions={(
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
      )}
    />
  );
}

// ── FileChangeBlock ─────────────────────────
function FileChangeBlock({ block }: { block: Extract<MessageBlock, { kind: 'file_change' }> }) {
  const { t } = useTranslation();
  return (
    <CodePreviewCard
      className={styles.fileCard ?? ''}
      headerClassName={styles.fileCardHeader ?? ''}
      titleClassName={styles.fileCardTitle ?? ''}
      metaClassName={styles.fileCardMeta ?? ''}
      bodyClassName={styles.diff ?? ''}
      title={block.path}
      meta={t(`chat.fileAction.${block.action}`)}
      code={block.diff?.slice(0, 5000) ?? t('chat.fileAction.noPreview')}
    />
  );
}

// ── Main BlockRenderer ──────────────────────
function BlockRenderer({
  block,
  t,
}: {
  block: MessageBlock;
  t: TFunction;
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
        <StatusRow
          label={t('chat.sessionInit', { model: block.model ?? 'unknown' })}
          meta={block.permissionMode ?? undefined}
        >
          {block.tools && block.tools.length > 0 && (
            <div className={styles.sessionMeta}>
              <span className={styles.sessionMetaLabel}>Tools:</span>
              {block.tools.map((tool: string) => (
                <span key={tool} className={styles.inlinePill}>{tool}</span>
              ))}
            </div>
          )}
        </StatusRow>
      );

    case 'result':
      return (
        <StatusRow
          label={block.success
            ? t('chat.result.success', {
                input: String(block.tokenUsage?.input ?? '?'),
                output: String(block.tokenUsage?.output ?? '?'),
              })
            : t('chat.result.failed', { error: block.error ?? 'unknown error' })}
          meta={block.success ? undefined : 'failed'}
        >
          {block.tokenUsage && (
            <div className={styles.tokenUsage}>
              <span>↑ {block.tokenUsage.input.toLocaleString()} tokens in</span>
              <span>↓ {block.tokenUsage.output.toLocaleString()} tokens out</span>
            </div>
          )}
        </StatusRow>
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
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
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
      const rt = relativeTime(msg.timestamp, t, i18n.resolvedLanguage || i18n.language);
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

          {msg.blocks.map((block, i) => {
            if (block.kind === 'text' && isStreaming && msg.id === lastMsg?.id) {
              return <StreamingTextBlock key={i} content={block.content} isStreaming={true} />;
            }
            return <BlockRenderer key={i} block={block} t={t} />;
          })}

          <div className={styles.messageFooter}>
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
                title={t('chat.action.copy')}
                aria-label={t('chat.action.copy')}
                onClick={() => handleCopy(msg)}
                type="button"
              >
                <Copy size={14} />
              </button>
              {onRetry && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.action.retry')}
                  aria-label={t('chat.action.retry')}
                  onClick={() => onRetry(msg.id)}
                  type="button"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              {onDelete && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.action.delete')}
                  aria-label={t('chat.action.delete')}
                  onClick={() => onDelete(msg.id)}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          {copiedMessageId === msg.id && (
            <span className={styles.copyToast}>{t('chat.action.copied')}</span>
          )}
        </div>
      );
    },
    [t, i18n.resolvedLanguage, i18n.language, isStreaming, lastMsg?.id, copiedMessageId, handleCopy, onRetry, onDelete],
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
          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative', flexShrink: 0 }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              if (!msg) return null;
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
            <TextShimmer label={t('chat.thinking')} bars={3} />
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
