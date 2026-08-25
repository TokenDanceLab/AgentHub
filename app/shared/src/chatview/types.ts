/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW CORE TYPES
   Shared package types — no AgentHub or upstream dependency.
   ══════════════════════════════════════════════════════════════════════ */

import type { AttachmentRef } from '../composer/types'

/** Agent role: arbitrary string (consumers define their own set). */
export type AgentRole = string

/** Discriminated row card kind — determines icon, label, and rendering strategy. */
export type RowType = 'think' | 'tool' | 'file' | 'sub' | 'approval' | 'route' | 'deploy' | 'attachment' | 'ctx' | 'session' | 'preview'

/** A single row/card displayed inside an agent group in the transcript.
 *  Core data model for all card types: think, tool, file, sub, approval,
 *  route, deploy, attachment, context, session. */
export interface RowItem {
  id: string
  type: RowType
  label: string
  extra?: string
  status: 'running' | 'ok' | 'fail' | 'waiting'
  collapsible: boolean
  open?: boolean
  content?: string
  /** Stable tool identifier for i18n + icon routing — never translated. e.g. "read", "grep", "eslint". */
  toolName?: string
  /** Backend tool call id used to match tool_result cards to the correct tool_call. */
  toolCallId?: string
  /** True if this tool card is a final result (applies result-row CSS via type check). */
  isResult?: boolean
  diffLines?: { type: 'add' | 'del' | 'ctx'; text: string }[]
  fileOp?: 'cr' | 'mod' | 'del'
  apReason?: string
  /** Explicit kind marker for approval-card structured rendering.
   *  When absent the component infers kind from `apReason` JSON shape.
   *  Values: "command" | "diff" | "plan" | "allowed_prompts" | "web" | "json" */
  apKind?: string
  /** Risk severity for approval cards. When present, a RiskBadge renders in the
   *  actions row; critical level triggers a second-confirm on the approve
   *  button and the approve button turns red (T16). */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  /**
   * ISO timestamp of when the (waiting) approval request was raised
   * (#1819). Propagated from the upstream transcript block's `createdAt`;
   * the waiting card surfaces it as "requested at HH:MM" so the user can
   * judge how long the request has been pending. The upstream data model
   * has no deadline/expiry field, so this is intentionally NOT a countdown
   * or a timeout state — showing invented deadlines would be a lie.
   */
  waitingSince?: string
  standalone?: boolean
  url?: string
  deployMeta?: string
  fileName?: string
  fileSize?: string
  /**
   * Attachment payload kind (#1938, media kinds added by #1939). `'image'`
   * rows render an inline thumbnail (click to enlarge); `'audio'`/`'video'`
   * rows render an inline native player (URL resolved through the platform
   * port, same honesty contract); `'file'` rows keep the plain chip.
   * Carried explicitly so rendering never re-parses the free-form `extra`.
   */
  attachmentKind?: 'image' | 'audio' | 'video' | 'file'
  /**
   * Hub attachment ref for media rows (#1938/#1939) — the platform port
   * resolves `id` into a displayable URL; absent for non-attachment rows.
   */
  attachmentRef?: AttachmentRef
  ctxPct?: number
  ctxStats?: string[]
  sessionTags?: string[]
  codeLines?: string[]
  codeLang?: string
  children?: RowItem[]
  orchAgents?: { id: string; agent: string; role: AgentRole; task: string; status: 'pending' | 'running' | 'ok' | 'fail'; dependsOn?: string[] }[]
  orchNote?: string
  /** Domain extracted from preview URL (e.g. "github.com"). */
  previewDomain?: string
  /** Display title for URL preview (derived from URL path when no explicit title). */
  previewTitle?: string
}

/**
 * Unread-messages divider descriptor (desktop IM path, T8).
 * The upstream session exposes a read watermark (Hub: next_seq − last_read_seq
 * as unread_count); the consumer resolves it to a transcript block id of the
 * first unread message plus display copy, and ChatView renders a thin divider
 * right above that message.
 */
export interface UnreadDividerDescriptor {
  /** Transcript block id of the first unread message (divider renders above it). */
  anchorBlockId?: string
  /** Unread message count (watermark-derived). */
  count: number
  /** Main copy, e.g. "3 条未读". */
  label: string
  /** Optional read-through hint, e.g. "已读到 #12". */
  readThrough?: string
}
