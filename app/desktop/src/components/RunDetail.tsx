import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, TerminalSquare, Wrench, Activity, Clock, CheckCircle, Layers, FolderOpen } from 'lucide-react';
import type { RunInfo } from '@shared/types';
import type { FileDiff, ChatMessage } from './ChatView.types';
import type { SessionMetrics } from '@shared/context/breakdown';
import type { AgentRunEventSummary } from '@/api/hubClient';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import { RunState } from '@/utils/runStateMachine';
import { RunStateMachine } from '@/utils/runStateMachine';
import { useGitStatus, type GitStatus } from '@/hooks/useGitStatus';
import { useGitDiff } from '@/hooks/useGitDiff';
import { getSavedWorkDir } from '@/utils/workspaceStore';
import DiffViewer from './DiffViewer';
import { DiffReviewPanel } from '@shared/ui/DiffReviewPanel';
import ContextUsage from './ContextUsage';
import ArtifactBrowser from './ArtifactBrowser';
import type { ArtifactItem } from './ArtifactBrowser';
import styles from './RunDetail.module.css';

interface ToolCallEntry {
  callId: string;
  toolName: string;
  status: string;
  timestamp: string;
  output?: string;
}

interface Props {
  run: RunInfo | null;
  toolCalls: ToolCallEntry[];
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
  outputText: string;
  diffs?: FileDiff[];
  onCancel?: () => void;
  /** Chat messages from the current session, used for context breakdown visualization. */
  chatMessages?: ChatMessage[];
}

/** Build SessionMetrics from chat messages by extracting token data from result and context_usage blocks. */
function buildMetrics(chatMessages: ChatMessage[] | undefined): SessionMetrics | null {
  if (!chatMessages || chatMessages.length === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let contextLimit: number | undefined;
  let provider: string | undefined;
  let totalCost: number | undefined;

  // Track latest context_usage data — it provides the most complete snapshot
  let ctxTotal: number | undefined;
  let ctxInput: number | undefined;
  let ctxOutput: number | undefined;
  let ctxLimit: number | undefined;
  let ctxModel: string | undefined;
  let ctxProvider: string | undefined;
  let ctxCost: number | undefined;

  for (const msg of chatMessages) {
    for (const block of msg.blocks) {
      if (block.kind === 'result' && block.tokenUsage) {
        inputTokens += block.tokenUsage.input;
        outputTokens += block.tokenUsage.output;
      }
      if (block.kind === 'context_usage') {
        // Discriminated union narrowing is flaky — access via Record cast
        const ctx = block as Record<string, unknown>;
        if (ctx.input != null) ctxInput = ctx.input as number;
        if (ctx.output != null) ctxOutput = ctx.output as number;
        if (ctx.total != null) ctxTotal = ctx.total as number;
        if (ctx.contextLimit != null) ctxLimit = ctx.contextLimit as number;
        if (ctx.model != null) ctxModel = ctx.model as string;
        if (ctx.provider != null) ctxProvider = ctx.provider as string;
        if (ctx.totalCost != null) ctxCost = ctx.totalCost as number;
      }
      if (block.kind === 'session_init' && block.model) {
        model = block.model;
      }
    }
  }

  // Use context_usage totals if available (they come from the edge server's accurate tokenizer)
  if (ctxInput != null) inputTokens = ctxInput;
  if (ctxOutput != null) outputTokens = ctxOutput;
  if (ctxLimit != null) contextLimit = ctxLimit;
  if (ctxModel) model = ctxModel;
  if (ctxProvider) provider = ctxProvider;
  if (ctxCost != null) totalCost = ctxCost;

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) return null;

  // Flatten to simple {role, content} for the breakdown algorithm
  const flatMessages = chatMessages.map((msg) => ({
    role: msg.role,
    content: msg.blocks
      .filter(
        (b) => b.kind === 'text' || b.kind === 'thinking' || b.kind === 'code',
      )
      .map((b) => ('content' in b ? (b.content as string) : ''))
      .join('\n'),
  }));

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    contextLimit,
    model,
    provider,
    totalCost,
    messages: flatMessages,
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
          <span className={styles.chevron + (expanded ? ' ' + styles.chevronDown : '')}>▸</span>
        )}
      </button>
      {expanded && tc.output && (
        <pre className={styles.toolCallOutput}>{tc.output.slice(0, 5000)}</pre>
      )}
    </div>
  );
}

