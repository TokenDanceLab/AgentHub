import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { ProfilePopover } from '../../floating';
import { EmptyState } from '../../../ui';
import styles from '../ContactsPage.module.css';
import {
  FriendRequestCard,
  GroupRow,
  MemberRow,
  QuickActionGrid,
  SearchUserCard,
  ServiceCardRow,
} from './ContactRows';
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
   CSS remains on shared ContactsPage.module.css.
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
      <div className={`${styles.head} workbench-head`}>
        <div>
          <h1 className={styles.headTitle}>{title}</h1>
          <p className={styles.headSubcopy}>{subtitle}</p>
        </div>
        <button
          type="button"
          className={`${styles.addBtn} outline-action`}
          onClick={onAddContact}
        >
          {actionLabel}
        </button>
      </div>
      {showQuickGrid && <QuickActionGrid onAddContact={onAddContact} />}
      <div className={styles.sectionTitle}>{sectionTitle}</div>
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
      <div className={`${styles.head} workbench-head`}>
        <div>
          <h1 className={styles.headTitle}>{t('contacts.new.title', '新的联系人')}</h1>
          <p className={styles.headSubcopy}>
            {t('contacts.new.subtitle', '搜索用户、发送好友请求、处理收到的请求。')}
          </p>
        </div>
        <button
          type="button"
          className={`${styles.addBtn} outline-action`}
          onClick={onAddContact}
        >
          {t('contacts.add', '添加联系人')}
        </button>
      </div>

      {/* Search user */}
      {onSearchUser && (
        <div className={styles.searchSection}>
          <input
            className={styles.userSearchInput}
            placeholder={t('contacts.search.userPlaceholder', '输入用户 ID 或用户名搜索')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = (e.target as HTMLInputElement).value.trim();
                if (value) onSearchUser(value);
              }
            }}
          />
          {searchLoading && <span className={styles.searchLoading}>{t('contacts.search.loading', '搜索中...')}</span>}
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
      )}

      {/* Received friend requests */}
      {friendRequests && friendRequests.length > 0 && (
        <>
          <div className={styles.sectionTitle}>{t('contacts.requests.received', '收到的好友请求')}</div>
          <div className={styles.requestList}>
            {friendRequests.map((req) => (
              <FriendRequestCard
                key={req.request_id}
                request={req}
                direction="received"
                onAccept={onAcceptRequest}
                onReject={onRejectRequest}
                loading={actionLoading}
              />
            ))}
          </div>
        </>
      )}

      {/* Sent friend requests */}
      {sentRequests && sentRequests.length > 0 && (
        <>
          <div className={styles.sectionTitle}>{t('contacts.requests.sent', '已发送的请求')}</div>
          <div className={styles.requestList}>
            {sentRequests.map((req) => (
              <FriendRequestCard
                key={req.request_id}
                request={req}
                direction="sent"
              />
            ))}
          </div>
        </>
      )}

      {/* Legacy pending contacts (mock fallback) */}
      {pendingContacts.length > 0 && (
        <>
          <div className={styles.sectionTitle}>{t('contacts.pending', '待处理')}</div>
          <div className={styles.memberList}>
            {pendingContacts.map((m) => (
              <MemberRow
                avatarExpanded={activeMemberId === m.id}
                key={m.id}
                member={m}
                onAvatarClick={onAvatarClick}
                onClick={onMemberClick}
              />
            ))}
          </div>
        </>
      )}

      {(!friendRequests || friendRequests.length === 0) && pendingContacts.length === 0 && (
        <EmptyState
          title={t('contacts.empty', '暂无待处理的好友请求')}
          titleLevel={3}
          {...(styles['contacts-empty-compact']
            ? { className: styles['contacts-empty-compact'] }
            : {})}
          {...(styles['contacts-empty-compact-content']
            ? { contentClassName: styles['contacts-empty-compact-content'] }
            : {})}
          {...(styles['contacts-empty-compact-title']
            ? { titleClassName: styles['contacts-empty-compact-title'] }
            : {})}
        />
      )}
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
      <div className={`${styles.head} workbench-head`}>
        <div>
          <h1 className={styles.headTitle}>我的群组</h1>
          <p className={styles.headSubcopy}>
            项目群、评审群和协作群统一管理，按最新消息排序。
          </p>
        </div>
        <button
          type="button"
          className={`${styles.addBtn} outline-action`}
          onClick={onCreateGroup}
        >
          创建群组
        </button>
      </div>
      <div className={styles.sectionTitle}>TokenDance 群组</div>
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
      <div className={`${styles.head} workbench-head`}>
        <div>
          <h1 className={styles.headTitle}>服务台</h1>
          <p className={styles.headSubcopy}>
            把账号、Agent 运行和云文档问题转给对应支持入口。
          </p>
        </div>
        <button
          type="button"
          className={`${styles.addBtn} outline-action`}
          onClick={onNewTicket}
        >
          新建工单
        </button>
      </div>
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
      actions={[
        { label: profile.kind === 'group' ? '进入项目' : '发送消息' },
        { label: profile.kind === 'service' ? '帮助与客服' : '复制链接' },
      ]}
      anchorElement={profile.anchor}
      avatarColor={
        profile.kind === 'group'
          ? 'var(--role-researcher)'
          : profile.kind === 'service'
            ? 'var(--role-deployer)'
            : 'linear-gradient(135deg, var(--primary), var(--success))'
      }
      isOpen
      name={profile.name}
      onClose={onClose}
      {...(profile.badge ? { badge: profile.badge } : {})}
      {...(profile.initials ? { avatar: profile.initials } : {})}
      {...(profile.meta ? { meta: profile.meta } : {})}
      {...(profile.subtitle ? { subtitle: profile.subtitle } : {})}
      variant={profile.kind === 'group' ? 'group' : 'default'}
    />
  );
}
