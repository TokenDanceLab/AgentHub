import { useCallback, memo } from 'react'
import type { TranscriptAgentItem, BlockActionCallback } from '../transcript-item'
import RowItem from './RowItem'
import OrchestratorCard from './OrchestratorCard'
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
  block: TranscriptAgentItem
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

export default memo(function AgentGroup({ block, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds }: Props) {
  const initial = roleInitial[block.role] ?? block.agent[0]
  const avatar = (
    <div className={`ag-av ${block.role}`}>
      {block.role === 'shield' ? <IconShield size={14} /> : initial}
    </div>
  )

  const handleApprove = useCallback(onBlockAction ? (id: string) => onBlockAction('approve', id) : undefined, [onBlockAction]) as ((id: string) => void) | undefined
  const handleReject = useCallback(onBlockAction ? (id: string) => onBlockAction('deny', id) : undefined, [onBlockAction]) as ((id: string) => void) | undefined
  const handleRetry = useCallback(onBlockAction ? (id: string) => onBlockAction('retry', id) : undefined, [onBlockAction]) as ((id: string) => void) | undefined

  const body = (
    <>
      {chatMode === 'group' && (
        <div className="agent-meta">
          <span className="ag-name">{block.agent}</span>
          {block.time && <span className="ag-time">{block.time}</span>}
        </div>
      )}
      {block.rows.length > 0 && (
        <div className="card-stack">
          {block.rows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} onApprove={handleApprove} onReject={handleReject} onRetry={handleRetry} onDeploySubmit={onDeploySubmit} onContextMenu={onBlockContextMenu} onBlockSelect={onBlockSelect} onReviewFile={onReviewFile} selected={selectedBlockIds?.has(row.id)} selectedAny={selectionMode} softHidden={softHiddenBlockIds?.has(row.id)} actioned={actionedBlockIds?.has(row.id)} />
          ))}
        </div>
      )}
      {block.standaloneRows.length > 0 && (
        <div className="card-stack">
          {block.standaloneRows.map((row) => (
            row.type === 'route' && row.orchAgents?.length
              ? <OrchestratorCard key={row.id} item={row} />
              : <RowItem key={row.id} item={row} onApprove={handleApprove} onReject={handleReject} onRetry={handleRetry} onDeploySubmit={onDeploySubmit} onContextMenu={onBlockContextMenu} onBlockSelect={onBlockSelect} onReviewFile={onReviewFile} selected={selectedBlockIds?.has(row.id)} selectedAny={selectionMode} softHidden={softHiddenBlockIds?.has(row.id)} actioned={actionedBlockIds?.has(row.id)} />
          ))}
        </div>
      )}
      {block.bubbles.map((text, i) => {
        const parts = text.split(/(`[^`]+`)/g)
        return (
          <div key={i} className="bubble-group">
            {block.replyBlockId && i === 0 && (
              <div className="reply-quote" data-block-id={block.replyBlockId}>
                <span className="reply-quote-author">{block.replyAuthor ?? 'User'}</span>
                <span className="reply-quote-preview">{block.replyPreview ?? ''}</span>
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
      })}
      {block.evidenceRefs && block.evidenceRefs.length > 0 && (
        <div className="evidence-chips">
          {block.evidenceRefs.map(ref => {
            const Icon = evidenceIconMap[ref.kind] ?? IconFile
            return (
              <span key={ref.id} className="evidence-chip" title={ref.label}>
                <Icon size={12} />
                <span>{ref.label}</span>
              </span>
            )
          })}
        </div>
      )}
    </>
  )

  if (chatMode === 'dm') {
    return (
      <div className="grp-row">
        <div
          className="dm-avatar"
          onClick={onAgentClick ? (e) => onAgentClick(block.agent, e.currentTarget) : undefined}
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
        onClick={onAgentClick ? (e) => onAgentClick(block.agent, e.currentTarget) : undefined}
        style={onAgentClick ? { cursor: 'pointer' } : undefined}
      >
        {avatar}
      </div>
      <div className="grp-content">{body}</div>
      <div className="dm-spacer"><div className="ag-av">&nbsp;</div></div>
    </div>
  )
})
