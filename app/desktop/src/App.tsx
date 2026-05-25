import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useId,
  Suspense,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useEdgeStatus } from '@/hooks/useEdgeStatus';
import { useAgentList } from '@/api/agentQueries';
import { startRun, cancelRun, decidePermission as decidePermissionRest } from '@/api/edgeClient';
import { useThreads, useThreadMessages } from '@/api/threadQueries';
import { createThread } from '@/api/edgeClient';
import type { StartRunRequest } from '@shared/types';
import { AppError } from '@shared/errors';
import type { ChatMessage } from '@/components/ChatView.types';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useUIStore } from '@/stores/uiStore';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { useShallow } from 'zustand/shallow';
import { SkeletonLine } from '@/components/Skeleton';
import { useToastStore } from '@/stores/toastStore';
import { useHubStore } from '@/stores/hubStore';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import AuthPage from '@/components/AuthPage';
import { ToastContainer } from '@/components/Toast';
import SettingsPage, { type SectionId as SettingsSectionId } from '@/components/SettingsPage';
import {
  AlertTriangle,
  ClipboardList,
  Circle,
  Copy,
  MessageSquareText,
  LogIn,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Route,
  Search,
  Settings,
  Square,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { getCurrentWindow } from '@tauri-apps/api/window';
import styles from '@/App.module.css';

interface OptimisticRun {
  runId: string;
  status: string;
  outputText: string;
  toolCalls: [];
  changedFiles: [];
}

const LEFT_SIDEBAR_MIN = 248;
const LEFT_SIDEBAR_MAX = 520;
const RIGHT_PANEL_MIN = 272;
const RIGHT_PANEL_MAX = 560;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRunActiveStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['queued', 'running', 'streaming', 'waiting_for_input', 'RUNNING', 'STREAMING', 'WAITING_FOR_INPUT'].includes(status);
}

function getActiveRunConflictId(error: unknown): string | undefined {
  if (!(error instanceof AppError)) return undefined;
  if (error.status !== 409 || error.code !== 'active_run_exists') return undefined;
  const runId = error.details?.runId;
  return typeof runId === 'string' && runId.length > 0 ? runId : undefined;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable]'));
}

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

interface ShellIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  ariaLabel?: string;
  tooltipSide?: TooltipSide;
  children: ReactNode;
}

function ShellIconButton({
  label,
  ariaLabel,
  tooltipSide = 'bottom',
  className,
  children,
  type = 'button',
  ...buttonProps
}: ShellIconButtonProps) {
  const tooltipId = useId();
  return (
    <button
      {...buttonProps}
      type={type}
      className={`${className ?? ''} ${styles.iconTooltipHost}`}
      aria-label={ariaLabel ?? label}
      aria-describedby={tooltipId}
      data-tooltip-side={tooltipSide}
    >
      <span className={styles.iconTooltipGlyph} aria-hidden="true">{children}</span>
      <span id={tooltipId} role="tooltip" className={styles.iconTooltip}>{label}</span>
    </button>
  );
}

