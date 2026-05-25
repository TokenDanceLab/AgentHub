import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, TerminalSquare, Wrench } from 'lucide-react';
import type { RunInfo } from '@shared/types';
import type { FileDiff, ChatMessage } from './ChatView.types';
import type { SessionMetrics } from '@shared/context/breakdown';
import { RunState } from '@/utils/runStateMachine';
import { RunStateMachine } from '@/utils/runStateMachine';
import DiffViewer from './DiffViewer';
import ContextUsage from './ContextUsage';
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

/** Build SessionMetrics from chat messages by extracting token data from result blocks. */
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
    model,
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
  const latestFiles = changedFiles.slice(-4).reverse();
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

      {!hasAnyContent && (
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
        <div className={styles.tabContent}>
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

          {diffs && diffs.length > 0 && (
            <section className={styles.cardSection}>
              <div className={styles.cardHeader}>
                <FileText size={14} />
                <span>{t('run.preview')}</span>
                <span className={styles.cardCount}>{diffs.length}</span>
              </div>
              <DiffViewer files={diffs} />
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
