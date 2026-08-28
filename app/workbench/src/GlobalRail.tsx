import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfilePopover, DemoToast } from './floating';
import { DesignNavIcon, type DesignNavIconName } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { Tooltip } from '@shared/ui/Tooltip';
import type { WorkbenchAttentionCounts } from './workbenchAttentionModel';
import styles from './AgentHubWorkbench.module.css';

/* ═══ Page routing ═══ */

export type GlobalRailPage =
  | 'chat'
  | 'contacts'
  | 'docs'
  | 'agents'
  | 'runs'
  | 'projects'
  | 'devices'
  | 'usage'
  | 'settings';

interface NavItem {
  id: GlobalRailPage;
  label: string;
  icon: DesignNavIconName;
}

const topNavItems: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'contacts', label: 'Contacts', icon: 'railContacts' },
  { id: 'docs', label: 'Docs', icon: 'railDocs' },
  { id: 'agents', label: 'Agent', icon: 'railAgent' },
  { id: 'runs', label: 'Tasks', icon: 'tasks' },
  { id: 'projects', label: 'Projects', icon: 'railProjects' },
  { id: 'devices', label: 'Devices', icon: 'railDevices' },
  { id: 'usage', label: 'Usage', icon: 'railUsage' },
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
  /**
   * Global attention counts (F1/F6). When present and non-zero, the Tasks
   * entry carries a count badge; clicking it navigates to the Tasks queue.
   * Absent when the shell provides no run/approval inventory.
   */
  attention?: WorkbenchAttentionCounts | undefined;
}

