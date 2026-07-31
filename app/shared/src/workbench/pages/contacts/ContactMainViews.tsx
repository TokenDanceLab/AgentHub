import React, { useCallback, useState } from 'react';
import {
  ContactGroupsPane,
  ContactListPage,
  ContactNewPane,
  ContactProfilePopover,
  ContactServicePane,
} from './ContactMainParts';
import type {
  ContactGroup,
  ContactMember,
  ContactProfile,
  ContactsPageProps,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Contacts main pane shell — pane switch + avatar ProfilePopover state.

   Extracted from ContactsPage as Phase 18 strangler slice #574.
   Residual thin (Phase 24 #640): pane bodies live in ContactMainParts.
   CSS remains on shared ContactsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export type ContactMainProps = Pick<
  ContactsPageProps,
  | 'activePane'
  | 'members'
  | 'externalContacts'
  | 'pendingContacts'
  | 'friendRequests'
  | 'sentRequests'
  | 'searchResult'
  | 'searchLoading'
  | 'starredContacts'
  | 'groups'
  | 'serviceDesks'
  | 'hasMore'
  | 'loadingMore'
  | 'onLoadMore'
  | 'onAddContact'
  | 'onCreateGroup'
  | 'onNewTicket'
  | 'onMemberClick'
  | 'onGroupClick'
  | 'onServiceClick'
  | 'onSearchUser'
  | 'onSendFriendRequest'
  | 'onAcceptRequest'
  | 'onRejectRequest'
>;

export function ContactMain({
  activePane,
  members,
  externalContacts,
  pendingContacts,
  friendRequests,
  sentRequests,
  searchResult,
  searchLoading,
  starredContacts,
  groups,
  serviceDesks,
  hasMore,
  loadingMore,
  onLoadMore,
  onAddContact,
  onCreateGroup,
  onNewTicket,
  onMemberClick,
  onGroupClick,
  onServiceClick,
  onSearchUser,
  onSendFriendRequest,
  onAcceptRequest,
  onRejectRequest,
}: ContactMainProps): React.ReactElement {
  const resolvedPending = pendingContacts ?? [];
  const [activeProfile, setActiveProfile] = useState<ContactProfile | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAcceptRequest = useCallback(async (requestId: string) => {
    setActionLoading(true);
    try { await onAcceptRequest?.(requestId); } finally { setActionLoading(false); }
  }, [onAcceptRequest]);

  const handleRejectRequest = useCallback(async (requestId: string) => {
    setActionLoading(true);
    try { await onRejectRequest?.(requestId); } finally { setActionLoading(false); }
  }, [onRejectRequest]);

  const handleSendFriendRequest = useCallback(async (userId: string) => {
    setActionLoading(true);
    try { await onSendFriendRequest?.(userId); } finally { setActionLoading(false); }
  }, [onSendFriendRequest]);

  const openMemberProfile = useCallback((member: ContactMember, anchor: HTMLElement) => {
    setActiveProfile({
      id: member.id,
      kind: 'member',
      name: member.name,
      initials: member.initials,
      subtitle: member.org,
      badge: member.tag || '联系人',
      meta: [
        { label: '组织', value: member.org },
        { label: '状态', value: member.status },
        { label: '身份', value: member.tag || '联系人' },
      ],
      anchor,
    });
  }, []);

  const openGroupProfile = useCallback((group: ContactGroup, anchor: HTMLElement) => {
    setActiveProfile({
      id: group.id,
      kind: 'group',
      name: group.name,
      initials: group.initials,
      subtitle: group.latestMessage,
      badge: group.count,
      meta: [
        { label: '成员', value: group.count },
        { label: '最近消息', value: group.latestMessage },
        { label: '状态', value: '打开群聊' },
      ],
      anchor,
    });
  }, []);

  const openServiceProfile = useCallback((desk: ServiceDesk, anchor: HTMLElement) => {
    setActiveProfile({
      id: desk.id,
      kind: 'service',
      name: desk.name,
      initials: desk.initials,
      subtitle: desk.description,
      badge: '服务台',
      meta: [
        { label: '入口', value: desk.name },
        { label: '范围', value: desk.description },
        { label: '状态', value: '进入' },
      ],
      anchor,
    });
  }, []);

  const activeMemberId =
    activeProfile?.kind === 'member' ? activeProfile.id : undefined;
  const activeGroupId =
    activeProfile?.kind === 'group' ? activeProfile.id : undefined;
  const activeServiceId =
    activeProfile?.kind === 'service' ? activeProfile.id : undefined;

  const renderMain = () => {
    switch (activePane) {
      case 'external':
        return (
          <ContactListPage
            title="外部联系人"
            subtitle="客户、合作方和临时项目协作者，不进入 TokenDance 组织架构。"
            actionLabel="添加外部联系人"
            rows={externalContacts ?? []}
            sectionTitle="外部联系人"
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            activeMemberId={activeMemberId}
            onAddContact={onAddContact}
            onMemberClick={onMemberClick}
            onAvatarClick={openMemberProfile}
          />
        );

      case 'new':
        return (
          <ContactNewPane
            pendingContacts={resolvedPending}
            friendRequests={friendRequests}
            sentRequests={sentRequests}
            searchResult={searchResult}
            searchLoading={searchLoading}
            actionLoading={actionLoading}
            activeMemberId={activeMemberId}
            onAddContact={onAddContact}
            onMemberClick={onMemberClick}
            onAvatarClick={openMemberProfile}
            onSearchUser={onSearchUser}
            onSendFriendRequest={handleSendFriendRequest}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
          />
        );

      case 'starred':
        return (
          <ContactListPage
            title="星标联系人"
            subtitle="常用联系人会固定在这里，便于快速发起对话和项目协作。"
            actionLabel="管理星标"
            rows={starredContacts ?? []}
            sectionTitle="TokenDance"
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            activeMemberId={activeMemberId}
            onAddContact={onAddContact}
            onMemberClick={onMemberClick}
            onAvatarClick={openMemberProfile}
          />
        );

      case 'groups':
        return (
          <ContactGroupsPane
            groups={groups ?? []}
            activeGroupId={activeGroupId}
            onCreateGroup={onCreateGroup}
            onGroupClick={onGroupClick}
            onAvatarClick={openGroupProfile}
          />
        );

      case 'service':
        return (
          <ContactServicePane
            serviceDesks={serviceDesks ?? []}
            activeServiceId={activeServiceId}
            onNewTicket={onNewTicket}
            onServiceClick={onServiceClick}
            onAvatarClick={openServiceProfile}
          />
        );

      case 'internal':
      default:
        return (
          <ContactListPage
            title="组织内联系人"
            subtitle="TokenDance 成员和外部联系人统一从这里添加、确认和发起对话。"
            actionLabel="添加联系人"
            rows={members}
            sectionTitle="TokenDance"
            showQuickGrid
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            activeMemberId={activeMemberId}
            onAddContact={onAddContact}
            onMemberClick={onMemberClick}
            onAvatarClick={openMemberProfile}
          />
        );
    }
  };

  return (
    <>
      {renderMain()}
      {activeProfile && (
        <ContactProfilePopover
          profile={activeProfile}
          onClose={() => setActiveProfile(null)}
        />
      )}
    </>
  );
}
