import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

type TabId = 'output' | 'toolCalls' | 'fileChanges';

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

  const defaultTab: TabId = outputText
    ? 'output'
    : toolCalls.length > 0
      ? 'toolCalls'
      : 'fileChanges';
  const [selectedTab, setSelectedTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    const handler = () => setSelectedTab('fileChanges');
    window.addEventListener('agenthub:open-diff', handler);
    return () => window.removeEventListener('agenthub:open-diff', handler);
  }, []);

  if (!run) {
    return (
      <div className={styles.panel}>
        <div className={styles.title}>{t('run.title')}</div>
        <div className={styles.empty}>No active run</div>
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

  // Resolve the effective tab to display (falls back if the selected tab has no data)
  const activeTab: TabId =
    selectedTab === 'output' && hasOutput
      ? 'output'
      : selectedTab === 'toolCalls' && hasToolCalls
        ? 'toolCalls'
        : selectedTab === 'fileChanges' && hasFileChanges
          ? 'fileChanges'
          : hasOutput
            ? 'output'
            : hasToolCalls
              ? 'toolCalls'
              : 'fileChanges';

  const hasAnyContent = hasOutput || hasToolCalls || hasFileChanges;

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

      {hasAnyContent && (
        <div className={styles.tabContent}>
          {activeTab === 'output' && <pre className={styles.output}>{outputText}</pre>}
          {activeTab === 'toolCalls' && (
            <div className={styles.list}>
              {toolCalls.map((tc) => (
                <ToolCallItem key={tc.callId} tc={tc} />
              ))}
            </div>
          )}
          {activeTab === 'fileChanges' &&
            (diffs && diffs.length > 0 ? (
              <DiffViewer files={diffs} />
            ) : (
              <div className={styles.list}>
                {changedFiles.map((f) => (
                  <div key={f.path} className={styles.item}>
                    <code className={styles.filePath}>{f.path}</code>
                    <span className={styles.action}>{f.action}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </aside>
  );
}
