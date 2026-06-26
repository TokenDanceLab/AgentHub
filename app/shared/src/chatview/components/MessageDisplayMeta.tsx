import type { BadgeVariant } from '../../transcript/types'

interface MessageDisplayMetaProps {
  align?: 'left' | 'right'
  badgeLabel?: string | undefined
  badgeVariant?: BadgeVariant | undefined
  detail?: string | undefined
  title?: string | undefined
}

export function MessageDisplayMeta({
  align = 'left',
  badgeLabel,
  badgeVariant,
  detail,
  title,
}: MessageDisplayMetaProps) {
  if (!title && !detail && !badgeLabel) return null

  return (
    <div className="message-display-meta" data-align={align}>
      <div className="message-display-meta-line">
        {title && <span className="message-display-title">{title}</span>}
        {badgeLabel && (
          <span className="message-display-badge" data-variant={badgeVariant ?? 'primary'}>
            {badgeLabel}
          </span>
        )}
      </div>
      {detail && <div className="message-display-detail">{detail}</div>}
    </div>
  )
}
