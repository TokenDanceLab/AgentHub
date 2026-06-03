import { useTranslation } from 'react-i18next';
import { MessageSquareText, UserCircle, Bot, Globe2 } from 'lucide-react';
import type { AgentInfo } from '@shared/types';
import type { Session } from '@/api/hubClient';
import Panel from '../primitives/Panel';
import SettingRow from '../primitives/SettingRow';
import SummaryCard from '../primitives/SummaryCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import Switch from '../primitives/Switch';
import HubSessionRow from '../cards/HubSessionRow';
import { writeStoredValue } from '../utils';
import styles from '../primitives/primitives.module.css';

function sessionIdOf(session: Session) { return session.session_id ?? session.id ?? 'session'; }

interface GroupChatSectionProps {
  hubSessionActive: boolean;
  isLoading: boolean;
  isError: boolean;
  imSessions: Session[];
  imContactsCount: number;
  imSnapshotStatus: string;
  agents: AgentInfo[];
  edgeOnline: boolean;
  groupChatEnabled: boolean;
  setGroupChatEnabled: (value: boolean) => void;
  onOpenAuth: () => void;
}

export default function GroupChatSection({
  hubSessionActive, isLoading, isError, imSessions, imContactsCount, imSnapshotStatus,
  agents, edgeOnline, groupChatEnabled, setGroupChatEnabled, onOpenAuth,
}: GroupChatSectionProps) {
  const { t } = useTranslation();
  const imGroupSessions = imSessions.filter((s) => s.type === 'group');
  const imPrivateSessions = imSessions.filter((s) => s.type !== 'group');

  return (
    <Panel title={t('settings.groupChat')} description={t('settings.groupChatDesc')}>
      {!hubSessionActive ? (
        <AuthGapBlock title={t('settings.hubSignInRequired')} description={t('settings.onlineImSignedOutDesc')} actionLabel={t('settings.signIn')} onAction={onOpenAuth} />
      ) : isError ? (
        <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.onlineImHubErrorDesc')} />
      ) : null}
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<MessageSquareText size={18} />} label={t('settings.groupChatRooms')} value={isLoading ? t('settings.loading') : `${imGroupSessions.length}`} detail={t('settings.groupChatRoomsDesc')} />
        <SummaryCard icon={<UserCircle size={18} />} label={t('settings.onlineImContacts')} value={isLoading ? t('settings.loading') : `${imContactsCount}`} detail={t('settings.onlineImContactsDesc')} />
        <SummaryCard icon={<Bot size={18} />} label={t('settings.groupChatAgents')} value={`${agents.length}`} detail={edgeOnline ? t('settings.groupChatAgentsDesc') : t('settings.edgeOffline')} />
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.onlineImSessions')} value={isLoading ? t('settings.loading') : `${imPrivateSessions.length}/${imSessions.length}`} detail={t('settings.groupChatSessionMixDesc')} />
      </div>
      <SettingRow title={t('settings.enableGroupChat')} description={t('settings.enableGroupChatDesc')} control={<Switch checked={hubSessionActive && groupChatEnabled} onChange={(v) => { setGroupChatEnabled(v); writeStoredValue('groupChat', v); }} disabled={!hubSessionActive} />} />
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <strong>{t('settings.groupChatHubRooms')}</strong>
          <span>{t('settings.groupChatHubRoomsDesc')}</span>
        </div>
        {hubSessionActive && !isError && imGroupSessions.length > 0 ? (
          <div className={styles.taskList}>{imGroupSessions.slice(0, 5).map((session) => <HubSessionRow key={`group-${sessionIdOf(session)}`} session={session} />)}</div>
        ) : hubSessionActive && !isError ? (
          <EmptyBlock title={t('settings.groupChatNoRooms')} description={t('settings.groupChatNoRoomsDesc')} />
        ) : null}
      </div>
      <SettingRow title={t('settings.groupChatModeration')} description={t('settings.groupChatModerationDesc')} value={imSnapshotStatus} />
    </Panel>
  );
}
