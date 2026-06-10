import React from 'react';
import type { ApprovalDecisionAction, TranscriptBlock, TranscriptAuthor } from '../transcript';
import type { WorkbenchConversation } from '../platform';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import type { FileItem } from './inspector';
import {
  AgentMessage,
  AttachmentBlock,
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
  ApprovalCardBlock,
  URLPreviewCard,
} from './blocks';
import { StepCard } from '../ui/StepCard';
import MarkdownContent from '../ui/Markdown';
import DeployCard from '../ui/DeployCard';
import { EmptyState } from '../ui/EmptyState';
import type { StepCardSubStep } from '../ui/StepCard';
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
  activeConversation?: WorkbenchConversation | undefined;
  contextBlockId?: string | undefined;
  /** Highlight a specific block (e.g. from search result click). Scrolls into view and applies a 3 s CSS highlight. */
  highlightedBlockId?: string | undefined;
  /** Called when the highlight period ends (after 3 s), allowing the parent to clear the highlightedBlockId. */
  onHighlightEnd?: (() => void) | undefined;
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
  onApprovalDecision?: ((action: ApprovalDecisionAction) => void) | undefined;
  onReviewFile?: ((file: FileItem) => void) | undefined;
  /** Called when a user clicks "Deploy" on a deploy block. */
  onDeploySubmit?: ((runId: string, slug: string) => void) | undefined;
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
  activeConversation,
  contextBlockId,
  highlightedBlockId,
  onHighlightEnd,
  onBlockContextMenu,
  onBlockPointerDown,
  onBlockPointerMove,
  onBlockPointerUp,
  onBlockSelect,
  onAgentProfileOpen,
  onApprovalDecision,
  onReviewFile,
  onDeploySubmit,
  selectedBlockIds = [],
  selectionMode = false,
  softHiddenBlockIds = [],
  transcript,
  pinnedAnnouncement,
}: TranscriptViewProps): React.ReactElement {
  const [expandedDiffIds, setExpandedDiffIds] = React.useState<Set<string>>(() => new Set());
  const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = React.useRef<HTMLOListElement>(null);
  const regionRef = React.useRef<HTMLElement>(null);
  const autoScrollAnchorRef = React.useRef<boolean>(true);

  // Auto-scroll: keep track of whether user is near the bottom of the region
  const handleTranscriptScroll = React.useCallback(() => {
    const el = regionRef.current;
    if (!el) return;
    const threshold = 150;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollAnchorRef.current = distanceFromBottom <= threshold;
  }, []);

  // Compute a scroll key that changes whenever any block's streaming-relevant content changes
  const scrollKey = React.useMemo(() => {
    if (transcript.length === 0) return '';
    const last = transcript[transcript.length - 1];
    if (!last) return String(transcript.length);
    // Include properties that may change during streaming for various block kinds
    return [transcript.length, last.id, (last as any).text, (last as any).content, (last as any).summary, (last as any).status].join('|');
  }, [transcript]);

  // Auto-scroll to bottom when user sends a message or new blocks arrive.
  // Uses scrollTop = scrollHeight (not smooth) to avoid fighting streaming reflows.
  React.useEffect(() => {
    if (transcript.length === 0) return;
    // When the user sends a new message (transcript grew), ALWAYS scroll to bottom.
    // When streaming updates the last block, only scroll if already near bottom.
    const rafId = requestAnimationFrame(() => {
      const el = regionRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(rafId);
  }, [scrollKey]);

  // Scroll to highlighted block when highlightedBlockId changes
  React.useEffect(() => {
    if (!highlightedBlockId) return;
    const el = document.querySelector(`[data-scroll-block="${highlightedBlockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      onHighlightEnd?.();
    }, 3000);
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [highlightedBlockId, onHighlightEnd]);

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
      ref={regionRef}
      onScroll={handleTranscriptScroll}
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

      {visibleTranscript.length === 0 ? (
        <EmptyState
          title="开始对话"
          description="发送消息即可开始与 Agent 对话，工作记录将显示在这里。"
        />
      ) : (
        <ol className={styles.transcript} data-transcript-list ref={transcriptRef}>
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
                    highlightedBlockId === block.id ? styles.blockHighlighted : '',
                    selectedIds.has(block.id) ? styles.blockSelected : '',
                    actionedIds.has(block.id) ? styles.blockActioned : '',
                    softHiddenIds.has(block.id) ? styles.blockSoftHidden : '',
                  ].filter(Boolean).join(' ')}
                  aria-selected={selectedIds.has(block.id)}
                  data-message-id={block.id}
                  data-scroll-block={block.id}
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
                  {renderTranscriptBlock(
                    block,
                    onAgentProfileOpen,
                    onReviewFile,
                    hideGroupedUserAvatar,
                    diffControls,
                    onApprovalDecision,
                    onDeploySubmit,
                    activeConversation,
                  )}
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      )}
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
  onApprovalDecision?: ((action: ApprovalDecisionAction) => void) | undefined,
  onDeploySubmit?: ((runId: string, slug: string) => void) | undefined,
  activeConversation?: WorkbenchConversation | undefined,
): React.ReactElement {
  switch (block.kind) {
    case 'text':
      return renderTextBlock(block, onAgentProfileOpen, hideUserAvatar, activeConversation);
    case 'tool_call':
      return renderToolCallBlock(block);
    case 'tool_result':
      return renderToolResultBlock(block);
    case 'artifact':
      return renderArtifactBlock(block, onReviewFile, diffControls);
    case 'preview':
      return renderPreviewBlock(block);
    case 'file_change':
      return renderFileChangeBlock(block, onReviewFile, diffControls);
    case 'diff':
      return renderDiffBlock(block);
    case 'approval':
      return renderApprovalBlock(block);
    case 'permission_request':
      return renderPermissionRequestBlock(block, onApprovalDecision);
    case 'permission_result':
      return renderPermissionResultBlock(block);
    case 'agent_timeline':
      return renderAgentTimelineBlock(block);
    case 'run_session':
      return renderRunSessionBlock(block);
    case 'run_step_group':
      return renderRunStepGroupBlock(block, onReviewFile, diffControls, onApprovalDecision);
    case 'thinking':
      return renderThinkingBlock(block);
    case 'subagent':
      return renderSubagentBlock(block);
    case 'subtask':
      return renderSubtaskBlock(block);
    case 'child_agent':
      return renderChildAgentBlock(block);
    case 'route_decision':
      return renderRouteDecisionBlock(block);
    case 'context_usage':
      return renderContextUsageBlock(block);
    case 'result':
      return renderResultBlock(block);
    case 'failure':
      return renderFailureBlock(block);
    case 'finished':
      return renderFinishedBlock(block);
    case 'replay_gap':
      // eslint-disable-next-line react/jsx-no-useless-fragment
      return React.createElement(React.Fragment);
    case 'attachment':
      return renderAttachmentBlock(block);
    case 'deploy':
      return renderDeployBlock(block, onDeploySubmit);
    default:
      return assertNever(block);
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
  activeConversation?: WorkbenchConversation | undefined,
): React.ReactElement {
  const replyRef = block.replyToMessageId ? (
    <button
      className={styles.replyQuote}
      onClick={() => scrollToBlock(block.replyToMessageId!)}
      type="button"
    >
      <span className={styles.replyQuoteAuthor}>{block.replyAuthor ?? '未知'}</span>
      <span className={styles.replyQuoteText}>{block.replyPreview ?? '...'}</span>
    </button>
  ) : null;

  const quoteBlock = block.quote ? (
    <blockquote className={styles.inlineBlockquote}>{block.quote}</blockquote>
  ) : null;

  const time = formatBlockTime(block.createdAt);

  if (!isCurrentUserAuthor(block.author)) {
    const displayAuthor = resolveAgentDisplayAuthor(block.author, activeConversation);
    return (
      <AgentMessage
        avatar={displayAuthor.avatar}
        avatarColor={displayAuthor.avatarColor}
        {...agentMessageBadge(block)}
        {...(time ? { time } : {})}
        name={displayAuthor.name}
        onAvatarClick={onAgentProfileOpen}
      >
        {replyRef}
        {quoteBlock}
        {renderAgentText(block)}
      </AgentMessage>
    );
  }

  return (
    <UserMessage hideAvatar={hideUserAvatar} avatarInitials={agentAvatar(block.author.name)}>
      {replyRef}
      {quoteBlock}
      {renderMessageText(block.text, block.hasNewerVersion)}
    </UserMessage>
  );
}

/** Scroll to a transcript block by its id. */
function scrollToBlock(blockId: string): void {
  const candidates = [blockId, `hub-message-${blockId}`, `thread-item-${blockId}`];
  for (const candidate of candidates) {
    const el = document.querySelector(`[data-scroll-block="${candidate}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
}

/** Render message text with full markdown support. */
function renderMessageText(text: string, hasNewerVersion?: boolean): React.ReactElement {
  const urlCards = extractUrlPreviewCards(text);

  return (
    <div className={styles.blockText} data-grayed={hasNewerVersion ? 'true' : undefined}>
      <MarkdownContent content={text} />
      {urlCards}
    </div>
  );
}

/** Regex to detect http(s) URLs in message text. */
const URL_REGEX = /https?:\/\/[^\s<>()[\]{}'")\]]+/g;

/** Extract unique URLs from text and render URLPreviewCard elements. */
function extractUrlPreviewCards(text: string): React.ReactElement | null {
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) return null;

  // Deduplicate URLs
  const seen = new Set<string>();
  const uniqueUrls: string[] = [];
  for (const url of matches) {
    // Strip trailing punctuation that may have been captured
    const cleaned = url.replace(/[.,;:!?]+$/, '');
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      uniqueUrls.push(cleaned);
    }
  }

  if (uniqueUrls.length === 0) return null;

  return (
    <React.Fragment>
      {uniqueUrls.map((url) => (
        <URLPreviewCard key={url} url={url} />
      ))}
    </React.Fragment>
  );
}

interface ParsedPart {
  kind: 'text' | 'quote';
  text?: string;
  lines?: string[];
}

function parseBlockquotes(text: string): ParsedPart[] {
  const lines = text.split('\n');
  const parts: ParsedPart[] = [];
  const currentText: string[] = [];
  const currentQuote: string[] = [];
  let inQuote = false;

  function flushText(): void {
    if (currentText.length > 0) {
      parts.push({ kind: 'text', text: currentText.join('\n') });
      currentText.length = 0;
    }
  }

  function flushQuote(): void {
    if (currentQuote.length > 0) {
      parts.push({ kind: 'quote', lines: [...currentQuote] });
      currentQuote.length = 0;
    }
  }

  for (const line of lines) {
    const quoteMatch = line.match(/^>\s?(.*)/);
    if (quoteMatch) {
      if (!inQuote) {
        flushText();
        inQuote = true;
      }
      currentQuote.push(quoteMatch[1]!);
    } else {
      if (inQuote) {
        if (line.trim() === '' && currentQuote.length > 0) {
          currentQuote.push('');
          continue;
        }
        flushQuote();
        inQuote = false;
      }
      currentText.push(line);
    }
  }

  flushText();
  flushQuote();

  if (parts.length === 0) {
    return [{ kind: 'text', text }];
  }

  return parts;
}

function renderAgentText(block: Extract<TranscriptBlock, { kind: 'text' }>): React.ReactElement {
  const [title, rest] = agentTextParts(block);
  const grayed = block.hasNewerVersion ? 'true' as const : undefined;
  if (!rest) {
    return (
      <div className={styles.blockText} data-grayed={grayed}>
        <MarkdownContent content={title} />
      </div>
    );
  }

  return (
    <div className={styles.blockText} data-grayed={grayed}>
      <div className={styles.inlineTitle}>{title}</div>
      <MarkdownContent content={rest} />
    </div>
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
            detailRows={toolCallDetailRows(target, block.summary)}
            evidenceRefs={block.evidenceRefs}
          />
        </div>
      </div>
    </div>
  );
}

function renderToolResultBlock(
  block: Extract<TranscriptBlock, { kind: 'tool_result' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <div className={styles.agentRunDetail}>
          <ToolCardBlock
            description={block.summary}
            detailRows={toolResultDetailRows(block.summary)}
            evidenceRefs={block.evidenceRefs}
            status={block.status}
            toolName={`${block.toolName} result`}
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
  const path = block.path ?? fileRef?.path ?? fileRef?.label;

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
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <div className={styles.blockTitle}>{block.title}</div>
        {(block.artifactKind || block.uri || block.mimeType) && (
          <div className={styles.inlineMutedLoose}>
            {[block.artifactKind, block.mimeType, block.uri].filter(Boolean).join(' / ')}
          </div>
        )}
      </div>
    </div>
  );
}

function renderPreviewBlock(
  block: Extract<TranscriptBlock, { kind: 'preview' }>,
): React.ReactElement {
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <div className={styles.blockTitle}>Preview {block.previewId}</div>
        <div className={styles.inlineMutedLoose}>
          {[block.status, block.url].filter(Boolean).join(' / ')}
        </div>
      </div>
    </div>
  );
}

function renderFileChangeBlock(
  block: Extract<TranscriptBlock, { kind: 'file_change' }>,
  onReviewFile?: ((file: FileItem) => void) | undefined,
  diffControls?: InlineDiffControls | undefined,
): React.ReactElement {
  const diffExpanded = diffControls?.expandedDiffIds.has(block.id) ?? false;
  return (
    <div className={styles.agentBlockRow}>
      <div className={styles.agentRunShell}>
        <FileChangeCard
          action={block.action}
          {...(block.additions != null ? { additions: block.additions } : {})}
          {...(block.deletions != null ? { deletions: block.deletions } : {})}
          {...(block.editId ? { editId: block.editId } : {})}
          {...(block.reviewStatus ? { reviewStatus: block.reviewStatus } : {})}
          {...(block.canApply != null ? { canApply: block.canApply } : {})}
          {...(block.canRevert != null ? { canRevert: block.canRevert } : {})}
          {...(block.lines?.length && diffControls ? {
            diffExpanded,
            onToggleDiff: () => diffControls.onToggleDiff(block.id),
          } : {})}
          onReview={onReviewFile ? () => onReviewFile(fileItemFromPath(block.path)) : undefined}
          path={block.path}
        />
        {block.lines?.length && diffExpanded && (
          <DiffCard
            additions={block.additions ?? 0}
            deletions={block.deletions ?? 0}
            filename={block.path}
            lines={block.lines}
          />
        )}
      </div>
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

function toolCallDetailRows(
  target?: string | undefined,
  summary?: string | undefined,
): Array<{ label: string; value: string }> {
  return [
    ...(target ? [{ label: 'Target', value: target }] : []),
    ...(summary ? [{ label: 'Summary', value: summary }] : []),
  ];
}

function toolResultDetailRows(
  summary?: string | undefined,
): Array<{ label: string; value: string }> {
  return summary ? [{ label: 'Result', value: summary }] : [];
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

function renderPermissionRequestBlock(
  block: Extract<TranscriptBlock, { kind: 'permission_request' }>,
  onApprovalDecision?: ((action: ApprovalDecisionAction) => void) | undefined,
): React.ReactElement {
  return (
    <ApprovalCardBlock
      id={block.requestId}
      agentTaskId={block.agentTaskId}
      correlationId={block.correlationId}
      edgeDeviceId={block.edgeDeviceId}
      onDecision={onApprovalDecision}
      reason={block.reason}
      risk={block.risk}
      status={block.status}
      teamId={block.teamId}
      teamRunId={block.teamRunId}
      targetId={block.targetId}
      title={block.title}
      toolName={block.toolName}
    />
  );
}

function renderPermissionResultBlock(
  block: Extract<TranscriptBlock, { kind: 'permission_result' }>,
): React.ReactElement {
  return (
    <ApprovalCardBlock
      id={block.requestId}
      reason={block.reason ?? block.decision}
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
          agentLabel={block.agentLabel}
          deviceId={block.deviceId}
          edgeRunId={block.edgeRunId}
          meta={block.meta}
          modeLabel={block.modeLabel}
          runtimeLabel={block.runtimeLabel}
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
  onApprovalDecision?: ((action: ApprovalDecisionAction) => void) | undefined,
): React.ReactElement {
  const subSteps = buildStepCardSubSteps(block.children);
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
          {renderRunStepChild(child, onReviewFile, diffControls, pairedDiff, onApprovalDecision)}
        </React.Fragment>,
      );
      continue;
    }
    renderedChildren.push(
      <React.Fragment key={child.id}>{renderRunStepChild(child, onReviewFile, diffControls, undefined, onApprovalDecision)}</React.Fragment>,
    );
  }

  return (
    <div className={styles.agentBlockRow}>
      <StepCard
        {...(block.open != null && { defaultOpen: block.open })}
        icon={block.icon}
        status={block.status}
        subSteps={subSteps}
        title={block.title}
        {...(block.meta ? { meta: block.meta } : {})}
      >
        {renderedChildren}
      </StepCard>
    </div>
  );
}

function buildStepCardSubSteps(children: TranscriptBlock[]): StepCardSubStep[] {
  return children.map((child): StepCardSubStep => {
    switch (child.kind) {
      case 'text': {
        const status = child.evidenceRefs?.some((r) => r.status === 'running') ? 'running'
          : child.evidenceRefs?.some((r) => r.status === 'failed') ? 'failed'
          : child.evidenceRefs?.every((r) => r.status === 'completed') ? 'completed'
          : undefined;
        return {
          key: child.id,
          kind: 'text',
          label: child.displayTitle ?? child.text.split('\n')[0] ?? '消息',
          ...(status != null && { status }),
        };
      }
      case 'tool_call': {
        const detail = child.summary ?? child.target;
        return {
          key: child.id,
          kind: 'tool_call',
          label: child.toolName,
          ...(detail != null && { detail }),
          ...(child.status != null && { status: child.status }),
        };
      }
      case 'tool_result': {
        const detail = child.summary;
        return {
          key: child.id,
          kind: 'tool_call',
          label: `${child.toolName} result`,
          ...(detail != null && { detail }),
          ...(child.status != null && { status: child.status }),
        };
      }
      case 'artifact': {
        const fileRef = child.evidenceRefs?.find((ref) => ref.kind === 'file');
        const path = child.path ?? fileRef?.path ?? fileRef?.label;
        const detail = child.action ? `${child.action}` : undefined;
        return {
          key: child.id,
          kind: 'artifact',
          label: path ?? child.title,
          ...(detail != null && { detail }),
          status: 'completed',
        };
      }
      case 'file_change': {
        const detail = child.action;
        return {
          key: child.id,
          kind: 'artifact',
          label: child.path,
          ...(detail != null && { detail }),
          status: 'completed',
        };
      }
      case 'diff': {
        const detail = child.additions != null || child.deletions != null
          ? `+${child.additions ?? 0} -${child.deletions ?? 0}`
          : undefined;
        return {
          key: child.id,
          kind: 'artifact',
          label: child.files[0] ?? child.title,
          ...(detail != null && { detail }),
          status: 'completed',
        };
      }
      case 'thinking': {
        const detail = child.content?.slice(0, 80);
        return {
          key: child.id,
          kind: 'plan',
          label: child.isThinking ? '推理中...' : '推理摘要',
          ...(detail != null && { detail }),
          status: child.isThinking ? 'running' : 'completed',
        };
      }
      case 'approval':
      case 'permission_request':
      case 'permission_result':
        return {
          key: child.id,
          kind: 'skill',
          label: child.title,
          ...(child.status != null && { status: child.status }),
        };
      case 'subagent':
      case 'subtask':
      case 'child_agent': {
        const detail = child.summary;
        return {
          key: child.id,
          kind: 'plan',
          label: child.title,
          ...(detail != null && { detail }),
          ...(child.status != null && { status: child.status }),
        };
      }
      case 'run_session': {
        const status = child.status as 'pending' | 'running' | 'completed' | 'failed' | undefined;
        return {
          key: child.id,
          kind: 'plan' as const,
          label: child.title,
          ...(status != null && { status }),
        };
      }
      default: {
        const block = child as TranscriptBlock & { title?: string };
        return {
          key: block.id,
          kind: 'text' as const,
          label: block.title ?? block.id,
        };
      }
    }
  });
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
  return block.path ?? fileRef?.path ?? fileRef?.label ?? block.title;
}

function renderRunStepChild(
  block: TranscriptBlock,
  onReviewFile?: ((file: FileItem) => void) | undefined,
  diffControls?: InlineDiffControls | undefined,
  pairedDiff?: Extract<TranscriptBlock, { kind: 'diff' }> | undefined,
  onApprovalDecision?: ((action: ApprovalDecisionAction) => void) | undefined,
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
    case 'tool_result':
      return (
        <ToolCardBlock
          description={block.summary}
          status={block.status}
          toolName={`${block.toolName} result`}
        />
      );
    case 'artifact': {
      const fileRef = block.evidenceRefs?.find((ref) => ref.kind === 'file');
      const path = block.path ?? fileRef?.path ?? fileRef?.label ?? block.title;
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
    case 'file_change':
      return (
        <>
          <FileChangeCard
            action={block.action}
            {...(block.additions != null ? { additions: block.additions } : {})}
            {...(block.deletions != null ? { deletions: block.deletions } : {})}
            {...(block.editId ? { editId: block.editId } : {})}
            {...(block.reviewStatus ? { reviewStatus: block.reviewStatus } : {})}
            {...(block.canApply != null ? { canApply: block.canApply } : {})}
            {...(block.canRevert != null ? { canRevert: block.canRevert } : {})}
            onReview={onReviewFile ? () => onReviewFile(fileItemFromPath(block.path)) : undefined}
            path={block.path}
          />
          {block.lines?.length ? (
            <DiffCard
              additions={block.additions ?? 0}
              deletions={block.deletions ?? 0}
              filename={block.path}
              lines={block.lines}
            />
          ) : null}
        </>
      );
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
      return renderTranscriptBlock(block, undefined, onReviewFile, false, diffControls, onApprovalDecision);
  }
}

function renderDeployBlock(
  block: Extract<TranscriptBlock, { kind: 'deploy' }>,
  onDeploySubmit?: ((runId: string, slug: string) => void) | undefined,
): React.ReactElement {
  return React.createElement(DeployCard, {
    status: block.status,
    url: block.url,
    onDeploy: onDeploySubmit && block.runId
      ? () => {
          // Derive a slug from the run ID or let the parent generate one.
          const slug = block.runId!.replace(/_/g, '-').slice(0, 20);
          onDeploySubmit(block.runId!, slug);
        }
      : undefined,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unsupported transcript block: ${JSON.stringify(value)}`);
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

function renderSubtaskBlock(
  block: Extract<TranscriptBlock, { kind: 'subtask' }>,
): React.ReactElement {
  return (
    <SubagentBlock
      runId={block.runId}
      status={block.status}
      summary={block.summary}
      title={block.title}
      worker={block.worker ?? 'Agent'}
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

function renderFailureBlock(
  block: Extract<TranscriptBlock, { kind: 'failure' }>,
): React.ReactElement {
  return (
    <ResultBlock
      success={false}
      summary={block.reason ?? block.title}
    />
  );
}

function renderFinishedBlock(
  block: Extract<TranscriptBlock, { kind: 'finished' }>,
): React.ReactElement {
  return (
    <ResultBlock
      duration={block.duration}
      success={true}
      summary={block.title}
    />
  );
}

/* ── Attachment block ── */

function renderAttachmentBlock(
  block: Extract<TranscriptBlock, { kind: 'attachment' }>,
): React.ReactElement {
  if (!isCurrentUserAuthor(block.author)) {
    return (
      <div className={styles.agentBlockRow}>
        <div className={styles.agentRunShell}>
          <AttachmentBlock
            attachmentRef={block.attachmentRef}
            contentType={block.contentType}
          />
        </div>
      </div>
    );
  }

  return (
    <UserMessage hideAvatar={false} avatarInitials={agentAvatar(block.author.name)}>
      <AttachmentBlock
        attachmentRef={block.attachmentRef}
        contentType={block.contentType}
      />
    </UserMessage>
  );
}

/* ═══ Helpers ═══ */

function isCurrentUserAuthor(author: TranscriptAuthor): boolean {
  const id = author.id.trim().toLowerCase();
  const name = author.name.trim().toLowerCase();
  return id === 'delicious233' || id === 'delicious' || name === 'delicious233' || author.role === 'human';
}

function agentAvatar(name: string): string {
  return workbenchProfileInitials(name);
}

function agentAvatarColor(name: string): string {
  return workbenchAgentColor({ name });
}

function resolveAgentDisplayAuthor(
  author: TranscriptAuthor,
  activeConversation?: WorkbenchConversation | undefined,
): { name: string; avatar: string; avatarColor: string } {
  if (isGenericAgentAuthor(author) && activeConversation?.kind === 'direct' && activeConversation.title.trim()) {
    const name = activeConversation.title.trim();
    return {
      name,
      avatar: activeConversation.avatarLabel ?? agentAvatar(name),
      avatarColor: activeConversation.avatarColor ?? agentAvatarColor(name),
    };
  }

  return {
    name: author.name,
    avatar: agentAvatar(author.name),
    avatarColor: agentAvatarColor(author.name),
  };
}

function isGenericAgentAuthor(author: TranscriptAuthor): boolean {
  const id = author.id.trim().toLowerCase();
  const name = author.name.trim().toLowerCase();
  return author.role === 'agent' && (id === 'agent' || name === 'agent');
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
