import React from 'react';
import type { TranscriptBlock, TranscriptAuthor } from '../transcript';
import {
  AgentMessage,
  UserMessage,
  ToolCardBlock,
  FileChangeCard,
  DiffCard,
  ThinkingBlock,
  SubagentBlock,
  ChildAgentBlock,
  ResultBlock,
  RouteDecisionBlock,
  ContextUsageBlock,
  DateDivider,
  PinnedAnnouncement,
  RunSessionCard,
  AgentTimeline,
  RunStepGroup,
  ApprovalCardBlock,
} from './blocks';
import styles from './AgentHubWorkbench.module.css';

export interface TranscriptViewProps {
  transcript: TranscriptBlock[];
  contextBlockId?: string | undefined;
  actionedBlockIds?: string[] | undefined;
  selectedBlockIds?: string[] | undefined;
  selectionMode?: boolean | undefined;
  softHiddenBlockIds?: string[] | undefined;
  onBlockContextMenu?: ((block: TranscriptBlock, event: React.MouseEvent<HTMLElement>) => void) | undefined;
  onBlockSelect?: ((blockId: string) => void) | undefined;
  /** Optional pinned announcement to show at the top of the transcript. */
  pinnedAnnouncement?: {
    title: string;
    content: string;
    author?: string | undefined;
    time?: string | undefined;
    onCopy?: (() => void) | undefined;
    onDismiss?: (() => void) | undefined;
  } | undefined;
}

