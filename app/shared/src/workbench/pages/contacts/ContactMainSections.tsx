import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { EmptyState } from '../../../ui';
import styles from '../ContactsPage.module.css';
import {
  FriendRequestCard,
  GroupRow,
  MemberRow,
  SearchUserCard,
  ServiceCardRow,
} from './ContactRows';
import {
  contactEmptyStateClassProps,
  searchQueryFromKeyDown,
  shouldShowNewContactsEmpty,
} from './ContactMainHelpers';
import type {
  ContactGroup,
  ContactMember,
  FriendRequestRow,
  HubSearchResultRow,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   ContactMainSections — presentational residual slices from ContactMainParts
   (#672). Shared head / list / request / search chrome. CSS stays on
   ContactsPage.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

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

export function ContactMemberListSection({
  rows,
  activeMemberId,
  onMemberClick,
  onAvatarClick,
}: {
  rows: ContactMember[];
  activeMemberId?: string | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  return (
    <div className={styles.memberList}>
      {rows.map((m) => (
        <MemberRow
          avatarExpanded={activeMemberId === m.id}
          key={m.id}
          member={m}
          onAvatarClick={onAvatarClick}
          onClick={onMemberClick}
        />
      ))}
    </div>
  );
}

export function ContactGroupListSection({
  groups,
  activeGroupId,
  onGroupClick,
  onAvatarClick,
}: {
  groups: ContactGroup[];
  activeGroupId?: string | undefined;
  onGroupClick?: ((group: ContactGroup) => void) | undefined;
  onAvatarClick?: ((group: ContactGroup, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  return (
    <div className={styles.memberList}>
      {groups.map((g) => (
        <GroupRow
          avatarExpanded={activeGroupId === g.id}
          group={g}
          key={g.id}
          onAvatarClick={onAvatarClick}
          onClick={onGroupClick}
        />
      ))}
    </div>
  );
}

export function ContactServiceGridSection({
  serviceDesks,
  activeServiceId,
  onServiceClick,
  onAvatarClick,
}: {
  serviceDesks: ServiceDesk[];
  activeServiceId?: string | undefined;
  onServiceClick?: ((desk: ServiceDesk) => void) | undefined;
  onAvatarClick?: ((desk: ServiceDesk, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  return (
    <div className={styles.serviceGrid}>
      {serviceDesks.map((desk) => (
        <ServiceCardRow
          avatarExpanded={activeServiceId === desk.id}
          key={desk.id}
          desk={desk}
          onAvatarClick={onAvatarClick}
          onClick={onServiceClick}
        />
      ))}
    </div>
  );
}

export function ContactUserSearchSection({
  searchResult,
  searchLoading,
  actionLoading,
  onSearchUser,
  onSendFriendRequest,
}: {
  searchResult?: HubSearchResultRow | null | undefined;
  searchLoading?: boolean | undefined;
  actionLoading: boolean;
  onSearchUser: (query: string) => Promise<unknown> | void;
  onSendFriendRequest?: ((userId: string) => Promise<unknown> | void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <div className={styles.searchSection}>
      <input
        className={styles.userSearchInput}
        placeholder={t('contacts.search.userPlaceholder', '输入用户 ID 或用户名搜索')}
        onKeyDown={(e) => {
          const query = searchQueryFromKeyDown(e);
          if (query) onSearchUser(query);
        }}
      />
      {searchLoading && (
        <span className={styles.searchLoading}>
          {t('contacts.search.loading', '搜索中...')}
        </span>
      )}
      {searchResult && (
        <div className={styles.searchResults}>
          <SearchUserCard
            result={searchResult}
            onSendRequest={onSendFriendRequest}
            loading={actionLoading}
          />
        </div>
      )}
    </div>
  );
}

export function ContactFriendRequestSection({
  title,
  requests,
  direction,
  actionLoading,
  onAcceptRequest,
  onRejectRequest,
}: {
  title: string;
  requests: FriendRequestRow[];
  direction: 'received' | 'sent';
  actionLoading?: boolean | undefined;
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
}): React.ReactElement {
  return (
    <>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.requestList}>
        {requests.map((req) => (
          <FriendRequestCard
            key={req.request_id}
            request={req}
            direction={direction}
            {...(direction === 'received'
              ? {
                  onAccept: onAcceptRequest,
                  onReject: onRejectRequest,
                  loading: actionLoading,
                }
              : {})}
          />
        ))}
      </div>
    </>
  );
}

export function ContactPendingMemberSection({
  title,
  pendingContacts,
  activeMemberId,
  onMemberClick,
  onAvatarClick,
}: {
  title: string;
  pendingContacts: ContactMember[];
  activeMemberId?: string | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  return (
    <>
      <div className={styles.sectionTitle}>{title}</div>
      <ContactMemberListSection
        rows={pendingContacts}
        activeMemberId={activeMemberId}
        onMemberClick={onMemberClick}
        onAvatarClick={onAvatarClick}
      />
    </>
  );
}

export function ContactNewEmptyState(): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <EmptyState
      title={t('contacts.empty', '暂无待处理的好友请求')}
      titleLevel={3}
      {...contactEmptyStateClassProps()}
    />
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
