import { useCallback, useMemo, memo } from 'react'
import type { TranscriptAgentItem, BlockActionCallback } from '../transcript-item'
import { RowItem } from './RowItem'
import { OrchestratorCard } from './OrchestratorCard'
import { IconShield, IconFile, IconFileText, IconSearch, IconPlayerPlay, IconArrowForward } from './Icons'
import { roleInitial } from '../design/roles'
import type { AgentRole } from '../design/roles'

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
  selectedBlockIds?: Set<string>
  selectionMode?: boolean
  softHiddenBlockIds?: Set<string>
  actionedBlockIds?: Set<string>
}

/** Render an agent item in the transcript: avatar, name, time, card stack,
 *  standalone cards, chat bubbles, and evidence chips.
 *  Dispatches orchestrator cards via {@link OrchestratorCard} and
 *  regular cards via {@link RowItem}. */
export const AgentGroup = memo(function AgentGroup({ item, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds }: Props) {
  const initial = roleInitial[item.role] ?? item.agent[0]
  const avatar = (
    <div className={`ag-av ${item.role}`}>
      {item.role === 'shield' ? <IconShield size={14} /> : initial}
    </div>
  )

  const handleApprove = useCallback((id: string) => onBlockAction?.('approve', id), [onBlockAction])
  const handleReject = useCallback((id: string) => onBlockAction?.('deny', id), [onBlockAction])
  const handleRetry = useCallback((id: string) => onBlockAction?.('retry', id), [onBlockAction])

  const bubblesContent = useMemo(() => item.bubbles.map((text, i) => {
    const parts = text.split(/(`[^`]+`)/g)
    return (
      <div key={i} className="bubble-group">
        {item.replyBlockId && i === 0 && (
          <div className="reply-quote" data-item-id={item.replyBlockId}>
            <span className="reply-quote-author">{item.replyAuthor ?? 'User'}</span>
            <span className="reply-quote-preview">{item.replyPreview ?? ''}</span>
          </div>
        )}
        <div className="agent-bubble">
          {parts.map((part, j) =>
            part.startsWith('`') && part.endsWith('`')
              ? <code key={j}>{part.slice(1, -1)}</code>
              : part
          )}
        </div>
      </div>
    )
  }), [item.bubbles, item.replyBlockId, item.replyAuthor, item.replyPreview])

  const evidenceChipsContent = useMemo(() => {
    if (!item.evidenceRefs || item.evidenceRefs.length === 0) return null
    return (
      <div className="evidence-chips">
        {item.evidenceRefs.map(ref => {
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
          {item.rows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} onApprove={handleApprove} onReject={handleReject} onRetry={handleRetry} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(onBlockContextMenu ? { onContextMenu: onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(selectedBlockIds ? { selected: selectedBlockIds.has(row.id) } : {})} {...(selectionMode !== undefined ? { selectedAny: selectionMode } : {})} {...(softHiddenBlockIds ? { softHidden: softHiddenBlockIds.has(row.id) } : {})} {...(actionedBlockIds ? { actioned: actionedBlockIds.has(row.id) } : {})} />
          ))}
        </div>
      )}
      {item.standaloneRows.length > 0 && (
        <div className="card-stack">
          {item.standaloneRows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} onApprove={handleApprove} onReject={handleReject} onRetry={handleRetry} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(onBlockContextMenu ? { onContextMenu: onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(selectedBlockIds ? { selected: selectedBlockIds.has(row.id) } : {})} {...(selectionMode !== undefined ? { selectedAny: selectionMode } : {})} {...(softHiddenBlockIds ? { softHidden: softHiddenBlockIds.has(row.id) } : {})} {...(actionedBlockIds ? { actioned: actionedBlockIds.has(row.id) } : {})} />
          ))}
        </div>
      )}
      {bubblesContent}
      {evidenceChipsContent}
    </>
  )

  if (chatMode === 'dm') {
    return (
      <div className="grp-row">
        <div
          className="dm-avatar"
          onClick={onAgentClick ? (e) => onAgentClick(item.agent, e.currentTarget) : undefined}
          style={onAgentClick ? { cursor: 'pointer' } : undefined}
        >
          {avatar}
        </div>
        <div className="grp-content">{body}</div>
        <div className="dm-spacer"><div className="ag-av">&nbsp;</div></div>
      </div>
    )
  }

  return (
    <div className="grp-row">
      <div
        className="dm-avatar"
        onClick={onAgentClick ? (e) => onAgentClick(item.agent, e.currentTarget) : undefined}
        style={onAgentClick ? { cursor: 'pointer' } : undefined}
      >
        {avatar}
      </div>
      <div className="grp-content">{body}</div>
      <div className="dm-spacer"><div className="ag-av">&nbsp;</div></div>
    </div>
  )
})
