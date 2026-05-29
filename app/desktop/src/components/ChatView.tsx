<<<<<<< HEAD
import { useRef, useState, useCallback, useEffect, useLayoutEffect, Fragment, memo, useMemo, createContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, RefreshCw, Trash2, ArrowDown, FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench, ChevronRight, ChevronDown, Route, GitFork, Gauge, AlertTriangle, ExternalLink, RefreshCcw, Wifi, Key, Cpu, Clipboard, Check, X, Columns2, AlignJustify, Reply } from 'lucide-react';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';
import { formatTokens, formatCost } from '@shared/context/breakdown';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff, ReplyTarget } from './ChatView.types';
import MarkdownRenderer from './MarkdownRenderer';
import CodeBlock from './CodeBlock';
import { EmptyState } from '@shared/ui';
import TaskList from './TaskList';
import ApprovalCard from './ApprovalCard';
import DeployCard from './DeployCard';
import LinkCard from './LinkCard';
import ArtifactPreview from './ArtifactPreview';
import type { ArtifactType } from './ArtifactPreview';
import { ToolTimeline } from '@shared/ui/ToolTimeline';
=======
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
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
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
import { useStreamingText } from '@/hooks/useStreamingText';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useToastStore } from '@/stores/toastStore';
import styles from './ChatView.module.css';

export type { ChatMessage, MessageBlock, ReplyTarget };

interface Props {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onRetry?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  onRegenerate?: (messageId: string) => void;
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
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

<<<<<<< HEAD
// ── Tool call grouping (Kanna-style: collapse consecutive tool_use blocks) ──

const TOOL_CATEGORY_LABELS: Record<string, { singular: string; plural: string }> = {
  Read: { singular: 'read', plural: 'reads' },
  Write: { singular: 'write', plural: 'writes' },
  Edit: { singular: 'edit', plural: 'edits' },
  Bash: { singular: 'command', plural: 'commands' },
  Grep: { singular: 'search', plural: 'searches' },
  Glob: { singular: 'glob', plural: 'globs' },
  WebFetch: { singular: 'web fetch', plural: 'web fetches' },
  WebSearch: { singular: 'web search', plural: 'web searches' },
  Task: { singular: 'task', plural: 'tasks' },
  TodoWrite: { singular: 'todo update', plural: 'todo updates' },
};

function getToolCategoryLabel(toolName: string, count: number): string {
  const cat = TOOL_CATEGORY_LABELS[toolName];
  if (cat) return count === 1 ? cat.singular : cat.plural;
  return count === 1 ? 'tool call' : 'tool calls';
}

function groupToolBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const result: MessageBlock[] = [];
  let toolGroup: Extract<MessageBlock, { kind: 'tool_use' }>[] = [];

  for (const block of blocks) {
    if (block.kind === 'tool_use') {
      toolGroup.push(block);
    } else {
      flushToolGroup();
      result.push(block);
    }
  }
  flushToolGroup();
  return result;

  function flushToolGroup() {
    if (toolGroup.length < 2) {
      for (const tb of toolGroup) {
        result.push(tb);
      }
    } else {
      const toolCounts: Record<string, number> = {};
      for (const tb of toolGroup) {
        toolCounts[tb.toolName] = (toolCounts[tb.toolName] ?? 0) + 1;
      }
      result.push({
        kind: 'tool_group',
        items: toolGroup,
        collapsed: true,
        toolCounts,
        totalCount: toolGroup.length,
      });
    }
    toolGroup = [];
  }
}

function formatToolGroupLabel(toolCounts: Record<string, number>): string {
  return Object.entries(toolCounts)
    .map(([name, count]) => `${count} ${getToolCategoryLabel(name, count)}`)
    .join(', ');
}

// ── Shallow equality helper (for memo comparators) ──
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (objA[key] !== objB[key]) return false;
  }
  return true;
}

/** Memo comparator: shallow-equal on `block` prop, reference-equal on scalar props */
function blockMemoEqual(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const keysPrev = Object.keys(prev);
  const keysNext = Object.keys(next);
  if (keysPrev.length !== keysNext.length) return false;
  for (const key of keysPrev) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
    if (key === 'block') {
      if (!shallowEqual(prev[key], next[key])) return false;
    } else if (prev[key] !== next[key]) {
      return false;
    }
  }
  return true;
}

=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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

function shallowEqualRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
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
    if (preview.length < 2000 && (/^[-+ ]/.test(line) || line.startsWith('@@'))) {
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
    case 'draining':
      return styles.toolStatusDraining ?? '';
    case 'completed':
      return styles.toolStatusDone ?? '';
    case 'failed':
      return styles.toolStatusFailed ?? '';
    default:
      return '';
  }
}

// ── ThinkingBlock ───────────────────────────
const ThinkingBlock = memo(function ThinkingBlock({ content, active }: { content: string; active?: boolean }) {
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
});

<<<<<<< HEAD
const PendingThinking = memo(function PendingThinking({ label }: { label: string }) {
=======
function PendingThinking({ label }: { label: string }) {
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
  return (
    <div className={styles.pendingThinking}>
      <span className={styles.pendingThinkingLabel}>{label}</span>
    </div>
  );
});

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

<<<<<<< HEAD
=======
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

>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
function previewInlineText(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

<<<<<<< HEAD
const AgentTextBlock = memo(function AgentTextBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
=======
function AgentTextBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
});
=======
}
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

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

