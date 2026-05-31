import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  Check,
  Eye,
  FileText,
  ListTree,
  Package,
  ShieldAlert,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { RunInfo } from '@shared/types';
import { parseUnifiedDiff } from '@shared/diff';
import type { FileDiff, ChatMessage } from './ChatView.types';
import type { SessionMetrics } from '@shared/context/breakdown';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';
import { RunState, RunStateMachine } from '@/utils/runStateMachine';
import DiffViewer from './DiffViewer';
import DiffReviewPanel from './DiffReviewPanel';
import ContextUsage from './ContextUsage';
import styles from './RunDetail.module.css';

interface ToolCallEntry {
  callId: string;
  toolName: string;
  status: string;
  timestamp: string;
  output?: string;
}

interface RunArtifactEntry {
  id: string;
  path: string;
  kind: string;
  createdAt: string;
  sizeBytes?: number;
}

interface RunPreviewEntry {
  id: string;
  url?: string;
  status: string;
  createdAt: string;
}

interface Props {
  run: RunInfo | null;
  toolCalls: ToolCallEntry[];
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
  outputText: string;
  diffs?: FileDiff[];
  onCancel?: () => void;
  approvals?: PermissionRequestItem[];
  artifacts?: RunArtifactEntry[];
  previews?: RunPreviewEntry[];
  onDecideApproval?: (requestId: string, decision: 'allow' | 'deny', reason?: string) => Promise<void> | void;
  chatMessages?: ChatMessage[];
}

function buildMetrics(chatMessages: ChatMessage[] | undefined): SessionMetrics | null {
  if (!chatMessages || chatMessages.length === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;

  for (const msg of chatMessages) {
    for (const block of msg.blocks) {
      if (block.kind === 'result' && block.tokenUsage) {
        inputTokens += block.tokenUsage.input;
        outputTokens += block.tokenUsage.output;
      }
      if (block.kind === 'session_init' && block.model) {
        model = block.model;
      }
    }
  }

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    model,
    messages: chatMessages.map((msg) => ({
      role: msg.role,
      content: msg.blocks
        .filter((b) => b.kind === 'text' || b.kind === 'thinking' || b.kind === 'code')
        .map((b) => ('content' in b ? (b.content as string) : ''))
        .join('\n'),
    })),
  };
}

