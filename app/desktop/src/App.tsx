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
import { createHubClient } from '@/api/hubClient';
import { startRun, cancelRun, decidePermission as decidePermissionRest } from '@/api/edgeClient';
import { useThreads } from '@/api/threadQueries';
import { createThread } from '@/api/edgeClient';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';
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
import { getBinding } from '@/stores/keybindingStore';
import { matchesBinding } from '@/utils/keybinding';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import AuthPage from '@/components/AuthPage';
import HomeDashboard from '@/components/HomeDashboard';
import { NotificationBell } from '@/components/NotificationBell';
import { ToastContainer } from '@/components/Toast';
import SettingsPage, { type SectionId as SettingsSectionId } from '@/components/SettingsPage';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Circle,
  Copy,
  GitBranch,
  Home,
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
  artifacts?: [];
  previews?: [];
}

const LEFT_SIDEBAR_MIN = 248;
const LEFT_SIDEBAR_MAX = 420;
const RUN_CARD_MIN_WORKSPACE_WIDTH = 1180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRunActiveStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['queued', 'running', 'streaming', 'waiting_for_input', 'waiting_approval', 'RUNNING', 'STREAMING', 'WAITING_FOR_INPUT'].includes(status);
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

function DesktopHubTaskBridge() {
  const { isAuthenticated, token, tryAutoLogin } = useAuth();

  useEffect(() => {
    if (!isAuthenticated && !token) {
      void tryAutoLogin();
    }
  }, [isAuthenticated, token, tryAutoLogin]);

  if (!isAuthenticated || !token) {
    return null;
  }

  return <DesktopHubTaskBridgeActive />;
}