<<<<<<< HEAD
const UserTextBlock = memo(function UserTextBlock({ content }: { content: string }) {
=======
function UserTextBlock({ content }: { content: string }) {
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
});
=======
}
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

// ── ToolUseBlock ────────────────────────────

function toolUseBlockPropsEqual(
  prev: { block: Extract<MessageBlock, { kind: 'tool_use' }> },
  next: { block: Extract<MessageBlock, { kind: 'tool_use' }> },
): boolean {
  const pb = prev.block;
  const nb = next.block;
  return (
    pb.callId === nb.callId &&
    pb.toolName === nb.toolName &&
    pb.status === nb.status &&
    pb.children === nb.children &&
    shallowEqual(pb.input, nb.input)
  );
}

const ToolUseBlock = memo(function ToolUseBlock({ block }: { block: Extract<MessageBlock, { kind: 'tool_use' }> }) {
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
}, toolUseBlockPropsEqual);

// ── ToolGroupBlock ─────────────────────────── (Kanna-style collapsed tool group)
const ToolGroupDisplay = memo(function ToolGroupDisplay({
  block,
  isStreaming,
}: {
  block: Extract<MessageBlock, { kind: 'tool_group' }>;
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const label = formatToolGroupLabel(block.toolCounts);
  // Check if any tool in the group is still in progress
  const anyRunning = block.items.some(
    (tb) => tb.status === 'pending' || tb.status === 'running',
  );
  const showLoading = anyRunning && isStreaming;

  return (
    <div className={styles.toolGroupContainer}>
      <button
        className={styles.toolGroupHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={styles.toolGroupChevron + (expanded ? ' ' + styles.toolGroupChevronOpen : '')}
        />
        <span
          className={
            showLoading ? styles.toolGroupLabelActive : styles.toolGroupLabel
          }
        >
          {label}
        </span>
        <span className={styles.toolGroupCount}>
          ({block.totalCount} {t('chat.toolGroup.count', { count: block.totalCount, defaultValue: 'tools' })})
        </span>
      </button>
      {expanded && (
        <div className={styles.toolGroupBody}>
          {block.items.map((item, i) => (
            <ToolUseBlock key={item.callId || i} block={item} />
          ))}
          {block.items.length > 5 && (
            <button
              className={styles.toolGroupCollapseBtn}
              onClick={() => setExpanded(false)}
            >
              <ChevronRight size={12} className={styles.toolGroupChevron} />
              <span>{t('chat.toolGroup.collapse', { defaultValue: 'Collapse' })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const ToolResultRenderer = memo(function ToolResultRenderer({ result }: { result: ToolResultBlock }) {
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
});

const StatusRow = memo(function StatusRow({
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
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>{'>'}</span>
        <span className={styles.statusRowLabel}>{label}</span>
        {meta && <span className={styles.statusRowMeta}>{meta}</span>}
      </button>
      {expanded && children && <div className={styles.statusRowBody}>{children}</div>}
    </div>
  );
});

type ContextUsageBlockType = Extract<MessageBlock, { kind: 'context_usage' }>;

function isDetailedContextUsage(block: ContextUsageBlockType): boolean {
  return block.variant === 'warning' || block.variant === 'compaction';
}

<<<<<<< HEAD
=======
type ContextUsageBlockType = Extract<MessageBlock, { kind: 'context_usage' }>;

function isDetailedContextUsage(block: ContextUsageBlockType): boolean {
  return block.variant === 'warning' || block.variant === 'compaction';
}

>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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

<<<<<<< HEAD
const ContextUsageInline = memo(function ContextUsageInline({ block }: { block: ContextUsageBlockType }) {
=======
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
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
});

// ── DiffCard ──────────────────────────────── (参考: Kanna DiffEditRow + Cherry DiffViewer + OpenCode side-by-side)
type DiffViewMode = 'unified' | 'side-by-side';

const DiffCard = memo(function DiffCard({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const addToast = useToastStore((s) => s.addToast);

  const handleApply = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('agenthub:apply-diff', {
        detail: { filePath: diff.filePath, status: diff.status, hunks: diff.hunks },
      }),
    );
    addToast({ type: 'success', message: t('chat.diffApplied', { path: basename(diff.filePath), defaultValue: `Applied: ${basename(diff.filePath)}` }) });
  }, [diff.filePath, diff.status, diff.hunks, addToast, t]);

  const handleReject = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('agenthub:reject-diff', {
        detail: { filePath: diff.filePath },
      }),
    );
    addToast({ type: 'info', message: t('chat.diffRejected', { path: basename(diff.filePath), defaultValue: `Rejected: ${basename(diff.filePath)}` }) });
  }, [diff.filePath, addToast, t]);

  // Keyboard shortcuts: Ctrl+Y apply, Ctrl+N reject (Kanna-style)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleReject();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleApply, handleReject]);

  const handleOpenFullDiff = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('agenthub:open-diff', { detail: { filePath: diff.filePath } }),
    );
  }, [diff.filePath]);

  // Render a single line with optional line numbers
  const renderDiffLine = (line: typeof diff.hunks[number]['lines'][number], idx: number) => {
    const className =
      line.type === 'added'
        ? styles.lineAdded
        : line.type === 'deleted'
          ? styles.lineDeleted
          : styles.lineContext;
    return (
      <div key={idx} className={`${styles.diffUnifiedRow} ${className}`}>
        {line.oldLineNumber != null && (
          <span className={styles.diffLineNum}>{line.oldLineNumber}</span>
        )}
        {line.newLineNumber != null && line.oldLineNumber == null && (
          <span className={styles.diffLineNum} />
        )}
        <span className={styles.linePrefix}>
          {line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '}
        </span>
        <span>{line.content}</span>
      </div>
    );
  };

  // Build side-by-side rows from hunks
  const buildSideBySideRows = (): Array<{
    left: typeof diff.hunks[number]['lines'][number] | null;
    right: typeof diff.hunks[number]['lines'][number] | null;
  }> => {
    const rows: Array<{
      left: typeof diff.hunks[number]['lines'][number] | null;
      right: typeof diff.hunks[number]['lines'][number] | null;
    }> = [];
    for (const hunk of diff.hunks) {
      // Collect added and deleted lines per hunk for pairing
      const deleted: typeof hunk.lines[number][] = [];
      const added: typeof hunk.lines[number][] = [];
      const contextBuf: typeof hunk.lines[number][] = [];

      const flushContext = () => {
        for (const ctx of contextBuf) {
          rows.push({ left: ctx, right: ctx });
        }
        contextBuf.length = 0;
      };

      // Pair deleted/added lines; context lines occupy both sides
      let i = 0;
      while (i < hunk.lines.length) {
        const line = hunk.lines[i]!;
        if (line.type === 'context') {
          // Flush any pending deleted/added before context
          while (deleted.length > 0 || added.length > 0) {
            rows.push({
              left: deleted.shift() ?? null,
              right: added.shift() ?? null,
            });
          }
          contextBuf.push(line);
          i++;
        } else if (line.type === 'deleted') {
          flushContext();
          deleted.push(line);
          i++;
          // Look ahead for added lines to pair
          while (i < hunk.lines.length) {
            const nextLine = hunk.lines[i]!;
            if (nextLine.type !== 'added') break;
            added.push(nextLine);
            i++;
          }
          while (deleted.length > 0 || added.length > 0) {
            rows.push({
              left: deleted.shift() ?? null,
              right: added.shift() ?? null,
            });
          }
        } else if (line.type === 'added') {
          flushContext();
          added.push(line);
          i++;
          while (deleted.length > 0 || added.length > 0) {
            rows.push({
              left: deleted.shift() ?? null,
              right: added.shift() ?? null,
            });
          }
        }
      }
      flushContext();
      // Drain any remaining
      while (deleted.length > 0 || added.length > 0) {
        rows.push({
          left: deleted.shift() ?? null,
          right: added.shift() ?? null,
        });
      }
    }
    return rows;
  };

  return (
    <div className={styles.diffCard} data-testid="diff-card">
      <div className={styles.diffCardHeader}>
        <code className={styles.diffCardFilePath} title={diff.filePath}>
          {basename(diff.filePath)}
        </code>
        <span className={`${styles.diffStatBadge} ${styles.diffAdded}`}>
          +{diff.additions}
        </span>
        <span className={`${styles.diffStatBadge} ${styles.diffDeleted}`}>
          -{diff.deletions}
        </span>

        <div className={styles.diffCardActions}>
          {/* View mode toggle */}
          <button
            className={`${styles.diffViewToggle} ${viewMode === 'unified' ? styles.diffViewToggleActive : ''}`}
            onClick={() => setViewMode('unified')}
            title={t('chat.diffUnifiedView', { defaultValue: 'Unified view' })}
            aria-label={t('chat.diffUnifiedView', { defaultValue: 'Unified view' })}
            aria-pressed={viewMode === 'unified'}
          >
            <AlignJustify size={13} />
          </button>
          <button
            className={`${styles.diffViewToggle} ${viewMode === 'side-by-side' ? styles.diffViewToggleActive : ''}`}
            onClick={() => setViewMode('side-by-side')}
            title={t('chat.diffSideBySideView', { defaultValue: 'Side-by-side view' })}
            aria-label={t('chat.diffSideBySideView', { defaultValue: 'Side-by-side view' })}
            aria-pressed={viewMode === 'side-by-side'}
          >
            <Columns2 size={13} />
          </button>

          {/* Apply / Reject buttons */}
          <button
            className={`${styles.diffActionBtn} ${styles.diffApplyBtn}`}
            onClick={handleApply}
            title={t('chat.applyDiff', { defaultValue: 'Apply changes (Ctrl+Y)' })}
            aria-label={t('chat.applyDiff', { defaultValue: 'Apply changes' })}
          >
            <Check size={12} />
            <span className={styles.diffActionLabel}>{t('chat.apply', { defaultValue: 'Apply' })}</span>
          </button>
          <button
            className={`${styles.diffActionBtn} ${styles.diffRejectBtn}`}
            onClick={handleReject}
            title={t('chat.rejectDiff', { defaultValue: 'Reject changes (Ctrl+N)' })}
            aria-label={t('chat.rejectDiff', { defaultValue: 'Reject changes' })}
          >
            <X size={12} />
            <span className={styles.diffActionLabel}>{t('chat.reject', { defaultValue: 'Reject' })}</span>
          </button>

          {/* Open full diff viewer */}
          <button
            className={styles.viewFullDiff}
            onClick={handleOpenFullDiff}
            title={t('chat.viewFullDiff', { defaultValue: 'Open in diff viewer' })}
          >
            {t('chat.viewFullDiff')}
          </button>
        </div>
      </div>

      {/* Diff body — scrollable container, no cap */}
      {viewMode === 'unified' ? (
        <div className={`${styles.diffBody} ${styles.diffUnified}`}>
          {diff.hunks.map((hunk, hi) => (
            <Fragment key={hi}>  {/* eslint-disable-line react/jsx-no-useless-fragment */}
              <div className={styles.diffHunkHeader}>{hunk.header}</div>
              {hunk.lines.map((line, li) => renderDiffLine(line, li))}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className={`${styles.diffBody} ${styles.diffSideBySide}`}>
          <div className={styles.diffSideBySideCol}>
            <div className={styles.diffSideBySideHeader}>
              {t('chat.diffOld', { defaultValue: 'Old' })}
            </div>
            {buildSideBySideRows().map((row, ri) => (
              <div key={ri} className={styles.diffSideBySideRow}>
                <div
                  className={
                    row.left
                      ? `${styles.diffSideBySideCell} ${
                          row.left.type === 'deleted' ? styles.lineDeleted : styles.lineContext
                        }`
                      : styles.diffSideBySideGap
                  }
                >
                  {row.left?.content ?? ''}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.diffSideBySideCol}>
            <div className={styles.diffSideBySideHeader}>
              {t('chat.diffNew', { defaultValue: 'New' })}
            </div>
            {buildSideBySideRows().map((row, ri) => (
              <div key={ri} className={styles.diffSideBySideRow}>
                <div
                  className={
                    row.right
                      ? `${styles.diffSideBySideCell} ${
                          row.right.type === 'added' ? styles.lineAdded : styles.lineContext
                        }`
                      : styles.diffSideBySideGap
                  }
                >
                  {row.right?.content ?? ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ── FileChangeBlock ─────────────────────────
const FileChangeBlock = memo(function FileChangeBlock({ block }: { block: Extract<MessageBlock, { kind: 'file_change' }> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rawDiff = summarizeRawDiff(block.diff);
  const structuredDiff = block.structuredDiff;

  // Use structured diff stats when available, otherwise fall back to raw diff summary
  const additions = structuredDiff?.additions ?? rawDiff.additions;
  const deletions = structuredDiff?.deletions ?? rawDiff.deletions;
  const hasDiff = structuredDiff ? structuredDiff.hunks.length > 0 : rawDiff.preview.length > 0;

  const actionLabel = t(`chat.fileAction.${block.action}`, { defaultValue: block.action });

  const handleApply = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('agenthub:apply-diff', {
        detail: {
          filePath: block.path,
          action: block.action,
          rawDiff: block.diff,
          hunks: structuredDiff?.hunks,
        },
      }),
    );
  }, [block.path, block.action, block.diff, structuredDiff?.hunks]);

  const handleReject = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('agenthub:reject-diff', {
        detail: { filePath: block.path },
      }),
    );
  }, [block.path]);

  const handleReviewChanges = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('agenthub:review-changes', {
        detail: { path: block.path, action: block.action, diff: block.diff },
      }),
    );
  }, [block.path, block.action, block.diff]);

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
        {additions > 0 && <span className={styles.fileChangeAdd}>+{additions}</span>}
        {deletions > 0 && <span className={styles.fileChangeDel}>-{deletions}</span>}
        {hasDiff && (
          <ChevronRight
            size={15}
            className={styles.fileChangeChevron + (expanded ? ' ' + styles.fileChangeChevronOpen : '')}
          />
        )}
      </button>

      {/* Inline apply/reject action row */}
      {hasDiff && (
        <div className={styles.fileChangeActions}>
          <button
            className={`${styles.diffActionBtn} ${styles.diffApplyBtn}`}
            type="button"
            onClick={handleApply}
            title={t('chat.applyDiff', { defaultValue: 'Apply changes (Ctrl+Y)' })}
          >
            <Check size={11} />
            <span>{t('chat.apply', { defaultValue: 'Apply' })}</span>
          </button>
          <button
            className={`${styles.diffActionBtn} ${styles.diffRejectBtn}`}
            type="button"
            onClick={handleReject}
            title={t('chat.rejectDiff', { defaultValue: 'Reject changes (Ctrl+N)' })}
          >
            <X size={11} />
            <span>{t('chat.reject', { defaultValue: 'Reject' })}</span>
          </button>
          <button
            className={styles.reviewChangesBtn}
            type="button"
            onClick={handleReviewChanges}
          >
            {t('chat.reviewChanges')}
          </button>
        </div>
      )}

      {expanded && hasDiff && (
        structuredDiff ? (
          <div className={styles.fileChangeStructuredDiff}>
            <DiffCard diff={structuredDiff} />
          </div>
        ) : (
          <pre className={styles.fileChangeDiff}>
            {rawDiff.preview.join('\n')}
            {block.diff && block.diff.split(/\r?\n/).length > rawDiff.preview.length ? '\n...' : ''}
          </pre>
        )
      )}
    </div>
  );
});

const AgentTaskBlock = memo(function AgentTaskBlock({ block }: { block: Extract<MessageBlock, { kind: 'agent_task' }> }) {
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
});

function formatDurationMs(durationMs?: number): string | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

<<<<<<< HEAD
const ChildAgentBlock = memo(function ChildAgentBlock({ block }: { block: Extract<MessageBlock, { kind: 'child_agent' }> }) {
=======
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
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
});

const RouteDecisionBlock = memo(function RouteDecisionBlock({ block }: { block: Extract<MessageBlock, { kind: 'route_decision' }> }) {
=======
}

function RouteDecisionBlock({ block }: { block: Extract<MessageBlock, { kind: 'route_decision' }> }) {
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
});

// ── ErrorBlock ──────────────────────────────

// Category → icon + severity mapping
type ErrorCategory = 'network' | 'auth' | 'rate_limit' | 'tool' | 'model' | 'unknown';

interface ErrorCategoryConfig {
  icon: typeof AlertTriangle;
  colorClass: string | undefined;
  severity: 'critical' | 'warning' | 'info';
}

const ERROR_CATEGORY_CONFIG: Record<ErrorCategory, ErrorCategoryConfig> = {
  network: { icon: Wifi, colorClass: styles.errorCategoryNetwork, severity: 'critical' },
  auth: { icon: Key, colorClass: styles.errorCategoryAuth, severity: 'critical' },
  rate_limit: { icon: Gauge, colorClass: styles.errorCategoryRateLimit, severity: 'warning' },
  tool: { icon: Wrench, colorClass: styles.errorCategoryTool, severity: 'warning' },
  model: { icon: Cpu, colorClass: styles.errorCategoryModel, severity: 'info' },
  unknown: { icon: AlertTriangle, colorClass: styles.errorCategoryUnknown, severity: 'warning' },
};

// Category → default suggestion text (i18n key + fallback)
const ERROR_CATEGORY_SUGGESTION: Record<ErrorCategory, string> = {
  network: 'chat.error.suggestion.network',
  auth: 'chat.error.suggestion.auth',
  rate_limit: 'chat.error.suggestion.rateLimit',
  tool: 'chat.error.suggestion.tool',
  model: 'chat.error.suggestion.model',
  unknown: 'chat.error.suggestion.unknown',
};

const ERROR_SUGGESTION_DEFAULTS: Record<string, string> = {
  'chat.error.suggestion.network': 'Check your internet connection and try again.',
  'chat.error.suggestion.auth': 'There may be an issue with your API key or authentication.',
  'chat.error.suggestion.rateLimit': 'You have hit a rate limit. Try reducing context size or wait before retrying.',
  'chat.error.suggestion.tool': 'A tool execution failed. Check the tool configuration or try again.',
  'chat.error.suggestion.model': 'The model encountered an error. Try a different model or adjust your request.',
  'chat.error.suggestion.unknown': 'An unexpected error occurred. Check the details below for more information.',
};

// Category → contextual action button (label i18n key, icon, dispatch event)
const ERROR_CATEGORY_ACTIONS: Record<
  ErrorCategory,
  Array<{ labelKey: string; labelDefault: string; icon: typeof AlertTriangle; event: string }>
> = {
  auth: [
    { labelKey: 'chat.error.openSettings', labelDefault: 'Open Settings', icon: Key, event: 'agenthub:open-settings' },
  ],
  network: [
    { labelKey: 'chat.error.checkConnection', labelDefault: 'Check Connection', icon: Wifi, event: 'agenthub:check-connection' },
  ],
  rate_limit: [
    { labelKey: 'chat.error.reduceContext', labelDefault: 'Reduce Context', icon: Gauge, event: 'agenthub:reduce-context' },
  ],
  model: [
    { labelKey: 'chat.error.tryDifferentModel', labelDefault: 'Try Different Model', icon: Cpu, event: 'agenthub:switch-model' },
  ],
  tool: [
    { labelKey: 'chat.error.inspectTool', labelDefault: 'Inspect Tool', icon: Wrench, event: 'agenthub:inspect-tool' },
  ],
  unknown: [],
};

const ErrorBlock = memo(function ErrorBlock({ block }: { block: Extract<MessageBlock, { kind: 'error' }> }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const message = block.message || block.error || t('chat.error.unknown');
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(block.detail);
  const category = block.category ?? 'unknown';
  const cfg = ERROR_CATEGORY_CONFIG[category] ?? ERROR_CATEGORY_CONFIG.unknown;
  const CategoryIcon = cfg.icon;
  const suggestionKey = ERROR_CATEGORY_SUGGESTION[category] ?? ERROR_CATEGORY_SUGGESTION.unknown;
  const suggestionDefault = ERROR_SUGGESTION_DEFAULTS[suggestionKey] ?? '';
  const suggestionText = block.suggestion || t(suggestionKey, suggestionDefault);
  const actions = ERROR_CATEGORY_ACTIONS[category] ?? [];

  const handleCopyError = useCallback(async () => {
    const parts: string[] = [];
    if (block.error) parts.push(`Error: ${block.error}`);
    if (block.message && block.message !== block.error) parts.push(`Message: ${block.message}`);
    if (block.category) parts.push(`Category: ${block.category}`);
    if (block.detail) parts.push(`Detail:\n${block.detail}`);
    try {
      await navigator.clipboard.writeText(parts.join('\n'));
      addToast({ type: 'success', message: t('toast.copied') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [block.error, block.message, block.category, block.detail, addToast, t]);

  return (
    <div
      className={`${styles.errorBlock} ${cfg.colorClass ?? ''}`}
      data-testid="error-block"
      data-error-category={category}
    >
      <div className={styles.errorBlockHeader}>
        <span className={styles.errorIcon} aria-hidden="true">
          <CategoryIcon size={16} />
        </span>
        <span className={styles.errorLabel}>{t('chat.error.title')}</span>
        <span className={styles.errorCategoryBadge}>
          {t(`chat.error.category.${category}`, category)}
        </span>
        <span className={styles.errorMessage}>{message}</span>
      </div>

      <p className={styles.errorSuggestion}>{suggestionText}</p>

      <div className={styles.errorActionRow}>
        {actions.map((action) => (
          <button
            key={action.event}
            type="button"
            className={styles.errorActionChip}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(action.event, { detail: { errorBlock: block } }),
              )
            }
          >
            <action.icon size={13} />
            <span>{t(action.labelKey, action.labelDefault)}</span>
          </button>
        ))}
        {block.retryable && (
          <button
            type="button"
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
        <button
          type="button"
          className={styles.copyErrorBtn}
          onClick={handleCopyError}
          title={t('chat.error.copyDetails', 'Copy Error Details')}
        >
          <Clipboard size={14} />
          <span>{t('chat.error.copyDetails', 'Copy Error Details')}</span>
        </button>
      </div>

      {hasDetail && (
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
    </div>
  );
});

// ── CitationBlock ───────────────────────────
const CitationBlock = memo(function CitationBlock({ block }: { block: Extract<MessageBlock, { kind: 'citation' }> }) {
  const title = block.title || block.url || block.text?.slice(0, 80) || '';
  const preview = block.text ? block.text.slice(0, 200) : '';

  return (
    <div className={styles.citationBlock} data-testid="citation-block">
      <div className={styles.citationHeader}>
        <span className={styles.citationIcon} aria-hidden="true"><ExternalLink size={14} /></span>
        <span className={styles.citationTitle}>{title}</span>
      </div>
      {preview && <p className={styles.citationPreview}>{preview}</p>}
      {block.url && (
        <a
          className={styles.citationLink}
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          title={block.url}
        >
          {block.url}
        </a>
      )}
    </div>
  );
});

// ── CompactBlock ────────────────────────────
const CompactBlock = memo(function CompactBlock({ block }: { block: Extract<MessageBlock, { kind: 'compact' }> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(Boolean(block.expanded));
  const hasItems = Array.isArray(block.items) && block.items.length > 0;

  return (
    <div className={styles.compactBlock} data-testid="compact-block">
      <button
        className={styles.compactToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        <span className={styles.compactSummary}>{block.summary}</span>
        {hasItems && (
          <span className={styles.compactItemCount}>
            {t('chat.compact.itemCount', { count: block.items!.length })}
          </span>
        )}
      </button>
      {expanded && hasItems && (
        <div className={styles.compactBody}>
          {block.items!.map((item, i) => (
            <BlockRenderer key={i} block={item} t={t} />
          ))}
        </div>
      )}
    </div>
  );
});

=======
}

>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
// ── Main BlockRenderer ──────────────────────
function blockRendererPropsEqual(
  prev: { block: MessageBlock; t: (key: string, vars?: Record<string, unknown>) => string; role?: ChatMessage['role']; active?: boolean },
  next: { block: MessageBlock; t: (key: string, vars?: Record<string, unknown>) => string; role?: ChatMessage['role']; active?: boolean },
): boolean {
  return prev.role === next.role && prev.active === next.active && shallowEqual(prev.block, next.block);
}

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

<<<<<<< HEAD
    case 'error':
      return <ErrorBlock block={block} />;

    case 'citation':
      return <CitationBlock block={block} />;

    case 'compact':
      return <CompactBlock block={block} />;

    case 'tool_group':
      return <ToolGroupDisplay block={block} isStreaming={active} />;

    case 'approval':
      return (
        <ApprovalCard
          approvalId={block.approvalId}
          agentName={block.agentName}
          toolName={block.toolName}
          riskLevel={block.riskLevel}
          status={block.status}
          timestamp={block.timestamp}
          reason={block.reason}
          decidedBy={block.decidedBy}
          decidedAt={block.decidedAt}
          teamId={block.teamId}
          runId={block.runId}
          agentTaskId={block.agentTaskId}
        />
      );

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
      return <DeployCard block={block} />;

    case 'link_card':
      return <LinkCard block={block} />;

=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    default:
      return null;
  }
}, blockRendererPropsEqual);

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
<<<<<<< HEAD
        case 'error':
          return `[error] ${block.message || block.error || 'unknown error'}`;
        case 'citation':
          return `[citation] ${block.title || block.url || block.text?.slice(0, 80) || ''}`;
        case 'compact':
          return `[compact] ${block.summary}`;
        case 'tool_group':
          return block.items.map((item) => `[${item.toolName}] ${summarizeInput(item.input)}`).join('\n');
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
    case 'error':
    case 'citation':
    case 'compact':
    case 'tool_group':
      return true;
    case 'approval':
    case 'artifact':
    case 'deploy_card':
    case 'link_card':
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
      return true;
    default:
      return false;
  }
}

function hasVisibleMessage(message: ChatMessage): boolean {
  return message.blocks.some(hasVisibleBlock);
}

<<<<<<< HEAD
// ── MessageCard (memo'd per-message renderer) ─
interface MessageCardProps {
  msg: ChatMessage;
  isActive: boolean;
  isLastMessage: boolean;
  replyTo?: ReplyTarget | null;
  copiedMessageId: string | null;
  onCopy: (msg: ChatMessage) => void;
  onRetry?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  onRegenerate?: (messageId: string) => void;
}

const MessageCard = memo(function MessageCard({
  msg,
  isActive,
  isLastMessage,
  replyTo,
  copiedMessageId,
  onCopy,
  onRetry,
  onFork,
  onDelete,
  onReply,
  onRegenerate,
}: MessageCardProps) {
  const { t, i18n } = useTranslation();
  const messageTime = formatMessageTime(msg.timestamp, i18n.language);
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
      {msg.role === 'agent' ? <ToolTimeline
        blocks={msg.blocks}
        labels={{
          header: t('chat.toolTimeline'),
          headerCount: (count: number) => t('chat.toolTimelineCount', { count }),
          statusPending: t('chat.taskStatus.pending', { defaultValue: 'pending' }),
          statusRunning: t('chat.taskStatus.running', { defaultValue: 'running' }),
          statusDraining: t('chat.taskStatus.draining', { defaultValue: 'draining' }),
          statusCompleted: t('chat.taskStatus.completed', { defaultValue: 'done' }),
          statusFailed: t('chat.taskStatus.failed', { defaultValue: 'failed' }),
        }}
      /> : null}

      {groupToolBlocks(msg.blocks).map((block, i) => (
        <BlockRenderer
          key={i}
          block={block}
          t={t}
          role={msg.role}
          active={isActive}
        />
      ))}

      {replyTo && replyTo.messageId === msg.id && (
        <div className={styles.replyIndicator}>
          <Reply size={12} />
          <span>{t('chat.replyIndicator')}</span>
        </div>
      )}

      {msg.role !== 'user' && (
        <div className={styles.messageFooter}>
          <div className={styles.actionBar}>
            <button
              className={styles.actionBtn}
              title={t('chat.copy')}
              aria-label={t('chat.copy')}
              onClick={() => onCopy(msg)}
            >
              <Copy size={14} />
            </button>
            {onReply && msg.role !== 'system' && (
              <button
                className={styles.actionBtn}
                title={t('chat.reply')}
                aria-label={t('chat.reply')}
                onClick={() => onReply({
                  messageId: msg.id,
                  author: msg.role === 'user' ? t('chat.sender.you') : (msg.agentName || t('chat.sender.agent')),
                  preview: extractMessageText(msg).slice(0, 120),
                })}
              >
                <Reply size={14} />
              </button>
            )}
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
            {onRegenerate && msg.role === 'agent' && isLastMessage && (
              <button
                className={styles.actionBtn}
                title={t('chat.regenerate')}
                aria-label={t('chat.regenerate')}
                onClick={() => onRegenerate(msg.id)}
              >
                <RefreshCcw size={14} />
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
      {copiedMessageId === msg.id && (
        <span className={styles.copyToast}>{t('chat.copied')}</span>
      )}
    </div>
  );
});

=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
// ── ChatView ────────────────────────────────
export default function ChatView({
  messages,
  isStreaming,
  onRetry,
  onFork,
<<<<<<< HEAD
  onDelete, onReply, onRegenerate, replyTo, onCancelReply,
=======
  onDelete,
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
}: Props) {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const visibleMessages = messages.filter(hasVisibleMessage);
<<<<<<< HEAD

  // ── Keyboard navigation & accessibility ─────
  const [focusedMessageIndex, setFocusedMessageIndex] = useState<number>(-1);
  const [collapseCounts, setCollapseCounts] = useState<Record<string, number>>({});
  const [streamAnnouncement, setStreamAnnouncement] = useState<string>('');
  const messageElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerMessageRef = useCallback((msgId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      messageElsRef.current.set(msgId, el);
    } else {
      messageElsRef.current.delete(msgId);
    }
  }, []);

  // ── Virtualizer ──────────────────────────────
  const virtualEnabled = visibleMessages.length > 50;
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 5,
    enabled: virtualEnabled,
  });

  // Stable refs so virtualizer auto-scroll closure always sees latest values
  const messagesRef = useRef(visibleMessages);
  messagesRef.current = visibleMessages;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

  // ── Keyboard navigation callbacks (after virtualizer is available) ──
  const focusMessageByIndex = useCallback((index: number) => {
    const id = visibleMessages[index]?.id;
    if (!id) return;
    const el = messageElsRef.current.get(id);
    if (el) {
      el.focus();
      setFocusedMessageIndex(index);
    } else if (virtualEnabled) {
      // Element not yet in DOM — scroll to bring it into view first
      virtualizer.scrollToIndex(index, { align: 'center' });
      setFocusedMessageIndex(index);
      // Focus after virtualizer re-renders
      requestAnimationFrame(() => {
        const el2 = messageElsRef.current.get(id);
        el2?.focus();
      });
    }
  }, [visibleMessages, virtualEnabled, virtualizer]);

  const handleMessageKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>, msgId: string, index: number) => {
    const target = e.target as HTMLElement;
    const isInput = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target.isContentEditable;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (index > 0) focusMessageByIndex(index - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (index < visibleMessages.length - 1) focusMessageByIndex(index + 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setCollapseCounts((prev) => ({ ...prev, [msgId]: (prev[msgId] ?? 0) + 1 }));
        break;
      case 'j':
        if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (index < visibleMessages.length - 1) focusMessageByIndex(index + 1);
        }
        break;
      case 'k':
        if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (index > 0) focusMessageByIndex(index - 1);
        }
        break;
    }
  }, [visibleMessages, focusMessageByIndex]);

  const { scrollToBottom, isNearBottom } = useAutoScroll(
    scrollRef,
    { messages: visibleMessages, isStreaming: isStreaming ?? false },
<<<<<<< HEAD
    virtualEnabled
      ? {
          scrollToBottomFn: () => {
            const len = messagesRef.current.length;
            if (len > 0) {
              virtualizerRef.current.scrollToIndex(len - 1, { align: 'end' });
            }
          },
        }
      : undefined,
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
  );

  const lastMsg = visibleMessages[visibleMessages.length - 1];
  const lastMessageId = lastMsg?.id ?? null;
<<<<<<< HEAD

  // Announce new streaming content to screen readers
  useEffect(() => {
    if (!isStreaming || !lastMsg) {
      setStreamAnnouncement('');
      return;
    }
    // Only announce periodically (every 2s) to avoid flooding
    if (announceTimerRef.current) return;
    announceTimerRef.current = setTimeout(() => {
      announceTimerRef.current = null;
      const textBlocks = lastMsg.blocks.filter((b): b is Extract<typeof lastMsg.blocks[number], { kind: 'text' }> => b.kind === 'text');
      if (textBlocks.length > 0) {
        const lastContent = textBlocks[textBlocks.length - 1]?.content ?? '';
        const snippet = lastContent.slice(-100).trim();
        if (snippet) setStreamAnnouncement(snippet);
      }
    }, 2000);
    return () => {
      if (announceTimerRef.current) {
        clearTimeout(announceTimerRef.current);
        announceTimerRef.current = null;
      }
    };
  }, [isStreaming, lastMsg]);
=======
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
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

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

<<<<<<< HEAD
=======
  const renderMessage = useCallback(
    (msg: ChatMessage) => {
      const messageTime = formatMessageTime(msg.timestamp, i18n.language);
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
                key={i}
                block={block}
                t={t}
                role={msg.role}
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
          {copiedMessageId === msg.id && (
            <span className={styles.copyToast}>{t('chat.copied')}</span>
          )}
        </div>
      );
    },
    [t, i18n.language, isStreaming, lastMsg?.id, copiedMessageId, handleCopy, onRetry, onFork, onDelete],
  );

>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
        {visibleMessages.length === 0 ? (
          <EmptyState
            title={t('chat.emptyTitle')}
            description={t('chat.emptyDescription')}
          />
<<<<<<< HEAD
        ) : (<Fragment>
          {virtualEnabled ? (
              <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative', flexShrink: 0 }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const msg = visibleMessages[virtualRow.index];
                  if (!msg) return null;
                  const idx = virtualRow.index;
                  const isStreamingMsg = Boolean(isStreaming && msg.id === lastMsg?.id);
                  const collapseCount = isStreamingMsg ? 0 : (collapseCounts[msg.id] ?? 0);
                  const msgKey = collapseCount > 0 ? `${msg.id}-c${collapseCount}` : msg.id;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className={styles.virtualItem}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div
                        key={msgKey}
                        data-message-id={msg.id}
                        ref={registerMessageRef(msg.id)}
                        tabIndex={focusedMessageIndex === idx ? 0 : -1}
                        role="article"
                        aria-roledescription="chat message"
                        className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : ''} ${focusedMessageIndex === idx ? styles.messageRowFocused : ''}`}
                        onKeyDown={(e) => handleMessageKeyDown(e, msg.id, idx)}
                        onFocus={() => setFocusedMessageIndex(idx)}
                      >
                        <MessageCard
                          msg={msg}
                          isActive={Boolean(isStreaming && msg.id === lastMsg?.id)}
                          isLastMessage={msg.id === lastMsg?.id}
                          replyTo={replyTo}
                          copiedMessageId={copiedMessageId}
                          onCopy={handleCopy}
                          onRetry={onRetry}
                          onFork={onFork}
                          onDelete={onDelete}
                          onReply={onReply}
                          onRegenerate={onRegenerate}
                        />
                    </div>
                      </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.messageList}>
                {visibleMessages.map((msg, idx) => {
                  const isStreamingMsg = Boolean(isStreaming && msg.id === lastMsg?.id);
                  // Use collapse counter in key to force remount on Escape, but not during streaming
                  const collapseCount = isStreamingMsg ? 0 : (collapseCounts[msg.id] ?? 0);
                  const msgKey = collapseCount > 0 ? `${msg.id}-c${collapseCount}` : msg.id;
                  return (
                    <div
                      key={msgKey}
                      data-message-id={msg.id}
                      ref={registerMessageRef(msg.id)}
                      tabIndex={focusedMessageIndex === idx ? 0 : -1}
                      role="article"
                      aria-roledescription="chat message"
                      className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : ''} ${focusedMessageIndex === idx ? styles.messageRowFocused : ''}`}
                      onKeyDown={(e) => handleMessageKeyDown(e, msg.id, idx)}
                      onFocus={() => setFocusedMessageIndex(idx)}
                    >
                      <MessageCard
                        msg={msg}
                        isActive={Boolean(isStreaming && msg.id === lastMsg?.id)}
                        isLastMessage={msg.id === lastMsg?.id}
                        replyTo={replyTo}
                        copiedMessageId={copiedMessageId}
                        onCopy={handleCopy}
                        onRetry={onRetry}
                        onFork={onFork}
                        onDelete={onDelete}
                        onReply={onReply}
                        onRegenerate={onRegenerate}
                      />
                    </div>
                  );
                })}
              </div>
            )}
        </Fragment>)}
        {isStreaming && !lastMsgHasText ? <PendingThinking label={t('chat.thinkingLabel')} /> : null}
        {/* Screen-reader assertive live region for streaming announcements */}
        <span
          className={styles.srOnly}
          aria-live="assertive"
          aria-atomic="true"
          role="status"
        >
          {streamAnnouncement}
        </span>
=======
        ) : (
          <div className={styles.messageList}>
            {visibleMessages.map((msg) => (
              <div
                key={msg.id}
                data-message-id={msg.id}
                className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : ''}`}
              >
                {renderMessage(msg)}
              </div>
            ))}
          </div>
        )}
        {isStreaming && !lastMsgHasText ? <PendingThinking label={t('chat.thinkingLabel')} /> : null}
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