function ToolCallItem({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = !!tc.output;

  return (
    <div className={styles.toolCallItem}>
      <button
        className={styles.toolCallHeader}
        onClick={() => hasOutput && setExpanded((v) => !v)}
        aria-expanded={hasOutput ? expanded : undefined}
        disabled={!hasOutput}
      >
        <span className={tc.status === 'completed' ? styles.success : styles.pending}>
          {tc.toolName}
        </span>
        <span className={styles.itemTs}>{new Date(tc.timestamp).toLocaleTimeString()}</span>
        {hasOutput && (
          <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>
            &gt;
          </span>
        )}
      </button>
      {expanded && tc.output && (
        <pre className={styles.toolCallOutput}>{tc.output.slice(0, 5000)}</pre>
      )}
    </div>
  );
}

function getRuntimeBlockLabel(kind: string, t: (key: string) => string): string {
  switch (kind) {
    case 'thinking':
      return t('run.block.thinking');
    case 'tool_use':
      return t('run.block.toolCall');
    case 'file_change':
      return t('run.block.fileChange');
    case 'result':
      return t('run.block.result');
    case 'session_init':
      return t('run.block.session');
    case 'code':
      return t('run.block.code');
    case 'text':
      return t('run.block.text');
    default:
      return t('run.block.raw');
  }
}

function blockSummary(block: ChatMessage['blocks'][number]): string {
  switch (block.kind) {
    case 'text':
    case 'code':
    case 'thinking':
      return block.content.slice(0, 140);
    case 'tool_use':
      return `${block.toolName} ${block.status}`;
    case 'file_change':
      return `${block.action} ${block.path}`;
    case 'result':
      return block.success ? 'success' : (block.error ?? 'failed');
    case 'session_init':
      return [block.model, block.permissionMode].filter(Boolean).join(' / ') || 'session';
    default:
      return JSON.stringify(block).slice(0, 140);
  }
}

function collectRuntimeBlocks(chatMessages: ChatMessage[] | undefined) {
  return (chatMessages ?? [])
    .flatMap((message) => message.blocks.map((block) => ({ block, timestamp: message.timestamp })))
    .filter(({ block }) => block.kind !== 'session_init' || blockSummary(block) !== 'session');
}

function collectDiffs(chatMessages: ChatMessage[] | undefined): FileDiff[] {
  const parsed: FileDiff[] = [];
  for (const message of chatMessages ?? []) {
    for (const block of message.blocks) {
      if (block.kind !== 'file_change' || !block.diff) continue;
      const files = parseUnifiedDiff(block.diff, block.path) as FileDiff[];
      if (files.length > 0) {
        parsed.push(...files);
        continue;
      }
      const lines = block.diff.split(/\r?\n/).filter(Boolean);
      parsed.push({
        filePath: block.path,
        status: block.action === 'created' ? 'added' : block.action,
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        hunks: [
          {
            header: '@@ runtime event diff @@',
            lines: lines.map((line, index) => ({
              type: line.startsWith('+') ? 'added' : line.startsWith('-') ? 'deleted' : 'context',
              content: line.replace(/^[-+ ]/, ''),
              oldLineNumber: line.startsWith('+') ? undefined : index + 1,
              newLineNumber: line.startsWith('-') ? undefined : index + 1,
            })),
          },
        ],
      });
    }
  }
  return parsed;
}

export default function RunDetail({
  run,
  toolCalls,
  changedFiles,
  outputText,
  diffs,
  onCancel,
  approvals = [],
  artifacts = [],
  previews = [],
  onDecideApproval,
  chatMessages,
}: Props) {
  const { t } = useTranslation();
  const [approvalActionId, setApprovalActionId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const metrics = useMemo(() => buildMetrics(chatMessages), [chatMessages]);
  const runtimeBlocks = useMemo(() => collectRuntimeBlocks(chatMessages), [chatMessages]);
  const eventDiffs = useMemo(() => collectDiffs(chatMessages), [chatMessages]);

  if (!run) {
    return (
      <div className={styles.panel}>
        <div className={styles.title}>{t('run.title')}</div>
        <div className={styles.empty}>{t('run.empty')}</div>
      </div>
    );
  }

  const resolvedStatus = RunStateMachine.fromLegacyStatus(run.status);
  const statusKey = `run.status.${run.status}`;
  const statusClass =
    resolvedStatus === RunState.COMPLETED
      ? styles.statusDone
      : resolvedStatus === RunState.FAILED || resolvedStatus === RunState.CANCELLED
        ? styles.statusFailed
        : resolvedStatus === RunState.RUNNING ||
            resolvedStatus === RunState.STREAMING ||
            resolvedStatus === RunState.WAITING_FOR_INPUT
          ? styles.statusRunning
          : styles.statusPending;

  const hasOutput = !!outputText;
  const hasToolCalls = toolCalls.length > 0;
  const hasFileChanges = changedFiles.length > 0;
  const reviewDiffs = diffs && diffs.length > 0 ? diffs : eventDiffs;
  const hasDiffs = reviewDiffs.length > 0;
  const hasAnyContent = hasOutput || hasToolCalls || hasFileChanges || runtimeBlocks.length > 0;
  const latestFiles = changedFiles.slice(-4).reverse();
  const latestTools = toolCalls.slice(-4).reverse();
  const pendingApprovals = approvals.filter((approval) => !approval.decision && approval.runId === run.runId);
  const latestBlocks = runtimeBlocks.slice(-6).reverse();

  const isActive =
    resolvedStatus !== RunState.COMPLETED &&
    resolvedStatus !== RunState.FAILED &&
    resolvedStatus !== RunState.CANCELLED &&
    resolvedStatus !== RunState.IDLE;

  const decideApproval = async (requestId: string, decision: 'allow' | 'deny') => {
    if (!onDecideApproval) return;
    setApprovalActionId(`${requestId}:${decision}`);
    setApprovalError(null);
    try {
      await onDecideApproval(requestId, decision, decision === 'deny' ? 'review panel denied' : undefined);
    } catch {
      setApprovalError(t('run.reviewApprovalFailed'));
    } finally {
      setApprovalActionId(null);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t('run.title')}>
      <div className={styles.title}>{t('run.title')}</div>

      <div className={styles.section}>
        <span className={`${styles.status} ${statusClass}`}>{t(statusKey)}</span>
        {run.runId && <span className={styles.runId}>{run.runId.slice(0, 12)}</span>}
      </div>

      {onCancel && isActive && (
        <div className={styles.section}>
          <button className={styles.cancelButton} onClick={onCancel}>
            {t('action.cancelRun')}
          </button>
        </div>
      )}

      <ContextUsage metrics={metrics} />

      <section className={styles.reviewSurface} aria-label={t('run.reviewSurface')}>
        <div className={styles.cardHeader}>
          <ListTree size={14} />
          <span>{t('run.reviewSurface')}</span>
        </div>

        <div className={styles.reviewGrid}>
          <div className={styles.reviewCard}>
            <div className={styles.reviewCardTitle}>
              <ShieldAlert size={13} />
              <span>{t('run.reviewApprovals')}</span>
              <span className={styles.cardCount}>{pendingApprovals.length}</span>
            </div>
            {pendingApprovals.length > 0 ? (
              <div className={styles.reviewList}>
                {pendingApprovals.slice(-3).reverse().map((approval) => (
                  <div key={approval.requestId} className={styles.reviewItem}>
                    <code className={styles.filePath}>{approval.toolName}</code>
                    <span className={styles.reviewSummary}>
                      {Object.keys(approval.toolInput).join(', ') || approval.requestId}
                    </span>
                    {onDecideApproval && (
                      <span className={styles.reviewActions}>
                        <button
                          className={styles.iconAction}
                          onClick={() => void decideApproval(approval.requestId, 'allow')}
                          disabled={approvalActionId !== null}
                          aria-label={t('run.reviewAllow')}
                        >
                          <Check size={12} />
                        </button>
                        <button
                          className={styles.iconAction}
                          onClick={() => void decideApproval(approval.requestId, 'deny')}
                          disabled={approvalActionId !== null}
                          aria-label={t('run.reviewDeny')}
                        >
                          <XCircle size={12} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className={styles.gapText}>{t('run.reviewNoApprovals')}</span>
            )}
            {approvalError && <span className={styles.errorText}>{approvalError}</span>}
          </div>

          <div className={styles.reviewCard}>
            <div className={styles.reviewCardTitle}>
              <Package size={13} />
              <span>{t('run.reviewArtifacts')}</span>
              <span className={styles.cardCount}>{artifacts.length}</span>
            </div>
            {artifacts.length > 0 ? (
              <div className={styles.reviewList}>
                {artifacts.slice(-3).reverse().map((artifact) => (
                  <div key={artifact.id} className={styles.reviewItem}>
                    <code className={styles.filePath}>{artifact.path}</code>
                    <span className={styles.action}>{artifact.kind}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className={styles.gapText}>{t('run.reviewArtifactGap')}</span>
            )}
          </div>

          <div className={styles.reviewCard}>
            <div className={styles.reviewCardTitle}>
              <Eye size={13} />
              <span>{t('run.reviewPreviews')}</span>
              <span className={styles.cardCount}>{previews.length}</span>
            </div>
            {previews.length > 0 ? (
              <div className={styles.reviewList}>
                {previews.slice(-3).reverse().map((preview) => (
                  <div key={preview.id} className={styles.reviewItem}>
                    <code className={styles.filePath}>{preview.url ?? preview.id}</code>
                    <span className={styles.action}>{preview.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className={styles.gapText}>{t('run.reviewPreviewGap')}</span>
            )}
          </div>
        </div>
      </section>

      {latestBlocks.length > 0 && (
        <section className={styles.cardSection}>
          <div className={styles.cardHeader}>
            <Brain size={14} />
            <span>{t('run.runtimeBlocks')}</span>
            <span className={styles.cardCount}>{runtimeBlocks.length}</span>
          </div>
          <div className={styles.runtimeList}>
            {latestBlocks.map(({ block, timestamp }, index) => (
              <div key={`${timestamp}-${index}-${block.kind}`} className={styles.runtimeItem}>
                <span className={styles.runtimeKind}>{getRuntimeBlockLabel(block.kind, t)}</span>
                <span className={styles.runtimeSummary}>{blockSummary(block)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasDiffs && (
        <div className={styles.diffReviewPrimary}>
          <DiffReviewPanel files={reviewDiffs} />
        </div>
      )}

      {!hasAnyContent && !hasDiffs && (
        <div className={styles.emptyStack}>
          <div className={styles.emptyCard}>
            <TerminalSquare size={16} />
            <span>{t('run.emptyOutput')}</span>
          </div>
          <div className={styles.emptyCard}>
            <FileText size={16} />
            <span>{t('run.emptySources')}</span>
          </div>
        </div>
      )}

      {hasAnyContent && (
        <div className={`${styles.tabContent} ${hasDiffs ? styles.tabContentSecondary : ''}`}>
          {hasOutput && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <TerminalSquare size={14} />
                <span>{t('run.output')}</span>
              </div>
              <pre className={styles.output}>{outputText}</pre>
            </section>
          )}

          {hasToolCalls && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <Wrench size={14} />
                <span>{t('run.toolCalls')}</span>
                <span className={styles.cardCount}>{toolCalls.length}</span>
              </div>
              <div className={styles.list}>
                {latestTools.map((tc) => (
                  <ToolCallItem key={tc.callId} tc={tc} />
                ))}
              </div>
            </section>
          )}

          {hasFileChanges && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <FileText size={14} />
                <span>{t('run.fileChanges')}</span>
                <span className={styles.cardCount}>{changedFiles.length}</span>
              </div>
              <div className={styles.sourceList}>
                {latestFiles.map((f) => (
                  <div key={`${f.path}-${f.timestamp}`} className={styles.sourceItem}>
                    <code className={styles.filePath}>{f.path}</code>
                    <span className={styles.action}>{f.action}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasDiffs && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <FileText size={14} />
                <span>{t('run.preview')}</span>
                <span className={styles.cardCount}>{reviewDiffs.length}</span>
              </div>
              <DiffViewer files={reviewDiffs} />
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
