import type { ChatViewTranscriptItem } from '../adapter'
import UserMessage from './UserMsg'
import AgentGroup from './AgentGroup'
import './Transcript.css'

interface Props { items: ChatViewTranscriptItem[]; chatMode: 'dm' | 'group' }

function isUser(item: ChatViewTranscriptItem): item is Extract<ChatViewTranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

function isAgent(item: ChatViewTranscriptItem): item is Extract<ChatViewTranscriptItem, { id: string }> {
  return 'id' in item
}

export default function Transcript({ items, chatMode }: Props) {
  return (
    <div className="transcript">
      {items.map((item, i) => {
        if (isUser(item)) return <UserMessage key={item.text + (item.name || '')} item={item} chatMode={chatMode} />
        if (isAgent(item)) return <AgentGroup key={item.id} block={item} chatMode={chatMode} />
        return null
      })}
    </div>
  )
}
