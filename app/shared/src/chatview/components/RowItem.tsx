import { useState, useEffect, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'

import type { RowItem as RowItemType } from '../types'
import {
  IconBrain, IconFileText, IconSearch, IconFile, IconEdit,
  IconShield, IconArrowForward, IconSubtask, IconPlayerPlay, IconChevronDown,
  IconTarget, IconUpload, IconChart, IconDatabase, IconBraces,
  IconMarkdown, IconCss, IconTerminal, IconGlobe,
} from './Icons'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { cardLabelKey, toolKey, isToolResult } from '../design/labels'
import { formatApprovalWaitingSince } from '../adapterShared'
import MarkdownContent from '../../ui/Markdown'
import { Button } from '../../ui/Button'
import { RiskBadge } from '../../ui/RiskBadge'
import type { RiskLevel } from '../../ui/RiskBadge'
import { useCopiedFlag } from '../../ui/useCopiedFlag'
import { isSafeRemotePreviewUrl } from '../../ui/previewSandbox'
import './RowItem.css'

type IconComponent = React.FC<{ size?: number; className?: string }>

const iconMap: Record<string, IconComponent> = {
  think: IconBrain, tool: IconFileText, file: IconFile, sub: IconSubtask,
  approval: IconShield, route: IconArrowForward,
  deploy: IconTarget, attachment: IconUpload, ctx: IconChart, session: IconPlayerPlay,
  preview: IconTarget,
}

/** Stable toolName → icon routing — keys never translated */
const iconOverride: Record<string, IconComponent> = {
  read: IconFileText, grep: IconSearch, write: IconEdit,
  eslint: IconTerminal, prettier: IconTerminal,
  test: IconTerminal, lint: IconTerminal, tsc: IconTerminal,
  audit: IconSearch, check: IconSearch,
}

function fileIcon(item: RowItemType): IconComponent {
  const path = item.extra || item.content || ''
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sql': return IconDatabase
    case 'ts': case 'tsx': return IconBraces
    case 'js': case 'jsx': return IconBraces
    case 'md': return IconMarkdown
    case 'css': return IconCss
    case 'html': case 'json': return IconBraces
    default: return IconFile
  }
}

function FileTypeIcon({ item }: { item: RowItemType }) {
  const Icon = fileIcon(item)
  return <Icon size={14} />
}

/**
 * Stable DOM identity for a row, used as the `data-block-id` attribute and
 * the value highlight/search jump targets. Exported so the Transcript can
 * build a `blockId → segmentIndex` map for virtualized `scrollToIndex` jumps
 * (the row may be off-screen / unmounted under virtualization).
 */
export function stableInteractionId(item: RowItemType): string {
  return item.type === 'tool' && item.toolCallId ? `call-${item.toolCallId}` : item.id
}

/** Approval request kind inferred from payload structure. */
type ApKind = 'command' | 'diff' | 'plan' | 'allowed_prompts' | 'web' | 'json'

interface ParsedAp {
  kind: ApKind
  command?: string
  cwd?: string
  diffText?: string
  planMarkdown?: string
  planEntries?: { text: string; status?: string }[]
  allowedPrompts?: { tool?: string; prompt: string }[]
  url?: string
  query?: string
  jsonPreview?: string
  textContent?: string
}

/** Parse apReason to determine approval kind and extract structured data.
 *  Priority: 1) explicit `apKind` field  2) infer from JSON shape  3) plain text. */
function parseApKind(item: RowItemType): ParsedAp {
  if (item.apKind) {
    const kind = item.apKind.toLowerCase() as ApKind
    if (['command', 'diff', 'plan', 'allowed_prompts', 'web', 'json'].includes(kind)) {
      return { kind }
    }
  }
  if (!item.apReason) return { kind: 'json', textContent: '' }
  try {
    const p = JSON.parse(item.apReason)
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('not obj')
    if (p.command) return { kind: 'command', command: p.command, cwd: p.cwd }
    if (p.diff) return { kind: 'diff', diffText: p.diff }
    if (p.plan || p.plan_markdown || p.plan_entries) return { kind: 'plan', planMarkdown: p.plan || p.plan_markdown, planEntries: p.plan_entries || p.planEntries }
    if (p.allowed_prompts || p.allowedPrompts) return { kind: 'allowed_prompts', allowedPrompts: p.allowed_prompts || p.allowedPrompts }
    if (p.url) return { kind: 'web', url: p.url, query: p.query }
    return { kind: 'json', jsonPreview: JSON.stringify(p, null, 2) }
  } catch { /* not JSON */ }
  return { kind: 'json', textContent: item.apReason }
}

