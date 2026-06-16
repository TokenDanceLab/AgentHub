import type { UserMsg as UserMsgType } from '../data/mock'
import { useI18n } from '../i18n/I18nProvider'

interface Props { item: UserMsgType; chatMode: 'dm' | 'group' }

export default function UserMsg({ item, chatMode }: Props) {
  const { t } = useI18n()

  if (chatMode === 'dm') {
    return (
      <div className="grp-row user-row-right">
        <div className="dm-avatar" style={{ visibility: 'hidden' }}><div className="ag-av">&nbsp;</div></div>
        <div className="grp-content user-content-right">
          <div className="user-bubble">{item.text}</div>
        </div>
        <div className="dm-avatar"><div className="ag-av user-av">D</div></div>
      </div>
    )
  }

  return (
    <div className="grp-row user-row-right">
      <div className="dm-avatar" style={{ visibility: 'hidden' }}><div className="ag-av">&nbsp;</div></div>
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
}
