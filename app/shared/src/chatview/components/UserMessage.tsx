import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TranscriptUserItem } from '../transcript-item'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'

interface Props { item: TranscriptUserItem; chatMode: 'dm' | 'group' }

/** Render a user message bubble in the transcript.
 *  In DM mode: avatar only, right-aligned. In group mode: name + time + avatar. */
export const UserMessage = memo(function UserMessage({ item, chatMode }: Props) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)

  if (chatMode === 'dm') {
    return (
      <div className="grp-row user-row-right">
        <div className="dm-spacer"><div className="ag-av">&nbsp;</div></div>
        <div className="grp-content user-content-right">
          <div className="user-bubble">{item.text}</div>
        </div>
        <div className="dm-avatar"><div className="ag-av user-av">D</div></div>
      </div>
    )
  }

  return (
    <div className="grp-row user-row-right">
      <div className="dm-spacer"><div className="ag-av">&nbsp;</div></div>
      <div className="grp-content user-content-right">
        <div className="user-meta">
          <span className="ag-time">{item.time}</span>
          <span className="ag-name">{item.name || t('chat.you')}</span>
        </div>
        <div className="user-bubble">{item.text}</div>
      </div>
      <div className="dm-avatar"><div className="ag-av user-av">D</div></div>
    </div>
  )
})
