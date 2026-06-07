import { useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RefreshCw, Trash2, ArrowDown, FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench, AlertTriangle, ExternalLink, RefreshCcw, Reply } from 'lucide-react';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff, ReplyTarget } from '@shared/types/chat';
import MarkdownRenderer from './MarkdownRenderer';
import CodeBlock from './CodeBlock';
import { CodePreviewCard, DisclosureRow, EmptyState, DeployCard, ArtifactPreview, LinkCard } from '@shared/ui';
import type { ArtifactType } from '@shared/ui';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useToastStore } from '@/stores/toastStore';
import { TextShimmer } from '@shared/ui';
import ApprovalCard from './ApprovalCard';
import styles from './ChatView.module.css';

export type { ChatMessage, MessageBlock, ReplyTarget };

interface Props {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  /** Called when user clicks Reply on a message */
  onReply?: (target: ReplyTarget) => void;
  /** Called when user clicks Regenerate on the last assistant message */
  onRegenerate?: (messageId: string) => void;
  /** If set, the message being replied to is highlighted */
  replyTo?: ReplyTarget | null;
  /** Called when user cancels reply mode */
  onCancelReply?: () => void;
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
  const [applyState, setApplyState] = useState<'idle' | 'applied' | 'error'>('idle');
  const totalLines = diff.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  const previewLines = diff.hunks
    .slice(0, 3)
    .flatMap((h) => h.lines)
    .slice(0, 15)
    .map((line) => `${line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '} ${line.content}`);
  const hiddenLineCount = Math.max(totalLines - previewLines.length, 0);

  const handleApplyDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (applyState === 'applied') return;
    try {
      window.dispatchEvent(
        new CustomEvent('agenthub:apply-diff', {
          detail: { filePath: diff.filePath, diff },
        }),
      );
      setApplyState('applied');
    } catch {
      setApplyState('error');
    }
  };

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
        <>
          <button
            className={`${styles.applyDiffBtn} ${applyState === 'applied' ? styles.applyDiffBtnDone : ''}`}
            onClick={handleApplyDiff}
            title={applyState === 'applied' ? t('diff.actions.diffApplied') : t('diff.actions.applyDiff')}
            aria-label={applyState === 'applied' ? t('diff.actions.diffApplied') : t('diff.actions.applyDiff')}
            type="button"
            disabled={applyState === 'applied'}
          >
            {applyState === 'applied' ? 'Applied' : t('diff.actions.applyDiff')}
          </button>
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
        </>
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

// ── ErrorBlock ──────────────────────────────
function ErrorBlock({ block }: { block: Extract<MessageBlock, { kind: 'error' }> }) {
  const { t } = useTranslation();
  const message = block.message || block.error || t('chat.error.unknown');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.errorBlock} data-testid="error-block">
      <div className={styles.errorBlockHeader}>
        <AlertTriangle size={16} className={styles.errorIcon} />
        <span className={styles.errorLabel}>{t('chat.error.title')}</span>
        <span className={styles.errorMessage}>{message}</span>
      </div>
      {block.detail && (
        <>
          <button
            className={styles.errorDetailToggle}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
            {expanded ? t('chat.error.hideDetail') : t('chat.error.showDetail')}
          </button>
          {expanded && <pre className={styles.errorDetail}>{block.detail}</pre>}
        </>
      )}
      {block.retryable && (
        <button
          className={styles.retryBtn}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('agenthub:retry', { detail: { errorBlock: block } }),
            )
          }
        >
          <RefreshCcw size={14} />
          <span>{t('chat.retry')}</span>
        </button>
      )}
    </div>
  );
}

// ── CitationBlock ───────────────────────────
function CitationBlock({ block }: { block: Extract<MessageBlock, { kind: 'citation' }> }) {
  const title = block.title || block.url || block.text?.slice(0, 80) || '';

  return (
    <div className={styles.citationBlock} data-testid="citation-block">
      <div className={styles.citationHeader}>
        <ExternalLink size={14} className={styles.citationIcon} />
        <span className={styles.citationTitle}>{title}</span>
      </div>
      {block.text && <p className={styles.citationPreview}>{block.text.slice(0, 200)}</p>}
      {block.url && (
        <a className={styles.citationLink} href={block.url} target="_blank" rel="noopener noreferrer">
          {block.url}
        </a>
      )}
    </div>
  );
}