export function TranscriptView({
  actionedBlockIds = [],
  contextBlockId,
  onBlockContextMenu,
  onBlockSelect,
  selectedBlockIds = [],
  selectionMode = false,
  softHiddenBlockIds = [],
  transcript,
  pinnedAnnouncement,
}: TranscriptViewProps): React.ReactElement {
  const actionedIds = new Set(actionedBlockIds);
  const selectedIds = new Set(selectedBlockIds);
  const softHiddenIds = new Set(softHiddenBlockIds);

  return (
    <section aria-label="Transcript" className={styles.transcriptRegion}>
      {pinnedAnnouncement && (
        <div className={styles.pinnedAnnouncementWrap}>
          <PinnedAnnouncement
            title={pinnedAnnouncement.title}
            content={pinnedAnnouncement.content}
            author={pinnedAnnouncement.author}
            time={pinnedAnnouncement.time}
            onCopy={pinnedAnnouncement.onCopy}
            onDismiss={pinnedAnnouncement.onDismiss}
          />
        </div>
      )}

      <ol className={styles.transcript}>
        {transcript.map((block, index) => {
          const showDateDivider =
            Boolean(block.createdAt) && (
              index === 0 || shouldShowDateDivider(transcript[index - 1]!, block)
            );

          return (
            <React.Fragment key={block.id}>
              {showDateDivider && <DateDivider date={formatBlockDate(block)} />}
              <li
                className={[
                  styles.block,
                  contextBlockId === block.id ? styles.blockContext : '',
                  selectedIds.has(block.id) ? styles.blockSelected : '',
                  actionedIds.has(block.id) ? styles.blockActioned : '',
                  softHiddenIds.has(block.id) ? styles.blockSoftHidden : '',
                ].filter(Boolean).join(' ')}
                aria-selected={selectedIds.has(block.id)}
                data-selectable-card={block.id}
                data-card-state={[
                  contextBlockId === block.id ? 'context' : '',
                  selectedIds.has(block.id) ? 'selected' : '',
                  actionedIds.has(block.id) ? 'actioned' : '',
                  softHiddenIds.has(block.id) ? 'soft-hidden' : '',
                ].filter(Boolean).join(' ')}
                onClick={selectionMode ? () => onBlockSelect?.(block.id) : undefined}
                onContextMenu={(event) => onBlockContextMenu?.(block, event)}
              >
                {renderTranscriptBlock(block)}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </section>
  );
}

/* ═══ Block renderer ═══ */

function renderTranscriptBlock(block: TranscriptBlock): React.ReactElement {
  switch (block.kind) {
    case 'text':
      return renderTextBlock(block);
    case 'tool_call':
      return renderToolCallBlock(block);
    case 'artifact':
      return renderArtifactBlock(block);
    case 'diff':
      return renderDiffBlock(block);
    case 'approval':
      return renderApprovalBlock(block);
    case 'run_session':
      return renderRunSessionBlock(block);
    case 'agent_timeline':
      return renderAgentTimelineBlock(block);
    case 'run_step_group':
      return renderRunStepGroupBlock(block);
    case 'thinking':
      return renderThinkingBlock(block);
    case 'subagent':
      return renderSubagentBlock(block);
    case 'child_agent':
      return renderChildAgentBlock(block);
    case 'route_decision':
      return renderRouteDecisionBlock(block);
    case 'context_usage':
      return renderContextUsageBlock(block);
    case 'result':
      return renderResultBlock(block);
    default:
      return <p className={styles.blockText}>{JSON.stringify(block)}</p>;
  }
}

/* ── Text block ── */

function renderTextBlock(block: Extract<TranscriptBlock, { kind: 'text' }>): React.ReactElement {
  if (isAgentAuthor(block.author)) {
    const time = formatBlockTime(block.createdAt);

    return (
      <AgentMessage
        avatar={agentAvatar(block.author.name)}
        avatarColor={agentAvatarColor(block.author.name)}
        {...agentMessageBadge(block)}
        {...(time ? { time } : {})}
        name={block.author.name}
      >
        {renderAgentText(block.text)}
      </AgentMessage>
    );
  }

  return (
    <UserMessage>
      <p className={styles.blockText}>{block.text}</p>
    </UserMessage>
  );
}

function renderAgentText(text: string): React.ReactElement {
  const [title, rest] = splitAgentText(text);
  if (!rest) {
    return <p className={styles.blockText}>{title}</p>;
  }

  return (
    <>
      <div className={styles.inlineTitle}>{title}</div>
      <div className={styles.inlineMutedLoose}>{rest}</div>
    </>
  );
}

function splitAgentText(text: string): [string, string] {
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex > 0 && newlineIndex < text.length - 1) {
    return [
      text.slice(0, newlineIndex).trim(),
      text.slice(newlineIndex + 1).trim(),
    ];
  }

  const sentenceEnd = text.indexOf('。');
  if (sentenceEnd <= 0 || sentenceEnd >= text.length - 1) {
    return [text, ''];
  }

  return [
    text.slice(0, sentenceEnd),
    text.slice(sentenceEnd + 1),
  ];
}

/* ── Tool call block ── */

function renderToolCallBlock(
  block: Extract<TranscriptBlock, { kind: 'tool_call' }>,
): React.ReactElement {
  const evidence = block.evidenceRefs?.find((ref) => ref.path) ?? block.evidenceRefs?.find((ref) => ref.kind === 'tool');
  const target = block.target ?? evidence?.path ?? evidence?.label;

  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <div className={styles.agentRunDetail}>
          <ToolCardBlock
            toolName={block.toolName}
            status={block.status}
            path={target}
            description={block.summary}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Artifact block ── */

function renderArtifactBlock(
  block: Extract<TranscriptBlock, { kind: 'artifact' }>,
): React.ReactElement {
  const fileRef = block.evidenceRefs?.find((ref) => ref.kind === 'file');

  if (fileRef?.path) {
    return (
      <div className={styles.agentBlockRow}>
        <div className={styles.agentRunShell}>
          <FileChangeCard
            path={fileRef.path}
            action={block.action ?? 'modified'}
            {...(block.additions != null ? { additions: block.additions } : {})}
            {...(block.deletions != null ? { deletions: block.deletions } : {})}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.blockTitle}>
      {block.title}
    </div>
  );
}

/* ── Diff block ── */

function renderDiffBlock(
  block: Extract<TranscriptBlock, { kind: 'diff' }>,
): React.ReactElement {
  const filename = block.files[0] ?? block.title;
  const additions = block.additions ?? 0;
  const deletions = block.deletions ?? 0;
  const lines = block.lines ?? [];

  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <DiffCard
          filename={filename}
          additions={additions}
          deletions={deletions}
          lines={lines}
        />
      </div>
    </div>
  );
}

/* ── Approval block ── */

function renderApprovalBlock(
  block: Extract<TranscriptBlock, { kind: 'approval' }>,
): React.ReactElement {
  return (
    <ApprovalCardBlock
      id={block.id}
      reason={block.reason}
      risk={block.risk}
      status={block.status}
      title={block.title}
      toolName={block.toolName}
    />
  );
}

function renderRunSessionBlock(
  block: Extract<TranscriptBlock, { kind: 'run_session' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <RunSessionCard
          meta={block.meta}
          runId={block.runId}
          status={block.status}
          title={block.title}
        />
      </div>
    </div>
  );
}

function renderAgentTimelineBlock(
  block: Extract<TranscriptBlock, { kind: 'agent_timeline' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <AgentTimeline items={block.items} title={block.title ?? '运行时间线'} />
      </div>
    </div>
  );
}

function renderRunStepGroupBlock(
  block: Extract<TranscriptBlock, { kind: 'run_step_group' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <RunStepGroup
        defaultOpen={block.open}
        icon={block.icon}
        {...(block.meta ? { meta: block.meta } : {})}
        status={block.status}
        title={block.title}
      >
        {block.children.map((child) => (
          <React.Fragment key={child.id}>{renderRunStepChild(child)}</React.Fragment>
        ))}
      </RunStepGroup>
    </div>
  );
}

function renderRunStepChild(block: TranscriptBlock): React.ReactElement {
  switch (block.kind) {
    case 'tool_call': {
      const evidence = block.evidenceRefs?.find((ref) => ref.path) ?? block.evidenceRefs?.find((ref) => ref.kind === 'tool');
      const target = block.target ?? evidence?.path ?? evidence?.label;
      return (
        <ToolCardBlock
          description={block.summary}
          path={target}
          status={block.status}
          toolName={block.toolName}
        />
      );
    }
    case 'artifact': {
      const fileRef = block.evidenceRefs?.find((ref) => ref.kind === 'file');
      return (
        <FileChangeCard
          action={block.action ?? 'modified'}
          {...(block.additions != null ? { additions: block.additions } : {})}
          {...(block.deletions != null ? { deletions: block.deletions } : {})}
          onReview={() => undefined}
          path={fileRef?.path ?? block.title}
        />
      );
    }
    case 'diff':
      return (
        <DiffCard
          additions={block.additions ?? 0}
          deletions={block.deletions ?? 0}
          filename={block.files[0] ?? block.title}
          lines={block.lines ?? []}
        />
      );
    case 'thinking':
      return renderNestedThinkingDetail(block);
    default:
      return renderTranscriptBlock(block);
  }
}

/* ── V4 detail blocks ── */

function renderThinkingBlock(
  block: Extract<TranscriptBlock, { kind: 'thinking' }>,
): React.ReactElement {
  return (
    <ThinkingBlock
      content={block.content}
      isThinking={block.isThinking ?? isEvidenceRunning(block)}
    />
  );
}

function renderNestedThinkingDetail(
  block: Extract<TranscriptBlock, { kind: 'thinking' }>,
): React.ReactElement {
  const running = block.isThinking ?? isEvidenceRunning(block);
  return (
    <div className={styles.runStepThinkingDetail} data-card-surface>
      <div className={styles.runStepThinkingHead}>
        <strong>{running ? '当前推理' : '推理摘要'}</strong>
        <em>{running ? '运行中' : '完成'}</em>
      </div>
      {block.content ? <p>{block.content}</p> : null}
    </div>
  );
}

function renderSubagentBlock(
  block: Extract<TranscriptBlock, { kind: 'subagent' }>,
): React.ReactElement {
  return (
    <SubagentBlock
      runId={block.runId}
      status={block.status}
      summary={block.summary}
      title={block.title}
      worker={block.worker}
    />
  );
}

function renderChildAgentBlock(
  block: Extract<TranscriptBlock, { kind: 'child_agent' }>,
): React.ReactElement {
  return (
    <ChildAgentBlock
      agent={block.agent}
      parentRunId={block.parentRunId}
      runId={block.runId}
      status={block.status}
      summary={block.summary}
      title={block.title}
    />
  );
}

function renderRouteDecisionBlock(
  block: Extract<TranscriptBlock, { kind: 'route_decision' }>,
): React.ReactElement {
  return (
    <RouteDecisionBlock
      action={block.action}
      summary={block.summary}
      targetAgent={block.targetAgent}
    />
  );
}

function renderContextUsageBlock(
  block: Extract<TranscriptBlock, { kind: 'context_usage' }>,
): React.ReactElement {
  const usagePercent = block.usagePercent ?? (
    block.contextLimit
      ? ((block.inputTokens + block.outputTokens) / block.contextLimit) * 100
      : 0
  );

  return (
    <ContextUsageBlock
      cachePercent={block.cachePercent}
      contextLimit={block.contextLimit}
      cost={block.cost}
      inputTokens={block.inputTokens}
      modelLabel={block.modelLabel}
      outputTokens={block.outputTokens}
      usagePercent={usagePercent}
    />
  );
}

function renderResultBlock(
  block: Extract<TranscriptBlock, { kind: 'result' }>,
): React.ReactElement {
  return (
    <ResultBlock
      duration={block.duration}
      success={block.success}
      summary={block.summary}
      turns={block.turns}
    />
  );
}

/* ═══ Helpers ═══ */

function isAgentAuthor(author: TranscriptAuthor): boolean {
  return author.role === 'agent';
}

function agentAvatar(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

function agentAvatarColor(name: string): string {
  const key = name.trim().toLowerCase();
  if (key.includes('builder')) return 'var(--role-builder)';
  if (key.includes('reviewer')) return 'var(--role-reviewer)';
  if (key.includes('deployer')) return 'var(--role-deployer)';
  if (key.includes('orchestrator')) return 'var(--role-orchestrator)';
  if (key.includes('researcher')) return 'var(--role-researcher)';
  return 'var(--surface-highest)';
}

function agentMessageBadge(
  block: Extract<TranscriptBlock, { kind: 'text' }>,
): { badgeLabel?: string; badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary' } {
  const statuses = block.evidenceRefs?.map((ref) => ref.status).filter(Boolean) ?? [];
  if (statuses.includes('running')) return { badgeLabel: '运行中', badgeVariant: 'thinking' };
  if (statuses.includes('pending')) return { badgeLabel: '待执行', badgeVariant: 'primary' };
  if (statuses.includes('failed')) return { badgeLabel: '失败', badgeVariant: 'danger' };
  if (statuses.length > 0 && statuses.every((status) => status === 'completed')) {
    return { badgeLabel: '完成', badgeVariant: 'success' };
  }
  return {};
}

function formatBlockTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  });
}

function isEvidenceRunning(block: TranscriptBlock): boolean {
  return block.evidenceRefs?.some((ref) => ref.status === 'running') ?? false;
}

/**
 * Checks whether a date divider should appear between two blocks.
 * Returns false when no date data is available.
 */
function shouldShowDateDivider(prev: TranscriptBlock, next: TranscriptBlock): boolean {
  if (!prev.createdAt || !next.createdAt) return false;
  const prevDate = dayKey(prev.createdAt);
  const nextDate = dayKey(next.createdAt);
  return Boolean(prevDate && nextDate && prevDate !== nextDate);
}

/** Returns a human-readable date string for a block. */
function formatBlockDate(block: TranscriptBlock): string {
  if (!block.createdAt) return '';
  const parsed = new Date(block.createdAt);
  if (Number.isNaN(parsed.getTime())) return '';
  const date = parsed.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const time = parsed.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}

function dayKey(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-CA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
