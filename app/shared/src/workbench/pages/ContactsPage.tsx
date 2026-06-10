import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../designIcons';
import { ProfilePopover } from '../floating';
import { Select } from '../../ui';
import styles from './ContactsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ContactsPage — pure presentational workbench page
   ═══════════════════════════════════════════════════════════════════════ */

// ── Capability tag colors (matches AgentsPage convention) ──

const CAPABILITY_TAG_COLORS: readonly string[] = ['tagBlue', 'tagGreen', 'tagOrange', 'tagPurple', 'tagTeal'];

function capabilityColor(index: number): string {
  return CAPABILITY_TAG_COLORS[index % CAPABILITY_TAG_COLORS.length] ?? '';
}

// ── Data shapes ──

export interface FriendRequestRow {
  request_id: string;
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  message: string;
  created_at: string;
}

export interface HubContactRow {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  remark?: string;
  online: boolean;
  type: string;
}

export interface HubSearchResultRow {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  relationship: string;
}

export interface ContactMember {
  id: string;
  name: string;
  initials: string;
  tag?: string;
  org: string;
  status: string;
  capabilities?: string[];
}

export interface ContactGroup {
  id: string;
  name: string;
  initials: string;
  count: string;
  latestMessage: string;
}

export interface ServiceDesk {
  id: string;
  name: string;
  initials: string;
  description: string;
}

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

export type ContactsPane =
  | 'internal'
  | 'external'
  | 'new'
  | 'starred'
  | 'groups'
  | 'service';

export type ContactModalTab = 'qr' | 'link' | 'code' | 'phone';

export interface ContactsPageProps {
  /** Currently active nav pane */
  activePane: ContactsPane;
  /** Called when user clicks a nav item */
  onPaneChange: (pane: ContactsPane) => void;

  /** Search query */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Organization name displayed in the org row */
  orgName: string;
  /** Organization initials for the logo */
  orgInitials: string;

  /** Internal members (used in internal / starred panes) */
  members: ContactMember[];
  /** External contacts (used in external pane) */
  externalContacts?: ContactMember[];
  /** Pending contact requests (used in "new" pane) */
  pendingContacts?: ContactMember[];
  /** Received friend requests from Hub API */
  friendRequests?: FriendRequestRow[];
  /** Sent friend requests from Hub API */
  sentRequests?: FriendRequestRow[];
  /** Hub contacts (from API) */
  hubContacts?: HubContactRow[];
  /** Search result from Hub user search */
  searchResult?: HubSearchResultRow | null;
  /** Whether a search is in progress */
  searchLoading?: boolean;
  /** Starred contacts (used in starred pane) */
  starredContacts?: ContactMember[];
  /** Groups (used in groups pane) */
  groups?: ContactGroup[];
  /** Service desks (used in service pane) */
  serviceDesks?: ServiceDesk[];

  /** Recent contact shortcuts shown in the bottom of the nav */
  recentShortcuts?: string[];

  /** Called when "add contact" / "invite" button is clicked */
  onAddContact?: (() => void) | undefined;
  /** Called when "create group" button is clicked */
  onCreateGroup?: (() => void) | undefined;
  /** Called when "new ticket" button is clicked */
  onNewTicket?: (() => void) | undefined;

  /** Called when a member row is clicked */
  onMemberClick?: ((member: ContactMember) => void) | undefined;
  /** Called when a group row is clicked */
  onGroupClick?: ((group: ContactGroup) => void) | undefined;
  /** Called when a service card is clicked */
  onServiceClick?: ((desk: ServiceDesk) => void) | undefined;

  // ── Modal props ──
  /** Whether the add-contact modal is open */
  modalOpen?: boolean;
  /** Called to close the modal */
  onModalClose?: (() => void) | undefined;
  /** Called when the invite invite link is copied */
  onCopyInvite?: (() => void) | undefined;
  /** Called when phone invite is submitted */
  onSendPhoneInvite?: ((countryCode: string, phone: string, note: string) => void) | undefined;

  // ── Hub mutation callbacks ──

  /** Called when user searches for a Hub user by ID or name */
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  /** Called when user sends a friend request */
  onSendFriendRequest?: ((userId: string, message?: string) => Promise<unknown> | void) | undefined;
  /** Called when user accepts a pending friend request */
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  /** Called when user rejects a pending friend request */
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  /** Called when user removes a contact */
  onRemoveContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  /** Called when user blocks a contact */
  onBlockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  /** Called when user updates a contact remark */
  onUpdateRemark?: ((userId: string, remark: string) => Promise<unknown> | void) | undefined;
}

