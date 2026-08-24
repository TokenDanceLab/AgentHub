import { useCallback, useMemo, memo, type ReactNode } from 'react'
import type { TranscriptAgentItem, BlockActionCallback } from '../transcript-item'
import { RowItem } from './RowItem'
import { OrchestratorCard } from './OrchestratorCard'
import { IconShield, IconFile, IconFileText, IconSearch, IconPlayerPlay } from './Icons'
import { roleInitial } from '../design/roles'
import MarkdownContent from '../../ui/Markdown'
import { MessageDisplayMeta } from './MessageDisplayMeta'
import { isAgentItemStreaming } from './streaming'

const evidenceIconMap: Record<string, typeof IconFile> = {
  file: IconFile,
  artifact: IconFile,
  tool: IconFileText,
  run: IconPlayerPlay,
  approval: IconShield,
  preview: IconSearch,
}

interface Props {
  item: TranscriptAgentItem
  chatMode: 'dm' | 'group'
  onAgentClick?: (agentName: string, anchor: HTMLElement) => void
  onBlockContextMenu?: (blockId: string, event: React.MouseEvent) => void
  onBlockSelect?: (blockId: string, shiftKey: boolean) => void
  onBlockAction?: BlockActionCallback
  onReviewFile?: (file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void
  onDeploySubmit?: (id: string) => void
  previewExternalOpenEnabled?: boolean
  selectedBlockIds?: Set<string>
  selectionMode?: boolean
  softHiddenBlockIds?: Set<string>
  actionedBlockIds?: Set<string>
  /** #1825: set on the newest same-session append -> one-shot entry animation. */
  enter?: boolean | undefined
}

/** Render an agent item in the transcript: avatar, name, time, card stack,
 *  standalone cards, chat bubbles, and evidence chips.
 *  Dispatches orchestrator cards via {@link OrchestratorCard} and
 *  regular cards via {@link RowItem}. */
export const AgentGroup = memo(function AgentGroup({ item, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, previewExternalOpenEnabled, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, enter }: Props) {
  // #1825: streaming bubble activity indicator — any running row (including
  // nested child rows and ordered-part rows, same view Transcript uses for
  // aria-busy) marks the agent item as mid-stream; the last bubble carries
  // the caret.
  const isStreaming = isAgentItemStreaming(item)
  const initial = roleInitial[item.role] ?? item.agent[0]
  const avatar = (
    <div className={`ag-av ${item.role}`}>
      {item.role === 'shield' ? <IconShield size={14} /> : initial}
    </div>
  )

  const handleApprove = useCallback((id: string) => onBlockAction?.('approve', id), [onBlockAction])
  const handleReject = useCallback((id: string) => onBlockAction?.('deny', id), [onBlockAction])
  const handleRetry = useCallback((id: string) => onBlockAction?.('retry', id), [onBlockAction])

  const renderBubble = useCallback((
    part: {
      text: string
      blockId?: string
      displayTitle?: string
      displayDetail?: string
      badgeLabel?: string
      badgeVariant?: TranscriptAgentItem['badgeVariant']
    },
    key: string,
    showReply: boolean,
    streaming: boolean,
  ) => {
    // #1821: text bubbles get the same selectable/context-menu identity tool
    // rows have (RowItem's `data-selectable-card` + onContextMenu contract) —
    // only when both an upstream block id and a handler exist.
    const bubbleBlockId = part.blockId
    const bubbleProps = bubbleBlockId && onBlockContextMenu
      ? {
          'data-block-id': bubbleBlockId,
          'data-selectable-card': bubbleBlockId,
          onContextMenu: (event: React.MouseEvent) => onBlockContextMenu(bubbleBlockId, event),
        }
      : {}
    return (
      <div key={key} className={`bubble-group${streaming ? ' streaming' : ''}`}>
        <MessageDisplayMeta
          badgeLabel={part.badgeLabel ?? item.badgeLabel}
          badgeVariant={part.badgeVariant ?? item.badgeVariant}
          detail={part.displayDetail ?? item.displayDetail}
          title={part.displayTitle ?? item.displayTitle}
        />
        {item.replyBlockId && showReply && (
          <div className="reply-quote" data-item-id={item.replyBlockId}>
            <span className="reply-quote-author">{item.replyAuthor ?? 'User'}</span>
            <span className="reply-quote-preview">{item.replyPreview ?? ''}</span>
          </div>
        )}
        <div className="agent-bubble" {...bubbleProps}>
          <MarkdownContent content={part.text} />
        </div>
      </div>
    )
  }, [item.badgeLabel, item.badgeVariant, item.displayDetail, item.displayTitle, item.replyBlockId, item.replyAuthor, item.replyPreview, onBlockContextMenu])

  const renderRow = useCallback((row: (typeof item.rows)[number]) => {
    if (row.type === 'route' && row.orchAgents?.length) {
      return <OrchestratorCard key={row.id} item={row} />;
    }
    return (
      <RowItem
        key={row.id}
        item={row}
        onApprove={handleApprove}
        onReject={handleReject}
        onRetry={handleRetry}
        {...(onDeploySubmit ? { onDeploySubmit } : {})}
        {...(previewExternalOpenEnabled !== undefined ? { previewExternalOpenEnabled } : {})}
        {...(onBlockContextMenu ? { onContextMenu: onBlockContextMenu } : {})}
        {...(onBlockSelect ? { onBlockSelect } : {})}
        {...(onReviewFile ? { onReviewFile } : {})}
        {...(selectedBlockIds ? { selected: selectedBlockIds.has(row.id) } : {})}
        {...(selectionMode !== undefined ? { selectedAny: selectionMode } : {})}
        {...(softHiddenBlockIds ? { softHidden: softHiddenBlockIds.has(row.id) } : {})}
        {...(actionedBlockIds ? { actioned: actionedBlockIds.has(row.id) } : {})}
      />
    );
  }, [actionedBlockIds, handleApprove, handleReject, handleRetry, onBlockContextMenu, onBlockSelect, onDeploySubmit, previewExternalOpenEnabled, onReviewFile, selectedBlockIds, selectionMode, softHiddenBlockIds])

  const orderedBodyContent = useMemo(() => {
    const parts = item.parts;
    if (!parts?.length) return null;
    let bubbleIndex = 0;
    let stackIndex = 0;
    let rowStack: ReactNode[] = [];
    const content: ReactNode[] = [];
    const bubbleTotal = parts.filter((p) => p.type === 'bubble').length;
    const flushRowStack = () => {
      if (rowStack.length === 0) return;
      const rows = rowStack;
      rowStack = [];
      content.push(
        <div className="card-stack" key={`stack-${stackIndex}`}>
          {rows}
        </div>,
      );
      stackIndex += 1;
    };

    parts.forEach((part, index) => {
      if (part.type === 'bubble') {
        flushRowStack();
        const currentBubbleIndex = bubbleIndex;
        bubbleIndex += 1;
        content.push(renderBubble(part, `bubble-${index}`, currentBubbleIndex === 0, isStreaming && currentBubbleIndex === bubbleTotal - 1));
        return;
      }
      rowStack.push(renderRow(part.row));
    });

    flushRowStack();
    return content;
  }, [item.parts, renderBubble, renderRow, isStreaming])

  const fallbackBubblesContent = useMemo(() => item.bubbles.map((text, i) => (
    renderBubble({ text }, `bubble-${i}`, i === 0, isStreaming && i === item.bubbles.length - 1)
  )), [item.bubbles, renderBubble, isStreaming])

  const evidenceChipsContent = useMemo(() => {
    const visibleEvidenceRefs = item.evidenceRefs?.filter(ref => ref.kind !== 'run') ?? []
    if (visibleEvidenceRefs.length === 0) return null
    return (
      <div className="evidence-chips">
        {visibleEvidenceRefs.map(ref => {
          const Icon = evidenceIconMap[ref.kind] ?? IconFile
          return (
            <span key={ref.id} className="evidence-chip" title={ref.label}>
              <Icon size={12} />
              <span>{ref.label}</span>
            </span>
          )
        })}
      </div>
    )
  }, [item.evidenceRefs])

  const body = (
    <>
      {chatMode === 'group' && (
        <div className="agent-meta">
          <span className="ag-name">{item.agent}</span>
          {item.time && <span className="ag-time">{item.time}</span>}
        </div>
      )}
      {item.rows.length > 0 && (
        <div className="card-stack">
          {item.rows.map(renderRow)}
        </div>
      )}
      {item.standaloneRows.length > 0 && (
        <div className="card-stack">
          {item.standaloneRows.map(renderRow)}
        </div>
      )}
      {fallbackBubblesContent}
      {evidenceChipsContent}
    </>
  )

  const orderedBody = (
    <>
      {chatMode === 'group' && (
        <div className="agent-meta">
          <span className="ag-name">{item.agent}</span>
          {item.time && <span className="ag-time">{item.time}</span>}
        </div>
      )}
      {orderedBodyContent}
      {evidenceChipsContent}
    </>
  )

  if (chatMode === 'dm') {
    return (
      <div className={enter ? 'grp-row grp-enter' : 'grp-row'}>
        <div
          className="dm-avatar"
          onClick={onAgentClick ? (e) => onAgentClick(item.agent, e.currentTarget) : undefined}
          style={onAgentClick ? { cursor: 'pointer' } : undefined}
        >
          {avatar}
        </div>
        <div className="grp-content">{orderedBodyContent ? orderedBody : body}</div>
        <div className="dm-spacer" aria-hidden="true"><div className="ag-av">&nbsp;</div></div>
      </div>
    )
  }

  return (
    <div className={enter ? 'grp-row grp-enter' : 'grp-row'}>
      <div
        className="dm-avatar"
        onClick={onAgentClick ? (e) => onAgentClick(item.agent, e.currentTarget) : undefined}
        style={onAgentClick ? { cursor: 'pointer' } : undefined}
      >
        {avatar}
      </div>
      <div className="grp-content">{orderedBodyContent ? orderedBody : body}</div>
      <div className="dm-spacer" aria-hidden="true"><div className="ag-av">&nbsp;</div></div>
    </div>
  )
})
