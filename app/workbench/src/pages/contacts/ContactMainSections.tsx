import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../ContactsPage.module.css';
import { shouldShowNewContactsEmpty } from './ContactMainHelpers';
import {
  ContactFriendRequestSection,
  ContactNewEmptyState,
  ContactPendingMemberSection,
  ContactUserSearchSection,
} from './ContactMainItemParts';
import type {
  ContactMember,
  FriendRequestRow,
  HubSearchResultRow,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   ContactMainSections — thin residual shell after extracting list /
   search / request / pending / empty chrome to ContactMainItemParts and
   FriendRequestCard prop builders to ContactMainHelpers (#707 / #672).
   CSS stays on ContactsPage.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  ContactFriendRequestSection,
  ContactGroupListSection,
  ContactMemberListSection,
  ContactNewEmptyState,
  ContactPendingMemberSection,
  ContactServiceGridSection,
  ContactUserSearchSection,
} from './ContactMainItemParts';

export function ContactMainHead({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <div className={`${styles.head} workbench-head`}>
      <div>
        <h1 className={styles.headTitle}>{title}</h1>
        <p className={styles.headSubcopy}>{subtitle}</p>
      </div>
      <button
        type="button"
        className={`${styles.addBtn} outline-action`}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}

export function ContactNewBodySections({
  pendingContacts,
  friendRequests,
  sentRequests,
  searchResult,
  searchLoading,
  actionLoading,
  activeMemberId,
  onMemberClick,
  onAvatarClick,
  onSearchUser,
  onSendFriendRequest,
  onAcceptRequest,
  onRejectRequest,
}: {
  pendingContacts: ContactMember[];
  friendRequests?: FriendRequestRow[] | undefined;
  sentRequests?: FriendRequestRow[] | undefined;
  searchResult?: HubSearchResultRow | null | undefined;
  searchLoading?: boolean | undefined;
  actionLoading: boolean;
  activeMemberId?: string | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  onSendFriendRequest?: ((userId: string) => Promise<unknown> | void) | undefined;
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <>
      {onSearchUser && (
        <ContactUserSearchSection
          searchResult={searchResult}
          searchLoading={searchLoading}
          actionLoading={actionLoading}
          onSearchUser={onSearchUser}
          onSendFriendRequest={onSendFriendRequest}
        />
      )}

      {friendRequests && friendRequests.length > 0 && (
        <ContactFriendRequestSection
          title={t('contacts.requests.received', '收到的好友请求')}
          requests={friendRequests}
          direction="received"
          actionLoading={actionLoading}
          onAcceptRequest={onAcceptRequest}
          onRejectRequest={onRejectRequest}
        />
      )}

      {sentRequests && sentRequests.length > 0 && (
        <ContactFriendRequestSection
          title={t('contacts.requests.sent', '已发送的请求')}
          requests={sentRequests}
          direction="sent"
        />
      )}

      {pendingContacts.length > 0 && (
        <ContactPendingMemberSection
          title={t('contacts.pending', '待处理')}
          pendingContacts={pendingContacts}
          activeMemberId={activeMemberId}
          onMemberClick={onMemberClick}
          onAvatarClick={onAvatarClick}
        />
      )}

      {shouldShowNewContactsEmpty(friendRequests, pendingContacts) && (
        <ContactNewEmptyState />
      )}
    </>
  );
}