export default function App() {
  const { online, health } = useHealth();
  const { messages, isConnected, currentRun, permissionRequests, decidePermission } = useChatMessages(online);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const edgeStatus = useEdgeStatus(online);
  const addToast = useToastStore((s) => s.addToast);
  const { theme, toggleTheme } = useTheme();

  const { data: threadData } = useThreads();
  const threads = threadData?.items ?? [];

  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const showAuthModal = useHubStore((s) => s.showAuthModal);
  const { setOnline, setConnected, wsLatency } = useConnectionStore(
    useShallow((s) => ({ setOnline: s.setOnline, setConnected: s.setConnected, wsLatency: s.wsLatency })),
  );
  const { selectedThreadId, selectedAgentId, selectThread, selectAgentThread } = useThreadStore(
    useShallow((s) => ({ selectedThreadId: s.selectedThreadId, selectedAgentId: s.selectedAgentId, selectThread: s.selectThread, selectAgentThread: s.selectAgentThread })),
  );
  const { data: agentData } = useAgentList(online);
  const agents = agentData?.items ?? [];
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [viewMode, setViewMode] = useState<'agent' | 'im'>('agent');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('general');
  const {
    leftSidebarCollapsed,
    rightPanelOpen,
    leftSidebarWidth,
    rightPanelWidth,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setLeftSidebarWidth,
    setRightPanelWidth,
  } = useUIStore(
    useShallow((s) => ({
      leftSidebarCollapsed: s.leftSidebarCollapsed,
      rightPanelOpen: s.rightPanelOpen,
      leftSidebarWidth: s.sidebarWidth,
      rightPanelWidth: s.rightPanelWidth,
      setLeftSidebarCollapsed: s.setLeftSidebarCollapsed,
      setRightPanelOpen: s.setRightPanelOpen,
      setLeftSidebarWidth: s.setSidebarWidth,
      setRightPanelWidth: s.setRightPanelWidth,
    })),
  );
  const [optimisticRun, setOptimisticRun] = useState<OptimisticRun | null>(null);
  const [runStartPending, setRunStartPending] = useState(false);

  // Mobile/tablet overlays
  const [navPanelOpen, setNavPanelOpen] = useState(false);

  // Sync health → connection store
  const prevOnlineRef = useRef<boolean | null>(null);
  const healthRef = useRef(health);
  healthRef.current = health;
  useEffect(() => {
    if (prevOnlineRef.current === online) return;
    prevOnlineRef.current = online;
    setOnline(online, healthRef.current);
  }, [online, setOnline]);

  // Sync isConnected → connection store
  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  // Toast when new thread appears
  const prevThreadIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!online || threads.length === 0) { prevThreadIdsRef.current = new Set(); return; }
    const currentIds = new Set(threads.map((th) => th.threadId));
    const wasInitial = prevThreadIdsRef.current.size === 0;
    if (!wasInitial) {
      for (const th of threads) {
        if (!prevThreadIdsRef.current.has(th.threadId)) addToast({ type: 'success', message: t('toast.threadCreated') });
      }
    }
    prevThreadIdsRef.current = currentIds;
  }, [threads, online, addToast, t]);

  const selectedThread = threads.find((th) => th.threadId === selectedThreadId);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const displayedRun = currentRun ?? optimisticRun;
  const runIsActive = isRunActiveStatus(displayedRun?.status);
  const composerLocked = runStartPending || runIsActive;
  const allMessages = useMemo(() => {
    const merged = [...userMessages, ...messages];
    if (!displayedRun) return merged;

    const hasVisibleAgentFeedback = messages.some(
      (msg) => msg.role === 'agent' && msg.blocks.some((block) => block.kind !== 'session_init'),
    );
    if (hasVisibleAgentFeedback) return merged;

    const statusKey = `run.status.${displayedRun.status}`;
    const statusLabel = t(statusKey, { defaultValue: displayedRun.status });
    const output = displayedRun.outputText.trim();
    const content = output.length > 0
      ? output
      : runIsActive
        ? t('chat.runStatus.running', {
            status: statusLabel,
            agent: selectedAgent?.name ?? t('chat.runStatus.agentFallback'),
          })
        : t('chat.runStatus.completed', {
            status: statusLabel,
            agent: selectedAgent?.name ?? t('chat.runStatus.agentFallback'),
          });

    return [
      ...merged,
      {
        id: `run-status-${displayedRun.runId}-${displayedRun.status}`,
        role: 'agent' as const,
        timestamp: new Date().toISOString(),
        agentName: selectedAgent?.name,
        blocks: [{ kind: 'text' as const, content }],
      },
    ];
  }, [displayedRun, messages, runIsActive, selectedAgent?.name, t, userMessages]);
  const shellStyle = {
    '--left-sidebar-width': `${leftSidebarWidth}px`,
    '--right-panel-width': `${rightPanelWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (currentRun) setOptimisticRun(null);
  }, [currentRun]);

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string }) => {
    if (runStartPending || runIsActive) {
      addToast({ type: 'info', message: t('error.activeRunExists') });
      return false;
    }
    const tempRunId = `starting-${Date.now()}`;
    const tempUserMessageId = `user-${tempRunId}`;
    setRunStartPending(true);
    setUserMessages((prev) => [
      ...prev,
      {
        id: tempUserMessageId,
        role: 'user',
        timestamp: new Date().toISOString(),
        blocks: [{ kind: 'text', content: prompt }],
      },
    ]);
    try {
      const req: StartRunRequest = {
        prompt,
        ...useModelSettingsStore.getState().resolveRunRequestOptions(opts),
      };
      if (agentId) req.agentId = agentId;
      if (selectedThread) req.threadId = selectedThread.threadId;
      setOptimisticRun({ runId: tempRunId, status: 'queued', outputText: '', toolCalls: [], changedFiles: [] });
      const started = await startRun(req);
      setOptimisticRun({ ...started, outputText: '', toolCalls: [], changedFiles: [] });
      return true;
    } catch (e) {
      setUserMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessageId));
      const activeRunId = getActiveRunConflictId(e);
      if (activeRunId) {
        setOptimisticRun({ runId: activeRunId, status: 'running', outputText: '', toolCalls: [], changedFiles: [] });
        addToast({ type: 'info', message: t('error.activeRunExists') });
        return false;
      }
      setOptimisticRun(null);
      addToast({ type: 'error', message: t('error.startRunFailed') });
      console.error('Failed to start run:', e);
      return false;
    } finally {
      setRunStartPending(false);
    }
  }, [addToast, runIsActive, runStartPending, selectedThread, t]);

  const handleCancel = useCallback(async () => {
    const runId = currentRun?.runId ?? (optimisticRun?.runId.startsWith('starting-') ? undefined : optimisticRun?.runId);
    if (runId) {
      try { await cancelRun(runId); } catch {}
    }
  }, [currentRun?.runId, optimisticRun?.runId]);

  const handleSelectThread = useCallback((id: string) => { selectThread(id); setUserMessages([]); }, [selectThread]);
  const handleSelectAgent = useCallback(async (agentId: string) => {
    const store = useThreadStore.getState();
    const existing = store.agentThreadMap[agentId];
    if (existing) {
      store.selectAgentThread(agentId, existing);
      setUserMessages([]);
      return;
    }
    const agent = agents.find((a) => a.id === agentId);
    try {
      const thread = await createThread(agent?.name ? `${agent.name}` : undefined);
      store.selectAgentThread(agentId, thread.threadId);
      setUserMessages([]);
    } catch {
      // still select the agent visually even if thread creation fails
      store.selectAgentThread(agentId, '');
    }
  }, [agents]);
  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  const handleStartResize = useCallback((side: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const initialLeft = leftSidebarWidth;
    const initialRight = rightPanelWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      if (side === 'left') {
        setLeftSidebarWidth(clamp(initialLeft + moveEvent.clientX - startX, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX));
      } else {
        setRightPanelWidth(clamp(initialRight + startX - moveEvent.clientX, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));
      }
    };

    const handleUp = () => {
      document.body.classList.remove(styles.resizing);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    document.body.classList.add(styles.resizing);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }, [leftSidebarWidth, rightPanelWidth]);

  const handleResizeKeyDown = useCallback((side: 'left' | 'right') => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 16;
    let nextWidth: number | null = null;

    if (side === 'left') {
      if (event.key === 'ArrowLeft') nextWidth = leftSidebarWidth - step;
      if (event.key === 'ArrowRight') nextWidth = leftSidebarWidth + step;
      if (event.key === 'Home') nextWidth = LEFT_SIDEBAR_MIN;
      if (event.key === 'End') nextWidth = LEFT_SIDEBAR_MAX;
      if (nextWidth != null) {
        event.preventDefault();
        setLeftSidebarWidth(clamp(nextWidth, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX));
      }
      return;
    }

    if (event.key === 'ArrowLeft') nextWidth = rightPanelWidth + step;
    if (event.key === 'ArrowRight') nextWidth = rightPanelWidth - step;
    if (event.key === 'Home') nextWidth = RIGHT_PANEL_MIN;
    if (event.key === 'End') nextWidth = RIGHT_PANEL_MAX;
    if (nextWidth != null) {
      event.preventDefault();
      setRightPanelWidth(clamp(nextWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));
    }
  }, [leftSidebarWidth, rightPanelWidth, setLeftSidebarWidth, setRightPanelWidth]);

  const handleDecidePermission = useCallback((requestId: string, decision: 'allow' | 'deny', reason?: string) => {
    decidePermission(requestId, decision, reason);
    if (currentRun?.runId) {
      decidePermissionRest({ runId: currentRun.runId, requestId, decision, reason }).catch(() => {});
    }
  }, [decidePermission, currentRun?.runId]);

  const handleRetry = useCallback((messageId: string) => {
    const msg = allMessages.find((m) => m.id === messageId);
    if (!msg) return;
    const prompt = msg.blocks.find((b) => b.kind === 'text')?.content;
    if (prompt) handleSend(prompt, selectedAgentId);
  }, [allMessages, handleSend, selectedAgentId]);

  const handleDelete = useCallback((messageId: string) => {
    setUserMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const handleShareWorkspace = useCallback(async () => {
    const title = selectedThread?.title ?? selectedAgent?.name ?? 'AgentHub';
    const summary = [
      `AgentHub: ${title}`,
      selectedThread ? `Thread: ${selectedThread.threadId}` : null,
      selectedAgent ? `Agent: ${selectedAgent.name}` : null,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      addToast({ type: 'success', message: t('toast.copied') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, selectedAgent, selectedThread, t]);

  // Global shell shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavPanelOpen(false);
      }
      if (isEditableShortcutTarget(e.target)) return;

      const shellModifier = e.ctrlKey || e.metaKey;
      if (shortcutHelpOpen && !(e.key === '?' && !shellModifier)) return;
      if (e.key === '?' && !shellModifier) {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
      }
      if (shellModifier && e.key.toLowerCase() === 'b' && !workspaceExpanded && !isMobile) {
        e.preventDefault();
        setLeftSidebarCollapsed(!leftSidebarCollapsed);
      }
      if (shellModifier && e.key.toLowerCase() === 'j' && displayedRun && !workspaceExpanded && !isMobile) {
        e.preventDefault();
        setRightPanelOpen(!rightPanelOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    displayedRun,
    isMobile,
    leftSidebarCollapsed,
    rightPanelOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    shortcutHelpOpen,
    workspaceExpanded,
  ]);

  // ── Double-click top bar → toggle maximize/restore
  const handleTopBarDoubleClick = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a')) return;
    try {
      const w = getCurrentWindow();
      (await w.isMaximized()) ? w.unmaximize() : w.maximize();
    } catch {}
  }, []);

  // ── Render ─────────────────────────────────

  return (
    <ErrorBoundary>
    <div className={styles.root}>
      {/* Top status bar — drag region + window controls */}
      <div className={styles.topBar} data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick}>
        <div className={styles.topBarLeft}>
          <span className={styles.statusBadge}>
            <span className={`${styles.statusBadgeDot} ${online ? styles.statusBadgeDotOnline : styles.statusBadgeDotOffline}`} />
            {online ? `Edge ${health?.version ?? 'v1'}` : t('status.offline')}
          </span>
          {wsLatency != null && <span className={styles.topBarDim} style={{ marginLeft: 6 }}>{wsLatency}ms</span>}
          {isConnected ? <Wifi size={12} className={styles.topBarDim} /> : <WifiOff size={12} className={styles.topBarDim} />}
          {edgeStatus.lastError && <AlertTriangle size={13} className={styles.topBarDim} style={{ marginLeft: 4 }} aria-label={edgeStatus.lastError} />}
        </div>
        <div className={styles.topBarRight}>
          {/* Window controls — no drag region so clicks register */}
          <div className={styles.winControls}>
            <ShellIconButton className={styles.winBtn} onClick={() => getCurrentWindow().minimize()} label={t('window.minimize')} tooltipSide="bottom">
              <Minus size={13} />
            </ShellIconButton>
            <ShellIconButton className={styles.winBtn} onClick={async () => {
              const w = getCurrentWindow();
              (await w.isMaximized()) ? w.unmaximize() : w.maximize();
            }} label={t('window.maximize')} tooltipSide="bottom">
              <Square size={11} />
            </ShellIconButton>
            <ShellIconButton className={`${styles.winBtn} ${styles.winBtnClose}`} onClick={() => getCurrentWindow().close()} label={t('window.close')} tooltipSide="bottom">
              <X size={14} />
            </ShellIconButton>
          </div>
        </div>
      </div>

      {edgeStatus.showBanner && (
        <div className={styles.banner} role="alert">
          <AlertTriangle size={15} className={styles.bannerIcon} aria-hidden="true" />
          <span className={styles.bannerMsg}>{edgeStatus.lastError ?? t('banner.disconnected')}</span>
          <span className={styles.bannerActions}>
            <button className={styles.bannerBtn} onClick={edgeStatus.retry} disabled={edgeStatus.retrying}>{edgeStatus.retrying ? '...' : t('banner.retry')}</button>
            <button className={styles.bannerBtn} onClick={edgeStatus.dismissBanner}>{t('banner.dismiss')}</button>
          </span>
        </div>
      )}

      {settingsOpen ? (
        <SettingsPage
          initialSection={settingsInitialSection}
          onBack={() => setSettingsOpen(false)}
          onOpenAuth={() => useHubStore.getState().setShowAuthModal(true)}
        />
      ) : (
      <>

      {/* Mobile toolbar */}
      {isMobile && (
        <div className={styles.mobileToolbar}>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => setNavPanelOpen(true)} label={t('nav.openMenu')} aria-expanded={navPanelOpen}>
            <Menu size={17} />
          </ShellIconButton>
          <span className={styles.mobileToolbarTitle}>{selectedAgent?.name ?? 'AgentHub'}</span>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => openSettings('general')} label={t('nav.settings')}>
            <Settings size={17} />
          </ShellIconButton>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => useHubStore.getState().setShowAuthModal(true)} label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}>
            {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={17} />}
          </ShellIconButton>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={toggleTheme} label={theme === 'dark' ? t('theme.light') : t('theme.dark')} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </ShellIconButton>
        </div>
      )}

      {/* Mobile nav overlay */}
      {isMobile && (
        <>
          <div className={`${styles.overlay} ${navPanelOpen ? styles.overlayActive : ''}`} onClick={() => setNavPanelOpen(false)} />
          <div className={`${styles.overlayPanel} ${styles.overlayPanelLeft} ${navPanelOpen ? styles.overlayPanelLeftActive : ''}`}>
            <div className={styles.mobileNavPanel}>
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarSectionLabel}>{t('agent.title')}</div>
                <div className={styles.sidebarScroll}>
                  <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
                </div>
              </div>
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarSectionLabel}>{t('thread.title')}</div>
                <div className={styles.sidebarScroll}>
                  <Slot name="thread-panel" online={online} selectedId={selectedThreadId ?? undefined} onSelect={handleSelectThread} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className={styles.body} style={shellStyle}>
        {/* Single sidebar — agents + threads grouped */}
        {!isMobile && !workspaceExpanded && leftSidebarCollapsed && (
          <div className={styles.leftRail}>
            <ShellIconButton
              className={styles.railBtn}
              onClick={() => setLeftSidebarCollapsed(false)}
              label={t('nav.expandSidebar')}
              tooltipSide="right"
              aria-expanded="false"
            >
              <PanelLeftOpen size={17} />
            </ShellIconButton>
            <ShellIconButton className={styles.railBtn} onClick={() => openSettings('general')} label={t('nav.settings')} tooltipSide="right">
              <Settings size={17} />
            </ShellIconButton>
            <ShellIconButton
              className={styles.railBtn}
              onClick={() => useHubStore.getState().setShowAuthModal(true)}
              label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
              tooltipSide="right"
              aria-pressed={hubAuthenticated}
            >
              {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={17} />}
            </ShellIconButton>
            <ShellIconButton className={styles.railBtn} onClick={toggleTheme} label={theme === 'dark' ? t('theme.light') : t('theme.dark')} tooltipSide="right" aria-pressed={theme === 'dark'}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </ShellIconButton>
          </div>
        )}

        {!isMobile && !workspaceExpanded && !leftSidebarCollapsed && (
          <>
          <div className={styles.sidebar}>
            {/* Global search */}
            <div className={styles.sidebarSearch}>
              <Search size={14} color="#B0B0B5" />
              <input type="text" placeholder={t('im.contact.search')} />
            </div>

            {/* Agents section */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarSectionLabel}>{t('agent.title')}</div>
              <div className={styles.sidebarScroll}>
                <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
              </div>
            </div>

            {/* Threads section */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarSectionLabel}>{t('thread.title')}</div>
              <div className={styles.sidebarScroll}>
                <Slot name="thread-panel" online={online} selectedId={selectedThreadId ?? undefined} onSelect={handleSelectThread} />
                {threads.length === 0 && (
                  <div className={styles.sidebarEmpty}>{t('thread.emptyHint')}</div>
                )}
              </div>
            </div>

            {/* Sidebar footer */}
            <div className={styles.sidebarFooter}>
              <ShellIconButton
                className={styles.navIconBtn}
                onClick={() => setLeftSidebarCollapsed(true)}
                label={t('nav.collapseSidebar')}
                tooltipSide="top"
                aria-expanded="true"
              >
                <PanelLeftClose size={16} />
              </ShellIconButton>
              <ShellIconButton className={styles.navIconBtn} onClick={() => openSettings('general')} label={t('nav.settings')} tooltipSide="top">
                <Settings size={16} />
              </ShellIconButton>
              <ShellIconButton
                className={styles.navIconBtn}
                onClick={() => useHubStore.getState().setShowAuthModal(true)}
                label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
                tooltipSide="top"
                aria-pressed={hubAuthenticated}
              >
                {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={16} />}
              </ShellIconButton>
              <ShellIconButton className={styles.navIconBtn} onClick={toggleTheme} label={theme === 'dark' ? t('theme.light') : t('theme.dark')} tooltipSide="top" aria-pressed={theme === 'dark'}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </ShellIconButton>
            </div>
          </div>
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizeLeft')}
            aria-valuemin={LEFT_SIDEBAR_MIN}
            aria-valuemax={LEFT_SIDEBAR_MAX}
            aria-valuenow={leftSidebarWidth}
            tabIndex={0}
            onPointerDown={handleStartResize('left')}
            onKeyDown={handleResizeKeyDown('left')}
          />
          </>
        )}

        {/* Main zone */}
        <div className={`${styles.main} ${workspaceExpanded ? styles.mainExpanded : ''}`}>
          <div className={styles.workspace}>
            {/* Workspace header */}
            <div className={styles.workspaceHeader}>
              <div className={`${styles.workspaceHeaderDot} ${online ? styles.workspaceHeaderDotOnline : styles.workspaceHeaderDotOffline}`} />
              <h2>{selectedAgent ? selectedAgent.name : 'AgentHub'}</h2>
              {selectedThread && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted-foreground)' }}>{selectedThread.title}</span>}
              <div className={styles.workspaceHeaderActions}>
                <ShellIconButton
                  className={styles.workspaceHeaderBtn}
                  onClick={handleShareWorkspace}
                  label={t('workspace.share')}
                  tooltipSide="bottom"
                >
                  <Copy size={15} />
                </ShellIconButton>
                <ShellIconButton
                  className={styles.workspaceHeaderBtn}
                  onClick={() => setViewMode((mode) => (mode === 'agent' ? 'im' : 'agent'))}
                  label={viewMode === 'agent' ? t('im.groupChat') : t('nav.agent')}
                  tooltipSide="bottom"
                  aria-pressed={viewMode === 'im'}
                >
                  <MessageSquareText size={15} />
                </ShellIconButton>
                <ShellIconButton
                  className={styles.workspaceHeaderBtn}
                  onClick={() => openSettings('tasks')}
                  label={t('settings.tasks')}
                  tooltipSide="bottom"
                >
                  <ClipboardList size={15} />
                </ShellIconButton>
                <ShellIconButton
                  className={styles.workspaceHeaderBtn}
                  onClick={() => openSettings('agentScheduling')}
                  label={t('settings.agentScheduling')}
                  tooltipSide="bottom"
                >
                  <Route size={15} />
                </ShellIconButton>
                {displayedRun && !rightPanelOpen && (
                  <ShellIconButton
                    className={styles.workspaceHeaderBtn}
                    onClick={() => setRightPanelOpen(true)}
                    label={t('run.open')}
                    tooltipSide="bottom"
                    aria-expanded="false"
                  >
                    <PanelRightOpen size={15} />
                  </ShellIconButton>
                )}
                <ShellIconButton
                  className={styles.workspaceHeaderBtn}
                  onClick={() => setWorkspaceExpanded((v) => !v)}
                  label={workspaceExpanded ? t('workspace.collapse') : t('workspace.expand')}
                  tooltipSide="bottom"
                  aria-pressed={workspaceExpanded}
                >
                  {workspaceExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </ShellIconButton>
              </div>
            </div>

            {/* Chat area */}
            <div className={styles.chatArea}>
              {viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" /></Suspense></ErrorBoundary>
              ) : (
                <Slot name="main-view" messages={messages} allMessages={allMessages} threadsCount={threads.length} isStreaming={composerLocked} isConnected={isConnected} agents={agents} selectedAgentId={selectedAgentId} onSelectAgent={handleSelectAgent} onRetry={handleRetry} onDelete={handleDelete} onSendMessage={handleSend} />
              )}
            </div>

            {/* Input area */}
            {viewMode === 'agent' && (
              <div className={styles.inputArea}>
                <Slot name="prompt-input" agents={agents} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} onSend={handleSend} isStreaming={runIsActive} isStarting={runStartPending} onCancel={handleCancel} disabled={!online} threadId={selectedThreadId ?? undefined} />
              </div>
            )}
          </div>
        </div>

        {!isMobile && !workspaceExpanded && displayedRun && rightPanelOpen && (
          <>
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizeRight')}
            aria-valuemin={RIGHT_PANEL_MIN}
            aria-valuemax={RIGHT_PANEL_MAX}
            aria-valuenow={rightPanelWidth}
            tabIndex={0}
            onPointerDown={handleStartResize('right')}
            onKeyDown={handleResizeKeyDown('right')}
          />
          <div className={styles.rightPanel}>
            <div className={styles.rightPanelHeader}>
              <div className={styles.rightPanelSegmented}>
                <button className={`${styles.rightPanelTab} ${styles.rightPanelTabActive}`} type="button" role="tab" aria-selected="true">{t('run.output')}</button>
                <button className={styles.rightPanelTab} type="button" role="tab" aria-selected="false">{t('run.files')}</button>
              </div>
              <ShellIconButton
                className={styles.rightPanelCollapseBtn}
                onClick={() => setRightPanelOpen(false)}
                label={t('run.close')}
                tooltipSide="left"
                aria-expanded="true"
              >
                <PanelRightClose size={15} />
              </ShellIconButton>
            </div>
            <div className={styles.rightPanelBody}>
              <ErrorBoundary>
                <Suspense fallback={<div style={{ padding: 16, color: 'var(--muted-foreground)' }}><SkeletonLine width="60%" height="1em" /><SkeletonLine width="40%" height="1em" /></div>}>
                  <Slot
                    name="run-detail"
                    run={displayedRun ? { runId: displayedRun.runId, projectId: '', threadId: selectedThread?.threadId ?? '', status: displayedRun.status } : null}
                    outputText={displayedRun?.outputText ?? ''}
                    toolCalls={displayedRun?.toolCalls ?? []}
                    changedFiles={displayedRun?.changedFiles ?? []}
                    onCancel={handleCancel}
                    chatMessages={allMessages}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
          </>
        )}

        {!isMobile && !workspaceExpanded && displayedRun && !rightPanelOpen && (
          <div className={styles.rightRail} aria-label={t('run.collapsedRail')}>
            <ShellIconButton
              className={styles.railBtn}
              onClick={() => setRightPanelOpen(true)}
              label={t('run.open')}
              tooltipSide="left"
              aria-expanded="false"
            >
              <PanelRightOpen size={17} />
            </ShellIconButton>
            <span className={`${styles.railStatusDot} ${runIsActive ? styles.railStatusDotActive : ''}`} />
            <ShellIconButton
              className={styles.railBtn}
              onClick={() => openSettings('tasks')}
              label={t('settings.tasks')}
              tooltipSide="left"
            >
              <ClipboardList size={17} />
            </ShellIconButton>
            <ShellIconButton
              className={styles.railBtn}
              onClick={() => openSettings('agentScheduling')}
              label={t('settings.agentScheduling')}
              tooltipSide="left"
            >
              <Route size={17} />
            </ShellIconButton>
          </div>
        )}
      </div>
      </>
      )}

      {/* Modals */}
      <Suspense fallback={null}>
        <Slot name="search-dialog" messages={allMessages} onSelect={() => {}} />
      </Suspense>
      <Slot name="permission-dialog" requests={permissionRequests} onDecide={handleDecidePermission} />
      <Slot name="shortcut-help" open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      {showAuthModal && (
        <div className={styles.modalOverlay} onClick={() => useHubStore.getState().setShowAuthModal(false)}>
          <div className={styles.authModal} onClick={(e) => e.stopPropagation()}>
            <AuthPage
              onLoginSuccess={() => useHubStore.getState().setShowAuthModal(false)}
              onClose={() => useHubStore.getState().setShowAuthModal(false)}
            />
          </div>
        </div>
      )}
      <ToastContainer />
    </div>
    </ErrorBoundary>
  );
}
