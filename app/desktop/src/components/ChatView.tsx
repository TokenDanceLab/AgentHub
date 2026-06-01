import { useRef, useState, useCallback, useEffect, useLayoutEffect, memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw, Trash2, ArrowDown, FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench, ChevronRight, Route, GitFork, Gauge } from 'lucide-react';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import { formatTokens, formatCost } from '@shared/context/breakdown';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff } from './ChatView.types';
import MarkdownRenderer from './MarkdownRenderer';
import CodeBlock from './CodeBlock';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import ToolTimeline from './ToolTimeline';
import TeamRunDock from './TeamRunDock';
import { useStreamingText } from '@/hooks/useStreamingText';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useToastStore } from '@/stores/toastStore';
import type { AgentTeamOverview } from '@/api/agentTeamQueries';
import type { LocalOrchestrationStatus } from '@/utils/localOrchestration';
import type { TeamLocalExecution } from '@/utils/teamLocalExecution';
import styles from './ChatView.module.css';

export type { ChatMessage, MessageBlock };

interface Props {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onRetry?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  agentTeamOverview?: AgentTeamOverview;
  agentTeamsLoading?: boolean;
  agentTeamsSignedIn?: boolean;
  teamLocalExecutions?: TeamLocalExecution[];
  localOrchestration?: LocalOrchestrationStatus;
  onStartLocalOrchestration?: (agentId: string, draft: string) => void;
  onOpenTeamRuns?: () => void;
}

const LONG_AGENT_TEXT_MAX_LINES = 24;
const LONG_AGENT_TEXT_PREVIEW_LINES = 18;
const LONG_AGENT_TEXT_MAX_CHARS = 2200;
const LONG_AGENT_TEXT_PREVIEW_CHARS = 1800;

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

function DecorativeAgentIcon({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll('title').forEach((node) => node.remove());
  });

  return (
    <span ref={ref} className={styles.decorativeAgentIcon} aria-hidden="true">
      {children}
    </span>
  );
}

function AgentAvatarIcon({ name }: { name: string }) {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('claude code') ||
    normalized === 'claude' ||
    normalized.includes('claude-opus') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-haiku')
  ) {
    return <DecorativeAgentIcon><ClaudeCode size={18} /></DecorativeAgentIcon>;
  }
  if (normalized.includes('codex')) return <DecorativeAgentIcon><Codex size={18} /></DecorativeAgentIcon>;
  if (normalized.includes('opencode') || normalized.includes('open-code')) return <DecorativeAgentIcon><OpenCode size={18} /></DecorativeAgentIcon>;
  if (
    normalized.includes('gpt') ||
    normalized.includes('glm') ||
    normalized.includes('qwen')
  ) {
    return <DecorativeAgentIcon><Bot size={16} /></DecorativeAgentIcon>;
  }
  return <DecorativeAgentIcon><Bot size={15} /></DecorativeAgentIcon>;
}

function agentDisplayName(name: string): string {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('claude code') ||
    normalized === 'claude' ||
    normalized.includes('claude-opus') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-haiku')
  ) {
    return 'Claude Code';
  }
  if (normalized.includes('codex')) return 'Codex';
  if (normalized.includes('opencode') || normalized.includes('open-code')) return 'OpenCode';
  if (normalized.includes('tokendance')) return 'TokenDance';
  return name;
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
  return (
    <div className={styles.thinking}>
      <button
        className={styles.thinkingToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span className={active ? styles.runningText : styles.settledText}>
          {active ? t('chat.thinkingLabel') : t('chat.thinkingSettledLabel')}
        </span>
      </button>
      {expanded && <div className={styles.thinkingContent}>{content}</div>}
    </div>
  );
}

function PendingThinking({ label }: { label: string }) {
  return (
    <div className={styles.pendingThinking}>
      <span className={styles.pendingThinkingLabel}>{label}</span>
    </div>
  );
}

