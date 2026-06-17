import { useState, useEffect } from 'react'
import type { RowItem as RowItemType } from '../types'
import {
  IconBrain, IconFileText, IconSearch, IconFile, IconEdit,
  IconShield, IconArrowForward, IconSubtask, IconPlayerPlay, IconChevronDown,
  IconTarget, IconUpload, IconChart, IconDatabase, IconBraces,
  IconMarkdown, IconCss, IconTerminal,
} from './Icons'
import { useTranslation } from 'react-i18next'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { cardLabelKey, toolKey, isToolResult } from '../design/labels'
import './RowItem.css'

type IconComponent = React.FC<{ size?: number; className?: string }>

const iconMap: Record<string, IconComponent> = {
  think: IconBrain, tool: IconFileText, file: IconFile, sub: IconSubtask,
  approval: IconShield, route: IconArrowForward,
  deploy: IconTarget, attachment: IconUpload, ctx: IconChart, session: IconPlayerPlay,
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

interface Props {
  item: RowItemType
  onToggle?: (id: string) => void
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onRetry?: (id: string) => void
  onCopy?: (id: string, text: string) => void
  onFileClick?: (id: string) => void
  onContextMenu?: (id: string, event: React.MouseEvent) => void
  onBlockSelect?: (id: string, shiftKey: boolean) => void
  onReviewFile?: (file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void
  selected?: boolean
  selectedAny?: boolean
  softHidden?: boolean
  actioned?: boolean
}

export default function RowItem({ item, onToggle, onApprove, onReject, onRetry, onCopy, onFileClick, onContextMenu, onBlockSelect, onReviewFile: _onReviewFile, selected, selectedAny: _selectedAny, softHidden, actioned: _actioned }: Props) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  const [open, setOpen] = useState(item.open ?? false)
  const isOpen = item.type === 'route' ? true : open

  // Think cards: auto-open when running, auto-collapse when done
  useEffect(() => {
    if (item.type !== 'think' || !item.collapsible) return
    setOpen(item.status === 'running')
  }, [item.status, item.type, item.collapsible])

  // Icon: file cards use extension-based icon; others use toolName or type
  const IconComp = item.type === 'file' ? fileIcon(item)
    : iconOverride[toolKey(item)] || iconMap[item.type] || IconFileText

  const { key: labelKey, params: labelParams } = cardLabelKey(item)
  const labelText = labelParams ? t(labelKey, labelParams) : t(labelKey)
  const resultClass = isToolResult(item) ? ' result-row' : ''

  const cls = `row-item ${item.type}${item.fileOp ? ' ' + item.fileOp : ''}${item.standalone ? ' standalone' : ''}${item.collapsible ? ' collapsible' : ''}${isOpen ? ' open' : ''}${item.status === 'running' ? ' running' : ''}${item.status === 'fail' ? ' fail' : ''}${resultClass}${selected ? ' selected' : ''}${softHidden ? ' soft-hidden' : ''}`

  const handleClick = () => {
    if (item.status === 'running' || !item.collapsible) return
    setOpen(!open); onToggle?.(item.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu?.(item.id, e)
  }

  const handleSelectClick = (e: React.MouseEvent) => {
    onBlockSelect?.(item.id, e.shiftKey)
  }

  return (
    <div className={cls} onContextMenu={onContextMenu ? handleContextMenu : undefined} onClick={onBlockSelect ? handleSelectClick : undefined} data-block-id={item.id} tabIndex={0}>
      <div className="row-hd" onClick={handleClick}>
        <IconComp className={`row-icon${item.fileOp === 'cr' ? ' cr' : item.fileOp === 'mod' ? ' mod' : item.fileOp === 'del' ? ' del' : ''}`} size={16} />
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
          ) : labelText}
        </span>
        {item.extra && <span className="row-extra">{item.extra}</span>}
        {item.collapsible && <IconChevronDown className="row-chevron" size={12} />}
      </div>
      {isOpen && (
        <div className="row-bd">
          {item.content && item.type !== 'file' && <div className="row-text">{item.content}</div>}
          {item.codeLines && (
            <div className="code-block">
              <div className="code-head">
                <span className="code-head-left"><FileTypeIcon item={item} /><span>{item.codeLang || labelText}</span></span>
                <button className="code-copy" onClick={() => { const text = item.codeLines?.join('\n') || ''; onCopy ? onCopy(item.id, text) : navigator.clipboard?.writeText(text) }}>{t('code.copy')}</button>
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
          {item.apReason && (<>
            <div className="ap-reason">{item.apReason}</div>
            {item.status==='waiting' && <div className="ap-actions"><button className="ap-approve" onClick={() => onApprove?.(item.id)}>{t('card.approval.approve')}</button><button className="ap-deny" onClick={() => onReject?.(item.id)}>{t('card.approval.deny')}</button></div>}
          </>)}
          {item.status==='fail' && onRetry && <div className="ap-actions"><button className="ap-approve" onClick={() => onRetry(item.id)}>{t('card.fail.retry')}</button></div>}
          {item.url && <div className="dp-url">{item.url}</div>}
          {item.deployMeta && <div className="dp-meta">{item.deployMeta}</div>}
          {item.fileName && <div className={`att-row${onFileClick ? ' clickable' : ''}`} onClick={() => onFileClick?.(item.id)}><span className="att-name">{item.fileName}</span>{item.fileSize && <span className="att-size">{item.fileSize}</span>}</div>}
          {item.ctxPct !== undefined && (<>
            <div className="ctx-bar-wrap"><div className="ctx-bar"><div className={`ctx-fill ${(item.ctxPct??0)>80?'warn':'ok'}`} style={{'--ctx-pct': `${item.ctxPct}%`} as React.CSSProperties} /></div><span className="pct">{item.ctxPct}%</span></div>
            {item.ctxStats && <div className="ctx-meta">{item.ctxStats.map((s,i) => <span key={i}>{s}</span>)}</div>}
          </>)}
          {item.sessionTags && <div className="sess-meta">{item.sessionTags.map((t,i) => <span key={i}>{t}</span>)}</div>}
          {item.children && item.children.length > 0 && (
            <div className="row-children">
              {item.children.map((child) => <RowItem key={child.id} item={child} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