interface Props {
  item: RowItemType
  onToggle?: (id: string) => void
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onRetry?: (id: string) => void
  onCopy?: (id: string, text: string) => void
  onFileClick?: (id: string) => void
  onDeploySubmit?: (id: string) => void
  /** #1871: false disables the preview card's external-open (surface capability gate). */
  previewExternalOpenEnabled?: boolean
  onContextMenu?: (id: string, event: React.MouseEvent) => void
  onBlockSelect?: (id: string, shiftKey: boolean) => void
  onReviewFile?: (file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void
  selected?: boolean
  selectedAny?: boolean
  softHidden?: boolean
  actioned?: boolean
}

/** Render a single card/row inside an agent group in the transcript.
 *  Handles think, tool, file, sub, approval, route, deploy, attachment,
 *  context, and session card types with collapsible content areas. */
export const RowItem = memo(function RowItem({ item, onToggle, onApprove, onReject, onRetry, onCopy, onFileClick, onDeploySubmit, previewExternalOpenEnabled, onContextMenu, onBlockSelect, onReviewFile: _onReviewFile, selected, selectedAny: _selectedAny, softHidden, actioned: _actioned }: Props) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  const [open, setOpen] = useState(item.open ?? false)
  const userToggledRef = useRef(false)
  const thinkStartRef = useRef<number | null>(null)
  const [thinkDuration, setThinkDuration] = useState<number | undefined>(undefined)
  // T16: critical approval second-confirm — first click arms, second click fires.
  const [confirmingApprove, setConfirmingApprove] = useState(false)
  // Fable UIUX #4: Copy→Check feedback for the code copy button.
  const [copied, markCopied] = useCopiedFlag()
  const isOpen = item.type === 'route' ? true : open

  // Think cards: auto-open when running, auto-collapse 1s after done
  // (once semantics: once user manually toggles, never auto-collapse)
  // Also tracks think duration for "Thought for Ns" display (QW6).
  useEffect(() => {
    if (item.type !== 'think' || !item.collapsible) return
    if (userToggledRef.current) return
    if (item.status === 'running') {
      setOpen(true)
      if (thinkStartRef.current === null) thinkStartRef.current = Date.now()
    } else {
      if (thinkStartRef.current !== null) {
        setThinkDuration(Math.ceil((Date.now() - thinkStartRef.current) / 1000))
        thinkStartRef.current = null
      }
      const timer = setTimeout(() => {
        if (!userToggledRef.current) setOpen(false)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [item.status, item.type, item.collapsible])

  // Fail cards: auto-expand when status becomes 'fail' (once semantics —
  // once user manually toggles, never auto-reopen)
  useEffect(() => {
    if (item.type === 'approval' || item.type === 'tool' || item.type === 'sub') return
    if (item.status === 'fail' && item.collapsible && !userToggledRef.current) {
      setOpen(true)
    }
  }, [item.status, item.type, item.collapsible])

  // Waiting approval cards: auto-expand so the approve/deny actions are
  // visible without hunting inside the collapsed body (#1821). Once the user
  // manually toggles, respect their choice.
  useEffect(() => {
    if (item.type !== 'approval' || item.status !== 'waiting') return
    if (!item.collapsible || userToggledRef.current) return
    setOpen(true)
  }, [item.type, item.status, item.collapsible])

  // T16: reset critical second-confirm whenever the approval card's status or
  // identity changes (decided → idle, or a new request replaces this card).
  useEffect(() => {
    if (item.type !== 'approval') return
    setConfirmingApprove(false)
  }, [item.id, item.status, item.type])

  // Icon: file cards use extension-based icon; others use toolName or type
  const IconComp = item.type === 'file' ? fileIcon(item)
    : iconOverride[toolKey(item)] || iconMap[item.type] || IconFileText

  const { key: labelKey, params: labelParams } = cardLabelKey(item)
  const labelText = labelParams ? t(labelKey, labelParams) : t(labelKey)
  const resultClass = isToolResult(item) ? ' result-row' : ''
  const interactionId = stableInteractionId(item)

  const cls = `row-item ${item.type}${item.fileOp ? ' ' + item.fileOp : ''}${item.standalone ? ' standalone' : ''}${item.collapsible ? ' collapsible' : ''}${isOpen ? ' open' : ''}${item.status === 'running' ? ' running' : ''}${item.status === 'fail' ? ' fail' : ''}${resultClass}${selected ? ' selected' : ''}${softHidden ? ' soft-hidden' : ''}`

  const handleClick = (e: React.MouseEvent) => {
    if (item.status === 'running' || !item.collapsible) return
    e.stopPropagation()
    userToggledRef.current = true
    setOpen(!open); onToggle?.(item.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu?.(interactionId, e)
  }

  const handleSelectClick = (e: React.MouseEvent) => {
    onBlockSelect?.(interactionId, e.shiftKey)
  }

  // T16: critical approvals require a second-confirm — the first click arms
  // (button flips to "确认批准？" + red highlight), the second click fires.
  // Non-critical approvals fire onApprove immediately.
  const handleApproveClick = () => {
    if (item.riskLevel === 'critical') {
      if (!confirmingApprove) {
        setConfirmingApprove(true)
        return
      }
      setConfirmingApprove(false)
    }
    onApprove?.(item.id)
  }

  const handleRejectClick = () => {
    setConfirmingApprove(false)
    onReject?.(item.id)
  }

  // Fable UIUX #4: copy code lines, then flip the button to Check for 1500ms.
  // Follows the previous contract: onCopy (app-level handler, e.g. toast) takes
  // precedence; otherwise fall back to navigator.clipboard directly.
  const handleCodeCopy = () => {
    const text = item.codeLines?.join('\n') || ''
    if (onCopy) {
      onCopy(item.id, text)
      markCopied()
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(markCopied).catch(() => {
        /* clipboard may be denied — keep silent, no feedback flip */
      })
    }
  }

  // T16 + Wave10 a11y: keyboard equivalents for block rows.
  //   - Shift+F10 or Menu key → open context menu (mirrors ConversationSidebar).
  //   - Enter/Space → activate: block-select when wired, else toggle the body.
  //   - Escape → collapse an open collapsible row (approval cards also reset
  //     the critical second-confirm).
  //   - approval-waiting cards keep the A/R single-key shortcuts (case-insensitive,
  //     modifier combos pass through, ignored inside editable fields so typing
  //     isn't hijacked). Mirrors codeg keyboard-shortcuts normalization spirit.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null

    // Context-menu keyboard equivalent: Shift+F10 or the dedicated Menu key.
    // Synthesize a MouseEvent-shaped payload from the focused anchor's rect so
    // the parent's onContextMenu handler (which reads clientX/clientY) can
    // position the floating menu without a real pointer event.
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (!onContextMenu) return
      e.preventDefault()
      e.stopPropagation()
      const anchor = e.currentTarget as HTMLElement
      const rect = anchor.getBoundingClientRect()
      onContextMenu(interactionId, {
        preventDefault() {},
        stopPropagation() {},
        currentTarget: anchor,
        clientX: rect.left + Math.min(rect.width / 2, 24),
        clientY: rect.top + Math.min(rect.height / 2, 24),
      } as unknown as React.MouseEvent)
      return
    }

    // Approval-waiting letter shortcuts (A/R) + Escape-to-collapse.
    if (item.type === 'approval' && item.status === 'waiting') {
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key
      if (key === 'Escape') {
        e.preventDefault()
        setConfirmingApprove(false)
        userToggledRef.current = true
        setOpen(false)
        onToggle?.(item.id)
        return
      }
      const lower = key.length === 1 ? key.toLowerCase() : key
      if (lower === 'a') {
        e.preventDefault()
        handleApproveClick()
        return
      }
      if (lower === 'r') {
        e.preventDefault()
        handleRejectClick()
        return
      }
    }

    // Universal Escape → collapse an open collapsible row (non-approval path;
    // approval-waiting Escape returns above so its confirm state resets too).
    if (e.key === 'Escape') {
      if (item.collapsible && isOpen) {
        e.preventDefault()
        userToggledRef.current = true
        setOpen(false)
        onToggle?.(item.id)
      }
      return
    }

    // Enter/Space → activate. Skip when focus is on an inner control (the
    // header button, links, inputs) so its native activation isn't shadowed
    // and we don't double-fire block-select on top of a button click.
    if (e.key === 'Enter' || e.key === ' ') {
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (onBlockSelect) {
        e.preventDefault()
        onBlockSelect(interactionId, e.shiftKey)
        return
      }
      if (item.collapsible && item.status !== 'running') {
        e.preventDefault()
        userToggledRef.current = true
        setOpen(!isOpen)
        onToggle?.(item.id)
      }
    }
  }

  return (
    <div
      className={cls}
      onContextMenu={onContextMenu ? handleContextMenu : undefined}
      onClick={onBlockSelect ? handleSelectClick : undefined}
      onKeyDown={handleKeyDown}
      data-block-id={interactionId}
      data-row-id={item.id}
      data-selectable-card={interactionId}
      tabIndex={0}
    >
      <button
        type="button"
        className="row-hd"
        onClick={handleClick}
        {...(item.collapsible ? { 'aria-expanded': isOpen, 'aria-label': isOpen ? t('card.collapse') : t('card.expand') } : {})}
      >
        <IconComp className={`row-icon${item.fileOp === 'cr' ? ' cr' : item.fileOp === 'mod' ? ' mod' : item.fileOp === 'del' ? ' del' : ''}`} size={16} />
        {item.status === 'running' && (item.type === 'tool' || item.type === 'file' || item.type === 'sub') && (
          <span className="row-spinner" aria-hidden="true" />
        )}
        <span className="row-label">
          {item.type === 'file' ? (
            <><span className={`file-act ${item.fileOp||''}`}>{labelText}</span>
            {item.diffLines && (
              <span className="file-stat">
                <span className="file-stat-add">+{item.diffLines.filter(l => l.type === 'add').length}</span>
                {' / '}
                <span className="file-stat-del">&minus;{item.diffLines.filter(l => l.type === 'del').length}</span>
              </span>
            )}
            </>
          ) : item.type === 'think' ? (
            <>
              <span className={item.status === 'running' ? 'think-shimmer' : ''}>{labelText}</span>
              {item.status !== 'running' && item.status !== 'fail' && thinkDuration != null && (
                <span className="think-duration">{t('card.think.thoughtFor', { duration: String(thinkDuration) })}</span>
              )}
            </>
          ) : labelText}
        </span>
        {item.extra && <span className="row-extra">{item.extra}</span>}
        {item.collapsible && <IconChevronDown className="row-chevron" size={12} />}
      </button>
      {isOpen && (
        <div className="row-bd">
          {item.content && item.type !== 'file' && <div className="row-text">{item.content}</div>}
          {item.codeLines && (
            <div className="code-block">
              <div className="code-head">
                <span className="code-head-left"><FileTypeIcon item={item} /><span>{item.codeLang || labelText}</span></span>
                <Button variant="ghost" size="sm" className={copied ? 'copied' : undefined} aria-label={copied ? t('code.copied') : t('code.copy')} onClick={handleCodeCopy}>{copied ? <><Check size={12} />{t('code.copied')}</> : <><Copy size={12} />{t('code.copy')}</>}</Button>
              </div>
              <div className="code-lines">{item.codeLines.map((line, i) => (
                <div key={i} className="code-line"><span className="code-num">{i + 1}</span><span className="code-text">{line}</span></div>
              ))}</div>
            </div>
          )}
          {item.diffLines && (
            <div className="code-block">
              <div className="code-head">
                <span className="code-head-left"><FileTypeIcon item={item} /><span>{item.content || labelText}</span></span>
              </div>
              <div className="code-lines">{item.diffLines.map((l,i) => <div key={i} className={`code-line ${l.type}`}><span className="code-text">{l.text}</span></div>)}</div>
            </div>
          )}
          {item.apReason && (() => {
            const ap = parseApKind(item)
            return (
              <div className="ap-scroll">
                {ap.kind === 'command' && (
                  <div className="ap-section">
                    <div className="ap-cmd">
                      <div className="ap-cmd-head"><IconTerminal size={12} /><span>{t('card.approval.title')}</span></div>
                      {ap.command && <div className="ap-cmd-body">{ap.command}</div>}
                      {ap.cwd && <div className="ap-cwd">cwd: {ap.cwd}</div>}
                    </div>
                  </div>
                )}
                {ap.kind === 'diff' && (
                  <div className="ap-section">
                    <div className="code-block">
                      <div className="code-head"><span className="code-head-left"><FileTypeIcon item={item} /><span>{t('card.approval.title')}</span></span></div>
                      <div className="code-lines">
                        {(ap.diffText || '').split('\n').map((line, i) => {
                          const t2 = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx'
                          return <div key={i} className={`code-line ${t2}`}><span className="code-num">{i + 1}</span><span className="code-text">{line}</span></div>
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {ap.kind === 'plan' && (
                  <div className="ap-section ap-plan">
                    {ap.planMarkdown ? <MarkdownContent content={ap.planMarkdown} /> : null}
                    {ap.planEntries && ap.planEntries.length > 0 && (
                      <div className="ap-allowed-list">
                        {ap.planEntries.map((e, i) => (
                          <span key={i} className="ap-pill">{e.text}{e.status ? ` (${e.status})` : ''}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {ap.kind === 'allowed_prompts' && (
                  <div className="ap-section">
                    <div className="ap-allowed-list">
                      {ap.allowedPrompts?.map((item2, i) => (
                        <span key={i} className="ap-pill">
                          {item2.tool && <span className="ap-pill-tool">{item2.tool}</span>}
                          <span>{item2.prompt}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {ap.kind === 'web' && (
                  <div className="ap-section ap-web">
                    {ap.url ? <a href={ap.url} target="_blank" rel="noopener noreferrer">{ap.url}</a> : null}
                    {ap.query && <div className="ap-json">{ap.query}</div>}
                  </div>
                )}
                {ap.kind === 'json' && (
                  <div className="ap-section">
                    <div className="ap-json">{ap.jsonPreview || ap.textContent || ''}</div>
                  </div>
                )}
              </div>
            )
          })()}
          {/* a11y TODO (#1503 approval arrival): this waiting approval card lives inside the
              Transcript's role=log region. Under virtualization the card is unmounted while
              outside the buffer window, so its arrival is never announced to screen readers.
              Fix: a live region OUTSIDE the virtualizer (ChatViewTranscript/consumer level)
              fed by an approval-arrival signal — needs data flow changes, deferred. */}
          {/* #1819 waiting-approval time feedback: the request has no deadline
              upstream (Edge/Hub carry nothing like expires_at), so we surface
              the honest created-time ("requested at HH:MM") instead of a fake
              countdown or timed-out state. Hidden when the timestamp is
              missing/invalid. */}
          {item.type === 'approval' && item.status === 'waiting' && (() => {
            const waitingSinceLabel = formatApprovalWaitingSince(item.waitingSince)
            return waitingSinceLabel ? (
              <div className="ap-waiting-meta">
                {t('card.approval.requestedAt', { time: waitingSinceLabel })}
              </div>
            ) : null
          })()}
          {item.apReason && item.status==='waiting' && (
            <div className={`ap-actions${item.riskLevel ? ' has-risk' : ''}`}>
              {item.riskLevel && (
                <RiskBadge level={item.riskLevel as RiskLevel} className="ap-risk-badge">
                  {t(`card.approval.risk.${item.riskLevel}`)}
                </RiskBadge>
              )}
              <Button
                variant={item.riskLevel === 'critical' ? 'destructive' : 'primary'}
                size="sm"
                className={`ap-approve${item.riskLevel === 'critical' ? ' critical' : ''}${confirmingApprove ? ' confirming' : ''}`}
                aria-label={confirmingApprove ? t('card.approval.confirmApprove') : t('card.approval.approve')}
                onClick={handleApproveClick}
              >
                {confirmingApprove ? t('card.approval.confirmApprove') : t('card.approval.approve')}
              </Button>
              <Button variant="ghost" size="sm" className="ap-reject" aria-label={t('card.approval.deny')} onClick={handleRejectClick}>{t('card.approval.deny')}</Button>
              <span className="ap-kbd-hint">{t('card.approval.kbdHint')}</span>
            </div>
          )}
          {item.type === 'preview' && item.url && (
            // #1871: external-open is capability-gated — only when the surface
            // enables it AND the URL is a safe http(s) scheme does it render as an
            // outbound link. Otherwise it stays an inert card (no clickable escape
            // from the sandboxed transcript surface).
            (previewExternalOpenEnabled !== false && isSafeRemotePreviewUrl(item.url)) ? (
              <a className="preview-card" href={item.url} rel="noopener noreferrer" target="_blank">
                <div className="preview-thumb" aria-hidden="true">
                  <IconGlobe className="preview-favicon" size={20} />
                </div>
                <div className="preview-body">
                  {item.previewDomain && <span className="preview-domain">{item.previewDomain}</span>}
                  <span className="preview-title">{item.previewTitle || item.url}</span>
                  <span className="preview-url-text">{item.url}</span>
                </div>
              </a>
            ) : (
              <div className="preview-card preview-card-blocked">
                <div className="preview-thumb" aria-hidden="true">
                  <IconGlobe className="preview-favicon" size={20} />
                </div>
                <div className="preview-body">
                  {item.previewDomain && <span className="preview-domain">{item.previewDomain}</span>}
                  <span className="preview-title">{item.previewTitle || item.url}</span>
                  <span className="preview-url-text">{item.url}</span>
                </div>
              </div>
            )
          )}
          {item.url && item.type !== 'preview' && <div className="dp-url" onClick={() => onDeploySubmit?.(item.id)} style={{cursor: onDeploySubmit ? 'pointer' : undefined}}>{item.url}</div>}
          {item.deployMeta && <div className="dp-meta">{item.deployMeta}</div>}
          {item.fileName && <div className={`att-row${onFileClick ? ' clickable' : ''}`} onClick={onFileClick ? () => onFileClick(item.id) : undefined}><span className="att-name">{item.fileName}</span>{item.fileSize && <span className="att-size">{item.fileSize}</span>}</div>}
          {item.ctxPct !== undefined && (<>
            <div className="ctx-bar-wrap"><div className="ctx-bar"><div className={`ctx-fill ${(item.ctxPct??0)>80?'warn':'ok'}`} style={{'--ctx-pct': `${item.ctxPct}%`} as React.CSSProperties} /></div><span className="pct">{item.ctxPct}%</span></div>
            {item.ctxStats && <div className="ctx-meta">{item.ctxStats.map((s,i) => <span key={i}>{s}</span>)}</div>}
          </>)}
          {item.sessionTags && <div className="sess-meta">{item.sessionTags.map((t,i) => <span key={i}>{t}</span>)}</div>}
          {item.children && item.children.length > 0 && (
            <div className="row-children">
              {item.children.map((child) => (
                // #1821: nested cards (run_step_group recursion) must receive
                // the approval + toggle callbacks or their buttons are dead.
                // Conditional spread keeps exactOptionalPropertyTypes happy.
                <RowItem
                  key={child.id}
                  item={child}
                  {...(onToggle ? { onToggle } : {})}
                  {...(onApprove ? { onApprove } : {})}
                  {...(onReject ? { onReject } : {})}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {item.status==='fail' && onRetry && <div className="retry-bar"><Button variant="ghost" size="sm" className="fail-retry" aria-label={t('card.fail.retry')} onClick={() => onRetry(item.id)}>{t('card.fail.retry')}</Button></div>}
    </div>
  )
})