function previewAgentText(content: string): { preview: string; hiddenLines: number; hiddenChars: number } | null {
  const lines = content.split(/\r?\n/);
  const tooManyLines = lines.length > LONG_AGENT_TEXT_MAX_LINES;
  const tooManyChars = content.length > LONG_AGENT_TEXT_MAX_CHARS;
  if (!tooManyLines && !tooManyChars) return null;

  let preview = tooManyLines
    ? lines.slice(0, LONG_AGENT_TEXT_PREVIEW_LINES).join('\n')
    : content.slice(0, LONG_AGENT_TEXT_PREVIEW_CHARS);
  if (preview.length > LONG_AGENT_TEXT_PREVIEW_CHARS) {
    preview = preview.slice(0, LONG_AGENT_TEXT_PREVIEW_CHARS);
  }
  preview = preview.trimEnd();

  const hiddenLines = Math.max(0, lines.length - preview.split(/\r?\n/).length);
  const hiddenChars = Math.max(0, content.length - preview.length);
  return { preview, hiddenLines, hiddenChars };
}

function previewInlineText(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function AgentTextBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const { t } = useTranslation();
  const displayed = useStreamingText(content, Boolean(isStreaming));
  const [expanded, setExpanded] = useState(false);
  const collapsed = previewAgentText(displayed);

  if (!collapsed || expanded) {
    return (
      <div className={styles.longTextBlock}>
        <MarkdownRenderer content={displayed} />
        {collapsed && (
          <button
            type="button"
            className={styles.longTextToggle}
            onClick={() => setExpanded(false)}
            aria-label={t('chat.collapseOutput')}
          >
            {t('chat.collapseOutput')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.longTextBlock}>
      <MarkdownRenderer content={collapsed.preview} />
      <button
        type="button"
        className={styles.longTextToggle}
        onClick={() => setExpanded(true)}
        aria-label={t('chat.showFullOutput')}
      >
        {t('chat.showFullOutput', {
          lines: collapsed.hiddenLines,
          chars: collapsed.hiddenChars,
        })}
      </button>
    </div>
  );
}

interface ParsedAttachmentSummary {
  name: string;
  source?: string;
  size?: string;
}

function parseUserAttachmentContext(content: string): { text: string; attachments: ParsedAttachmentSummary[] } | null {
  const match = content.match(/\n\s*Attached files:\s*/i);
  if (!match || match.index == null) return null;

  const text = content.slice(0, match.index).trim();
  const context = content.slice(match.index + match[0].length);
  const attachments: ParsedAttachmentSummary[] = [];
  let current: ParsedAttachmentSummary | null = null;

  for (const rawLine of context.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const itemMatch = line.match(/^\d+\.\s+(.+)$/);
    if (itemMatch) {
      const name = itemMatch[1]?.trim();
      if (!name) continue;
      current = { name };
      attachments.push(current);
      continue;
    }

    if (!current) continue;
    const fieldMatch = line.match(/^(Source|Size):\s*(.+)$/i);
    if (!fieldMatch) continue;
    const key = fieldMatch[1]?.toLowerCase();
    const value = fieldMatch[2]?.trim();
    if (!key || !value) continue;
    if (key === 'source') current.source = value;
    if (key === 'size') current.size = value;
  }

  return attachments.length > 0 ? { text, attachments } : null;
}

function UserTextBlock({ content }: { content: string }) {
  const { t } = useTranslation();
  const parsed = parseUserAttachmentContext(content);
  if (!parsed) return <MarkdownRenderer content={content} />;

  return (
    <>
      {parsed.text && <MarkdownRenderer content={parsed.text} />}
      <div
        className={styles.userAttachmentList}
        aria-label={t('chat.attachmentsLabel', { count: parsed.attachments.length })}
      >
        {parsed.attachments.map((attachment, index) => (
          <div key={`${attachment.name}-${index}`} className={styles.userAttachmentChip}>
            <FileText size={13} />
            <span className={styles.userAttachmentName}>{attachment.name}</span>
            {(attachment.source || attachment.size) && (
              <span className={styles.userAttachmentMeta}>
                {[attachment.source, attachment.size].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
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

type ContextUsageBlockType = Extract<MessageBlock, { kind: 'context_usage' }>;

function isDetailedContextUsage(block: ContextUsageBlockType): boolean {
  return block.variant === 'warning' || block.variant === 'compaction';
}

function usagePercentFrom(block: ContextUsageBlockType): number | undefined {
  if (block.usagePercent != null) return block.usagePercent;
  if (block.contextLimit && block.total != null && block.contextLimit > 0) {
    return Math.max(0, Math.min(100, (block.total / block.contextLimit) * 100));
  }
  return undefined;
}

function formatTokenUsageFooter(
  msg: ChatMessage,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
  let stats: { input?: number; output?: number; total?: number } | null = null;

  for (const block of msg.blocks) {
    if (block.kind === 'result' && block.success && block.tokenUsage) {
      stats = {
        input: block.tokenUsage.input,
        output: block.tokenUsage.output,
        total: block.tokenUsage.input + block.tokenUsage.output,
      };
    }
    if (block.kind === 'context_usage' && !isDetailedContextUsage(block)) {
      const total = block.total ?? (
        block.input != null || block.output != null ? (block.input ?? 0) + (block.output ?? 0) : undefined
      );
      stats = {
        input: block.input,
        output: block.output,
        total,
      };
    }
  }

  if (!stats) return null;
  const parts: string[] = [];
  if (stats.input != null) parts.push(`${t('chat.tokenUsageInput')} ${formatTokens(stats.input)}`);
  if (stats.output != null) parts.push(`${t('chat.tokenUsageOutput')} ${formatTokens(stats.output)}`);
  if (stats.total != null) parts.push(`${t('chat.tokenUsageTotal')} ${formatTokens(stats.total)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ContextUsageInline({ block }: { block: ContextUsageBlockType }) {
  const { t } = useTranslation();
  const usagePercent = usagePercentFrom(block);
  const total = block.total ?? (
    block.input != null || block.output != null ? (block.input ?? 0) + (block.output ?? 0) : undefined
  );
  const title = block.variant === 'warning'
      ? t('chat.contextWarning')
      : block.variant === 'compaction'
        ? t('chat.contextCompaction')
        : t('chat.contextUsage');
  const modelLabel = [block.provider, block.model].filter(Boolean).join(' / ');
  const usageStyle = usagePercent != null
    ? { '--usage-percent': `${Math.max(0, Math.min(100, usagePercent))}%` } as CSSProperties
    : undefined;

  const stats: Array<[string, string]> = [];
  if (block.input != null) stats.push([t('chat.tokenUsageInput'), formatTokens(block.input)]);
  if (block.output != null) stats.push([t('chat.tokenUsageOutput'), formatTokens(block.output)]);
  if (total != null) stats.push([t('chat.tokenUsageTotal'), formatTokens(total)]);
  if (block.remaining != null) stats.push([t('chat.contextRemaining'), formatTokens(block.remaining)]);
  if (block.contextLimit != null) stats.push([t('chat.contextLimit'), formatTokens(block.contextLimit)]);
  if (block.totalCost != null) stats.push([t('chat.tokenUsageCost'), formatCost(block.totalCost)]);
  const summary = stats.map(([label, value]) => `${label} ${value}`).join(' · ');

  const rootClass = [
    styles.contextUsageStrip,
    styles.contextUsageDetailed,
    block.variant === 'warning' ? styles.contextUsageWarning : '',
    block.variant === 'compaction' ? styles.contextUsageCompaction : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass} data-testid="context-usage-strip" title={[summary, modelLabel].filter(Boolean).join(' · ') || undefined}>
      <div className={styles.contextUsageHeader}>
        <span className={styles.contextUsageIcon} aria-hidden="true"><Gauge size={14} /></span>
        <span className={styles.contextUsageTitle}>{title}</span>
        {usagePercent != null ? (
          <span className={styles.contextUsagePercent}>{Math.round(usagePercent)}%</span>
        ) : null}
        {block.threshold != null ? (
          <span className={styles.contextUsageThreshold}>
            {t('chat.contextThreshold', { percent: Math.round(block.threshold) })}
          </span>
        ) : null}
      </div>
      {usagePercent != null ? (
        <div className={styles.contextUsageBar} style={usageStyle} aria-hidden="true" />
      ) : null}
      {stats.length > 0 ? (
        <div className={styles.contextUsageStats}>
          {stats.map(([label, value]) => (
            <span key={label} className={styles.contextUsageStat}>
              <span>{label}</span>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {modelLabel ? <div className={styles.contextUsageModel}>{modelLabel}</div> : null}
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

  const handleReviewChanges = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('agenthub:review-changes', {
        detail: { path: block.path, action: block.action, diff: block.diff },
      }),
    );
  };

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
      {hasDiff && (
        <button
          className={styles.reviewChangesBtn}
          type="button"
          onClick={handleReviewChanges}
        >
          {t('chat.reviewChanges')}
        </button>
      )}
      {expanded && hasDiff && (
        <pre className={styles.fileChangeDiff}>
          {diff.preview.join('\n')}
          {block.diff && block.diff.split(/\r?\n/).length > diff.preview.length ? '\n...' : ''}
        </pre>
      )}
    </div>
  );
}

function AgentTaskBlock({ block }: { block: Extract<MessageBlock, { kind: 'agent_task' }> }) {
  const { t } = useTranslation();
  const title = block.title.trim() || block.taskId;
  return (
    <div className={styles.agentTaskBlock} data-testid="subagent-task-card">
      <div className={styles.agentTaskHeader}>
        <span className={styles.agentTaskIcon} aria-hidden="true"><Bot size={14} /></span>
        <span className={styles.agentTaskKind}>{t('chat.subagentTask')}</span>
        <strong>{title}</strong>
        <span className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}>
          {t(`chat.taskStatus.${block.status}`, { defaultValue: block.status })}
        </span>
      </div>
      {block.summary ? <p className={styles.agentTaskSummary}>{block.summary}</p> : null}
      <div className={styles.agentTaskMeta}>
        <code>{block.taskId}</code>
        {block.worker ? <span>{t('chat.subagentWorker')}: {block.worker}</span> : null}
      </div>
    </div>
  );
}

function formatDurationMs(durationMs?: number): string | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function ChildAgentBlock({ block }: { block: Extract<MessageBlock, { kind: 'child_agent' }> }) {
  const { t } = useTranslation();
  const title = block.title.trim() || block.childId;
  const detail = block.error || block.result;
  const duration = formatDurationMs(block.durationMs);

  return (
    <div className={styles.childAgentBlock} data-testid="child-agent-card">
      <div className={styles.childAgentHeader}>
        <span className={styles.childAgentIcon} aria-hidden="true"><GitFork size={14} /></span>
        <span className={styles.childAgentKind}>{t('chat.childAgent')}</span>
        {block.agentName ? <span className={styles.childAgentName}>{block.agentName}</span> : null}
        <strong>{title}</strong>
        <span className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}>
          {t(`chat.taskStatus.${block.status}`, { defaultValue: block.status })}
        </span>
      </div>
      {detail ? <p className={styles.childAgentSummary}>{detail}</p> : null}
      <div className={styles.childAgentMeta}>
        <code>{block.childId}</code>
        {block.childRunId ? <span>{t('chat.childAgentRun')}: {block.childRunId}</span> : null}
        {block.parentRunId ? <span>{t('chat.childAgentParent')}: {block.parentRunId}</span> : null}
        {duration ? <span>{duration}</span> : null}
      </div>
    </div>
  );
}

function RouteDecisionBlock({ block }: { block: Extract<MessageBlock, { kind: 'route_decision' }> }) {
  const { t } = useTranslation();
  const headline = block.instructions || block.summary || block.blockedReason || block.reasoning || block.action;
  return (
    <div className={styles.routeDecisionBlock} data-testid="route-decision-card">
      <div className={styles.routeDecisionHeader}>
        <span className={styles.routeDecisionIcon} aria-hidden="true"><Route size={14} /></span>
        <span className={styles.routeDecisionKind}>{t('chat.routeDecision')}</span>
        <em>{block.action}</em>
      </div>
      <p>{headline}</p>
      <div className={styles.routeDecisionMeta}>
        {block.nextWorker ? <span>{t('chat.routeNextWorker')}: {block.nextWorker}</span> : null}
        {block.blockedReason ? <span>{t('chat.routeBlocked')}: {block.blockedReason}</span> : null}
        {block.reasoning ? <span>{t('chat.routeReasoning')}: {previewInlineText(block.reasoning, 90)}</span> : null}
      </div>
    </div>
  );
}

// ── Stable block key generation ──────────────
function blockKey(block: MessageBlock, index: number): string {
  switch (block.kind) {
    case 'tool_use':
      return `tool-${block.callId}`;
    case 'text':
      return `text-${index}`;
    case 'thinking':
      return `thinking-${index}`;
    case 'code':
      return `code-${index}`;
    case 'result':
      return `result-${block.error ?? 'success'}-${index}`;
    case 'file_change':
      return `file-${block.path}-${block.action}-${index}`;
    case 'agent_task':
      return `task-${block.taskId}`;
    case 'child_agent':
      return `child-${block.childId}`;
    case 'route_decision':
      return `route-${block.action}-${index}`;
    case 'context_usage':
      return `context-${block.runId ?? index}`;
    case 'session_init':
      return `session-${block.model ?? index}`;
    case 'artifact':
      return `artifact-${block.artifactId}`;
    case 'deploy_card':
      return `deploy-${block.deployId ?? index}`;
    case 'link_card':
      return `link-${block.url}-${index}`;
    case 'approval':
      return `approval-${block.approvalId}`;
    case 'tool_group':
      return `toolgroup-${index}`;
    case 'error':
      return `error-${index}`;
    case 'citation':
      return `cite-${block.url ?? block.text ?? index}`;
    case 'compact':
      return `compact-${index}`;
    default:
      return `block-${index}`;
  }
}

// ── Main BlockRenderer ──────────────────────
const BlockRenderer = memo(function BlockRenderer({
  block,
  t,
  role,
  active,
}: {
  block: MessageBlock;
  t: (key: string, vars?: Record<string, unknown>) => string;
  role?: ChatMessage['role'];
  active?: boolean;
}) {
  switch (block.kind) {
    case 'text':
      if (role === 'user') return <UserTextBlock content={block.content} />;
      if (role === 'agent') return <AgentTextBlock content={block.content} isStreaming={active} />;
      return <MarkdownRenderer content={block.content} />;

    case 'code':
      return <CodeBlock content={block.content} language={block.language} />;

    case 'thinking':
      return <ThinkingBlock content={block.content} active={active} />;

    case 'tool_use':
      return <ToolUseBlock block={block} />;

    case 'file_change':
      return <FileChangeBlock block={block} />;

    case 'agent_task':
      return <AgentTaskBlock block={block} />;

    case 'child_agent':
      return <ChildAgentBlock block={block} />;

    case 'route_decision':
      return <RouteDecisionBlock block={block} />;

    case 'session_init':
      return null;

    case 'result':
      if (block.success) return null;
      return <StatusRow label={t('chat.result.failed', { error: block.error ?? 'unknown error' })} meta="failed" />;

    case 'context_usage':
      return isDetailedContextUsage(block) ? <ContextUsageInline block={block} /> : null;

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
        case 'agent_task':
          return `[subagent:${block.status}] ${block.title || block.taskId}${block.summary ? ` — ${block.summary}` : ''}`;
        case 'child_agent':
          return `[child:${block.status}] ${block.agentName ?? block.childId} ${block.title || block.childId}${block.result ? ` — ${block.result}` : ''}${block.error ? ` — ${block.error}` : ''}`;
        case 'route_decision':
          return `[route:${block.action}] ${block.instructions ?? block.summary ?? block.blockedReason ?? ''}`;
        case 'session_init':
          return `Session: ${block.model ?? 'unknown'}`;
        case 'result':
          return block.success
            ? `Result: success (tokens in=${block.tokenUsage?.input ?? '?'} out=${block.tokenUsage?.output ?? '?'})`
            : `Result: failed — ${block.error ?? 'unknown error'}`;
        case 'context_usage':
          return `Context usage: total=${block.total ?? '?'} input=${block.input ?? '?'} output=${block.output ?? '?'} percent=${block.usagePercent ?? '?'}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function hasVisibleBlock(block: MessageBlock): boolean {
  switch (block.kind) {
    case 'session_init':
      return false;
    case 'result':
      return !block.success;
    case 'context_usage':
      return isDetailedContextUsage(block);
    case 'text':
    case 'code':
    case 'thinking':
      return block.content.trim().length > 0;
    case 'tool_use':
    case 'file_change':
    case 'agent_task':
    case 'child_agent':
    case 'route_decision':
      return true;
    default:
      return false;
  }
}

function hasVisibleMessage(message: ChatMessage): boolean {
  return message.blocks.some(hasVisibleBlock);
}

// ── MessageCard (memoized message row) ───────
interface MessageCardProps {
  msg: ChatMessage;
  t: (key: string, vars?: Record<string, unknown>) => string;
  language: string;
  isStreaming: boolean;
  isLastMsg: boolean;
  isCopying: boolean;
  isDeleting: boolean;
  onCopy: (msg: ChatMessage) => void;
  onRetry?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  onDeleteClick?: (messageId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (messageId: string) => void;
}

function messageBlockSignature(blocks: ChatMessage['blocks']): string {
  return blocks.map((b) => {
    if (b.kind === 'tool_use') return `tool:${b.callId}:${b.status}:${b.children?.length ?? 0}`;
    if (b.kind === 'text') return `text:${b.content.length}`;
    if (b.kind === 'thinking') return `think:${b.content.length}`;
    if (b.kind === 'code') return `code:${b.content.length}`;
    if (b.kind === 'result') return `result:${b.success}:${b.tokenUsage?.input ?? 0}:${b.tokenUsage?.output ?? 0}`;
    if (b.kind === 'context_usage') return `ctx:${b.variant ?? ''}:${b.total ?? 0}:${b.usagePercent ?? 0}`;
    if (b.kind === 'file_change') return `file:${b.path}:${b.action}`;
    if (b.kind === 'agent_task') return `task:${b.taskId}:${b.status}`;
    if (b.kind === 'child_agent') return `child:${b.childId}:${b.status}`;
    if (b.kind === 'route_decision') return `route:${b.action}`;
    if (b.kind === 'artifact') return `artifact:${b.artifactId}`;
    if (b.kind === 'approval') return `approval:${b.approvalId}:${b.status}`;
    if (b.kind === 'tool_group') return `tgrp:${b.totalCount}`;
    return b.kind;
  }).join('|');
}

const MessageCard = memo(function MessageCard({
  msg,
  t,
  language,
  isStreaming,
  isLastMsg,
  isCopying,
  isDeleting,
  onCopy,
  onRetry,
  onFork,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
}: MessageCardProps) {
  const isActive = isStreaming && isLastMsg;
  const messageTime = formatMessageTime(msg.timestamp, language);
  const tokenUsageFooter = formatTokenUsageFooter(msg, t);

  return (
    <div
      className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : msg.role === 'system' ? styles.systemMsg : styles.agentMsg}`}
    >
      {msg.role === 'agent' && msg.agentName && (
        <div className={styles.agentAvatar} title={msg.agentName}>
          <div className={styles.avatarCircle}>
            <AgentAvatarIcon name={msg.agentName} />
          </div>
          <span className={styles.agentNameLabel}>{agentDisplayName(msg.agentName)}</span>
        </div>
      )}

      {msg.role === 'agent' ? <TaskList blocks={msg.blocks} /> : null}
      {msg.role === 'agent' ? <ToolTimeline blocks={msg.blocks} /> : null}

      {msg.blocks.map((block, i) => {
        return (
          <BlockRenderer
            key={blockKey(block, i)}
            block={block}
            t={t}
            role={msg.role}
            active={isActive}
          />
        );
      })}

      {msg.role !== 'user' && (
        <div className={`${styles.messageFooter} ${isDeleting ? styles.messageFooterActive : ''}`}>
          {isDeleting ? (
            <div className={styles.deleteConfirmBar} role="group" aria-label={t('chat.deleteConfirm')}>
              <span className={styles.deleteConfirmText}>{t('chat.deleteConfirmShort')}</span>
              <button
                type="button"
                className={styles.deleteCancelBtn}
                onClick={onCancelDelete}
              >
                {t('thread.cancel')}
              </button>
              <button
                type="button"
                className={styles.deleteConfirmBtn}
                onClick={() => onConfirmDelete(msg.id)}
              >
                {t('chat.deleteConfirmAction')}
              </button>
            </div>
          ) : (
            <div className={styles.actionBar}>
              <button
                className={styles.actionBtn}
                title={t('chat.copy')}
                aria-label={t('chat.copy')}
                onClick={() => onCopy(msg)}
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
              {onFork && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.fork')}
                  aria-label={t('chat.fork')}
                  onClick={() => onFork(msg.id)}
                >
                  <GitFork size={14} />
                </button>
              )}
              {onDeleteClick && (
                <button
                  className={styles.actionBtn}
                  title={t('chat.delete')}
                  aria-label={t('chat.delete')}
                  onClick={() => onDeleteClick(msg.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
          <span
            className={styles.timestamp}
            title={messageTime.exact}
            aria-label={messageTime.exact}
          >
            {messageTime.short}
          </span>
          {tokenUsageFooter ? (
            <span
              className={styles.messageTokenUsage}
              title={tokenUsageFooter}
              aria-label={tokenUsageFooter}
            >
              · {tokenUsageFooter}
            </span>
          ) : null}
        </div>
      )}
      {isCopying && (
        <span className={styles.copyToast}>{t('chat.copied')}</span>
      )}
    </div>
  );
}, (prev, next) => {
  // Always re-render the streaming last message (blocks change rapidly)
  if (next.isLastMsg && next.isStreaming) return false;
  // Transition from streaming to settled — re-render to finalize
  if (prev.isStreaming && !next.isStreaming && prev.isLastMsg) return false;

  // Message identity
  if (prev.msg.id !== next.msg.id) return false;

  // Visual state toggles
  if (prev.isCopying !== next.isCopying) return false;
  if (prev.isDeleting !== next.isDeleting) return false;

  // Block content signature
  if (messageBlockSignature(prev.msg.blocks) !== messageBlockSignature(next.msg.blocks)) return false;

  // Metadata
  if (prev.msg.timestamp !== next.msg.timestamp) return false;
  if (prev.msg.agentName !== next.msg.agentName) return false;
  if (prev.msg.role !== next.msg.role) return false;
  if (prev.language !== next.language) return false;

  return true;
});

// ── ChatView ────────────────────────────────
export default function ChatView({
  messages,
  isStreaming,
  onRetry,
  onFork,
  onDelete,
  agentTeamOverview,
  agentTeamsLoading,
  agentTeamsSignedIn,
  teamLocalExecutions,
  localOrchestration,
  onStartLocalOrchestration,
  onOpenTeamRuns,
}: Props) {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const visibleMessages = messages.filter(hasVisibleMessage);

  const { scrollToBottom, isNearBottom } = useAutoScroll(
    scrollRef,
    { messages: visibleMessages, isStreaming: isStreaming ?? false },
  );

  const lastMsg = visibleMessages[visibleMessages.length - 1];
  const lastMessageId = lastMsg?.id ?? null;
  const lastMessageSignature = lastMsg
    ? `${lastMsg.id}:${lastMsg.blocks.map((block) => {
        if ('content' in block && typeof block.content === 'string') return block.content.length;
        if (block.kind === 'tool_use') return `${block.status}:${block.children?.length ?? 0}`;
        if (block.kind === 'agent_task') return `${block.status}:${block.summary?.length ?? 0}`;
        if (block.kind === 'child_agent') return `${block.status}:${block.result?.length ?? 0}:${block.error?.length ?? 0}`;
        if (block.kind === 'result') return block.success ? 'success' : block.error ?? 'failed';
        if (block.kind === 'context_usage') return `${block.variant ?? 'usage'}:${block.total ?? ''}:${block.usagePercent ?? ''}`;
        return block.kind;
      }).join('|')}`
    : '';

  useEffect(() => {
    if (!lastMessageId || lastMessageIdRef.current === lastMessageId) return;
    lastMessageIdRef.current = lastMessageId;
    const force = lastMsg?.role === 'user';

    const frame = requestAnimationFrame(() => {
      scrollToBottom(force);
      requestAnimationFrame(() => scrollToBottom(force));
    });
    return () => cancelAnimationFrame(frame);
  }, [lastMessageId, lastMsg?.role, scrollToBottom]);

  useEffect(() => {
    if (!lastMessageSignature) return;
    const timers = [
      window.setTimeout(() => scrollToBottom(false), 0),
      window.setTimeout(() => scrollToBottom(false), 80),
      window.setTimeout(() => scrollToBottom(false), 220),
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
        scrollToBottom(false);
        requestAnimationFrame(() => scrollToBottom(false));
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

  const showScrollIndicator = isStreaming && !isNearBottom;

  useEffect(() => {
    if (!deletingMessageId) return;
    if (visibleMessages.some((message) => message.id === deletingMessageId)) return;
    setDeletingMessageId(null);
  }, [deletingMessageId, visibleMessages]);

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
        {(agentTeamsSignedIn || localOrchestration?.available || agentTeamsLoading) && (
          <TeamRunDock
            overview={agentTeamOverview}
            loading={agentTeamsLoading}
            signedIn={agentTeamsSignedIn}
            localExecutions={teamLocalExecutions}
            localOrchestration={localOrchestration}
            onStartLocalOrchestration={onStartLocalOrchestration}
            onOpenConsole={onOpenTeamRuns}
          />
        )}
        {visibleMessages.length === 0 ? (
          <EmptyState
            title={t('chat.emptyTitle')}
            description={t('chat.emptyDescription')}
          />
        ) : (
          <div className={styles.messageList}>
            {visibleMessages.map((msg) => (
              <div
                key={msg.id}
                data-message-id={msg.id}
                className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : ''}`}
              >
                <MessageCard
                  msg={msg}
                  t={t}
                  language={i18n.language}
                  isStreaming={isStreaming ?? false}
                  isLastMsg={msg.id === lastMsg?.id}
                  isCopying={copiedMessageId === msg.id}
                  isDeleting={deletingMessageId === msg.id}
                  onCopy={handleCopy}
                  onRetry={onRetry}
                  onFork={onFork}
                  onDeleteClick={onDelete ? setDeletingMessageId : undefined}
                  onCancelDelete={() => setDeletingMessageId(null)}
                  onConfirmDelete={(messageId: string) => {
                    onDelete?.(messageId);
                    setDeletingMessageId(null);
                  }}
                />
              </div>
            ))}
          </div>
        )}
        {isStreaming && !lastMsgHasText ? <PendingThinking label={t('chat.thinkingLabel')} /> : null}
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
