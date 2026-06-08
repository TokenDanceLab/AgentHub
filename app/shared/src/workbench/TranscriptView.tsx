import React from 'react';
import type { TranscriptBlock, TranscriptAuthor } from '../transcript';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import type { FileItem } from './inspector';
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
  AgentTimeline,
  RunSessionCard,
  RunStepGroup,
  ApprovalCardBlock,
} from './blocks';
import styles from './AgentHubWorkbench.module.css';

const USER_AVATAR_GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface TranscriptContextMenuEvent {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
}

export interface TranscriptPointerEvent {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
  currentTarget: HTMLElement;
}

export interface TranscriptViewProps {
  transcript: TranscriptBlock[];
  contextBlockId?: string | undefined;
  actionedBlockIds?: string[] | undefined;
  selectedBlockIds?: string[] | undefined;
  selectionMode?: boolean | undefined;
  softHiddenBlockIds?: string[] | undefined;
  onBlockContextMenu?: ((block: TranscriptBlock, event: TranscriptContextMenuEvent) => void) | undefined;
  onBlockPointerDown?: ((block: TranscriptBlock, event: TranscriptPointerEvent) => void) | undefined;
  onBlockPointerMove?: ((block: TranscriptBlock, event: TranscriptPointerEvent) => void) | undefined;
  onBlockPointerUp?: ((block: TranscriptBlock, event: TranscriptPointerEvent) => void) | undefined;
  onBlockSelect?: ((blockId: string, event?: { shiftKey?: boolean }) => void) | undefined;
  onAgentProfileOpen?: ((agentName: string, anchor: HTMLElement) => void) | undefined;
  onReviewFile?: ((file: FileItem) => void) | undefined;
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
  onBlockPointerDown,
  onBlockPointerMove,
  onBlockPointerUp,
  onBlockSelect,
  onAgentProfileOpen,
  onReviewFile,
  selectedBlockIds = [],
  selectionMode = false,
  softHiddenBlockIds = [],
  transcript,
  pinnedAnnouncement,
}: TranscriptViewProps): React.ReactElement {
  const [expandedDiffIds, setExpandedDiffIds] = React.useState<Set<string>>(() => new Set());
  const actionedIds = new Set(actionedBlockIds);
  const selectedIds = new Set(selectedBlockIds);
  const softHiddenIds = new Set(softHiddenBlockIds);
  const visibleTranscript = transcript;
  const diffControls = React.useMemo<InlineDiffControls>(() => ({
    expandedDiffIds,
    onToggleDiff: (diffId: string) => {
      setExpandedDiffIds((current) => {
        const next = new Set(current);
        if (next.has(diffId)) {
          next.delete(diffId);
        } else {
          next.add(diffId);
        }
        return next;
      });
    },
  }), [expandedDiffIds]);

  return (
    <section
      aria-label="Transcript"
      className={styles.transcriptRegion}
      data-pinned={pinnedAnnouncement ? 'true' : 'false'}
    >
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

      <ol className={styles.transcript} data-transcript-list>
        {visibleTranscript.map((block, index) => {
          const showDateDivider =
            Boolean(block.createdAt) && (
              index === 0 || shouldShowDateDivider(visibleTranscript[index - 1]!, block)
            );
          const hideGroupedUserAvatar = !showDateDivider && shouldHideGroupedUserAvatar(block, visibleTranscript[index - 1]);

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
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && selectionMode) {
                    event.preventDefault();
                    onBlockSelect?.(block.id, { shiftKey: event.shiftKey });
                    return;
                  }
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onBlockContextMenu?.(block, {
                      preventDefault: () => undefined,
                      clientX: rect.left + 28,
                      clientY: rect.top + 16,
                    });
                  }
                }}
                onContextMenu={(event) => onBlockContextMenu?.(block, event)}
                onPointerCancel={(event) => onBlockPointerUp?.(block, event)}
                onPointerDown={(event) => onBlockPointerDown?.(block, event)}
                onPointerLeave={(event) => onBlockPointerUp?.(block, event)}
                onPointerMove={(event) => onBlockPointerMove?.(block, event)}
                onPointerUp={(event) => onBlockPointerUp?.(block, event)}
                tabIndex={0}
              >
                {renderTranscriptBlock(block, onAgentProfileOpen, onReviewFile, hideGroupedUserAvatar, diffControls)}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </section>
  );
}

/* ═══ Block renderer ═══ */

