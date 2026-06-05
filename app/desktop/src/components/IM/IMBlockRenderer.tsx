// IMBlockRenderer — lightweight rich block renderer for IM chat flow.
// Detects and renders Tool use, Diff, Thinking, and plain text blocks.
// Reuses ChatView patterns where possible; creates compact IM-optimized versions otherwise.
//
// Sprint #2: Tool/Diff/Thinking block rendering for IM

import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  FolderOpen,
  Globe,
  Bot,
  CheckSquare,
  Wrench,
  ChevronRight,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import type { MessageBlock, ToolResultBlock, FileDiff, DiffLine } from '../ChatView.types';
import MarkdownRenderer from '../MarkdownRenderer';
import styles from './IMBlockRenderer.module.css';

// ── Tool icon map (same as ChatView) ─────────────────

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
  return <Icon size={13} />;
}

function summarizeInput(input: Record<string, unknown> | null | undefined): string {
  if (!input) return '(no input)';
  const parts: string[] = [];
  if (typeof input.file_path === 'string') parts.push(input.file_path);
  else if (typeof input.path === 'string') parts.push(input.path);
  if (typeof input.command === 'string') parts.push(input.command.slice(0, 50));
  if (typeof input.description === 'string') parts.push(input.description.slice(0, 50));
  const str = parts.join(' ');
  return str.length > 35 ? str.slice(0, 35) + '...' : str;
}

// ── Status badge class resolver ──────────────────────

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

// ── Inline Diff summary (compact version of ChatView's DiffCard) ──

