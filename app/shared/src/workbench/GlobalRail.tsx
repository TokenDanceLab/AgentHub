import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfilePopover, Toast } from './floating';
import { DesignNavIcon, type DesignNavIconName } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';

/* ═══ Page routing ═══ */

export type GlobalRailPage =
  | 'chat'
  | 'contacts'
  | 'docs'
  | 'agents'
  | 'runs'
  | 'projects'
  | 'settings';

interface NavItem {
  id: GlobalRailPage;
  label: string;
  icon: DesignNavIconName;
}

const topNavItems: NavItem[] = [
  { id: 'chat', label: '对话', icon: 'chat' },
  { id: 'contacts', label: '联系人', icon: 'railContacts' },
  { id: 'docs', label: '云文档', icon: 'railDocs' },
  { id: 'agents', label: 'Agent', icon: 'railAgent' },
  { id: 'runs', label: '任务', icon: 'tasks' },
  { id: 'projects', label: '项目', icon: 'railProjects' },
];

export type ConnectionStatusKind = 'connected' | 'connecting' | 'disconnected';

export interface GlobalRailProps {
  /** Controlled active page. When omitted, the rail manages its own state starting at 'chat'. */
  activePage?: GlobalRailPage;
  /** Called when the user clicks a navigation item. When omitted, internal state is used. */
  onNavigate?: (page: GlobalRailPage) => void;
  onLogout?: (() => void) | undefined;
  onToggleTheme?: (() => void) | undefined;
  /** User profile data for the current user. */
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  /** WebSocket connection status shown as a colored dot in the rail footer. */
  connectionStatus?: ConnectionStatusKind | undefined;
}

export function GlobalRail({
  activePage: activePageProp,
  onNavigate,
  onLogout,
  onToggleTheme,
  userDisplayName,
  userAvatarUrl,
  connectionStatus,
}: GlobalRailProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [internalPage, setInternalPage] = useState<GlobalRailPage>('chat');
  const avatarRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const displayName = userDisplayName ?? t('user.fallbackName');
  const displayInitial = displayName.slice(0, 1).toUpperCase();

  const navLabelMap: Record<GlobalRailPage, string> = {
    chat: t('nav.chat'),
    contacts: t('nav.contacts'),
    docs: t('nav.docs'),
    agents: 'Agent',
    runs: t('nav.tasks'),
    projects: t('nav.projects'),
    settings: t('user.settings'),
  };

  // Use controlled props when provided, otherwise fall back to internal state.
  const isControlled = activePageProp !== undefined;
  const activePage = isControlled ? activePageProp : internalPage;

  function handleNavigate(page: GlobalRailPage) {
    if (onNavigate) {
      onNavigate(page);
    } else {
      setInternalPage(page);
    }
  }

  function showToast(message: string): void {
    setToastMessage(message);
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 1700);
  }

  function handleProfileAction(action: string): void {
    if (action === t('user.logout')) {
      setProfileOpen(false);
      onLogout?.();
      showToast(t('toast.loggedOut'));
      return;
    }
    showToast(profileActionLabel(action, t));
  }

  function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setProfileOpen((open) => !open);
  }

  return (
    <nav aria-label="Global rail" className={styles.rail}>
      <div
        aria-label={displayName}
        aria-expanded={profileOpen}
        aria-haspopup="dialog"
        className={styles.railAvatar}
        onClick={() => setProfileOpen((open) => !open)}
        onKeyDown={handleAvatarKeyDown}
        ref={avatarRef}
        role="button"
        tabIndex={0}
        title={displayName}
      >
        {userAvatarUrl ? (
          <img alt="" src={userAvatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        ) : (
          displayInitial
        )}
      </div>

      {topNavItems.map((item) => (
        <button
          aria-current={activePage === item.id ? 'page' : undefined}
          aria-label={navLabelMap[item.id] ?? item.label}
          className={styles.railButton}
          key={item.id}
          onClick={() => handleNavigate(item.id)}
          title={navLabelMap[item.id] ?? item.label}
          type="button"
        >
          <DesignNavIcon name={item.icon} size={18} />
        </button>
      ))}

      <div className={styles.railSpacer} />

      <button
        aria-label={t('aria.settings')}
        className={styles.railButton}
        onClick={() => handleNavigate('settings')}
        title={t('user.settings')}
        type="button"
      >
        <DesignNavIcon name="railSettings" size={18} />
      </button>
      <button
        aria-label={t('aria.toggleTheme')}
        className={styles.railButton}
        onClick={onToggleTheme}
        title={t('user.toggleTheme')}
        type="button"
      >
        <DesignNavIcon name="sun" size={18} />
      </button>

      {connectionStatus && (
        <span
          aria-label={t('connectionDot.label', { status: connectionStatusLabel(connectionStatus, t) })}
          className={styles.connectionDot}
          data-status={connectionStatus}
          title={t('connectionDot.label', { status: connectionStatusLabel(connectionStatus, t) })}
        />
      )}

      <ProfilePopover
        accountMenu={[
          { label: t('user.myCard') },
          { label: t('user.myQr') },
          { label: t('user.loginMore') },
          { divider: true },
          { label: t('user.logout'), style: 'danger' },
        ]}
        actions={[
          { label: t('user.editProfile') },
          { label: t('profile.copyLink') },
        ]}
        anchorRef={avatarRef}
        avatar={userAvatarUrl ? '' : displayInitial}
        avatarColor="var(--primary)"
        {...(userAvatarUrl ? { avatarUrl: userAvatarUrl } : {})}
        badge={t('user.currentBadge')}
        isOpen={profileOpen}
        name={displayName}
        onAccountMenu={handleProfileAction}
        onAction={handleProfileAction}
        onClose={() => setProfileOpen(false)}
        onStatusToggle={() => showToast(t('toast.onlineStatus'))}
        org="TokenDance"
        status={t('status.online')}
        variant="account"
      />
      <Toast message={toastMessage} visible={toastVisible} />
    </nav>
  );
}

function profileActionLabel(action: string, t: (key: string) => string): string {
  switch (action) {
    case '编辑资料':
      return t('toast.editProfile');
    case '复制链接':
      return t('toast.linkCopiedGeneric');
    case '我的个人名片':
      return t('toast.profileCard');
    case '我的二维码与链接':
      return t('toast.qrLink');
    case '登录更多账号':
      return t('toast.accountLogin');
    case '设置':
      return t('toast.settingsOpened');
    default:
      return action;
  }
}

function connectionStatusLabel(status: ConnectionStatusKind, t: (key: string) => string): string {
  switch (status) {
    case 'connected':
      return t('connection.connected');
    case 'connecting':
      return t('connection.connectingBrief');
    case 'disconnected':
      return t('connection.disconnected');
    default:
      return status;
  }
}