function renderTranscriptBlock(
  block: TranscriptBlock,
  onAgentProfileOpen?: ((agentName: string, anchor: HTMLElement) => void) | undefined,
  onReviewFile?: ((file: FileItem) => void) | undefined,
  hideUserAvatar = false,
  diffControls?: InlineDiffControls | undefined,
): React.ReactElement {
  switch (block.kind) {
    case 'text':
      return renderTextBlock(block, onAgentProfileOpen, hideUserAvatar);
    case 'tool_call':
      return renderToolCallBlock(block);
    case 'artifact':
      return renderArtifactBlock(block, onReviewFile, diffControls);
    case 'diff':
      return renderDiffBlock(block);
    case 'approval':
      return renderApprovalBlock(block);
    case 'agent_timeline':
      return renderAgentTimelineBlock(block);
    case 'run_session':
      return renderRunSessionBlock(block);
    case 'run_step_group':
      return renderRunStepGroupBlock(block, onReviewFile, diffControls);
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

interface InlineDiffControls {
  expandedDiffIds: Set<string>;
  onToggleDiff(diffId: string): void;
}

/* ── Text block ── */

function renderTextBlock(
  block: Extract<TranscriptBlock, { kind: 'text' }>,
  onAgentProfileOpen?: ((agentName: string, anchor: HTMLElement) => void) | undefined,
  hideUserAvatar = false,
): React.ReactElement {
  if (!isCurrentUserAuthor(block.author)) {
    const time = formatBlockTime(block.createdAt);

    return (
      <AgentMessage
        avatar={agentAvatar(block.author.name)}
        avatarColor={agentAvatarColor(block.author.name)}
        {...agentMessageBadge(block)}
        {...(time ? { time } : {})}
        name={block.author.name}
        onAvatarClick={onAgentProfileOpen}
      >
        {renderAgentText(block)}
      </AgentMessage>
    );
  }

  return (
    <UserMessage hideAvatar={hideUserAvatar} avatarInitials={agentAvatar(block.author.name)}>
      <p className={styles.blockText}>{block.text}</p>
    </UserMessage>
  );
}

function renderAgentText(block: Extract<TranscriptBlock, { kind: 'text' }>): React.ReactElement {
  const [title, rest] = agentTextParts(block);
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

function agentTextParts(block: Extract<TranscriptBlock, { kind: 'text' }>): [string, string] {
  const title = block.displayTitle?.trim();
  const detail = block.displayDetail?.trim();
  if (title) return [title, detail ?? ''];
  return splitAgentText(block.text);
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
  onReviewFile?: ((file: FileItem) => void) | undefined,
  diffControls?: InlineDiffControls | undefined,
  pairedDiff?: Extract<TranscriptBlock, { kind: 'diff' }> | undefined,
): React.ReactElement {
  const fileRef = block.evidenceRefs?.find((ref) => ref.kind === 'file');
  const path = fileRef?.path ?? fileRef?.label;

  if (path) {
    return (
      <div className={styles.agentBlockRow}>
        <div className={styles.agentRunShell}>
          <FileChangeCard
            path={path}
            action={block.action ?? 'modified'}
            {...(block.additions != null ? { additions: block.additions } : {})}
            {...(block.deletions != null ? { deletions: block.deletions } : {})}
            {...(pairedDiff && diffControls ? {
              diffExpanded: diffControls.expandedDiffIds.has(pairedDiff.id),
              onToggleDiff: () => diffControls.onToggleDiff(pairedDiff.id),
            } : {})}
            onReview={onReviewFile ? () => onReviewFile(fileItemFromPath(path)) : undefined}
          />
          {pairedDiff && diffControls?.expandedDiffIds.has(pairedDiff.id) && (
            <DiffCard
              additions={pairedDiff.additions ?? block.additions ?? 0}
              deletions={pairedDiff.deletions ?? block.deletions ?? 0}
              filename={pairedDiff.files[0] ?? path}
              lines={pairedDiff.lines ?? []}
            />
          )}
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

function renderRunSessionBlock(
  block: Extract<TranscriptBlock, { kind: 'run_session' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <RunSessionCard
          adapterId={block.adapterId}
          deviceId={block.deviceId}
          edgeRunId={block.edgeRunId}
          meta={block.meta}
          modeLabel={block.modeLabel}
          runId={block.runId}
          sourceLabel={block.sourceLabel}
          status={block.status}
          targetLabel={block.targetLabel}
          taskId={block.taskId}
          title={block.title}
        />
      </div>
    </div>
  );
}

function renderRunStepGroupBlock(
  block: Extract<TranscriptBlock, { kind: 'run_step_group' }>,
  onReviewFile?: ((file: FileItem) => void) | undefined,
  diffControls?: InlineDiffControls | undefined,
): React.ReactElement {
  const renderedChildren: React.ReactNode[] = [];
  const consumedDiffIds = new Set<string>();
  for (let index = 0; index < block.children.length; index += 1) {
    const child = block.children[index]!;
    if (child.kind === 'diff' && consumedDiffIds.has(child.id)) continue;
    if (child.kind === 'artifact') {
      const pairedDiff = findPairedDiffBlock(child, block.children, consumedDiffIds);
      if (pairedDiff) consumedDiffIds.add(pairedDiff.id);
      renderedChildren.push(
        <React.Fragment key={child.id}>
          {renderRunStepChild(child, onReviewFile, diffControls, pairedDiff)}
        </React.Fragment>,
      );
      continue;
    }
    renderedChildren.push(
      <React.Fragment key={child.id}>{renderRunStepChild(child, onReviewFile, diffControls)}</React.Fragment>,
    );
  }

  return (
    <div className={styles.agentBlockRow}>
      <RunStepGroup
        defaultOpen={block.open}
        icon={block.icon}
        {...(block.meta ? { meta: block.meta } : {})}
        status={block.status}
        title={block.title}
      >
        {renderedChildren}
      </RunStepGroup>
    </div>
  );
}

function findPairedDiffBlock(
  artifact: Extract<TranscriptBlock, { kind: 'artifact' }>,
  siblings: TranscriptBlock[],
  consumedDiffIds: Set<string>,
): Extract<TranscriptBlock, { kind: 'diff' }> | undefined {
  const artifactPath = artifactFilePath(artifact);
  if (!artifactPath) return undefined;
  return siblings.find((candidate): candidate is Extract<TranscriptBlock, { kind: 'diff' }> => (
    candidate.kind === 'diff'
    && !consumedDiffIds.has(candidate.id)
    && candidate.files.some((file) => file === artifactPath)
  ));
}

function artifactFilePath(block: Extract<TranscriptBlock, { kind: 'artifact' }>): string | undefined {
  const fileRef = block.evidenceRefs?.find((ref) => ref.kind === 'file');
  return fileRef?.path ?? fileRef?.label ?? block.title;
}

function renderRunStepChild(
  block: TranscriptBlock,
  onReviewFile?: ((file: FileItem) => void) | undefined,
  diffControls?: InlineDiffControls | undefined,
  pairedDiff?: Extract<TranscriptBlock, { kind: 'diff' }> | undefined,
): React.ReactElement {
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
      const path = fileRef?.path ?? fileRef?.label ?? block.title;
      return (
        <>
          <FileChangeCard
            action={block.action ?? 'modified'}
            {...(block.additions != null ? { additions: block.additions } : {})}
            {...(block.deletions != null ? { deletions: block.deletions } : {})}
            {...(pairedDiff && diffControls ? {
              diffExpanded: diffControls.expandedDiffIds.has(pairedDiff.id),
              onToggleDiff: () => diffControls.onToggleDiff(pairedDiff.id),
            } : {})}
            onReview={onReviewFile ? () => onReviewFile(fileItemFromPath(path)) : undefined}
            path={path}
          />
          {pairedDiff && diffControls?.expandedDiffIds.has(pairedDiff.id) && (
            <DiffCard
              additions={pairedDiff.additions ?? block.additions ?? 0}
              deletions={pairedDiff.deletions ?? block.deletions ?? 0}
              filename={pairedDiff.files[0] ?? path}
              lines={pairedDiff.lines ?? []}
            />
          )}
        </>
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
      return renderTranscriptBlock(block, undefined, onReviewFile, false, diffControls);
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

function isCurrentUserAuthor(author: TranscriptAuthor): boolean {
  const id = author.id.trim().toLowerCase();
  const name = author.name.trim().toLowerCase();
  return id === 'delicious233' || id === 'delicious' || name === 'delicious233';
}

function agentAvatar(name: string): string {
  return workbenchProfileInitials(name);
}

function agentAvatarColor(name: string): string {
  return workbenchAgentColor({ name });
}

function agentMessageBadge(
  block: Extract<TranscriptBlock, { kind: 'text' }>,
): { badgeLabel?: string; badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary' } {
  if (block.badgeLabel) {
    return {
      badgeLabel: block.badgeLabel,
      badgeVariant: block.badgeVariant ?? 'primary',
    };
  }

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

function shouldHideGroupedUserAvatar(
  current: TranscriptBlock,
  previous: TranscriptBlock | undefined,
): boolean {
  if (!previous) return false;
  if (current.kind !== 'text' || previous.kind !== 'text') return false;
  if (!isCurrentUserAuthor(current.author) || !isCurrentUserAuthor(previous.author)) return false;
  if (current.author.id !== previous.author.id) return false;

  if (!current.createdAt || !previous.createdAt) return true;
  const currentTime = new Date(current.createdAt).getTime();
  const previousTime = new Date(previous.createdAt).getTime();
  if (Number.isNaN(currentTime) || Number.isNaN(previousTime)) return true;

  return currentTime >= previousTime && currentTime - previousTime <= USER_AVATAR_GROUP_WINDOW_MS;
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

function fileItemFromPath(path: string): FileItem {
  return {
    name: path,
    type: fileTypeFromPath(path),
  };
}

function fileTypeFromPath(path: string): FileItem['type'] {
  if (path.endsWith('.md')) return 'md';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'ts';
  if (path.endsWith('.sql') || path.endsWith('.db')) return 'db';
  return 'txt';
}
