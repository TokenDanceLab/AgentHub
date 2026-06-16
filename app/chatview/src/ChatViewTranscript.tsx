/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — AgentHub integration wrapper
   Takes TranscriptBlock[] from AgentHub, adapts to ChatView, renders.
   ══════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react'
import Transcript from './components/Transcript'
import { blocksToTranscript, type TranscriptBlock } from './adapter'

interface Props {
  blocks: TranscriptBlock[]
  chatMode?: 'dm' | 'group'
}

export default function ChatViewTranscript({ blocks, chatMode = 'group' }: Props) {
  const items = useMemo(() => blocksToTranscript(blocks), [blocks])

  return <Transcript items={items} chatMode={chatMode} />
}