export function GlobalRail({
  activePage: activePageProp,
  onNavigate,
  onLogout,
  onToggleTheme,
  userDisplayName,
  userAvatarUrl,
  connectionStatus,
  attention,
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
    agents: t('nav.agents'),
    runs: t('nav.tasks'),
    projects: t('nav.projects'),
    devices: t('nav.devices'),
    usage: t('nav.usage'),
    settings: t('user.settings'),
  };

  // F1 rail badge = the actionable queue: failed runs + pending approvals
  // (ux-benchmark F1: 失败运行数、待审批数). Running runs need no user
  // action; they stay visible on the status-strip chips and sidebar dots.
  const failedRunCount = attention?.failedRunCount ?? 0;
  const awaitingApprovalCount = attention?.awaitingApprovalCount ?? 0;
  const attentionTotal = failedRunCount + awaitingApprovalCount;
  const attentionParts: string[] = [];
  if (failedRunCount > 0) {
    attentionParts.push(t('sharedWorkbench:attention.failedRuns', { count: String(failedRunCount) }));
  }
  if (awaitingApprovalCount > 0) {
    attentionParts.push(t('sharedWorkbench:attention.pendingApprovals', { count: String(awaitingApprovalCount) }));
  }
  let attentionBreakdown = attention && attentionTotal > 0 ? attentionParts.join(' · ') : undefined;
  if (attentionBreakdown && attention?.activeConversationOnly) {
    attentionBreakdown += ` · ${t('sharedWorkbench:attention.scopeActiveConversation')}`;
  }

  // Use controlled props when provided, otherwise fall back to internal state.
  const isControlled = activePageProp !== undefined;
  const activePage = isControlled ? activePageProp : internalPage;

  /* ── Roving tabindex (#8): the rail page buttons form one tab stop;
     ArrowLeft/ArrowRight (and Home/End) move it. Same pattern as
     ContextMenu.tsx: activeIndex state + focus-on-change effect. ── */
  const railRef = useRef<HTMLElement>(null);
  const rovingKeyboardRef = useRef(false);
  const pageIds = useMemo<GlobalRailPage[]>(
    () => [...topNavItems.map((item) => item.id), 'settings'],
    [],
  );
  const [rovingIndex, setRovingIndex] = useState(() =>
    Math.max(0, pageIds.indexOf(activePage)),
  );

  // Keep the single tab stop on the active page when it changes externally.
  useEffect(() => {
    const index = pageIds.indexOf(activePage);
    if (index >= 0) setRovingIndex(index);
  }, [activePage, pageIds]);

  // Move DOM focus only when the index changed via the keyboard (mount and
  // mouse clicks must not steal focus from where the user is).
  useEffect(() => {
    if (!rovingKeyboardRef.current || !railRef.current) return;
    rovingKeyboardRef.current = false;
    const buttons = railRef.current.querySelectorAll<HTMLButtonElement>('[data-rail-page]');
    buttons[rovingIndex]?.focus();
  }, [rovingIndex]);

  function handleRailKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (rovingIndex + 1) % pageIds.length;
        break;
      case 'ArrowLeft':
        next = (rovingIndex - 1 + pageIds.length) % pageIds.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = pageIds.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    rovingKeyboardRef.current = true;
    setRovingIndex(next);
    handleNavigate(pageIds[next]!);
  }

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
    // Logout is the only real account action left in the popover; the
    // decorative edit-profile/card/QR/add-account items were removed
    // together with their fake success toasts (#1818).
    if (action === t('user.logout')) {
      setProfileOpen(false);
      onLogout?.();
      showToast(t('toast.loggedOut'));
    }
  }

  function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setProfileOpen((open) => !open);
  }

  return (
    <nav aria-label={t('aria.globalRail')} className={styles.rail} onKeyDown={handleRailKeyDown} ref={railRef}>
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

      {topNavItems.map((item, index) => {
        const showAttentionBadge = item.id === 'runs' && attentionTotal > 0;
        const baseLabel = navLabelMap[item.id] ?? item.label;
        const itemLabel = showAttentionBadge && attentionBreakdown
          ? `${baseLabel}（${attentionBreakdown}）`
          : baseLabel;
        return (
          <button type="button"
            aria-current={activePage === item.id ? 'page' : undefined}
            aria-label={itemLabel}
            className={styles.railButton}
            data-rail-page={item.id}
            key={item.id}
            onClick={() => handleNavigate(item.id)}
            tabIndex={rovingIndex === index ? 0 : -1}
            title={itemLabel}
          >
            <DesignNavIcon name={item.icon} size={18} />
            {showAttentionBadge && attentionBreakdown && (
              <span
                aria-hidden="true"
                className={styles.railAttentionBadge}
                data-rail-attention
                data-tone={failedRunCount > 0 ? 'danger' : 'warning'}
                title={t('sharedWorkbench:attention.tasksBadgeAria', { detail: attentionBreakdown })}
              >
                {attentionTotal > 99 ? '99+' : attentionTotal}
              </span>
            )}
          </button>
        );
      })}

      <div className={styles.railSpacer} />

      <Tooltip label={t('user.settings')}>
        <button type="button"
          aria-label={t('aria.settings')}
          className={styles.railButton}
          data-rail-page="settings"
          onClick={() => handleNavigate('settings')}
          tabIndex={rovingIndex === pageIds.length - 1 ? 0 : -1}
        >
          <DesignNavIcon name="railSettings" size={18} />
        </button>
      </Tooltip>
      <Tooltip label={t('user.toggleTheme')}>
        <button
          aria-label={t('aria.toggleTheme')}
          className={styles.railButton}
          onClick={onToggleTheme}
          type="button"
        >
          <DesignNavIcon name="sun" size={18} />
        </button>
      </Tooltip>

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
          { label: t('user.logout'), style: 'danger' },
        ]}
        anchorRef={avatarRef}
        avatar={userAvatarUrl ? '' : displayInitial}
        avatarColor="var(--td-plum)"
        {...(userAvatarUrl ? { avatarUrl: userAvatarUrl } : {})}
        badge={t('user.currentBadge')}
        isOpen={profileOpen}
        name={displayName}
        onAccountMenu={handleProfileAction}
        onClose={() => setProfileOpen(false)}
        org="TokenDance"
        status={t('status.online')}
        variant="account"
      />
      <DemoToast message={toastMessage} visible={toastVisible} />
    </nav>
  );
}

export function connectionStatusLabel(status: ConnectionStatusKind, t: (key: string) => string): string {
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
