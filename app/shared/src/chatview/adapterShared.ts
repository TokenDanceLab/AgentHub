/**
 * Chatview adapter shared helpers / constants.
 * Peel companion of adapter (#1143). Pure only; zero behavior change.
 */

import type { TranscriptBlock, EvidenceRefStatus } from '../transcript/types'
import type { RowItem } from './types'
import type { TranscriptAgentItem } from './transcript-item'

/** Separator used to join display parts (e.g. `'Agent · Linter'`, `'Read · medium · reason'`). */
export const SEP = ' · '

/**
 * Convert a unified-diff `patch` string into an array of line objects
 * suitable for rendering in the transcript's diff viewer.
 *
 * Truncates to `maxLines` lines (default 40) to avoid huge diffs
 * dominating the transcript.
 *
 * @param patch - A unified-diff patch string (lines starting with `+` / `-` / ` `).
 * @param maxLines - Maximum number of lines to include (default 40).
 * @returns An array of `{ type, text }` objects where type is `'add'`, `'del'`, or `'ctx'`.
 */
export function patchToDiffLines(patch: string, maxLines = 40) {
  return patch.split('\n').slice(0, maxLines).map(line => ({
    type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
    text: line,
  }))
}

/**
 * Extract optional display-override fields from a block.
 * Picks `displayTitle`, `displayDetail`, `badgeLabel`, and `badgeVariant` when present.
 * Used to propagate display annotations from upstream blocks into
 * TranscriptUserItem and TranscriptAgentItem.
 */
export function pickDisplay(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (b.displayTitle !== undefined) out.displayTitle = b.displayTitle
  if (b.displayDetail !== undefined) out.displayDetail = b.displayDetail
  if (b.badgeLabel !== undefined) out.badgeLabel = b.badgeLabel
  if (b.badgeVariant !== undefined) out.badgeVariant = b.badgeVariant
  return out
}

/**
 * Create a new TranscriptAgentItem with empty row/bubble/standalone arrays.
 *
 * @param author - The block's author metadata (id, name, role).
 * @param role - The agent's role string (e.g. `'builder'`, `'reviewer'`).
 * @param createdAt - ISO timestamp string for the time display.
 * @returns A fresh agent block ready to accumulate rows and bubbles.
 */
export function newAgentBlock(author: TranscriptBlock['author'], role: string, createdAt?: string): TranscriptAgentItem {
  return {
    id: author?.id ?? 'unknown',
    agent: author?.name || 'Agent',
    role,
    time: timeStr(createdAt),
    rows: [],
    bubbles: [],
    standaloneRows: [],
    parts: [],
    runs: [],
  }
}

/**
 * Format an ISO timestamp into a locale-aware time string (HH:MM).
 * Falls back to `'en-US'` when `navigator` is not available (e.g. SSR).
 *
 * @param iso - ISO 8601 date string (e.g. `'2026-06-17T14:30:00.000Z'`).
 * @returns A formatted time string like `'14:30'` or an empty string if input is falsy.
 */
export function timeStr(iso?: string) {
  if (!iso) return ''
  const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Locale-aware "requested at HH:MM" label for waiting approval cards (#1819).
 * Returns undefined for missing/invalid input so the meta line is hidden
 * rather than rendering an invented or broken timestamp.
 */
export function formatApprovalWaitingSince(iso?: string): string | undefined {
  if (!iso) return undefined
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return undefined
  const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  return new Date(parsed).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Canonical mapper from EvidenceRefStatus (or generic status string)
 * to RowItem status.
 *
 * Mapping:
 * - `'running'` / `'pending'`  -> `'running'`
 * - `'failed'`                 -> `'fail'`
 * - `'completed'`              -> `'ok'`
 * - Everything else            -> `'ok'`
 */
export function statusNorm(s: EvidenceRefStatus | string | undefined): RowItem['status'] {
  if (!s) return 'running'
  if (s === 'running' || s === 'pending') return 'running'
  if (s === 'failed') return 'fail'
  if (s === 'completed') return 'ok'
  return 'running'
}

/**
 * Deploy-specific status mapper. Handles deploy lifecycle states that
 * differ from the generic EvidenceRefStatus set.
 *
 * Mapping:
 * - `'failed'`                 -> `'fail'`
 * - `'pending'` / `'deploying'` -> `'running'`
 * - `'ready'` / `'deployed'`   -> `'ok'`
 * - `undefined` / other        -> `'ok'`
 */
export function deployStatusNorm(s?: string): RowItem['status'] {
  if (!s) return 'ok'
  if (s === 'failed') return 'fail'
  if (s === 'pending' || s === 'deploying') return 'running'
  if (s === 'ready' || s === 'deployed') return 'ok'
  return 'ok'
}

/**
 * Extract a human-readable domain from a URL string (without www. prefix).
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Derive a display title from a URL path segment when no explicit title is provided.
 */
export function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname
      .replace(/\/$/, '')
      .split('/')
      .filter(Boolean)
      .pop()
    if (!path) return extractDomain(url)
    const decoded = decodeURIComponent(path)
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '')
    return decoded.length > 60 ? decoded.slice(0, 57) + '...' : decoded
  } catch {
    return url
  }
}