// ── CompactBlock ────────────────────────────
function CompactBlock({ block }: { block: Extract<MessageBlock, { kind: 'compact' }> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(Boolean(block.expanded));

  return (
    <div className={styles.compactBlock} data-testid="compact-block">
      <button
        className={styles.compactToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span className={styles.compactSummary}>{block.summary}</span>
        {Array.isArray(block.items) && block.items.length > 0 && (
          <span className={styles.compactItemCount}>
            {t('chat.compact.itemCount', { count: block.items.length })}
          </span>
        )}
      </button>
      {expanded && Array.isArray(block.items) && block.items.length > 0 && (
        <div className={styles.compactBody}>
          {block.items.map((item, i) => (
            <BlockRenderer key={i} block={item} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ApprovalBlock ────────────────────────────
function ApprovalBlock({ block }: { block: Extract<MessageBlock, { kind: 'approval' }> }) {
  return (
    <ApprovalCard
      approvalId={block.approvalId}
      agentName={block.agentName ?? ''}
      toolName={block.toolName ?? ''}
      riskLevel={block.riskLevel ?? 'low'}
      status={block.status as 'pending' | 'approved' | 'denied' | 'timeout'}
      timestamp={block.timestamp ?? ''}
      reason={block.reason}
      decidedBy={block.decidedBy}
      decidedAt={block.decidedAt}
      teamId={block.teamId}
      runId={block.runId}
      agentTaskId={block.agentTaskId}
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

    case 'error':
      return <ErrorBlock block={block} />;

    case 'citation':
      return <CitationBlock block={block} />;

    case 'compact':
      return <CompactBlock block={block} />;

    case 'approval':
      return <ApprovalBlock block={block} />;

    case 'artifact': {
      const artifactUrl = block.artifactUrl ?? block.url ?? block.previewUrl ?? '';
      const artifactType: ArtifactType = (
        block.artifactType === 'iframe' ? 'iframe' :
        block.artifactType === 'page' ? 'page' :
        block.artifactType === 'image' ? 'image' :
        'file'
      );
      return (
        <ArtifactPreview
          artifactUrl={artifactUrl}
          artifactType={artifactType}
          title={block.title}
          inline
          onApplyDiff={block.canApplyDiff ? () => {} : undefined}
          diffApplied={block.diffApplied}
        />
      );
    }

    case 'deploy_card':
      return <DeployCard deployId={block.deployId} status={block.status} statusMessage={block.statusMessage} url={block.url} />;

    case 'link_card':
      return <LinkCard block={block} />;

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
        case 'error':
          return `[error] ${block.message || block.error || 'unknown error'}`;
        case 'citation':
          return `[citation] ${block.title || block.url || block.text?.slice(0, 80) || ''}`;
        case 'compact':
          return `[compact] ${block.summary}`;
        case 'deploy_card':
          return `[deploy:${block.status}] ${block.url ?? block.deployId ?? ''}${block.statusMessage ? ` — ${block.statusMessage}` : ''}`;
        case 'link_card':
          return `[link] ${block.title || block.url}${block.description ? ` — ${block.description}` : ''}`;
        case 'approval':
          return `[approval] ${block.toolName} (${block.riskLevel}) — ${block.status}`;
        case 'artifact':
          return `[artifact] ${block.title} (${block.artifactType})`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

// ── ChatView ────────────────────────────────
export default function ChatView({ messages, isStreaming, onRetry, onDelete, onReply, onRegenerate, replyTo }: Props) {
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
      if (msg.blocks.some((b) => b.kind === 'approval')) return 280;
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

  const generateReplyTarget = useCallback((msg: ChatMessage): ReplyTarget => {
    const preview = extractMessageText(msg).slice(0, 120);
    const author = msg.role === 'user' ? t('chat.sender.you') : (msg.agentName || t('chat.sender.agent'));
    return { messageId: msg.id, author, preview };
  }, [t]);

  const lastMsg = messages[messages.length - 1];
  const lastMsgHasText =
    lastMsg?.role === 'agent' && lastMsg.blocks.some((b) => b.kind === 'text');

  const isLastAssistantMsg = useCallback((msg: ChatMessage) => {
    if (msg.role !== 'agent') return false;
    const agentMsgs = messages.filter((m) => m.role === 'agent');
    if (agentMsgs.length === 0) return false;
    return agentMsgs[agentMsgs.length - 1]?.id === msg.id;
  }, [messages]);

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

          {replyTo && replyTo.messageId === msg.id && (
            <div className={styles.replyIndicator}>
              <Reply size={12} />
              <span>{t('chat.replyIndicator')}</span>
            </div>
          )}

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
              {onReply && msg.role !== 'system' && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.action.reply')}
                  aria-label={t('chat.action.reply')}
                  onClick={() => onReply(generateReplyTarget(msg))}
                  type="button"
                >
                  <Reply size={14} />
                </button>
              )}
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
              {onRegenerate && msg.role === 'agent' && isLastAssistantMsg(msg) && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.action.regenerate')}
                  aria-label={t('chat.action.regenerate')}
                  onClick={() => onRegenerate(msg.id)}
                  type="button"
                >
                  <RefreshCcw size={14} />
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
    [t, i18n.resolvedLanguage, i18n.language, isStreaming, lastMsg?.id, copiedMessageId, handleCopy, onRetry, onDelete, onReply, onRegenerate, replyTo, generateReplyTarget, isLastAssistantMsg],
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
