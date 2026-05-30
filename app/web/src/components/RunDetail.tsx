import { useState, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, TerminalSquare, Wrench } from 'lucide-react';
import { ActivityCard, DisclosureRow } from '@shared/ui';
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
    contextLimit: 200000,
    model,
    messages: flatMessages,
  };
}

function ToolCallItem({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = !!tc.output;

  return (
    <DisclosureRow
      className={styles.toolCallItem}
      buttonClassName={styles.toolCallHeader}
      chevronClassName={hasOutput ? styles.chevron : styles.chevronHidden}
      labelClassName={tc.status === 'completed' ? styles.success : styles.pending}
      metaClassName={styles.itemTs}
      label={tc.toolName}
      meta={new Date(tc.timestamp).toLocaleTimeString()}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      disabled={!hasOutput}
      bodyClassName={styles.toolCallBody}
    >
      {tc.output ? (
        <pre className={styles.toolCallOutput}>{tc.output.slice(0, 5000)}</pre>
      ) : null}
    </DisclosureRow>
  );
}

function RunDetailSection({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <ActivityCard
      className={styles.cardSection}
      icon={icon}
      iconClassName={styles.cardSectionIcon}
      label={title}
      labelClassName={styles.cardSectionTitle}
      bodyClassName={styles.cardSectionBody}
      metaClassName={styles.cardSectionHeader}
      contentClassName={styles.cardSectionContent}
      actionsClassName={styles.cardSectionActions}
      actions={typeof count === 'number' ? <span className={styles.cardCount}>{count}</span> : undefined}
      contentAs="div"
    >
      {children}
    </ActivityCard>
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
      <aside className={styles.panel} aria-label={t('run.title')}>
        <div className={styles.title}>{t('run.title')}</div>
        <div className={styles.emptyStack}>
          <ActivityCard
            className={styles.emptyCard}
            icon={<TerminalSquare size={16} />}
            iconClassName={styles.emptyIcon}
            bodyClassName={styles.emptyBody}
            label={t('run.empty')}
          />
          <ActivityCard
            className={styles.emptyCard}
            icon={<FileText size={16} />}
            iconClassName={styles.emptyIcon}
            bodyClassName={styles.emptyBody}
            label={t('run.emptyOutput')}
          />
          <ActivityCard
            className={styles.emptyCard}
            icon={<Wrench size={16} />}
            iconClassName={styles.emptyIcon}
            bodyClassName={styles.emptyBody}
            label={t('run.emptySources')}
          />
        </div>
      </aside>
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
          <ActivityCard
            className={styles.emptyCard}
            icon={<TerminalSquare size={16} />}
            iconClassName={styles.emptyIcon}
            bodyClassName={styles.emptyBody}
            label={t('run.emptyOutput')}
          />
          <ActivityCard
            className={styles.emptyCard}
            icon={<FileText size={16} />}
            iconClassName={styles.emptyIcon}
            bodyClassName={styles.emptyBody}
            label={t('run.emptySources')}
          />
        </div>
      )}

      {hasAnyContent && (
        <div className={styles.tabContent}>
          {hasOutput && (
            <RunDetailSection icon={<TerminalSquare size={14} />} title={t('run.output')}>
              <pre className={styles.output}>{outputText}</pre>
            </RunDetailSection>
          )}

          {hasToolCalls && (
            <RunDetailSection icon={<Wrench size={14} />} title={t('run.toolCalls')} count={toolCalls.length}>
              <div className={styles.list}>
                {latestTools.map((tc) => (
                  <ToolCallItem key={tc.callId} tc={tc} />
                ))}
              </div>
            </RunDetailSection>
          )}

          {hasFileChanges && (
            <RunDetailSection icon={<FileText size={14} />} title={t('run.fileChanges')} count={changedFiles.length}>
              <div className={styles.sourceList}>
                {latestFiles.map((f) => (
                  <ActivityCard
                    key={`${f.path}-${f.timestamp}`}
                    className={styles.sourceItem}
                    bodyClassName={styles.sourceBody}
                    labelClassName={styles.filePath}
                    actionsClassName={styles.sourceAction}
                    label={f.path}
                    actions={<span className={styles.action}>{f.action}</span>}
                  />
                ))}
              </div>
            </RunDetailSection>
          )}

          {diffs && diffs.length > 0 && (
            <RunDetailSection icon={<FileText size={14} />} title={t('run.preview')} count={diffs.length}>
              <DiffViewer files={diffs} />
            </RunDetailSection>
          )}
        </div>
      )}
    </aside>
  );
}
