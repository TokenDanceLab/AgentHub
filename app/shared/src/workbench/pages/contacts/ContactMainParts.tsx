import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { StatusNotice } from '../../../ui';
import { DesignNavIcon } from '../../designIcons';
import { ProfilePopover } from '../../floating';
import styles from '../ContactsPage.module.css';
import { QuickActionGrid } from './ContactRows';
import {
  contactProfileActions,
  contactProfileAvatarColor,
  contactProfileVariant,
} from './ContactMainHelpers';
import {
  ContactGroupListSection,
  ContactMainHead,
  ContactMemberListSection,
  ContactNewBodySections,
  ContactServiceGridSection,
} from './ContactMainSections';
import type {
  ContactGroup,
  ContactMember,
  ContactProfile,
  FriendRequestRow,
  HubSearchResultRow,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Contacts main-pane presentational subviews.

   Residual thin from ContactMainViews (Phase 24 #640).
   Residual thin #2 (Phase 27 #672): chrome/helpers in ContactMainSections
   + ContactMainHelpers. CSS remains on shared ContactsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function ContactListPage({
  title,
  subtitle,
  actionLabel,
  rows,
  sectionTitle,
  showQuickGrid = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  activeMemberId,
  onAddContact,
  onMemberClick,
  onAvatarClick,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  rows: ContactMember[];
  sectionTitle: string;
  showQuickGrid?: boolean;
  /** Whether more contacts are available via pagination (pageCursor). */
  hasMore?: boolean;
  /** Whether a load-more page fetch is in flight. */
  loadingMore?: boolean;
  /** Triggered when the scroll sentinel enters the viewport (or fallback button). */
  onLoadMore?: (() => void) | undefined;
  activeMemberId?: string | undefined;
  onAddContact?: (() => void) | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  // ── Infinite-scroll sentinel (T14 pattern; wired to the mock data-layer
  //    cursor pagination, #1510) ──
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    // Environments without IntersectionObserver (jsdom, legacy browsers)
    // fall back to the explicit "加载更多" button below.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current?.();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title={title}
        subtitle={subtitle}
        actionLabel={actionLabel}
        onAction={onAddContact}
      />
      {showQuickGrid && <QuickActionGrid onAddContact={onAddContact} />}
      <div className={styles.sectionTitle}>{sectionTitle}</div>
      <ContactMemberListSection
        rows={rows}
        activeMemberId={activeMemberId}
        onMemberClick={onMemberClick}
        onAvatarClick={onAvatarClick}
      />

      {/* ── Infinite-scroll load-more (mock data-layer cursor pagination,
              #1510; fallback button for environments without
              IntersectionObserver) ── */}
      {hasMore && !loadingMore ? (
        <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore}>
          加载更多
        </button>
      ) : null}
      <div
        ref={sentinelRef}
        className={styles.sentinel}
        role="status"
        aria-label={loadingMore ? '加载中…' : undefined}
      />
      {loadingMore ? (
        <StatusNotice
          icon={<DesignNavIcon name="running" size={14} />}
          role="status"
        >
          加载中…
        </StatusNotice>
      ) : null}
    </main>
  );
}

export function ContactNewPane({
  pendingContacts,
  friendRequests,
  sentRequests,
  searchResult,
  searchLoading,
  actionLoading,
  activeMemberId,
  onAddContact,
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
  onAddContact?: (() => void) | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  onSendFriendRequest?: ((userId: string) => Promise<unknown> | void) | undefined;
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title={t('contacts.new.title', '新的联系人')}
        subtitle={t('contacts.new.subtitle', '搜索用户、发送好友请求、处理收到的请求。')}
        actionLabel={t('contacts.add', '添加联系人')}
        onAction={onAddContact}
      />
      <ContactNewBodySections
        pendingContacts={pendingContacts}
        friendRequests={friendRequests}
        sentRequests={sentRequests}
        searchResult={searchResult}
        searchLoading={searchLoading}
        actionLoading={actionLoading}
        activeMemberId={activeMemberId}
        onMemberClick={onMemberClick}
        onAvatarClick={onAvatarClick}
        onSearchUser={onSearchUser}
        onSendFriendRequest={onSendFriendRequest}
        onAcceptRequest={onAcceptRequest}
        onRejectRequest={onRejectRequest}
      />
    </main>
  );
}

export function ContactGroupsPane({
  groups,
  activeGroupId,
  onCreateGroup,
  onGroupClick,
  onAvatarClick,
}: {
  groups: ContactGroup[];
  activeGroupId?: string | undefined;
  onCreateGroup?: (() => void) | undefined;
  onGroupClick?: ((group: ContactGroup) => void) | undefined;
  onAvatarClick?: ((group: ContactGroup, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title={t("contacts.section.myGroups.title")}
        subtitle={t("contacts.section.myGroups.subtitle")}
        actionLabel="创建群组"
        onAction={onCreateGroup}
      />
      <div className={styles.sectionTitle}>TokenDance 群组</div>
      <ContactGroupListSection
        groups={groups}
        activeGroupId={activeGroupId}
        onGroupClick={onGroupClick}
        onAvatarClick={onAvatarClick}
      />
    </main>
  );
}

export function ContactServicePane({
  serviceDesks,
  activeServiceId,
  onNewTicket,
  onServiceClick,
  onAvatarClick,
}: {
  serviceDesks: ServiceDesk[];
  activeServiceId?: string | undefined;
  onNewTicket?: (() => void) | undefined;
  onServiceClick?: ((desk: ServiceDesk) => void) | undefined;
  onAvatarClick?: ((desk: ServiceDesk, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title={t("contacts.section.helpDesk.title")}
        subtitle={t("contacts.section.helpDesk.subtitle")}
        actionLabel="新建工单"
        onAction={onNewTicket}
      />
      <ContactServiceGridSection
        serviceDesks={serviceDesks}
        activeServiceId={activeServiceId}
        onServiceClick={onServiceClick}
        onAvatarClick={onAvatarClick}
      />
    </main>
  );
}

export function ContactProfilePopover({
  profile,
  onClose,
}: {
  profile: ContactProfile;
  onClose: () => void;
}): React.ReactElement {
  return (
    <ProfilePopover
      actions={contactProfileActions(profile)}
      anchorElement={profile.anchor}
      avatarColor={contactProfileAvatarColor(profile)}
      isOpen
      name={profile.name}
      onClose={onClose}
      {...(profile.badge ? { badge: profile.badge } : {})}
      {...(profile.initials ? { avatar: profile.initials } : {})}
      {...(profile.meta ? { meta: profile.meta } : {})}
      {...(profile.subtitle ? { subtitle: profile.subtitle } : {})}
      variant={contactProfileVariant(profile)}
    />
  );
}
