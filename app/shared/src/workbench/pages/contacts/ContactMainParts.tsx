import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
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
  activeMemberId?: string | undefined;
  onAddContact?: (() => void) | undefined;
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
}): React.ReactElement {
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
  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title="我的群组"
        subtitle="项目群、评审群和协作群统一管理，按最新消息排序。"
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
  return (
    <main className={`${styles.main} workbench-main`}>
      <ContactMainHead
        title="服务台"
        subtitle="把账号、Agent 运行和云文档问题转给对应支持入口。"
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