function DesktopHubTaskBridgeActive() {
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const hubRealtime = useHubEventStream(getAccessToken);
  useHubIntegration({ hubWS: hubRealtime.hubWS, hubClient });
  return null;
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
  const threads = useMemo(() => threadData?.items ?? [], [threadData?.items]);

  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const showAuthModal = useHubStore((s) => s.showAuthModal);
  const { setOnline, setConnected, wsLatency } = useConnectionStore(
    useShallow((s) => ({ setOnline: s.setOnline, setConnected: s.setConnected, wsLatency: s.wsLatency })),
  );
  const { selectedThreadId, selectedAgentId, selectThread } = useThreadStore(
    useShallow((s) => ({ selectedThreadId: s.selectedThreadId, selectedAgentId: s.selectedAgentId, selectThread: s.selectThread })),
  );
  const { data: agentData } = useAgentList(online);
  const agents = useMemo(() => agentData?.items ?? [], [agentData?.items]);
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [viewMode, setViewMode] = useState<'agent' | 'im' | 'teamrun'>('agent');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('general');
  const {
    leftSidebarCollapsed,
    rightPanelOpen,
    leftSidebarWidth,
    leftSidebarView,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setLeftSidebarWidth,
    setLeftSidebarView,
  } = useUIStore(
    useShallow((s) => ({
      leftSidebarCollapsed: s.leftSidebarCollapsed,
      rightPanelOpen: s.rightPanelOpen,
      leftSidebarWidth: s.sidebarWidth,
      leftSidebarView: s.leftSidebarView,
      setLeftSidebarCollapsed: s.setLeftSidebarCollapsed,
      setRightPanelOpen: s.setRightPanelOpen,
      setLeftSidebarWidth: s.setSidebarWidth,
      setLeftSidebarView: s.setLeftSidebarView,
    })),
  );
  const [optimisticRun, setOptimisticRun] = useState<OptimisticRun | null>(null);
  const [runStartPending, setRunStartPending] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Mobile/tablet overlays
  const [navPanelOpen, setNavPanelOpen] = useState(false);

  // Sync health → connection store
  const prevOnlineRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevOnlineRef.current === online) return;
    prevOnlineRef.current = online;
    setOnline(online, health);
  }, [health, online, setOnline]);

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
  const runCardConstrained = workspaceWidth > 0 && workspaceWidth < RUN_CARD_MIN_WORKSPACE_WIDTH;
  const effectiveRightPanelOpen = rightPanelOpen && !runCardConstrained;
  const showRunCardSpace = !!displayedRun && effectiveRightPanelOpen && !isMobile && !workspaceExpanded;
  const composerLocked = runStartPending || runIsActive;
  const allMessages = useMemo(() => {
    const merged = [...userMessages, ...messages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
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
  const effectiveLeftSidebarWidth = clamp(leftSidebarWidth, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
  const shellStyle = {
    '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (currentRun) {
      queueMicrotask(() => setOptimisticRun(null));
    }
  }, [currentRun]);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateWidth = () => setWorkspaceWidth(node.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWorkspaceWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string; permissionMode?: string; workDir?: string }) => {
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
      if (opts?.permissionMode) req.permissionMode = opts.permissionMode;
      if (opts?.workDir) req.workDir = opts.workDir;
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
      try {
        await cancelRun(runId);
      } catch (error) {
        console.warn('Failed to cancel run:', error);
      }
    }
  }, [currentRun?.runId, optimisticRun?.runId]);

  const handleSelectThread = useCallback((id: string) => { selectThread(id); setUserMessages([]); setLeftSidebarView('thread'); }, [selectThread, setLeftSidebarView]);
  const handleSelectAgent = useCallback(async (agentId: string) => {
    const store = useThreadStore.getState();
    const existing = store.agentThreadMap[agentId];
    if (existing) {
      store.selectAgentThread(agentId, existing);
      setUserMessages([]);
      setLeftSidebarView('thread');
      return;
    }
    const agent = agents.find((a) => a.id === agentId);
    try {
      const thread = await createThread(agent?.name ? `${agent.name}` : undefined);
      store.selectAgentThread(agentId, thread.threadId);
      setUserMessages([]);
      setLeftSidebarView('thread');
    } catch {
      // still select the agent visually even if thread creation fails
      store.selectAgentThread(agentId, '');
    }
  }, [agents, setLeftSidebarView]);
  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  const openRunWorkbench = useCallback(() => {
    setLeftSidebarView('thread');
    setViewMode('agent');
    if (displayedRun) {
      setRightPanelOpen(true);
      return;
    }
    openSettings('tasks');
  }, [displayedRun, openSettings, setLeftSidebarView, setRightPanelOpen]);

  const openTeamRunConsole = useCallback(() => {
    setLeftSidebarView('thread');
    setViewMode('teamrun');
  }, [setLeftSidebarView]);

  const handleStartResize = useCallback((side: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const initialLeft = leftSidebarWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      if (side === 'left') {
        const nextLeft = clamp(initialLeft + moveEvent.clientX - startX, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
        setLeftSidebarWidth(nextLeft);
      }
    };

    const handleUp = () => {
      document.body.classList.remove(styles.resizing ?? '');
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    document.body.classList.add(styles.resizing ?? '');
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }, [leftSidebarWidth, setLeftSidebarWidth]);

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
        const clamped = clamp(nextWidth, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
        setLeftSidebarWidth(clamped);
      }
      return;
    }
  }, [leftSidebarWidth, setLeftSidebarWidth]);

  const handleDecidePermission = useCallback(async (requestId: string, decision: 'allow' | 'deny', reason?: string) => {
    const request = permissionRequests.find((item) => item.requestId === requestId);
    if (!request?.runId) {
      addToast({ type: 'error', message: t('toast.error') });
      return;
    }
    try {
      await decidePermissionRest({ runId: request.runId, requestId, decision, reason });
      decidePermission(requestId, decision, reason);
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, decidePermission, permissionRequests, t]);

  const handleReviewDecidePermission = useCallback(async (requestId: string, decision: 'allow' | 'deny', reason?: string) => {
    const request = permissionRequests.find((item) => item.requestId === requestId);
    if (!request?.runId) {
      addToast({ type: 'error', message: t('toast.error') });
      throw new Error('permission request missing run');
    }
    try {
      await decidePermissionRest({ runId: request.runId, requestId, decision, reason });
      decidePermission(requestId, decision, reason);
    } catch (error) {
      addToast({ type: 'error', message: t('toast.error') });
      throw error;
    }
  }, [addToast, decidePermission, permissionRequests, t]);

  const handleRetry = useCallback((messageId: string) => {
    const msg = allMessages.find((m) => m.id === messageId);
    if (!msg) return;
    const prompt = msg.blocks.find((b) => b.kind === 'text')?.content;
    if (prompt) handleSend(prompt, selectedAgentId ?? undefined);
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

      if (shortcutHelpOpen && !matchesBinding(e, getBinding('help'))) return;
      if (matchesBinding(e, getBinding('help'))) {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
      }
      if (matchesBinding(e, getBinding('toggleSidebar')) && !workspaceExpanded && !isMobile) {
        e.preventDefault();
        setLeftSidebarCollapsed(!leftSidebarCollapsed);
      }
      if (matchesBinding(e, getBinding('toggleRunPanel')) && displayedRun && !workspaceExpanded && !isMobile) {
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
      if (await w.isMaximized()) {
        void w.unmaximize();
      } else {
        void w.maximize();
      }
    } catch (error) {
      console.warn('Failed to toggle window maximize:', error);
    }
  }, []);

  // ── Render ─────────────────────────────────

  return (
    <ErrorBoundary>
    <div className={styles.root}>
      <DesktopHubTaskBridge />
      {/* Top status bar — drag region + window controls */}
      <div className={styles.topBar} data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick}>
        <div className={styles.topBarLeft}>
          {!isMobile && !workspaceExpanded && (
            <ShellIconButton
              className={styles.topBarSidebarBtn}
              onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
              label={leftSidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              tooltipSide="bottom"
              aria-expanded={!leftSidebarCollapsed}
            >
              {leftSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </ShellIconButton>
          )}
          <div className={styles.topBarNavCluster} aria-hidden="true">
            <span className={styles.topBarNavBtn}><ChevronLeft size={14} /></span>
            <span className={styles.topBarNavBtn}><ChevronRight size={14} /></span>
          </div>
          <nav className={styles.appMenu} aria-label={t('menu.title')}>
            <button type="button">{t('menu.file')}</button>
            <button type="button">{t('menu.edit')}</button>
            <button type="button">{t('menu.view')}</button>
            <button type="button">{t('menu.window')}</button>
            <button type="button">{t('menu.help')}</button>
          </nav>
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
              if (await w.isMaximized()) {
                void w.unmaximize();
              } else {
                void w.maximize();
              }
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
                <div className={styles.sidebarScroll}>
                  <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
                </div>
              </div>
              <div className={styles.sidebarSection}>
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
        {!isMobile && !workspaceExpanded && !leftSidebarCollapsed && (
          <>
          <div className={styles.sidebar}>
            {/* Home nav */}
            <div className={styles.sidebarHomeNav}>
              <ShellIconButton
                className={`${styles.navIconBtn} ${leftSidebarView === 'home' ? styles.navIconBtnActive : ''}`}
                onClick={() => setLeftSidebarView('home')}
                label={t('nav.home')}
                tooltipSide="right"
              >
                <Home size={16} />
              </ShellIconButton>
            </div>

            {/* Global search */}
            <div className={styles.sidebarSearch}>
              <Search size={14} color="#B0B0B5" />
              <input type="text" placeholder={t('im.contact.search')} />
            </div>

            {/* Agents section */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarScroll}>
                <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
              </div>
            </div>

            {/* Threads section */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarScroll}>
                <Slot name="thread-panel" online={online} selectedId={selectedThreadId ?? undefined} onSelect={handleSelectThread} />
              </div>
            </div>

            {/* Sidebar footer */}
            <div className={styles.sidebarFooter}>
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
          <div
            ref={workspaceRef}
            className={`${styles.workspace} ${showRunCardSpace ? styles.workspaceWithRunCard : ''}`}
          >
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
                  onClick={openTeamRunConsole}
                  label={t('teamrun.open')}
                  tooltipSide="bottom"
                  aria-pressed={viewMode === 'teamrun'}
                >
                  <GitBranch size={15} />
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
                <NotificationBell />
                {displayedRun && !effectiveRightPanelOpen && (
                  <ShellIconButton
                    className={styles.workspaceHeaderBtn}
                    onClick={() => setRightPanelOpen(true)}
                    label={t('run.open')}
                    tooltipSide="bottom"
                    aria-expanded={effectiveRightPanelOpen}
                  >
                    <PanelRightOpen size={15} />
                  </ShellIconButton>
                )}
                {displayedRun && effectiveRightPanelOpen && (
                  <ShellIconButton
                    className={styles.workspaceHeaderBtn}
                    onClick={() => setRightPanelOpen(false)}
                    label={t('run.close')}
                    tooltipSide="bottom"
                    aria-expanded={effectiveRightPanelOpen}
                  >
                    <PanelRightClose size={15} />
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
              {leftSidebarView === 'home' ? (
                <HomeDashboard
                  onNewThread={async () => {
                    try {
                      const thread = await createThread();
                      handleSelectThread(thread.threadId);
                    } catch {
                      // continue
                    }
                  }}
                  onSelectThread={handleSelectThread}
                  onQuickStart={async (prompt) => {
                    try {
                      const thread = await createThread();
                      handleSelectThread(thread.threadId);
                      handleSend(prompt);
                    } catch {
                      // continue
                    }
                  }}
                  permissionCount={permissionRequests.length}
                  onOpenTeamRuns={openTeamRunConsole}
                  onOpenRuns={openRunWorkbench}
                  onOpenApprovals={openRunWorkbench}
                  onOpenAuth={() => useHubStore.getState().setShowAuthModal(true)}
                />
              ) : viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" /></Suspense></ErrorBoundary>
              ) : viewMode === 'teamrun' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="teamrun-console" /></Suspense></ErrorBoundary>
              ) : (
                <Slot name="main-view" messages={messages} allMessages={allMessages} threadsCount={threads.length} isStreaming={composerLocked} isConnected={isConnected} agents={agents} selectedAgentId={selectedAgentId} onSelectAgent={handleSelectAgent} onRetry={handleRetry} onDelete={handleDelete} onSendMessage={handleSend} />
              )}
            </div>

            {/* Input area */}
            {leftSidebarView !== 'home' && viewMode === 'agent' && (
              <div className={styles.inputArea}>
                <Slot name="prompt-input" agents={agents} selectedAgentId={selectedAgentId ?? undefined} onSelectAgent={handleSelectAgent} onSend={handleSend} isStreaming={runIsActive} isStarting={runStartPending} onCancel={handleCancel} disabled={!online} threadId={selectedThreadId ?? undefined} />
              </div>
            )}

            {!isMobile && !workspaceExpanded && displayedRun && (
              <div
                className={`${styles.rightPanel} ${effectiveRightPanelOpen ? styles.rightPanelOpen : styles.rightPanelClosing}`}
                role="dialog"
                aria-label={t('run.title')}
                aria-hidden={!effectiveRightPanelOpen}
              >
                <div className={styles.rightPanelBody}>
                  <ErrorBoundary>
                    <Suspense fallback={<div style={{ padding: 16, color: 'var(--muted-foreground)' }}><SkeletonLine width="60%" height="1em" /><SkeletonLine width="40%" height="1em" /></div>}>
                      <Slot
                        name="run-detail"
                        run={displayedRun ? { runId: displayedRun.runId, projectId: '', threadId: selectedThread?.threadId ?? '', status: displayedRun.status } : null}
                        outputText={displayedRun?.outputText ?? ''}
                        toolCalls={displayedRun?.toolCalls ?? []}
                        changedFiles={displayedRun?.changedFiles ?? []}
                        approvals={permissionRequests}
                        artifacts={displayedRun && 'artifacts' in displayedRun ? displayedRun.artifacts : []}
                        previews={displayedRun && 'previews' in displayedRun ? displayedRun.previews : []}
                        onDecideApproval={handleReviewDecidePermission}
                        onCancel={handleCancel}
                        chatMessages={allMessages}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            )}
          </div>
        </div>
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
