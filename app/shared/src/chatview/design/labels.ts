/* ═══════════════════════════════════════════════════════════════════════
   LABEL RESOLVER — maps RowItem → i18n TransKey for status-aware display
   ══════════════════════════════════════════════════════════════════════ */

import type { RowItem } from '../data/mock'
import type { TransKey } from '../i18n/translations'

export interface LabelResult {
  key: TransKey
  params?: Record<string, string>
}

/** Extract sub-agent name from label like "Agent · Linter" */
function subName(item: RowItem): string {
  // If label contains " · ", extract the part after it
  const idx = item.label.indexOf(' · ')
  if (idx > -1) return item.label.slice(idx + 3)
  return item.label.startsWith('Agent ') ? item.label.slice(6) : ''
}

/**
 * Resolve the display label for a card based on type + status + toolName.
 * Returns {key, params?} — caller passes to t(key, params) for display string.
 */
export function cardLabelKey(item: RowItem): LabelResult {
  const { type, status, toolName } = item
  const running = status === 'running'

  switch (type) {
    case 'think': {
      if (toolName === 'analyze') return { key: running ? 'card.think.analyze' : 'card.think.analyzeDone' }
      return { key: running ? 'card.think.running' : 'card.think.done' }
    }

    case 'tool': {
      const tn = (toolName || toolKey(item))
      if (running) {
        return { key: `card.tool.${tn}.running` as TransKey }
      }
      return { key: `card.tool.${tn}` as TransKey }
    }

    case 'file': {
      const op = toolName || toolKey(item)
      return { key: (running ? `card.file.${op}.running` : `card.file.${op}`) as TransKey }
    }

    case 'sub': {
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
      return { key: 'card.route.dag' }

    case 'deploy':
      return { key: 'card.deploy.ready' }

    case 'attachment':
      // Attachment labels are filenames — pass through as-is
      return { key: item.label as TransKey }

    case 'session':
      return { key: 'card.session.prefix' }

    default:
      return { key: item.label as TransKey }
  }
}

/** Stable tool identifier for icon routing — never translated.
 *  Uses explicit toolName field when present; falls back to type+label inference
 *  for mock data that hasn't been migrated yet. */
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
    if (l === 'read') return 'read'
    if (l === 'grep') return 'grep'
    if (l === 'write') return 'write'
    if (l === 'eslint') return 'eslint'
    if (l === 'prettier') return 'prettier'
    if (l.includes('tsc')) return 'tsc'
    if (l === 'test') return 'test'
    if (l === 'lint') return 'lint'
    if (l === 'audit') return 'audit'
    if (l === 'check') return 'check'
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

/** Whether this tool card should get the result-row CSS class.
 *  Uses explicit isResult flag; falls back to label matching for legacy data. */
export function isToolResult(item: RowItem): boolean {
  if (item.isResult === true) return true
  if (item.isResult === false) return false
  // Fallback: detect result cards by label content
  const l = item.label.toLowerCase()
  return l.includes('result') || l.includes('结果')
}
