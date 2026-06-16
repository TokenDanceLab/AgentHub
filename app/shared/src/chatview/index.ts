/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW — public API
   Shared package. web + desktop import from '@shared/chatview'.
   ══════════════════════════════════════════════════════════════════════ */

export { ChatViewTranscript } from './ChatViewTranscript'
export { blocksToTranscriptItems } from './adapter'
export type { TranscriptBlock, ChatViewTranscriptItem, AgentTranscriptBlock, UserTranscriptMsg } from './adapter'
