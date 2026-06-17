import { memo } from 'react'
import type { TranscriptItem, BlockActionCallback } from '../transcript-item'
import UserMessage from './UserMsg'
import AgentGroup from './AgentGroup'
import './Transcript.css'

interface Props {
  items: TranscriptItem[]
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

function isUser(item: TranscriptItem): item is Extract<TranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

function isAgent(item: TranscriptItem): item is Extract<TranscriptItem, { id: string }> {
  return 'id' in item
}

export default memo(function Transcript({ items, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds }: Props) {
  return (
    <div className="transcript">
      {items.map((item, i) => {
        if (isUser(item)) return <UserMessage key={item.text + (item.name || '')} item={item} chatMode={chatMode} />
        if (isAgent(item)) return <AgentGroup key={item.id} block={item} chatMode={chatMode} onAgentClick={onAgentClick} onBlockContextMenu={onBlockContextMenu} onBlockSelect={onBlockSelect} onBlockAction={onBlockAction} onReviewFile={onReviewFile} onDeploySubmit={onDeploySubmit} selectedBlockIds={selectedBlockIds} selectionMode={selectionMode} softHiddenBlockIds={softHiddenBlockIds} actionedBlockIds={actionedBlockIds} />
        return null
      })}
    </div>
  )
})
