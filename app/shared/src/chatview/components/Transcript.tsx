import type { TranscriptItem } from '../data/mock'
import UserMessage from './UserMsg'
import AgentGroup from './AgentGroup'
import './Transcript.css'

interface Props { items: TranscriptItem[]; chatMode: 'dm' | 'group' }

function isUser(item: TranscriptItem): item is Extract<TranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

function isAgent(item: TranscriptItem): item is Extract<TranscriptItem, { id: string }> {
  return 'id' in item
}

export default function Transcript({ items, chatMode }: Props) {
  return (
    <div className="transcript">
      {items.map((item, i) => {
        if ('type' in item && item.type === 'divider') return null
        if (isUser(item)) return <UserMessage key={item.text + (item.name || '')} item={item} chatMode={chatMode} />
        if (isAgent(item)) return <AgentGroup key={item.id} block={item} chatMode={chatMode} />
        return null
      })}
    </div>
  )
}