/** Format milliseconds into a human-readable duration like "2m 34s" or "1h 5m". */
function formatElapsed(ms: number | undefined | null): string {
  if (ms == null || ms <= 0) return '-';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function RunDetail({
  run,
  toolCalls,
  changedFiles,
  outputText,
  diffs,
  onCancel,
  chatMessages,
}: Props) {
  const { t } = useTranslation();

  const metrics = useMemo(() => buildMetrics(chatMessages), [chatMessages]);

  // ── Hub event summary ────────────────────────────
  const getTaskByRunId = useTaskBridgeStore((s) => s.getTaskByRunId);
  const hubTaskId: string | undefined = useMemo(() => {
    if (!run?.runId) return undefined;
    return getTaskByRunId(run.runId)?.taskId;
  }, [run?.runId, getTaskByRunId]);

  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const [eventSummary, setEventSummary] = useState<AgentRunEventSummary | null>(null);

  useEffect(() => {
    if (!hubTaskId) {
      setEventSummary(null);
      return;
    }
    let cancelled = false;
    hubClient.getTaskRunEventSummary(hubTaskId).then((summary) => {
      if (!cancelled) setEventSummary(summary);
    }).catch(() => {
      if (!cancelled) setEventSummary(null);
    });
    return () => { cancelled = true; };
  }, [hubTaskId, hubClient]);

  const hasSummary = eventSummary != null;

  // ── Artifact browser "Apply" → diff review focus ──
  const [appliedArtifactPath, setAppliedArtifactPath] = useState<string | null>(null);

  const handleApplyDiff = (artifact: ArtifactItem) => {
    setAppliedArtifactPath(artifact.path);
    // Dispatch custom event so parents / extensions can react
    window.dispatchEvent(
      new CustomEvent('agenthub:apply-artifact-diff', {
        detail: { artifactId: artifact.id, path: artifact.path, title: artifact.title },
      }),
    );
  };

  if (!run) {
    return (
      <div className={styles.panel}>
        <div className={styles.title}>{t('run.title')}</div>
        <div className={styles.empty}>{t('run.empty')}</div>
      </div>
    );
  }

  // Normalize legacy status strings → RunState enum values
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

  const hasAnyContent = hasOutput || hasToolCalls || hasFileChanges;
  const hasDiffs = diffs && diffs.length > 0;
  const latestFiles = changedFiles.slice(-4).reverse();

  // ── Git status integration ──
  const workDir = useMemo(() => getSavedWorkDir(), []);
  const { status: gitStatus } = useGitStatus(workDir || undefined);
  const { allDiffs: gitDiffs, stagedDiffs: gitStagedDiffs, unstagedDiffs: gitUnstagedDiffs } = useGitDiff(workDir || undefined);

  const latestTools = toolCalls.slice(-4).reverse();

  // Show cancel button while the run is active (not terminal, not IDLE)
  const isActive =
    resolvedStatus !== RunState.COMPLETED &&
    resolvedStatus !== RunState.FAILED &&
    resolvedStatus !== RunState.CANCELLED &&
    resolvedStatus !== RunState.IDLE;

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

      {/* ── Hub Event Summary ── */}
      {hasSummary && (
        <div className={styles.section}>
          <div className={styles.cardHeader}>
            <Activity size={14} />
            <span>{t('run.summary.title')}</span>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <Layers size={12} className={styles.summaryIcon} />
              <span className={styles.summaryLabel}>{t('run.summary.steps')}</span>
              <span className={styles.summaryValue}>{eventSummary.step_count}</span>
            </div>
            <div className={styles.summaryItem}>
              <Clock size={12} className={styles.summaryIcon} />
              <span className={styles.summaryLabel}>{t('run.summary.elapsed')}</span>
              <span className={styles.summaryValue}>{formatElapsed(eventSummary.elapsed_ms)}</span>
            </div>
            <div className={styles.summaryItem}>
              <CheckCircle size={12} className={styles.summaryIcon} />
              <span className={styles.summaryLabel}>{t('run.summary.approvals')}</span>
              <span className={styles.summaryValue}>{eventSummary.approval_count}</span>
            </div>
            <div className={styles.summaryItem}>
              <FileText size={12} className={styles.summaryIcon} />
              <span className={styles.summaryLabel}>{t('run.summary.artifacts')}</span>
              <span className={styles.summaryValue}>{eventSummary.artifact_count}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Diff Review Panel: primary view when diffs exist ── */}
      {hasDiffs && (
        <div className={styles.diffReviewPrimary}>
          <DiffReviewPanel
            files={diffs}
            focusedFilePath={appliedArtifactPath ?? undefined}
            labels={{
              empty: t('diffReview.empty'),
              original: t('diffReview.original'),
              modified: t('diffReview.modified'),
              acceptAll: t('diffReview.acceptAll'),
              rejectAll: t('diffReview.rejectAll'),
              acceptLine: t('diffReview.acceptLine'),
              rejectLine: t('diffReview.rejectLine'),
            }}
          />
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

          {/* ── Artifact Browser: generated files gallery ── */}
          <section className={styles.cardSection}>
            <div className={styles.cardHeader}>
              <FolderOpen size={14} />
              <span>{t('run.artifact.browser.title')}</span>
            </div>
            <ArtifactBrowser
              toolCallOutputs={toolCalls.map((tc) => ({
                callId: tc.callId,
                toolName: tc.toolName,
                output: tc.output,
              }))}
              outputText={outputText}
              chatMessages={chatMessages}
              onApplyDiff={handleApplyDiff}
            />
          </section>

          {/* Unified DiffViewer kept as supplementary detailed view when diffs exist */}
          {hasDiffs && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <FileText size={14} />
                <span>{t('run.preview')}</span>
                <span className={styles.cardCount}>{diffs.length}</span>
              </div>
              <DiffViewer
                files={diffs}
                gitFiles={gitDiffs.length > 0 ? gitDiffs : undefined}
                gitStagedFiles={gitStagedDiffs.length > 0 ? gitStagedDiffs : undefined}
                gitUnstagedFiles={gitUnstagedDiffs.length > 0 ? gitUnstagedDiffs : undefined}
                gitBranch={gitStatus?.branch ?? null}
              />
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
