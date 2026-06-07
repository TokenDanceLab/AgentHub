import React, { useCallback, useState } from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
import styles from './ContactsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ContactsPage — pure presentational workbench page
   ═══════════════════════════════════════════════════════════════════════ */

// ── Data shapes ──

export interface ContactMember {
  id: string;
  name: string;
  initials: string;
  tag?: string;
  org: string;
  status: string;
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
}

// ── Defaults ──

const DEFAULT_SHORTCUTS = [
  'Johnny',
  'Trump',
  'AgentHub 设计评审',
  '文档重构',
];

const DEFAULT_PENDING: ContactMember[] = [
  {
    id: 'nora',
    name: 'Nora Wang',
    initials: 'N',
    tag: '申请加入 TokenDance',
    org: '手机号邀请',
    status: '待确认',
  },
  {
    id: 'leo',
    name: 'Leo Xu',
    initials: 'L',
    tag: '外部联系人请求',
    org: '企业链接',
    status: '待备注',
  },
];

const DEFAULT_EXTERNAL: ContactMember[] = [
  {
    id: 'alex',
    name: 'Alex Chen',
    initials: 'A',
    tag: '外部 PM',
    org: 'VectorControl 合作方',
    status: '待同步项目权限',
  },
  {
    id: 'mira',
    name: 'Mira Lee',
    initials: 'M',
    tag: '设计顾问',
    org: 'UI Review',
    status: '可发起对话',
  },
];

const DEFAULT_SERVICE_DESKS: ServiceDesk[] = [
  {
    id: 'account',
    name: '账号与权限',
    initials: 'S',
    description: 'TokenDance ID / 企业成员 / 外部联系人权限',
  },
  {
    id: 'agent-runtime',
    name: 'Agent 运行支持',
    initials: 'A',
    description: '项目运行卡住、工具权限、模型配置',
  },
  {
    id: 'docs',
    name: '云文档支持',
    initials: 'D',
    description: '文档分享、归档、知识库权限',
  },
];

// ── Design icons ──

function NavGlyph({ name }: { name: DesignNavIconName }) {
  return (
    <span className={styles.navGlyph}>
      <DesignNavIcon name={name} size={17} />
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
  { id: 'new', label: '新的联系人', icon: 'userPlus', badge: 2 },
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
}: {
  member: ContactMember;
  isGroup?: boolean;
  onClick?: ((member: ContactMember) => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(member);
  }, [member, onClick]);

  return (
    <button
      type="button"
      className={styles.memberRow}
      onClick={handleClick}
    >
      <div className={styles.memberAv}>{member.initials}</div>
      <span className={styles.memberName}>{member.name}</span>
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

function GroupRow({
  group,
  onClick,
}: {
  group: ContactGroup;
  onClick?: ((group: ContactGroup) => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(group);
  }, [group, onClick]);

  return (
    <button type="button" className={styles.memberRow} onClick={handleClick}>
      <div className={styles.memberAv}>{group.initials}</div>
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
}: {
  desk: ServiceDesk;
  onClick?: ((desk: ServiceDesk) => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(desk);
  }, [desk, onClick]);

  return (
    <button type="button" className={styles.serviceCard} onClick={handleClick}>
      <div className={styles.memberAv}>{desk.initials}</div>
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
        <select
          className={styles.phoneSelect}
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
        >
          <option>+86</option>
          <option>+852</option>
          <option>+1</option>
        </select>
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
  starredContacts,
  groups,
  serviceDesks,
  recentShortcuts = DEFAULT_SHORTCUTS,
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
}: ContactsPageProps): React.ReactElement {
  const resolvedPending = pendingContacts ?? DEFAULT_PENDING;

  // ── Render main content based on active pane ──

  const renderMain = () => {
    switch (activePane) {
      case 'external':
        return renderListPage({
          title: '外部联系人',
          subtitle: '客户、合作方和临时项目协作者，不进入 TokenDance 组织架构。',
          actionLabel: '添加外部联系人',
          rows: externalContacts ?? DEFAULT_EXTERNAL,
          sectionTitle: '外部联系人',
        });

      case 'new':
        return (
          <main className={styles.main}>
            <div className={styles.head}>
              <div>
                <h1 className={styles.headTitle}>新的联系人</h1>
                <p className={styles.headSubcopy}>
                  处理企业成员申请、外部联系人请求和手机号邀请。
                </p>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onAddContact}
              >
                添加联系人
              </button>
            </div>
            <QuickActionGrid onAddContact={onAddContact} variant="invite" />
            <div className={styles.sectionTitle}>待处理</div>
            <div className={styles.memberList}>
              {resolvedPending.map((m) => (
                <MemberRow key={m.id} member={m} onClick={onMemberClick} />
              ))}
            </div>
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
          <main className={styles.main}>
            <div className={styles.head}>
              <div>
                <h1 className={styles.headTitle}>我的群组</h1>
                <p className={styles.headSubcopy}>
                  项目群、评审群和协作群统一管理，按最新消息排序。
                </p>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onCreateGroup}
              >
                创建群组
              </button>
            </div>
            <div className={styles.sectionTitle}>TokenDance 群组</div>
            <div className={styles.memberList}>
              {(groups ?? []).map((g) => (
                <GroupRow key={g.id} group={g} onClick={onGroupClick} />
              ))}
            </div>
          </main>
        );

      case 'service':
        return (
          <main className={styles.main}>
            <div className={styles.head}>
              <div>
                <h1 className={styles.headTitle}>服务台</h1>
                <p className={styles.headSubcopy}>
                  把账号、Agent 运行和云文档问题转给对应支持入口。
                </p>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onNewTicket}
              >
                新建工单
              </button>
            </div>
            <div className={styles.serviceGrid}>
              {(serviceDesks ?? DEFAULT_SERVICE_DESKS).map((desk) => (
                <ServiceCardRow
                  key={desk.id}
                  desk={desk}
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
      <main className={styles.main}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.headTitle}>{title}</h1>
            <p className={styles.headSubcopy}>{subtitle}</p>
          </div>
          <button
            type="button"
            className={styles.addBtn}
            onClick={onAddContact}
          >
            {actionLabel}
          </button>
        </div>
        {showQuickGrid && <QuickActionGrid onAddContact={onAddContact} />}
        <div className={styles.sectionTitle}>{sectionTitle}</div>
        <div className={styles.memberList}>
          {rows.map((m) => (
            <MemberRow key={m.id} member={m} onClick={onMemberClick} />
          ))}
        </div>
      </main>
    );
  }

  // ── Main render ──

  return (
    <section className={styles.page}>
      {/* ── Left nav ── */}
      <aside className={styles.nav}>
        <div className={styles.navTitle}>通讯录</div>
        <input
          className={styles.search}
          placeholder="搜索联系人、群组或服务台"
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

        {NAV_ITEMS.map((item) => (
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
    </section>
  );
}
