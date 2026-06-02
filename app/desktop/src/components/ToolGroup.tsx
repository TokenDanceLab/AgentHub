import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageBlock, ToolResultBlock } from './ChatView.types';
import { FileText, Pencil, Terminal, Search, FolderOpen, Globe, Bot, CheckSquare, Wrench } from 'lucide-react';
import styles from './ToolGroup.module.css';

// ── Types ────────────────────────────────────
type ToolUseBlock = Extract<MessageBlock, { kind: 'tool_use' }>;

interface Props {
  blocks: ToolUseBlock[];
  isStreaming?: boolean;
}

// ── Category mapping ─────────────────────────
type Category = 'read' | 'edit' | 'command' | 'tool';

const CATEGORY_MAP: Record<string, Category> = {
  read: 'read',
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  write: 'edit',
  Write: 'edit',
  Edit: 'edit',
  bash: 'command',
  Bash: 'command',
  execute: 'command',
};

function mapCategory(toolName: string): Category {
  return CATEGORY_MAP[toolName] ?? 'tool';
}

function categoryLabel(cat: Category, t: (key: string) => string): string {
  switch (cat) {
    case 'read': return t('chat.toolGroup.read');
    case 'edit': return t('chat.toolGroup.edit');
    case 'command': return t('chat.toolGroup.command');
    default: return t('chat.toolGroup.tool');
  }
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
  return <Icon size={13} />;
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

// ── Status helpers ───────────────────────────
function statusClass(status: string): string {
  switch (status) {
    case 'pending':
      return styles.statusPending ?? '';
    case 'running':
      return styles.statusRunning ?? '';
    case 'completed':
      return styles.statusDone ?? '';
    case 'failed':
      return styles.statusFailed ?? '';
    default:
      return '';
  }
}

// ── ToolResultRenderer (simplified copy) ─────
function GroupedToolResult({ result }: { result: ToolResultBlock }) {
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
      return (
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

// ── Individual tool card inside group ────────
function GroupedToolCard({ block }: { block: ToolUseBlock }) {
  const { t } = useTranslation();
  const [showParams, setShowParams] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iconEl = resolveToolIcon(block.toolName);

  return (
    <div className={styles.toolCard}>
      <button
        className={styles.toolCardHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.toolCardIcon}>{iconEl}</span>
        <span className={styles.toolCardName}>{block.toolName}</span>
        <span className={styles.toolCardSummary}>{summarizeInput(block.input)}</span>
        <span className={`${styles.toolCardStatus} ${statusClass(block.status)}`}>
          {t(`chat.toolStatus.${block.status}`, { defaultValue: block.status })}
        </span>
        <span
          className={
            styles.toolCardChevron + (expanded ? ' ' + styles.toolCardChevronOpen : '')
          }
        >
          ▸
        </span>
      </button>

      {expanded && (
        <div className={styles.toolCardBody}>
          <button
            className={styles.showParamsBtn}
            onClick={() => setShowParams((v) => !v)}
          >
            {showParams ? t('chat.hideParameters') : t('chat.showParameters')}
          </button>
          {showParams && (
            <pre className={styles.toolCardParams}>
              {JSON.stringify(block.input, null, 2)}
            </pre>
          )}
          {block.children?.map((child, i) => (
            <GroupedToolResult key={i} result={child} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ToolGroup ────────────────────────────────
export default function ToolGroup({ blocks, isStreaming }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Track whether user has manually toggled (so we don't override)
  const userToggledRef = useRef(false);

  // Compute auto-expand state: true if any tool is pending or running
  const anyRunning = blocks.some(
    (b) => b.status === 'pending' || b.status === 'running',
  );
  const allSettled = blocks.every(
    (b) => b.status === 'completed' || b.status === 'failed',
  );

  // Auto-expand when any tool starts running; auto-collapse when all settle
  useEffect(() => {
    if (userToggledRef.current) return;
    if (anyRunning) {
      setExpanded(true);
    } else if (allSettled && blocks.length > 0) {
      setExpanded(false);
    }
  }, [anyRunning, allSettled, blocks.length]);

  const handleToggle = () => {
    userToggledRef.current = true;
    setExpanded((v) => !v);
  };

  // Build category summary
  const categoryCounts = new Map<Category, number>();
  for (const block of blocks) {
    const cat = mapCategory(block.toolName);
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }

  const totalCount = blocks.length;

  // Sorted category chips (most frequent first)
  const categoryChips = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({
      cat,
      count,
      label: categoryLabel(cat, t),
    }));

  return (
    <div className={styles.root} data-testid="tool-group">
      <button
        className={styles.summary}
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <span
          className={
            styles.chevron + (expanded ? ' ' + styles.chevronOpen : '')
          }
        >
          ▸
        </span>
        <span className={styles.summaryCount}>
          {t('chat.toolGroupSummary', { count: totalCount })}
        </span>
        <span className={styles.summaryCategories}>
          {categoryChips.map(({ cat, count, label }) => (
            <span key={cat} className={styles.categoryChip}>
              <span className={styles.chipCount}>{count}</span>
              <span>{label}</span>
            </span>
          ))}
        </span>
        {anyRunning && (
          <span className={`${styles.summaryStatus} ${styles.statusRunning}`}>
            {t('chat.toolGroup.running')}
          </span>
        )}
      </button>

      {expanded && (
        <div className={styles.body}>
          {blocks.map((block) => (
            <GroupedToolCard key={block.callId} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
