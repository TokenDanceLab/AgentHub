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

   Typing presence & i18n resources: re-exported below — prefer the barrel
   over deep imports of ./typingPresence or ./i18n/resources (deep imports
   are retained for existing consumers).
   ══════════════════════════════════════════════════════════════════════ */

// ── Components ────────────────────────────────────────────────────────

/**
 * Main chat view transcript component.
 *
 * Accepts an array of {@link TranscriptBlock} from an upstream data source
 * (e.g. AgentHub, a mock layer, or any agent runtime) and renders the full
 * transcript using the ChatView component tree internally.
 *
 * Requires:
 * - A react-i18next `I18nextProvider` with a `'chatview'` namespace loaded.
 * - CSS tokens scoped to `.chatview` (import `./design/tokens.css`).
 *
 * @example
 * ```tsx
 * import { ChatViewTranscript, blocksToTranscriptItems } from '@shared/chatview'
 * import { useTranscript } from '~/hooks/useTranscript'
 *
 * function MyTranscript() {
 *   const blocks = useTranscript()
 *   return <ChatViewTranscript transcript={blocks} />
 * }
 * ```
 */
export { ChatViewTranscript } from './components/ChatViewTranscript'

// ── Adapter ───────────────────────────────────────────────────────────

/**
 * Convert an array of upstream {@link TranscriptBlock} objects into
 * generic {@link TranscriptItem} objects suitable for rendering by
 * the ChatView component tree.
 *
 * This is the integration point: your upstream data source produces
 * TranscriptBlock[], you call this function, and you get TranscriptItem[]
 * to feed to the Transcript component.
 *
 * Grouping rules:
 * - Consecutive blocks from the same author are merged into one
 *   {@link TranscriptAgentItem}.
 * - User text blocks produce {@link TranscriptUserItem}.
 * - Tool calls and tool results with the same toolName are merged.
 * - Standalone cards (route, deploy, context, approval, session,
 *   attachment) are placed in `standaloneRows`.
 *
 * @param blocks - Array of upstream transcript blocks.
 * @returns Array of generic transcript items ready for rendering.
 */
export { blocksToTranscriptItems } from './adapter'

/**
 * Re-exported upstream type. Upstream data sources produce arrays of
 * this discriminated union, which the adapter consumes.
 */
export type { TranscriptBlock } from './adapter'

// ── Core types (no upstream dependency) ───────────────────────────────

/**
 * Union type of items the Transcript component can render:
 * `TranscriptUserItem | TranscriptAgentItem`.
 */
export type { TranscriptItem, TranscriptUserItem, TranscriptAgentItem } from './transcript-item'

/**
 * A single row/card displayed inside an agent group in the transcript.
 * Core data model for all card types: think, tool, file, sub, approval,
 * route, deploy, attachment, context, session.
 */
export type { RowItem, RowType, AgentRole } from './types'
export type { UnreadDividerDescriptor } from './types'

// ── Backward-compat aliases (deprecated — prefer the names above) ─────

/**
 * @deprecated Use {@link TranscriptItem} instead.
 */
export type { TranscriptItem as ChatViewTranscriptItem } from './transcript-item'

/**
 * @deprecated Use {@link TranscriptAgentItem} instead.
 */
export type { TranscriptAgentItem as AgentTranscriptBlock } from './transcript-item'

/**
 * @deprecated Use {@link TranscriptUserItem} instead.
 */
export type { TranscriptUserItem as UserTranscriptMsg } from './transcript-item'

// ── Typing presence ────────────────────────────────────────────────────

/**
 * Ephemeral session-scoped typing indicator state fed by inbound Hub WS
 * `typing` frames (auto-dismiss after 3s, plain observer pattern — no
 * zustand dependency).
 */
export {
  useTypingPresence,
  handleIncomingTyping,
  clearTyping,
  subscribe,
  getTypingUserIds,
} from './typingPresence'

// ── i18n resources ─────────────────────────────────────────────────────

/**
 * i18next resources for the 'chatview' namespace. Consumers must load
 * `chatviewResources` under `CHATVIEW_I18N_NAMESPACE` into their
 * I18nextProvider (see the header comment above).
 */
export { CHATVIEW_I18N_NAMESPACE, chatviewResources } from './i18n/resources'
export type { TransKey, Locale } from './i18n/resources'
