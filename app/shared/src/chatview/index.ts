/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW — public API
   Shared package. Consumers import from '@shared/chatview' (web) or
   relative path (desktop / other environments).

   i18n: Consumers must provide a 'chatview' namespace in their
   react-i18next I18nextProvider. See ./i18n/resources.ts for the
   required key set.

   Theme: Import ./design/tokens.css for the .chatview scoped design
   tokens. Tokens are scoped to .chatview — no :root pollution.

   Data: Import TranscriptBlock[] from your upstream and feed through
   blocksToTranscriptItems() to get TranscriptItem[] for rendering.
   ══════════════════════════════════════════════════════════════════════ */

// ── Components
export { ChatViewTranscript } from './components/ChatViewTranscript'

// ── Adapter: TranscriptBlock[] → TranscriptItem[]
export { blocksToTranscriptItems } from './adapter'
export type { TranscriptBlock } from './adapter'

// ── Core types (no upstream dependency)
export type { TranscriptItem, TranscriptUserItem, TranscriptAgentItem } from './transcript-item'
export type { RowItem, RowType, AgentRole } from './types'

// ── Backward-compat aliases (deprecated — prefer the names above)
export type { TranscriptItem as ChatViewTranscriptItem } from './transcript-item'
export type { TranscriptAgentItem as AgentTranscriptBlock } from './transcript-item'
export type { TranscriptUserItem as UserTranscriptMsg } from './transcript-item'
