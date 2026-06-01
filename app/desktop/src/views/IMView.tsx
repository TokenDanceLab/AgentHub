import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, MessageCircle, RefreshCw, X } from 'lucide-react';
import type { IMContact, IMMessage } from '@/components/IM/types';
import IMContactList from '@/components/IM/IMContactList';
import IMMessageView from '@/components/IM/IMMessageView';
import IMMessageInput from '@/components/IM/IMMessageInput';
import { useIMChat } from '@/hooks/useIMChat';
import { useHubStore } from '@/stores/hubStore';
import type { FriendRequestInfo, HubClient, HubNotification } from '@/api/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import type { ViewProps } from '@/config/viewRegistry';
import styles from './IMView.module.css';

type ActionState = Record<string, { status: 'pending' | 'error'; error?: string }>;

function contactName(request: FriendRequestInfo): string {
  return request.nickname || request.username || request.user_id;
}

function notificationTitle(notification: HubNotification): string {
  try {
    const parsed = JSON.parse(notification.payload) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record.title === 'string' && record.title) return record.title;
      if (typeof record.body === 'string' && record.body) return record.body;
      if (typeof record.message === 'string' && record.message) return record.message;
    }
  } catch {
    if (notification.payload) return notification.payload;
  }
  return notification.type || notification.id;
}

function actionError(actionState: ActionState, keys: string[]): string | undefined {
  return keys.map((key) => actionState[key]?.error).find(Boolean);
}

function actionPending(actionState: ActionState, keys: string[]): boolean {
  return keys.some((key) => actionState[key]?.status === 'pending');
}

