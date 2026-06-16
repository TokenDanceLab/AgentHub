/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — AgentHub integration wrapper
   Props match TranscriptViewProps subset. Drops into AgentHubWorkbench
   alongside the existing TranscriptView for side-by-side comparison.
   ══════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react'
import Transcript from './components/Transcript'
import { blocksToTranscriptItems, type TranscriptBlock } from './adapter'

interface Props {
  transcript: TranscriptBlock[]
}

/**
 * Drop-in replacement for TranscriptView (subset of props).
 * Takes real AgentHub TranscriptBlock[] and renders via ChatView component tree.
 */
export function ChatViewTranscript({ transcript }: Props) {
  const items = useMemo(() => blocksToTranscriptItems(transcript), [transcript])

  return <Transcript items={items} chatMode="group" />
}
