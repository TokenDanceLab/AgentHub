import { useTranslation } from 'react-i18next';
import { MessageSquareText, UserCircle, ShieldCheck, Globe2, RefreshCw } from 'lucide-react';
import type { ContactInfo, FriendRequestInfo, HubNotification, Session } from '@/api/hubClient';
import Panel from '../primitives/Panel';
import SummaryCard from '../primitives/SummaryCard';
import EmptyBlock from '../primitives/EmptyBlock';
import AuthGapBlock from '../primitives/AuthGapBlock';
import CapabilityCard from '../primitives/CapabilityCard';
import HubSessionRow from '../cards/HubSessionRow';
import HubFriendRequestRow from '../cards/HubFriendRequestRow';
import HubNotificationRow from '../cards/HubNotificationRow';
import { statusLabelFromQuery } from '../utils';
import styles from '../primitives/primitives.module.css';

interface OnlineImSectionProps {
  hubSessionActive: boolean;
  imSessions: Session[];
  imContacts: ContactInfo[];
  imFriendRequests: FriendRequestInfo[];
  imNotifications: HubNotification[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
  deviceRegistrationStatus: 'idle' | 'registering' | 'registered' | 'error';
  onOpenAuth: () => void;
}

export default function OnlineImSection({
  hubSessionActive, imSessions, imContacts, imFriendRequests, imNotifications,
  isLoading, isFetching, isError, isSuccess, refetch, deviceRegistrationStatus, onOpenAuth,
}: OnlineImSectionProps) {
  const { t } = useTranslation();

  const imSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive, isLoading, isFetching, isError, isSuccess, t,
  });

  return (
    <Panel title={t('settings.onlineIm')} description={t('settings.onlineImDesc')}>
      {!hubSessionActive ? (
        <AuthGapBlock title={t('settings.hubSignInRequired')} description={t('settings.onlineImSignedOutDesc')} actionLabel={t('settings.signIn')} onAction={onOpenAuth} />
      ) : isError ? (
        <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.onlineImHubErrorDesc')} />
      ) : null}
      <div className={styles.summaryGrid}>
        <SummaryCard icon={<MessageSquareText size={18} />} label={t('settings.onlineImSessions')} value={isLoading ? t('settings.loading') : `${imSessions.length}`} detail={hubSessionActive ? t('settings.onlineImSessionsDesc') : t('settings.onlineImSignedOutDesc')} />
        <SummaryCard icon={<UserCircle size={18} />} label={t('settings.onlineImContacts')} value={isLoading ? t('settings.loading') : `${imContacts.length}`} detail={t('settings.onlineImContactsDesc')} />
        <SummaryCard icon={<ShieldCheck size={18} />} label={t('settings.onlineImFriendRequests')} value={isLoading ? t('settings.loading') : `${imFriendRequests.length}`} detail={t('settings.onlineImFriendRequestsDesc')} />
        <SummaryCard icon={<Globe2 size={18} />} label={t('settings.onlineImNotifications')} value={isLoading ? t('settings.loading') : `${imNotifications.length}`} detail={t('settings.onlineImNotificationsDesc')} />
      </div>
      <div className={styles.taskSection}>
        <div className={styles.taskSectionHeader}>
          <div className={styles.taskSectionTitleRow}>
            <div>
              <strong>{t('settings.onlineImSnapshot')}</strong>
              <span>{t('settings.onlineImSnapshotDesc')}</span>
            </div>
            {hubSessionActive ? (
              <div className={styles.taskSectionActions}>
                <span className={`${styles.statusPill} ${isSuccess ? styles.statusPillOn : ''}`}>{imSnapshotStatus}</span>
                <button type="button" className={styles.secondaryBtn} onClick={() => void refetch()} disabled={isFetching}>
                  <RefreshCw size={15} />
                  {isFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRefreshRuns')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {hubSessionActive && !isError && imSessions.length > 0 ? (
          <div className={styles.taskList}>{imSessions.slice(0, 5).map((session) => <HubSessionRow key={session.session_id ?? session.id ?? 'session'} session={session} />)}</div>
        ) : hubSessionActive && !isError ? (
          <EmptyBlock title={t('settings.onlineImNoSessions')} description={t('settings.onlineImNoSessionsDesc')} />
        ) : null}
      </div>
      {hubSessionActive && !isError ? (
        <div className={styles.taskSection}>
          <div className={styles.taskSectionHeader}>
            <strong>{t('settings.onlineImReadonlySummary')}</strong>
            <span>{t('settings.onlineImReadonlySummaryDesc')}</span>
          </div>
          {imFriendRequests.length > 0 || imNotifications.length > 0 ? (
            <div className={styles.taskList}>
              {imFriendRequests.slice(0, 3).map((request) => <HubFriendRequestRow key={request.request_id} request={request} />)}
              {imNotifications.slice(0, 3).map((notification) => <HubNotificationRow key={notification.id} notification={notification} />)}
            </div>
          ) : (
            <EmptyBlock title={t('settings.onlineImNoReadonlyItems')} description={t('settings.onlineImNoReadonlyItemsDesc')} />
          )}
        </div>
      ) : null}
      <div className={styles.capabilityGrid}>
        <CapabilityCard title={t('settings.onlineImPresence')} description={t('settings.onlineImPresenceDesc')} status={deviceRegistrationStatus === 'error' ? t('settings.status.error') : hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
        <CapabilityCard title={t('settings.onlineImNotificationActions')} description={t('settings.onlineImNotificationActionsDesc')} status={imSnapshotStatus} />
      </div>
    </Panel>
  );
}