export default function IMView(props: ViewProps) {
  const { t } = useTranslation();
  const label = useCallback(
    (key: string, fallback: string, vars?: Record<string, unknown>) => {
      const translated = t(key, vars);
      return translated === key ? fallback : translated;
    },
    [t],
  );
  const hubWS = (props.hubWS ?? null) as HubWSHandle | null;
  const hubClient = (props.hubClient ?? null) as HubClient | null;
  const {
    getSessionMessages,
    loadSessionMessages,
    contacts,
    hubContacts,
    friendRequests,
    notifications,
    actionState,
    actionCapabilities,
    sendMessage,
    addContact,
    createPrivateSession,
    createGroupSession,
    acceptFriendRequest,
    rejectFriendRequest,
    markNotificationRead,
    readAllNotifications,
    markSessionRead,
    recallMessage,
    refreshSessions,
    status,
    error,
  } = useIMChat({
    hubClient,
    hubWS,
  });
  const userId = useHubStore((s) => s.userId);
  const authenticated = useHubStore((s) => s.authenticated);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const messages = useMemo(
    () => (activeSessionId ? getSessionMessages(activeSessionId) : []),
    [activeSessionId, getSessionMessages],
  );

  const activeContact = contacts.find((c) => c.id === activeSessionId);

  const handleSelectContact = useCallback((contact: IMContact) => {
    setActiveSessionId(contact.id);
    void loadSessionMessages(contact.id);
  }, [loadSessionMessages]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeSessionId) return false;
      const result = await sendMessage(activeSessionId, content);
      return result?.ok !== false;
    },
    [activeSessionId, sendMessage],
  );

  const unreadNotifications = notifications.filter((notification) => !notification.read);
  const unreadSessionCount = contacts.reduce((total, contact) => total + (contact.unreadCount ?? 0), 0);
  const sessionReadError = activeSessionId
    ? actionState[`session:${activeSessionId}:read`]?.error
    : undefined;

  // Not authenticated: show a prompt to connect
  if (!authenticated) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <MessageCircle size={48} className={styles.emptyIcon} aria-hidden="true" />
          <span className={styles.emptyTitle}>IM Chat</span>
          <span>{label('im.state.connectHub', 'Connect to Hub to start chatting')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.contactPanel}>
        <IMContactList
          contacts={contacts}
          hubContacts={hubContacts}
          selectedId={activeSessionId ?? undefined}
          onSelect={handleSelectContact}
          onAddContact={async (userId) => (await addContact(userId)).ok}
          onCreatePrivateSession={async (userId) => (await createPrivateSession(userId)).ok}
          onCreateGroupSession={async (name, memberIds) => (await createGroupSession(name, memberIds)).ok}
        />
      </div>

      <div className={styles.chatArea}>
        <div className={styles.actionPanel} aria-label={label('im.snapshot.title', 'Hub IM snapshot')}>
          <div className={styles.actionPanelHeader}>
            <span className={styles.chatType}>{label('im.snapshot.contactRequests', `${friendRequests.length} contact requests`, { count: friendRequests.length })}</span>
            <span className={styles.chatType}>{label('im.snapshot.notifications', `${unreadNotifications.length} unread notifications`, { count: unreadNotifications.length })}</span>
            <span className={styles.chatType}>{label('im.snapshot.unreadSessions', `${unreadSessionCount} unread sessions`, { count: unreadSessionCount })}</span>
            {!actionCapabilities.friendRequests || !actionCapabilities.notifications ? (
              <span className={styles.interfaceGap}>{label('im.action.interfaceGap', 'Interface gap')}</span>
            ) : null}
            <button
              type="button"
              className={styles.textAction}
              onClick={() => void refreshSessions()}
              disabled={status === 'loading'}
            >
              <RefreshCw size={14} />
              <span>{label('im.snapshot.refresh', 'Refresh')}</span>
            </button>
          </div>

          {friendRequests.length > 0 || notifications.length > 0 ? (
            <div className={styles.actionQueues}>
              {friendRequests.slice(0, 3).map((request) => {
                const pending = actionPending(actionState, [
                  `friend:${request.request_id}:accept`,
                  `friend:${request.request_id}:reject`,
                ]);
                const errorText = actionError(actionState, [
                  `friend:${request.request_id}:accept`,
                  `friend:${request.request_id}:reject`,
                ]);
                return (
                  <div className={styles.queueItem} key={request.request_id}>
                    <div className={styles.queueText}>
                      <strong>{contactName(request)}</strong>
                      <span>{request.message || label('im.request.noMessage', 'No request message')}</span>
                      {errorText ? <em role="alert">{errorText}</em> : null}
                    </div>
                    <div className={styles.queueActions}>
                      <button
                        type="button"
                        className={styles.iconAction}
                        onClick={() => void acceptFriendRequest(request.request_id)}
                        disabled={pending || !actionCapabilities.friendRequests}
                        aria-label={label('im.request.accept', 'Accept request')}
                        title={actionCapabilities.friendRequests ? label('im.request.accept', 'Accept request') : label('im.action.interfaceGap', 'Interface gap')}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconAction}
                        onClick={() => void rejectFriendRequest(request.request_id)}
                        disabled={pending || !actionCapabilities.friendRequests}
                        aria-label={label('im.request.reject', 'Reject request')}
                        title={actionCapabilities.friendRequests ? label('im.request.reject', 'Reject request') : label('im.action.interfaceGap', 'Interface gap')}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {notifications.slice(0, 3).map((notification) => {
                const pending = actionPending(actionState, [`notification:${notification.id}:read`]);
                const errorText = actionState[`notification:${notification.id}:read`]?.error;
                return (
                  <div className={styles.queueItem} key={notification.id}>
                    <div className={styles.queueText}>
                      <strong>{notificationTitle(notification)}</strong>
                      <span>{notification.read ? label('im.notification.read', 'Read') : label('im.notification.unread', 'Unread')}</span>
                      {errorText ? <em role="alert">{errorText}</em> : null}
                    </div>
                    <button
                      type="button"
                      className={styles.iconAction}
                      onClick={() => void markNotificationRead(notification.id)}
                      disabled={notification.read || pending || !actionCapabilities.notifications}
                      aria-label={label('im.notification.markRead', 'Mark notification read')}
                      title={actionCapabilities.notifications ? label('im.notification.markRead', 'Mark notification read') : label('im.action.interfaceGap', 'Interface gap')}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {notifications.length > 0 ? (
            <div className={styles.actionPanelFooter}>
              {actionState['notification:all:read']?.error ? (
                <span className={styles.inlineError} role="alert">{actionState['notification:all:read']?.error}</span>
              ) : null}
              <button
                type="button"
                className={styles.textAction}
                onClick={() => void readAllNotifications()}
                disabled={unreadNotifications.length === 0 || actionPending(actionState, ['notification:all:read']) || !actionCapabilities.notifications}
              >
                <CheckCheck size={14} />
                <span>{label('im.notification.readAll', 'Read all')}</span>
              </button>
            </div>
          ) : null}
        </div>
        {status === 'loading' ? (
          <div className={styles.noSelection}>
            <span>{label('im.state.loadingSessions', 'Loading Hub sessions...')}</span>
          </div>
        ) : status === 'error' ? (
          <div className={styles.noSelection} role="alert">
            <span>{error ? label(error, 'Hub messages are unavailable.') : label('im.state.unavailable', 'Hub messages are unavailable.')}</span>
            <button type="button" className={styles.textAction} onClick={() => void refreshSessions()}>
              <RefreshCw size={14} />
              <span>{label('im.state.retry', 'Retry')}</span>
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <div className={styles.noSelection}>
            <span>{label('im.state.noConversations', 'No Hub conversations yet')}</span>
          </div>
        ) : activeContact ? (
          <>
            <div className={styles.chatHeader}>
              <div className={styles.chatHeading}>
                <span className={styles.chatTitle}>{activeContact.name}</span>
                <span className={styles.chatType}>{activeContact.type}</span>
                {sessionReadError ? <span className={styles.inlineError} role="alert">{sessionReadError}</span> : null}
              </div>
              <button
                type="button"
                className={styles.textAction}
                onClick={() => activeSessionId && void markSessionRead(activeSessionId)}
                disabled={!activeSessionId || messages.length === 0 || !actionCapabilities.sessionRead || actionPending(actionState, [`session:${activeSessionId}:read`])}
                title={actionCapabilities.sessionRead ? label('im.session.markRead', 'Mark session read') : label('im.action.interfaceGap', 'Interface gap')}
              >
                <CheckCheck size={14} />
                <span>{label('im.session.markRead', 'Mark read')}</span>
              </button>
            </div>
            <div className={styles.messageArea}>
              <IMMessageView
                messages={messages}
                currentUserId={userId ?? undefined}
                canRecall={actionCapabilities.recallMessage}
                recallingMessageIds={Object.fromEntries(
                  Object.entries(actionState)
                    .filter(([key, value]) => key.startsWith('message:') && key.endsWith(':recall') && value.status === 'pending')
                    .map(([key]) => [key.split(':')[1], true]),
                )}
                onRecallMessage={(message: IMMessage) => recallMessage(message)}
              />
            </div>
            <div className={styles.inputArea}>
              <IMMessageInput
                onSend={handleSend}
                disabled={!activeSessionId || activeContact.dissolved}
                placeholder={activeContact.dissolved ? label('im.input.sessionDissolved', 'This Hub session is dissolved') : undefined}
              />
            </div>
          </>
        ) : (
          <div className={styles.noSelection}>
            <span>{label('im.state.selectContact', 'Select a contact to start messaging')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
