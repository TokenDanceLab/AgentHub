/* ═══════════════════════════════════════════════════════════════════════
   LABEL RESOLVER — maps RowItem → i18n TransKey for status-aware display
   ══════════════════════════════════════════════════════════════════════ */

import type { RowItem } from '../types'
import type { TransKey } from '../i18n/resources'
import { SEP } from '../adapter'

export interface LabelResult {
  key: TransKey
  params?: Record<string, string> | undefined
}

/** Extract sub-agent name from label like "Agent · Linter" */
function subName(item: RowItem): string {
  // If label contains SEP, extract the part after it
  const idx = item.label.indexOf(SEP)
  if (idx > -1) return item.label.slice(idx + SEP.length)
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
      if (status === 'fail') return { key: 'card.think.fail' }
      if (toolName === 'analyze') return { key: running ? 'card.think.analyze' : 'card.think.analyzeDone' }
      return { key: running ? 'card.think.running' : 'card.think.done' }
    }

    case 'tool': {
      if (status === 'fail') return { key: 'card.tool.fail' }
      const tn = (toolName || toolKey(item))
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

    default:
      return { key: (item.label || item.type) as TransKey }
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
    if (l === 'read' || l === '阅读') return 'read'
    if (l === 'grep' || l === '搜索') return 'grep'
    if (l === 'write' || l === '写入') return 'write'
    if (l === 'eslint') return 'eslint'
    if (l === 'prettier') return 'prettier'
    if (l.includes('tsc')) return 'tsc'
    if (l === 'test' || l === '测试') return 'test'
    if (l === 'lint') return 'lint'
    if (l === 'audit' || l === '审计') return 'audit'
    if (l === 'check' || l === '检查') return 'check'
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
