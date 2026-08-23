import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TranscriptUserItem } from '../transcript-item'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import MarkdownContent from '../../ui/Markdown'
import { MessageDisplayMeta } from './MessageDisplayMeta'

function userAvatarInitial(name: string | undefined, fallback: string): string {
  return (name?.trim() || fallback).slice(0, 1).toUpperCase()
}

interface Props {
  item: TranscriptUserItem
  chatMode: 'dm' | 'group'
  /**
   * Context-menu trigger for the user message bubble (#1821). Mirrors the
   * tool-row contract in RowItem: the bubble carries `data-selectable-card`
   * with the upstream block id and fires this handler on contextmenu.
   */
  onContextMenu?: (id: string, event: React.MouseEvent) => void
  /** #1825: one-shot entry animation for the newest same-session message. */
  enter?: boolean | undefined
}

/** Render a user message bubble in the transcript.
 *  In DM mode: avatar only, right-aligned. In group mode: name + time + avatar. */
export const UserMessage = memo(function UserMessage({ item, chatMode, onContextMenu, enter }: Props) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  const avatarInitial = userAvatarInitial(item.name, t('chat.you'))
  const rowClass = enter ? 'grp-row user-row-right grp-enter' : 'grp-row user-row-right'

  // #1821: text bubbles get the same selectable/context-menu identity tool
  // rows have — only when both an upstream block id and a handler exist.
  const selectableId = item.id
  const bubbleProps = selectableId && onContextMenu
    ? {
        'data-block-id': selectableId,
        'data-selectable-card': selectableId,
        onContextMenu: (event: React.MouseEvent) => onContextMenu(selectableId, event),
      }
    : {}

  if (chatMode === 'dm') {
    return (
      <div className={rowClass}>
        <div className="dm-spacer" aria-hidden="true"><div className="ag-av">&nbsp;</div></div>
        <div className="grp-content user-content-right">
          <MessageDisplayMeta
            align="right"
            badgeLabel={item.badgeLabel}
            badgeVariant={item.badgeVariant}
            detail={item.displayDetail}
            title={item.displayTitle}
          />
          <div className="user-bubble" {...bubbleProps}>
            <MarkdownContent content={item.text} />
          </div>
        </div>
        <div className="dm-avatar"><div className="ag-av user-av">{avatarInitial}</div></div>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      <div className="dm-spacer" aria-hidden="true"><div className="ag-av">&nbsp;</div></div>
      <div className="grp-content user-content-right">
        <div className="user-meta">
          <span className="ag-time">{item.time}</span>
          <span className="ag-name">{item.name || t('chat.you')}</span>
        </div>
        <MessageDisplayMeta
          align="right"
          badgeLabel={item.badgeLabel}
          badgeVariant={item.badgeVariant}
          detail={item.displayDetail}
          title={item.displayTitle}
        />
        <div className="user-bubble" {...bubbleProps}>
          <MarkdownContent content={item.text} />
        </div>
      </div>
      <div className="dm-avatar"><div className="ag-av user-av">{avatarInitial}</div></div>
    </div>
  )
})
