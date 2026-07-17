import React, { useCallback, useState } from 'react';
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
  ContactsPageProps,
  ServiceDesk,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Contacts main pane cluster — list / new / groups / service views +
   avatar ProfilePopover state.

   Extracted from ContactsPage as Phase 18 strangler slice #574.
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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

  function renderListPage({
    title,
    subtitle,
    actionLabel,
    rows,
    sectionTitle,
    showQuickGrid = false,
  }: {
    title: string;
    subtitle: string;
    actionLabel: string;
    rows: ContactMember[];
    sectionTitle: string;
    showQuickGrid?: boolean;
  }) {
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
              avatarExpanded={activeProfile?.kind === 'member' && activeProfile.id === m.id}
              key={m.id}
              member={m}
              onAvatarClick={openMemberProfile}
              onClick={onMemberClick}
            />
          ))}
        </div>
      </main>
    );
  }

  const renderMain = () => {
    switch (activePane) {
      case 'external':
        return renderListPage({
          title: '外部联系人',
          subtitle: '客户、合作方和临时项目协作者，不进入 TokenDance 组织架构。',
          actionLabel: '添加外部联系人',
          rows: externalContacts ?? [],
          sectionTitle: '外部联系人',
        });

      case 'new':
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
                      onSendRequest={handleSendFriendRequest}
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
                      onAccept={handleAcceptRequest}
                      onReject={handleRejectRequest}
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
            {resolvedPending.length > 0 && (
              <>
                <div className={styles.sectionTitle}>{t('contacts.pending', '待处理')}</div>
                <div className={styles.memberList}>
                  {resolvedPending.map((m) => (
                    <MemberRow
                      avatarExpanded={activeProfile?.kind === 'member' && activeProfile.id === m.id}
                      key={m.id}
                      member={m}
                      onAvatarClick={openMemberProfile}
                      onClick={onMemberClick}
                    />
                  ))}
                </div>
              </>
            )}

            {(!friendRequests || friendRequests.length === 0) && resolvedPending.length === 0 && (
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

      case 'starred':
        return renderListPage({
          title: '星标联系人',
          subtitle:
            '常用联系人会固定在这里，便于快速发起对话和项目协作。',
          actionLabel: '管理星标',
          rows: starredContacts ?? [],
          sectionTitle: 'TokenDance',
        });

      case 'groups':
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
              {(groups ?? []).map((g) => (
                <GroupRow
                  avatarExpanded={activeProfile?.kind === 'group' && activeProfile.id === g.id}
                  group={g}
                  key={g.id}
                  onAvatarClick={openGroupProfile}
                  onClick={onGroupClick}
                />
              ))}
            </div>
          </main>
        );

      case 'service':
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
              {(serviceDesks ?? []).map((desk) => (
                <ServiceCardRow
                  avatarExpanded={activeProfile?.kind === 'service' && activeProfile.id === desk.id}
                  key={desk.id}
                  desk={desk}
                  onAvatarClick={openServiceProfile}
                  onClick={onServiceClick}
                />
              ))}
            </div>
          </main>
        );

      case 'internal':
      default:
        return renderListPage({
          title: '组织内联系人',
          subtitle:
            'TokenDance 成员和外部联系人统一从这里添加、确认和发起对话。',
          actionLabel: '添加联系人',
          rows: members,
          sectionTitle: 'TokenDance',
          showQuickGrid: true,
        });
    }
  };

  return (
    <>
      {renderMain()}
      {activeProfile && (
        <ProfilePopover
          actions={[
            { label: activeProfile.kind === 'group' ? '进入项目' : '发送消息' },
            { label: activeProfile.kind === 'service' ? '帮助与客服' : '复制链接' },
          ]}
          anchorElement={activeProfile.anchor}
          avatarColor={
            activeProfile.kind === 'group'
              ? 'var(--role-researcher)'
              : activeProfile.kind === 'service'
                ? 'var(--role-deployer)'
                : 'linear-gradient(135deg, var(--primary), var(--success))'
          }
          isOpen
          name={activeProfile.name}
          onClose={() => setActiveProfile(null)}
          {...(activeProfile.badge ? { badge: activeProfile.badge } : {})}
          {...(activeProfile.initials ? { avatar: activeProfile.initials } : {})}
          {...(activeProfile.meta ? { meta: activeProfile.meta } : {})}
          {...(activeProfile.subtitle ? { subtitle: activeProfile.subtitle } : {})}
          variant={activeProfile.kind === 'group' ? 'group' : 'default'}
        />
      )}
    </>
  );
}
