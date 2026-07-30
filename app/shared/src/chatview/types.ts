/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW CORE TYPES
   Shared package types — no AgentHub or upstream dependency.
   ══════════════════════════════════════════════════════════════════════ */

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
  standalone?: boolean
  url?: string
  deployMeta?: string
  fileName?: string
  fileSize?: string
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