// ── Design icons ──

function NavGlyph({ name }: { name: DesignNavIconName }) {
  return (
    <span className={styles.navGlyph}>
      <DesignNavIcon
        name={name}
        size={DESIGN_NAV_GLYPH_SIZE}
        strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
      />
    </span>
  );
}

// ── Nav items ──

interface NavItem {
  id: ContactsPane;
  label: string;
  icon: DesignNavIconName;
  /** Optional badge count (for 'new' pane) */
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'internal', label: '组织内联系人', icon: 'users' },
  { id: 'external', label: '外部联系人', icon: 'external' },
  { id: 'new', label: '新的联系人', icon: 'userPlus' },
  { id: 'starred', label: '星标联系人', icon: 'star' },
  { id: 'groups', label: '我的群组', icon: 'groups' },
  { id: 'service', label: '服务台', icon: 'service' },
];

// ── Modal tab items ──

interface ModalTabItem {
  id: ContactModalTab;
  label: string;
}

const MODAL_TABS: ModalTabItem[] = [
  { id: 'qr', label: '企业二维码' },
  { id: 'link', label: '企业链接' },
  { id: 'code', label: '企业邀请码' },
  { id: 'phone', label: '手机号' },
];

// ── Sub-components ──

function MemberRow({
  member,
  isGroup = false,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  member: ContactMember;
  isGroup?: boolean;
  onClick?: ((member: ContactMember) => void) | undefined;
  onAvatarClick?: ((member: ContactMember, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(member);
  }, [member, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(member, event.currentTarget);
  }, [member, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(member, event.currentTarget);
  }, [member, onAvatarClick]);

  return (
    <button
      type="button"
      className={`${styles.memberRow} member-row`}
      data-card-surface
      onClick={handleClick}
    >
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${member.name} 资料`}
        className={styles.memberAv}
        data-profile={member.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {member.initials}
      </div>
      <span className={styles.memberName}>{member.name}</span>
      {member.capabilities && member.capabilities.length > 0 && (
        <span className={styles.capabilityTags}>
          {member.capabilities.slice(0, 3).map((cap, i) => {
            const color = capabilityColor(i);
            return (
              <span
                key={cap}
                className={`${styles.capabilityTag} ${color ? styles[color as keyof typeof styles] : ''}`}
              >
                {cap}
              </span>
            );
          })}
        </span>
      )}
      {member.tag && <span className={styles.memberTag}>{member.tag}</span>}
      <span
        className={`${styles.memberOrg} ${isGroup ? styles.groupMemberOrg : ''}`}
      >
        {member.org}
      </span>
      <span className={styles.memberStatus}>{member.status}</span>
    </button>
  );
}

// ── Friend request card ──

function FriendRequestCard({ request, direction, onAccept, onReject, loading }: {
  request: FriendRequestRow;
  direction: 'received' | 'sent';
  onAccept?: ((requestId: string) => void) | undefined;
  onReject?: ((requestId: string) => void) | undefined;
  loading?: boolean;
}): React.ReactElement {
  const initials = (request.nickname || request.username).slice(0, 2).toUpperCase();
  const displayName = request.nickname || request.username;
  const timeLabel = request.created_at
    ? new Date(request.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : '';
  return (
    <div className={styles.requestCard} data-card-surface>
      <div className={styles.requestAvatar}>{initials}</div>
      <div className={styles.requestInfo}>
        <span className={styles.requestName}>{displayName}</span>
        {request.message && <span className={styles.requestMsg}>{request.message}</span>}
        <span className={styles.requestMeta}>
          {direction === 'received' ? '收到请求' : '已发送'} {timeLabel && `· ${timeLabel}`}
        </span>
      </div>
      {direction === 'received' && (
        <div className={styles.requestActions}>
          <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onAccept?.(request.request_id)}>接受</button>
          <button type="button" className={styles.rejectBtn} disabled={loading} onClick={() => onReject?.(request.request_id)}>拒绝</button>
        </div>
      )}
    </div>
  );
}

// ── Search result card ──

function SearchUserCard({ result, onSendRequest, loading }: {
  result: HubSearchResultRow;
  onSendRequest?: ((userId: string) => void) | undefined;
  loading?: boolean;
}): React.ReactElement {
  const initials = (result.nickname || result.username).slice(0, 2).toUpperCase();
  const displayName = result.nickname || result.username;
  const relationshipLabel = (): string => {
    switch (result.relationship) {
      case 'friend': return '已是好友';
      case 'pending_sent': return '已发送请求';
      case 'pending_received': return '收到对方请求';
      case 'blocked': return '已屏蔽';
      default: return '陌生人';
    }
  };
  return (
    <div className={styles.searchResultCard} data-card-surface>
      <div className={styles.requestAvatar}>{initials}</div>
      <div className={styles.requestInfo}>
        <span className={styles.requestName}>{displayName}</span>
        <span className={styles.requestMeta}>@{result.username} · {relationshipLabel()}</span>
      </div>
      {result.relationship === 'stranger' && (
        <button type="button" className={styles.acceptBtn} disabled={loading} onClick={() => onSendRequest?.(result.user_id)}>添加好友</button>
      )}
    </div>
  );
}

function GroupRow({
  group,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  group: ContactGroup;
  onClick?: ((group: ContactGroup) => void) | undefined;
  onAvatarClick?: ((group: ContactGroup, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(group);
  }, [group, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(group, event.currentTarget);
  }, [group, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(group, event.currentTarget);
  }, [group, onAvatarClick]);

  return (
    <button type="button" className={`${styles.memberRow} member-row`} data-card-surface onClick={handleClick}>
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${group.name} 资料`}
        className={styles.memberAv}
        data-profile={group.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {group.initials}
      </div>
      <span className={styles.memberName}>{group.name}</span>
      <span className={styles.memberTag}>{group.count}</span>
      <span className={`${styles.memberOrg} ${styles.groupMemberOrg}`}>
        {group.latestMessage}
      </span>
      <span className={styles.memberStatus}>打开群聊</span>
    </button>
  );
}

function ServiceCardRow({
  desk,
  onClick,
  onAvatarClick,
  avatarExpanded = false,
}: {
  desk: ServiceDesk;
  onClick?: ((desk: ServiceDesk) => void) | undefined;
  onAvatarClick?: ((desk: ServiceDesk, anchor: HTMLElement) => void) | undefined;
  avatarExpanded?: boolean;
}) {
  const handleClick = useCallback(() => {
    onClick?.(desk);
  }, [desk, onClick]);

  const handleAvatarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(desk, event.currentTarget);
  }, [desk, onAvatarClick]);

  const handleAvatarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(desk, event.currentTarget);
  }, [desk, onAvatarClick]);

  return (
    <button type="button" className={`${styles.serviceCard} service-card`} data-card-surface onClick={handleClick}>
      <div
        aria-expanded={avatarExpanded}
        aria-haspopup="dialog"
        aria-label={`查看 ${desk.name} 资料`}
        className={styles.memberAv}
        data-profile={desk.id}
        onClick={handleAvatarClick}
        onKeyDown={handleAvatarKeyDown}
        role="button"
        tabIndex={0}
      >
        {desk.initials}
      </div>
      <div>
        <strong className={styles.serviceCardName}>{desk.name}</strong>
        <span className={styles.serviceCardDesc}>{desk.description}</span>
      </div>
      <em className={styles.serviceCardAction}>进入</em>
    </button>
  );
}

