import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { EmptyState } from '@shared/ui';
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
  friendRequestCardOptionalProps,
  searchQueryFromKeyDown,
} from './ContactMainHelpers';
import type {
  ContactGroup,
  ContactMember,
  FriendRequestRow,
  HubSearchResultRow,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   ContactMainItemParts — presentational residual slices from
   ContactMainSections (#707). List / search / request / pending / empty
   chrome. CSS stays on ContactsPage.module.css. No intentional UX change.
   exactOptionalPropertyTypes-safe FriendRequestCard props (#672).
   ═══════════════════════════════════════════════════════════════════════ */

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
        {requests.map((req) => {
          if (direction !== 'received') {
            return (
              <FriendRequestCard
                key={req.request_id}
                request={req}
                direction={direction}
              />
            );
          }
          // exactOptionalPropertyTypes: only pass defined optionals; wrap async
          // handlers to void-return to match FriendRequestCard props (#672).
          return (
            <FriendRequestCard
              key={req.request_id}
              request={req}
              direction={direction}
              {...friendRequestCardOptionalProps({
                onAcceptRequest,
                onRejectRequest,
                actionLoading,
              })}
            />
          );
        })}
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