function IMDiffSummary({
  filePath,
  additions,
  deletions,
  lines,
}: {
  filePath: string;
  additions: number;
  deletions: number;
  lines?: DiffLine[];
}) {
  const previewLines = lines?.slice(0, 8) ?? [];

  return (
    <div className={styles.diffCard}>
      <div className={styles.diffHeader}>
        <code className={styles.diffPath}>{filePath}</code>
        {additions > 0 && <span className={styles.diffAdded}>+{additions}</span>}
        {deletions > 0 && <span className={styles.diffDeleted}>-{deletions}</span>}
      </div>
      {previewLines.length > 0 && (
        <div className={styles.diffPreview}>
          {previewLines.map((line, i) => (
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
              <span className={styles.lineContent}>{line.content.slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compact Tool Use Block (IM-optimized) ────────────

const IMToolUseBlock = memo(function IMToolUseBlock({
  block,
}: {
  block: Extract<MessageBlock, { kind: 'tool_use' }>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const iconEl = resolveToolIcon(block.toolName);

  return (
    <div className={styles.toolUse}>
      <button
        className={styles.toolUseHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        type="button"
      >
        <span className={styles.toolIcon}>{iconEl}</span>
        <span className={styles.toolName}>{block.toolName}</span>
        <span className={styles.toolSummary}>{summarizeInput(block.input)}</span>
        <span className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}>
          {t(`chat.toolStatus.${block.status}`, { defaultValue: block.status })}
        </span>
        <ChevronRight
          size={13}
          className={`${styles.chevron} ${expanded ? styles.chevronDown : ''}`}
        />
      </button>
      {expanded && block.children && block.children.length > 0 && (
        <div className={styles.toolBody}>
          {block.children.map((child, i) => (
            <IMToolResult key={i} result={child} />
          ))}
        </div>
      )}
    </div>
  );
});

// ── Compact Tool Result ─────────────────────────────

function IMToolResult({ result }: { result: ToolResultBlock }) {
  switch (result.kind) {
    case 'read_result':
      return (
        <div className={styles.toolResultRow}>
          <FileText size={11} />
          <code>{result.filePath}</code>
          <span>— {result.lineCount} lines</span>
        </div>
      );
    case 'write_result':
    case 'edit_result':
      return result.diff ? (
        <IMDiffSummary
          filePath={result.filePath}
          additions={result.diff.additions}
          deletions={result.diff.deletions}
          lines={result.diff.hunks.flatMap((h) => h.lines)}
        />
      ) : (
        <div className={styles.toolResultRow}>
          <Pencil size={11} />
          <code>{result.filePath}</code>
        </div>
      );
    case 'bash_result':
      return (
        <div className={styles.toolResultRow}>
          {result.stdout && <code className={styles.toolStdout}>{result.stdout.slice(0, 300)}</code>}
          {result.stderr && (
            <code className={`${styles.toolStdout} ${styles.toolStderr}`}>
              {result.stderr.slice(0, 200)}
            </code>
          )}
          <span className={styles.exitCode}>exit {result.exitCode}</span>
        </div>
      );
    case 'generic_result':
      return <code className={styles.toolStdout}>{result.output.slice(0, 500)}</code>;
    default:
      return null;
  }
}

// ── Collapsible Thinking Section ────────────────────

const IMThinkingBlock = memo(function IMThinkingBlock({ content }: { content: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.thinking}>
      <button
        className={styles.thinkingToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        type="button"
      >
        <ChevronRight
          size={12}
          className={`${styles.chevron} ${expanded ? styles.chevronDown : ''}`}
        />
        <span>{t('chat.thinkingSettledLabel')}</span>
      </button>
      {expanded && (
        <div className={styles.thinkingContent}>
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
});

// ── Compact Approval Notice (read-only for IM) ─────

const IMApprovalNotice = memo(function IMApprovalNotice({
  block,
}: {
  block: Extract<MessageBlock, { kind: 'approval' }>;
}) {
  const { t } = useTranslation();
  const statusClass =
    block.status === 'approved'
      ? styles.approvalApproved
      : block.status === 'denied'
        ? styles.approvalDenied
        : block.status === 'timeout'
          ? styles.approvalTimeout
          : styles.approvalPending;

  return (
    <div className={styles.approvalNotice}>
      <span className={styles.approvalIcon}><Shield size={13} /></span>
      <span className={styles.approvalLabel}>{t('approval.title')}</span>
      {block.agentName && <span className={styles.approvalAgent}>{block.agentName}</span>}
      {block.toolName && <span className={styles.approvalTool}>{block.toolName}</span>}
      {block.riskLevel && (
        <span className={`${styles.approvalRisk} ${styles[`risk${block.riskLevel.charAt(0).toUpperCase()}${block.riskLevel.slice(1)}`] ?? ''}`}>
          {t(`approval.risk.${block.riskLevel}`, { defaultValue: block.riskLevel })}
        </span>
      )}
      <span className={`${styles.approvalStatus} ${statusClass}`}>
        {t(`approval.status.${block.status}`, { defaultValue: block.status })}
      </span>
    </div>
  );
});

// ── File Change Block (compact) ─────────────────────

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? path;
}

function summarizeRawDiff(diff?: string): {
  additions: number;
  deletions: number;
  preview: string[];
} {
  if (!diff) return { additions: 0, deletions: 0, preview: [] };
  const lines = diff.split(/\r?\n/);
  let additions = 0;
  let deletions = 0;
  const preview: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
    if (preview.length < 12 && (/^[-+ ]/.test(line) || line.startsWith('@@'))) {
      preview.push(line);
    }
  }
  return { additions, deletions, preview };
}

const IMFileChangeBlock = memo(function IMFileChangeBlock({
  block,
}: {
  block: Extract<MessageBlock, { kind: 'file_change' }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const diff = summarizeRawDiff(block.diff);
  const hasDiff = diff.preview.length > 0;

  return (
    <div className={styles.fileChange}>
      <button
        className={styles.fileChangeHeader}
        type="button"
        onClick={() => hasDiff && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Pencil size={13} />
        <span className={styles.fileChangeAction}>{block.action}</span>
        <code className={styles.fileChangePath}>{basename(block.path)}</code>
        {diff.additions > 0 && <span className={styles.fileChangeAdd}>+{diff.additions}</span>}
        {diff.deletions > 0 && <span className={styles.fileChangeDel}>-{diff.deletions}</span>}
      </button>
      {expanded && hasDiff && (
        <pre className={styles.fileChangeDiff}>{diff.preview.join('\n')}</pre>
      )}
    </div>
  );
});

// ── Mini Agent Task Block ──────────────────────────

const IMAgentTaskBlock = memo(function IMAgentTaskBlock({
  block,
}: {
  block: Extract<MessageBlock, { kind: 'agent_task' }>;
}) {
  const { t } = useTranslation();
  const title = block.title.trim() || block.taskId;

  return (
    <div className={styles.agentTask}>
      <Bot size={13} />
      <strong>{title}</strong>
      <span className={`${styles.toolStatus} ${toolStatusClass(block.status)}`}>
        {t(`chat.taskStatus.${block.status}`, { defaultValue: block.status })}
      </span>
      {block.summary && <span className={styles.agentTaskSummary}>{block.summary}</span>}
    </div>
  );
});

// ── Error Notice ───────────────────────────────────

const IMErrorBlock = memo(function IMErrorBlock({
  block,
}: {
  block: Extract<MessageBlock, { kind: 'error' }>;
}) {
  return (
    <div className={styles.errorBlock}>
      <AlertTriangle size={13} />
      <span>{block.message}</span>
      {block.category && <span className={styles.errorCategory}>{block.category}</span>}
    </div>
  );
});

// ── Content Parser: detect rich content in plain text ──

interface ParsedRichContent {
  type: 'blocks';
  blocks: MessageBlock[];
}

/**
 * Attempt to detect structured rich content in IM plain-text messages.
 * Handles:
 * 1. JSON content with explicit "blocks" array
 * 2. Diff markers in raw text
 * 3. Thinking markers: "## Thinking" or "<thinking>...</thinking>"
 */
function parseIMRichContent(content: string): ParsedRichContent | null {
  // 1. Try JSON with blocks
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const obj = parsed as Record<string, unknown>;
      // Case A: explicit blocks array
      if (Array.isArray(obj.blocks) && obj.blocks.length > 0) {
        return {
          type: 'blocks',
          blocks: obj.blocks as MessageBlock[],
        };
      }
      // Case B: single tool_use or other structured block
      if (typeof obj.kind === 'string' && obj.kind !== 'text') {
        return {
          type: 'blocks',
          blocks: [obj as MessageBlock],
        };
      }
      // Case C: wrap JSON text as blocks
      if (typeof obj.text === 'string') {
        const textBlocks = detectInlineRichContent(obj.text);
        if (textBlocks) return textBlocks;
      }
    }
  } catch {
    // Not JSON — try inline detection
  }

  // 2. Try inline rich content detection
  return detectInlineRichContent(content);
}

/**
 * Detect inline rich content markers in text.
 */
function detectInlineRichContent(content: string): ParsedRichContent | null {
  const blocks: MessageBlock[] = [];
  let remaining = content;

  // Check for unified diff pattern
  const diffMatch = remaining.match(/^---\s+a\/(.+?)\s*$/m);
  const diffEndMatch = remaining.match(/^\+{3}\s+b\/(.+?)\s*$/m);

  if (diffMatch && diffEndMatch) {
    // Extract the diff text
    const diffStart = remaining.indexOf('--- ');
    if (diffStart > 0) {
      // Text before diff
      const textBefore = remaining.slice(0, diffStart).trim();
      if (textBefore) {
        blocks.push({ kind: 'text', content: textBefore });
      }
      remaining = remaining.slice(diffStart);
    }
  }

  // Check for thinking markers: "## Thinking" or "<thinking>...</thinking>"
  const thinkingSectionMatch = remaining.match(
    /^##\s*Thinking\s*\n([\s\S]*?)(?=^##\s|\Z)/im,
  );
  const thinkingTagMatch = remaining.match(
    /<thinking>\s*([\s\S]*?)<\/thinking>/i,
  );

  if (thinkingTagMatch) {
    const beforeThinking = remaining.slice(0, thinkingTagMatch.index).trim();
    if (beforeThinking) {
      blocks.push({ kind: 'text', content: beforeThinking });
    }
    blocks.push({ kind: 'thinking', content: thinkingTagMatch[1]?.trim() ?? '' });
    const afterThinking = remaining.slice(
      (thinkingTagMatch.index ?? 0) + thinkingTagMatch[0].length,
    ).trim();
    if (afterThinking) {
      blocks.push({ kind: 'text', content: afterThinking });
    }
    if (blocks.length > 0) {
      return { type: 'blocks', blocks };
    }
  }

  if (thinkingSectionMatch) {
    const beforeThinking = remaining.slice(0, thinkingSectionMatch.index).trim();
    if (beforeThinking) {
      blocks.push({ kind: 'text', content: beforeThinking });
    }
    blocks.push({ kind: 'thinking', content: thinkingSectionMatch[1]?.trim() ?? '' });
    const afterThinking = remaining.slice(
      (thinkingSectionMatch.index ?? 0) + thinkingSectionMatch[0].length,
    ).trim();
    if (afterThinking) {
      blocks.push({ kind: 'text', content: afterThinking });
    }
    if (blocks.length > 0) {
      return { type: 'blocks', blocks };
    }
  }

  // No rich content detected
  return null;
}

// ── Single Block Renderer ──────────────────────────

const IMBlockItem = memo(function IMBlockItem({
  block,
}: {
  block: MessageBlock;
}) {
  switch (block.kind) {
    case 'text':
      if (!block.content.trim()) return null;
      return <MarkdownRenderer content={block.content} />;

    case 'thinking':
      return <IMThinkingBlock content={block.content} />;

    case 'tool_use':
      return <IMToolUseBlock block={block} />;

    case 'file_change':
      return <IMFileChangeBlock block={block} />;

    case 'agent_task':
      return <IMAgentTaskBlock block={block} />;

    case 'approval':
      return <IMApprovalNotice block={block} />;

    case 'error':
      return <IMErrorBlock block={block} />;

    case 'code':
      // Code blocks are already handled by MarkdownRenderer
      return <MarkdownRenderer content={`\`\`\`${block.language ?? ''}\n${block.content}\n\`\`\``} />;

    case 'status':
      return <div className={styles.statusRow}>{block.content}</div>;

    case 'tool_group':
      return (
        <>
          {block.blocks.map((tb, i) => (
            <IMToolUseBlock key={tb.callId ?? i} block={tb} />
          ))}
        </>
      );

    // Blocks that don't need IM rendering
    case 'result':
    case 'context_usage':
    case 'session_init':
    case 'compact':
    case 'route_decision':
    case 'child_agent':
    case 'artifact':
    case 'deploy_card':
    case 'link_card':
    case 'citation':
      return null;

    default:
      return null;
  }
});

// ── Main IMBlockRenderer ───────────────────────────

export interface IMBlockRendererProps {
  /** Raw message content (plain text or JSON-encoded blocks) */
  content: string;
  /** Optional explicit blocks from the message */
  blocks?: MessageBlock[];
  /** Whether to show in the recalled state */
  isRecalled?: boolean;
}

/**
 * IMBlockRenderer — determines the rendering strategy for an IM message body.
 *
 * Priority:
 * 1. If message has explicit `blocks`, render them directly.
 * 2. Otherwise, try to parse `content` for rich block markers.
 * 3. Fall back to plain Markdown rendering.
 */
const IMBlockRenderer = memo(function IMBlockRenderer({
  content,
  blocks,
  isRecalled,
}: IMBlockRendererProps) {
  // Recalled messages show a simple label
  if (isRecalled || content === '[Message recalled]') {
    return (
      <div className={styles.recalled}>
        <MarkdownRenderer content={content} />
      </div>
    );
  }

  // Path 1: Explicit blocks from the message
  if (blocks && blocks.length > 0) {
    return (
      <>
        {blocks
          .map((block, i) => <IMBlockItem key={`${block.kind}-${i}`} block={block} />)
          .filter(Boolean)}
      </>
    );
  }

  // Path 2: Try to parse content for rich blocks
  const parsed = parseIMRichContent(content);
  if (parsed) {
    return (
      <>
        {parsed.blocks
          .map((block, i) => <IMBlockItem key={`${block.kind}-${i}`} block={block} />)
          .filter(Boolean)}
      </>
    );
  }

  // Path 3: Plain Markdown fallback
  return <MarkdownRenderer content={content} />;
});

export default IMBlockRenderer;