function QuickActionGrid({
  onAddContact,
  variant = 'directory',
}: {
  onAddContact?: (() => void) | undefined;
  variant?: 'directory' | 'invite';
}) {
  const first =
    variant === 'invite'
      ? { label: '邀请企业成员', desc: '生成二维码、链接、邀请码或手机号邀请。' }
      : { label: '企业成员', desc: '通过二维码、链接或手机号邀请同事加入 TokenDance' };
  const second =
    variant === 'invite'
      ? { label: '添加外部联系人', desc: '适合客户、合作方和临时项目协作者。' }
      : { label: '外部联系人', desc: '添加客户、合作方或临时协作者到通讯录' };

  return (
    <div className={styles.quickGrid}>
      <button type="button" className={styles.quickBtn} onClick={onAddContact}>
        <span className={styles.quickBtnLabel}>{first.label}</span>
        <strong className={styles.quickBtnDesc}>
          {first.desc}
        </strong>
      </button>
      <button type="button" className={styles.quickBtn} onClick={onAddContact}>
        <span className={styles.quickBtnLabel}>{second.label}</span>
        <strong className={styles.quickBtnDesc}>
          {second.desc}
        </strong>
      </button>
    </div>
  );
}

// ── Modal panels ──

function QRPanel() {
  // Generate a pseudo-QR pattern (purely decorative)
  const cells = Array.from({ length: 81 }, (_, i) =>
    (i * 7 + i) % 5 < 2,
  );

  return (
    <div className={styles.qrPanel}>
      <div className={styles.qrCard}>
        <div className={styles.qrGrid} aria-label="企业二维码">
          {cells.map((on, i) => (
            <span
              key={i}
              className={on ? styles.qrCellOn : styles.qrCell}
            />
          ))}
          <b className={styles.qrCenter}>TD</b>
        </div>
      </div>
      <h3 className={styles.qrTitle}>TokenDance 企业二维码</h3>
      <p className={styles.qrCopy}>
        对方扫码后可申请加入企业，管理员确认后出现在组织内联系人。
      </p>
      <span className={styles.qrExpire}>有效期至 2026年7月18日</span>
    </div>
  );
}

