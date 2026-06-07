import React, { useRef, useState } from 'react';
import { ProfilePopover, Toast } from './floating';
import { DesignNavIcon, type DesignNavIconName } from './designIcons';
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

export interface GlobalRailProps {
  /** Controlled active page. When omitted, the rail manages its own state starting at 'chat'. */
  activePage?: GlobalRailPage;
  /** Called when the user clicks a navigation item. When omitted, internal state is used. */
  onNavigate?: (page: GlobalRailPage) => void;
  onToggleTheme?: () => void;
}

export function GlobalRail({
  activePage: activePageProp,
  onNavigate,
  onToggleTheme,
}: GlobalRailProps): React.ReactElement {
  const [internalPage, setInternalPage] = useState<GlobalRailPage>('chat');
  const avatarRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

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
    showToast(profileActionLabel(action));
  }

  function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setProfileOpen((open) => !open);
  }

  return (
    <nav aria-label="Global rail" className={styles.rail}>
      <div
        aria-label="Delicious233"
        aria-expanded={profileOpen}
        aria-haspopup="dialog"
        className={styles.railAvatar}
        onClick={() => setProfileOpen((open) => !open)}
        onKeyDown={handleAvatarKeyDown}
        ref={avatarRef}
        role="button"
        tabIndex={0}
        title="Delicious233"
      >
        D
      </div>

      {topNavItems.map((item) => (
        <button
          aria-current={activePage === item.id ? 'page' : undefined}
          aria-label={item.label}
          className={styles.railButton}
          key={item.id}
          onClick={() => handleNavigate(item.id)}
          title={item.label}
          type="button"
        >
          <DesignNavIcon name={item.icon} size={18} />
        </button>
      ))}

      <div className={styles.railSpacer} />

      <button
        aria-label="设置"
        className={styles.railButton}
        onClick={() => handleNavigate('settings')}
        title="设置"
        type="button"
      >
        <DesignNavIcon name="railSettings" size={18} />
      </button>
      <button
        aria-label="切换主题"
        className={styles.railButton}
        onClick={onToggleTheme}
        title="切换主题"
        type="button"
      >
        <DesignNavIcon name="sun" size={18} />
      </button>

      <ProfilePopover
        accountMenu={[
          { label: '我的个人名片' },
          { label: '我的二维码与链接' },
          { label: '登录更多账号' },
        ]}
        actions={[
          { label: '编辑资料' },
          { label: '复制链接' },
        ]}
        anchorRef={avatarRef}
        avatar="D"
        avatarColor="var(--primary)"
        badge="当前用户"
        isOpen={profileOpen}
        name="Delicious233"
        onAccountMenu={handleProfileAction}
        onAction={handleProfileAction}
        onClose={() => setProfileOpen(false)}
        onStatusToggle={() => showToast('状态已保持在线')}
        org="TokenDance"
        status="在线"
        variant="account"
      />
      <Toast message={toastMessage} visible={toastVisible} />
    </nav>
  );
}

function profileActionLabel(action: string): string {
  switch (action) {
    case '编辑资料':
      return '已打开资料编辑';
    case '复制链接':
      return '已复制链接';
    case '我的个人名片':
      return '已打开个人名片';
    case '我的二维码与链接':
      return '已打开二维码与链接';
    case '登录更多账号':
      return '已打开账号登录入口';
    case '设置':
      return '已打开设置';
    default:
      return action;
  }
}
