import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import { ProfilePopover } from '../floating';
import { EmptyState } from '../../ui';
import styles from './ContactsPage.module.css';
import {
  AddContactModal,
  FriendRequestCard,
  GroupRow,
  MemberRow,
  NavGlyph,
  NAV_ITEMS,
  QuickActionGrid,
  SearchUserCard,
  ServiceCardRow,
} from './contacts';
import type {
  ContactGroup,
  ContactMember,
  ContactsPageProps,
  ServiceDesk,
} from './contacts';

/* ═══════════════════════════════════════════════════════════════════════
   ContactsPage — pure presentational workbench page

   Subcomponents / types extracted under ./contacts for Phase 17 #561.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  FriendRequestRow,
  HubContactRow,
  HubSearchResultRow,
  ContactMember,
  ContactGroup,
  ServiceDesk,
  ContactsPane,
  ContactModalTab,
  ContactsPageProps,
} from './contacts';

type ContactProfile =
  | {
      id: string;
      kind: 'member';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    }
  | {
      id: string;
      kind: 'group';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    }
  | {
      id: string;
      kind: 'service';
      name: string;
      initials: string;
      subtitle: string;
      badge: string;
      meta: { label: string; value: string }[];
      anchor: HTMLElement;
    };

// ── Main component ──

export function ContactsPage({
  activePane,
  onPaneChange,
  searchQuery = '',
  onSearchChange,
  orgName,
  orgInitials,
  members,
  externalContacts,
  pendingContacts,
  friendRequests,
  sentRequests,
  hubContacts,
  searchResult,
  searchLoading,
  starredContacts,
  groups,
  serviceDesks,
  recentShortcuts = [],
  onAddContact,
  onCreateGroup,
  onNewTicket,
  onMemberClick,
  onGroupClick,
  onServiceClick,
  modalOpen = false,
  onModalClose,
  onCopyInvite,
  onSendPhoneInvite,
  onSearchUser,
  onSendFriendRequest,
  onAcceptRequest,
  onRejectRequest,
  onRemoveContact,
  onBlockContact,
  onUpdateRemark,
}: ContactsPageProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const resolvedPending = pendingContacts ?? [];
  const requestCount = (friendRequests?.length ?? 0) + (sentRequests?.length ?? 0);
  const navItems = NAV_ITEMS.map((item) =>
    item.id === 'new' && (resolvedPending.length > 0 || requestCount > 0)
      ? { ...item, badge: resolvedPending.length > 0 ? resolvedPending.length : requestCount }
      : item,
  );
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

  // ── Render main content based on active pane ──

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

  // ── Main render ──

  return (
    <section className={`${styles.page} workbench contacts-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav`}>
        <div className={`${styles.navTitle} workbench-title`}>{t('nav.contacts')}</div>
        <input
          className={`${styles.search} workbench-search`}
          placeholder={t('contacts.search.placeholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />

        <div className={styles.orgRow}>
          <div className={styles.orgLogo}>{orgInitials}</div>
          <span className={styles.orgName}>{orgName}</span>
          <button type="button" className={styles.orgAction}>
            管理
          </button>
        </div>

        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navRow} ${
              activePane === item.id ? styles.navRowActive : ''
            }`}
            onClick={() => onPaneChange(item.id)}
          >
            <NavGlyph name={item.icon} />
            {item.label}
            {item.badge != null && (
              <small className={styles.navBadge}>{item.badge}</small>
            )}
          </button>
        ))}

        <div className={styles.navCaption}>最近联系人</div>
        {recentShortcuts.map((name) => (
          <div key={name} className={styles.navShortcut}>
            {name}
          </div>
        ))}
      </aside>

      {/* ── Right main ── */}
      {renderMain()}

      {/* ── Modal ── */}
      {modalOpen && (
        <AddContactModal
          onClose={onModalClose}
          onCopyInvite={onCopyInvite}
          onSendPhoneInvite={onSendPhoneInvite}
        />
      )}
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
    </section>
  );
}