function LinkPanel({ onCopy }: { onCopy?: (() => void) | undefined }) {
  return (
    <div className={styles.linkPanel}>
      <label className={styles.linkLabel}>邀请链接</label>
      <div className={styles.linkCopyRow}>
        <input
          className={styles.linkInput}
          readOnly
          value="https://agenthub.tokendance.local/invite/TD-2026"
        />
        <button type="button" className={styles.linkCopyBtn} onClick={onCopy}>
          复制链接
        </button>
      </div>
      <p className={styles.linkHint}>
        适合发给已在 TokenDance 协作空间内的同事。
      </p>
    </div>
  );
}

function CodePanel({ onCopy }: { onCopy?: (() => void) | undefined }) {
  return (
    <div className={styles.codePanel}>
      <span className={styles.codeValue}>TD-86K2-2026</span>
      <p className={styles.linkHint}>
        企业邀请码 24 小时内有效，可通过 IM 或邮件发送。
      </p>
      <button type="button" className={styles.codeBtn} onClick={onCopy}>
        复制邀请码
      </button>
    </div>
  );
}

function PhonePanel({
  onSend,
}: {
  onSend?: ((countryCode: string, phone: string, note: string) => void) | undefined;
}) {
  const [countryCode, setCountryCode] = useState('+86');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const handleSend = useCallback(() => {
    onSend?.(countryCode, phone, note);
  }, [countryCode, phone, note, onSend]);

  return (
    <form
      className={styles.phonePanel}
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
    >
      <label className={styles.phoneLabel}>手机号</label>
      <div className={styles.phoneRow}>
        <Select
          ariaLabel="区号"
          className={styles.phoneSelect ?? ''}
          value={countryCode}
          options={['+86', '+852', '+1'].map((code) => [code, code])}
          onChange={setCountryCode}
        />
        <input
          className={styles.phoneInput}
          placeholder="输入手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <label className={styles.phoneLabel}>备注</label>
      <input
        className={styles.phoneInput}
        placeholder="例如：合作方 PM / 新同事"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="button" className={styles.phoneSendBtn} onClick={handleSend}>
        发送邀请
      </button>
    </form>
  );
}

// ── Add Contact Modal ──

function AddContactModal({
  onClose,
  onCopyInvite,
  onSendPhoneInvite,
}: {
  onClose?: (() => void) | undefined;
  onCopyInvite?: (() => void) | undefined;
  onSendPhoneInvite?: ((countryCode: string, phone: string, note: string) => void) | undefined;
}) {
  const [activeTab, setActiveTab] = useState<ContactModalTab>('qr');

  const renderPanel = () => {
    switch (activeTab) {
      case 'qr':
        return <QRPanel />;
      case 'link':
        return <LinkPanel onCopy={onCopyInvite} />;
      case 'code':
        return <CodePanel onCopy={onCopyInvite} />;
      case 'phone':
        return <PhonePanel onSend={onSendPhoneInvite} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addContactTitle"
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label="关闭"
        >
          <DesignNavIcon name="close" size={18} />
        </button>

        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle} id="addContactTitle">
            添加联系人
          </h2>
          <p className={styles.modalDesc}>
            邀请企业成员加入 TokenDance，或添加外部联系人用于项目协作。
          </p>
        </div>

        <div className={styles.modalTabs} role="tablist">
          {MODAL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`${styles.modalTab} ${
                activeTab === tab.id ? styles.modalTabActive : ''
              }`}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.modalBody}>{renderPanel()}</div>
      </section>
    </div>
  );
}

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
              <div className={styles.emptyState}>{t('contacts.empty', '暂无待处理的好友请求')}</div>
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
