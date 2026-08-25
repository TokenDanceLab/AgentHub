/* ═══════════════════════════════════════════════════════════════════════
   LABEL RESOLVER — maps RowItem → i18n TransKey for status-aware display
   ══════════════════════════════════════════════════════════════════════ */

import type { RowItem } from '../types'
import type { TransKey } from '../i18n/resources'
import { SEP } from '../adapter'

const KNOWN_TOOL_KEYS = new Set([
  'read',
  'grep',
  'write',
  'result',
  'eslint',
  'prettier',
  'tsc',
  'audit',
  'check',
  'test',
  'lint',
])

/** Display label resolved from a {@link RowItem}, ready for i18n interpolation.
 *  Caller uses `t(result.key, result.params)` to get the final display string. */
export interface LabelResult {
  /** i18next translation key in the `chatview` namespace */
  key: TransKey
  /** Optional interpolation parameters (e.g. `{ name: 'Linter' }`) */
  params?: Record<string, string> | undefined
}

/**
 * Extract sub-agent name from a label string.
 * If the label contains the SEP delimiter (` · `), returns the portion after it.
 * Otherwise, if the label starts with `'Agent '`, returns the remainder.
 * Returns an empty string if neither pattern matches.
 */
function subName(item: RowItem): string {
  // If label contains SEP, extract the part after it
  const idx = item.label.indexOf(SEP)
  if (idx > -1) return item.label.slice(idx + SEP.length)
  return item.label.startsWith('Agent ') ? item.label.slice(6) : ''
}

/**
 * Resolve the display label for a transcript card based on `type`, `status`, and `toolName`.
 *
 * The returned `key` is an i18next translation key in the `chatview` namespace.
 * Callers interpolate it via `t(result.key, result.params)`.
 *
 * Status-aware conventions:
 * - `'running'` / `'pending'` -- in-flight state (e.g. `'card.think.running'`)
 * - `'ok'` / `'completed'`   -- finished state (e.g. `'card.think.done'`)
 * - `'fail'` / `'failed'`     -- error state (e.g. `'card.think.fail'`)
 * - `'waiting'`               -- awaiting user input (e.g. `'card.approval.waiting'`)
 *
 * @param item - The row item to produce a label for.
 * @returns A {@link LabelResult} with the resolved i18n key and optional parameters.
 */
export function cardLabelKey(item: RowItem): LabelResult {
  const { type, status, toolName } = item
  const running = status === 'running'

  switch (type) {
    case 'think': {
      if (status === 'fail') return { key: 'card.think.fail' }
      if (toolName === 'analyze') return { key: running ? 'card.think.analyze' : 'card.think.analyzeDone' }
      return { key: running ? 'card.think.running' : 'card.think.done' }
    }

    case 'tool': {
      if (status === 'fail') return { key: 'card.tool.fail' }
      const tn = (toolName || toolKey(item)).trim().toLowerCase()
      if (!KNOWN_TOOL_KEYS.has(tn)) {
        return {
          key: running ? 'card.tool.generic.running' : 'card.tool.generic',
          params: { name: item.label || tn },
        }
      }
      if (running) {
        return { key: `card.tool.${tn}.running` as TransKey }
      }
      return { key: `card.tool.${tn}` as TransKey }
    }

    case 'file': {
      if (status === 'fail') return { key: 'card.file.fail' }
      const op = toolName || toolKey(item)
      return { key: (running ? `card.file.${op}.running` : `card.file.${op}`) as TransKey }
    }

    case 'sub': {
      if (status === 'fail') return { key: 'card.sub.agent.fail' }
      if (status === 'ok') return { key: 'card.sub.agent.ok' }
      const name = subName(item)
      if (running) return { key: 'card.sub.agent.running', params: name ? { name } : undefined }
      // Done: show "Agent · {name}" or just "Agent"
      if (name) return { key: 'card.sub.agent.withName' as TransKey, params: { name } }
      return { key: 'card.sub.agent' }
    }

    case 'approval':
      if (status === 'ok') return { key: 'card.approval.ok' }
      if (status === 'waiting') return { key: 'card.approval.waiting' }
      if (status === 'fail') return { key: 'card.approval.fail' }
      return { key: 'card.approval.title' }

    case 'route':
      if (status === 'fail') return { key: 'card.route.fail' }
      return { key: 'card.route.dag' }

    case 'deploy':
      if (status === 'fail') return { key: 'card.deploy.fail' }
      if (status === 'running') return { key: 'card.deploy.running' }
      return { key: 'card.deploy.ready' }

    case 'session':
      if (status === 'fail') return { key: 'card.session.fail' }
      return item.label ? { key: item.label as TransKey } : { key: 'card.session.prefix' }

    case 'ctx':
      if (status === 'fail') return { key: 'card.ctx.fail' }
      return { key: item.label as TransKey }

    case 'attachment':
      if (status === 'fail') return { key: 'card.attachment.fail' }
      return { key: item.label as TransKey }

    case 'preview':
      if (status === 'fail') return { key: 'card.preview.fail' }
      if (status === 'running') return { key: 'card.preview.running' }
      return { key: 'card.preview.ready' }

    case 'checkpoint':
      return { key: 'card.checkpoint', params: { count: String(item.checkpointFileCount ?? 0) } }

    default:
      return { key: (item.label || item.type) as TransKey }
  }
}

/**
 * Return a stable tool identifier for icon routing and i18n key derivation.
 *
 * The returned value is **never translated** -- it is a machine-readable key
 * such as `'read'`, `'grep'`, `'eslint'`, `'modify'`, or `'analyze'`.
 *
 * Priority:
 * 1. Explicit `item.toolName` field (set by the adapter for fully-migrated data).
 * 2. Fallback heuristic based on `type` + `label` content, for legacy / mock data
 *    that does not yet provide `toolName`.
 *
 * @param item - The row item to derive a tool key for.
 * @returns A stable, lowercase tool identifier string.
 */
export function toolKey(item: RowItem): string {
  if (item.toolName) return item.toolName
  // Fallback derivation — eventually all cards should set toolName explicitly
  if (item.type === 'file') {
    if (item.fileOp === 'cr') return 'create'
    if (item.fileOp === 'mod') return 'modify'
    if (item.fileOp === 'del') return 'delete'
    return 'modify'
  }
  if (item.type === 'tool') {
    const l = item.label.toLowerCase()
    if (l.includes('result') || l.includes('结果')) return 'result'
    if (l === 'read' || l.startsWith('阅读')) return 'read'
    if (l === 'grep' || l.startsWith('搜索')) return 'grep'
    if (l === 'write' || l.startsWith('写入')) return 'write'
    if (l === 'eslint') return 'eslint'
    if (l === 'prettier') return 'prettier'
    if (l.includes('tsc')) return 'tsc'
    if (l === 'test' || l.startsWith('测试')) return 'test'
    if (l === 'lint') return 'lint'
    if (l === 'audit' || l.startsWith('审计')) return 'audit'
    if (l === 'check' || l.startsWith('检查')) return 'check'
    return 'result'
  }
  if (item.type === 'think') {
    if (item.label.includes('分析')) return 'analyze'
    return 'think'
  }
  if (item.type === 'sub') {
    return 'sub'
  }
  return item.type
}

/**
 * Determine whether a tool card should receive the `result-row` CSS class.
 *
 * Priority:
 * 1. Explicit `item.isResult` boolean (set by the adapter for tool_result blocks).
 * 2. Fallback: detect result cards by label content (contains `'result'` or `'结果'`),
 *    for legacy data that does not yet provide the `isResult` flag.
 *
 * @param item - The row item to check.
 * @returns `true` if the item should be styled as a tool result.
 */
export function isToolResult(item: RowItem): boolean {
  if (item.isResult === true) return true
  if (item.isResult === false) return false
  if (item.type !== 'tool') return false
  // Fallback: detect result cards by label content
  if (!item.label) return false
  const l = item.label.toLowerCase()
  return l.includes('result') || l.includes('结果')
}
