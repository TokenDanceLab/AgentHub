import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
  lazy,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useHiddenMessages } from '@/hooks/useHiddenMessages';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useThreadCache } from '@/hooks/useThreadCache';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useThreadNavigation } from '@/hooks/useThreadNavigation';
import { useEdgeStatus } from '@/hooks/useEdgeStatus';
import { useAgentList } from '@/api/agentQueries';
import { useHubAgentTeams, type AgentTeamOverview } from '@/api/agentTeamQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useModelsDevDisplayNames } from '@/api/modelsDevCatalog';
import { useSendRun } from '@/hooks/useSendRun';
import {
  createThread,
  decidePermission as decidePermissionRest,
} from '@/api/edgeClient';
import { useThreads, useThreadMessages } from '@/api/threadQueries';
import { useRuns } from '@/api/runQueries';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import { useAuth } from '@/hooks/useAuth';
import useFocusSourceTracking from '@/hooks/useFocusSourceTracking';
import useShellShortcuts from '@/hooks/useShellShortcuts';
import { useDesktopCommands } from '@/hooks/useDesktopCommands';
import type { ThreadInfo } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useUIStore } from '@/stores/uiStore';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import {
  clamp,
  isRunActiveStatus,
  focusComposer,
  setComposerDraft,
  hideMessages,
  isTeamRunActiveStatus,
  isPendingTeamApprovalStatus,
  isTauriRuntime,
} from '@/utils/appUtils';
import { useShallow } from 'zustand/shallow';
import { SkeletonLine } from '@shared/ui';
import { useToastStore } from '@/stores/toastStore';
import { useHubStore } from '@/stores/hubStore';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConnectionStatus from '@/components/ConnectionStatus';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import TopMenuBar from '@/components/TopMenuBar';
import { useTopMenuConfig } from '@/hooks/useTopMenuConfig';
import { ToastContainer } from '@/components/Toast';
import type { SectionId as SettingsSectionId } from '@/components/SettingsPage';

// Lazy-loaded non-critical components
const AuthPage = lazy(() => import('@/components/AuthPage'));
const HomeDashboard = lazy(() => import('@/components/HomeDashboard'));
const SettingsPage = lazy(() => import('@/components/SettingsPage'));
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Circle,
  Copy,
  Home,
  MessageSquareText,
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
  UserCircle,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import {
  applyRuntimeAgentLabel,
  buildChatMessagesFromThreadItems,
  buildDisplayedRunOutputMessage,
  filterOptimisticMessagesForThread,
  mergeChatMessages,
} from '@/utils/chatMessages';
import { resolveThreadSelectionId, type ThreadSelectionInput } from '@/utils/threadSelection';
import { buildTeamLocalExecutions, normalizeTeamTasks } from '@/utils/teamLocalExecution';
import { buildAutomaticThreadTitle } from '@/utils/threadTitle';
import ShellIconButton from '@/components/ShellIconButton';
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
const LEFT_SIDEBAR_MAX = 420;
const RUN_CARD_MIN_WORKSPACE_WIDTH = 760;

function summarizeAgentTeamOverview(overview?: AgentTeamOverview) {
  const runs = overview?.bundles.flatMap((bundle) => bundle.runs) ?? [];
  const activeRuns = runs.filter((run) => isTeamRunActiveStatus(run.status)).length;
  const pendingApprovals = (overview?.state?.approvals ?? []).filter((approval) => (
    isPendingTeamApprovalStatus(approval.status)
  )).length;
  const pendingConflicts = (overview?.state?.conflicts ?? []).filter((conflict) => (
    conflict.status !== 'resolved'
  )).length;
  return {
    activeRuns,
    pendingApprovals,
    pendingConflicts,
    blockingCount: pendingApprovals + pendingConflicts,
  };
}

export default function App() {
  useFocusSourceTracking();

  const { online, health } = useHealth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const edgeStatus = useEdgeStatus(online);
  const addToast = useToastStore((s) => s.addToast);
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const hubAuth = useAuth();

  const { data: threadData } = useThreads();
  const threads = threadData?.items ?? [];
  const {
    addThreadToCache,
    updateThreadInCache,
    setThreadTitleInCache,
    pendingCreatedThreadIdsRef,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,
    silentCreatedThreadToastIdsRef,
  } = useThreadCache();

  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const showAuthModal = useHubStore((s) => s.showAuthModal);
  const executionTargetsQuery = useHubExecutionTargets(true);
  const hubInventoryEnabled = hubAuth.isAuthenticated && Boolean(hubAuth.token);
  const agentTeamsQuery = useHubAgentTeams({
    enabled: hubInventoryEnabled,
    getToken: () => hubAuth.token,
  });
  const { setOnline, setConnected, wsLatency } = useConnectionStore(
    useShallow((s) => ({ setOnline: s.setOnline, setConnected: s.setConnected, wsLatency: s.wsLatency })),
  );
  const { selectedThreadId, selectedAgentId, selectThread, selectAgentThread } = useThreadStore(
    useShallow((s) => ({ selectedThreadId: s.selectedThreadId, selectedAgentId: s.selectedAgentId, selectThread: s.selectThread, selectAgentThread: s.selectAgentThread })),
  );
  const activeThreadId = resolveThreadSelectionId(selectedThreadId as ThreadSelectionInput);
  const { messages, isConnected, currentRun, permissionRequests, decidePermission } = useChatMessages(online, activeThreadId);
  const { data: agentData } = useAgentList(online);
  const agents = agentData?.items ?? [];
  const bridgedTasks = useTaskBridgeStore((s) => s.tasks);
  const modelCatalogQuery = useModelCatalog(online);
  const modelsDevDisplayNamesQuery = useModelsDevDisplayNames(true);
  const agentTeamSummary = useMemo(
    () => summarizeAgentTeamOverview(agentTeamsQuery.data),
    [agentTeamsQuery.data],
  );
  const teamLocalExecutions = useMemo(() => {
    const overview = agentTeamsQuery.data;
    return buildTeamLocalExecutions({
      selectedRunId: overview?.selectedRun?.id,
      bridgeTasks: bridgedTasks,
      tasks: normalizeTeamTasks(overview?.state, overview?.tasks ?? []),
      assignments: overview?.state?.assignments ?? [],
      events: overview?.state?.run_events ?? [],
    });
  }, [agentTeamsQuery.data, bridgedTasks]);
  const teamRunBadgeCount = agentTeamSummary.blockingCount || agentTeamSummary.activeRuns;
  const teamRunButtonLabel = agentTeamSummary.blockingCount > 0
    ? t('workspace.teamRunsWithBlocks', { count: agentTeamSummary.blockingCount })
    : agentTeamSummary.activeRuns > 0
      ? t('workspace.teamRunsActive', { count: agentTeamSummary.activeRuns })
      : t('settings.agentScheduling');
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const { hiddenMessageIds, hideMessage } = useHiddenMessages(activeThreadId);
  const [viewMode, setViewMode] = useState<'agent' | 'im'>('agent');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('general');
  const [pendingComposerDraft, setPendingComposerDraft] = useState('');
  const {
    leftSidebarCollapsed,
    rightPanelOpen,
    leftSidebarWidth,
    leftSidebarView,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setLeftSidebarView,
  } = useUIStore(
    useShallow((s) => ({
      leftSidebarCollapsed: s.leftSidebarCollapsed,
      rightPanelOpen: s.rightPanelOpen,
      leftSidebarWidth: s.sidebarWidth,
      leftSidebarView: s.leftSidebarView,
      setLeftSidebarCollapsed: s.setLeftSidebarCollapsed,
      setRightPanelOpen: s.setRightPanelOpen,
      setLeftSidebarView: s.setLeftSidebarView,
    })),
  );
  const { handleStartResize, handleResizeKeyDown } = useSidebarResize();
  const [optimisticRun, setOptimisticRun] = useState<OptimisticRun | null>(null);
  const [runStartPending, setRunStartPending] = useState(false);
  const [rightPanelMounted, setRightPanelMounted] = useState(rightPanelOpen);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

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
        if (!prevThreadIdsRef.current.has(th.threadId)) {
          if (silentCreatedThreadToastIdsRef.current.delete(th.threadId)) continue;
          addToast({ type: 'success', message: t('toast.threadCreated') });
        }
      }
    }
    prevThreadIdsRef.current = currentIds;
  }, [threads, online, addToast, t]);

  useEffect(() => {
    if (!threadData?.items) return;
    const liveThreadIds = new Set(threads.map((thread) => thread.threadId));
    const knownThreadIds = new Set(liveThreadIds);
    for (const threadId of pendingCreatedThreadIdsRef.current) {
      knownThreadIds.add(threadId);
      if (liveThreadIds.has(threadId)) pendingCreatedThreadIdsRef.current.delete(threadId);
    }
    useThreadStore.getState().pruneMissingThreads([...knownThreadIds]);
  }, [threadData?.items, threads]);

  const selectedThread = threads.find((th) => th.threadId === activeThreadId);
  const { data: threadItemData } = useThreadMessages(activeThreadId);
  const { data: allRunsData } = useRuns(undefined, undefined, { enabled: online });
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const displayedRun = currentRun ?? optimisticRun;
  const runIsActive = isRunActiveStatus(displayedRun?.status);
  const runCardConstrained = workspaceWidth > 0 && workspaceWidth < RUN_CARD_MIN_WORKSPACE_WIDTH;
  const effectiveRightPanelOpen = rightPanelOpen && !runCardConstrained;
  const showRunCardSpace = !!displayedRun && effectiveRightPanelOpen && !isMobile && !workspaceExpanded;
  const composerLocked = runStartPending || runIsActive;
  const persistedMessages = useMemo(
    () => buildChatMessagesFromThreadItems(threadItemData?.items ?? []),
    [threadItemData?.items],
  );
  const allMessages = useMemo(() => {
    const merged = mergeChatMessages({
      persisted: persistedMessages,
      optimistic: filterOptimisticMessagesForThread(userMessages, activeThreadId),
      live: messages,
    });
    const labeled = applyRuntimeAgentLabel(merged, selectedAgent?.name);
    if (!displayedRun) return hideMessages(labeled, hiddenMessageIds);

    const hasVisibleAgentFeedback = messages.some(
      (msg) => msg.role === 'agent' && msg.blocks.some((block) => block.kind !== 'session_init'),
    );
    if (hasVisibleAgentFeedback) return hideMessages(labeled, hiddenMessageIds);

    const runOutputMessage = buildDisplayedRunOutputMessage(displayedRun, selectedAgent?.name);
    if (!runOutputMessage) return hideMessages(labeled, hiddenMessageIds);

    return hideMessages([
      ...labeled,
      runOutputMessage,
    ], hiddenMessageIds);
  }, [activeThreadId, displayedRun, hiddenMessageIds, messages, persistedMessages, selectedAgent?.name, userMessages]);
  const effectiveLeftSidebarWidth = clamp(leftSidebarWidth, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
  const shellStyle = {
    '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (currentRun) setOptimisticRun(null);
  }, [currentRun]);

  useEffect(() => {
    if (effectiveRightPanelOpen) {
      setRightPanelMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setRightPanelMounted(false), 220);
    return () => window.clearTimeout(timer);
  }, [effectiveRightPanelOpen]);

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

  const {
    handleSend,
    handleCancel,
    handleRetry,
  } = useSendRun({
    runStartPending,
    runIsActive,
    activeThreadId,
    threads,
    agents,
    selectedAgentId,
    optimisticRun,
    currentRun,
    allMessages,
    threadItemCount: threadItemData?.items?.length,
    setRunStartPending,
    setOptimisticRun,
    setUserMessages,
    selectThread,
    addThreadToCache,
    updateThreadInCache,
    setThreadTitleInCache,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,
    queryClient,
    addToast,
    t,
  });

  const {
    handleSelectThread,
    handleThreadTitleEdited,
    handleSelectAgent,
    handleCreateThread,
    handleQuickChat,
    handleForkThread,
    handleStartLocalOrchestration,
    handleSearchThreadSelect,
    handleSearchMessageSelect,
    openGlobalSearch,
  } = useThreadNavigation({
    allMessages,
    selectedAgentName: selectedAgent?.name,
    selectedAgentId: selectedAgentId ?? null,
    selectedThreadId: selectedThread?.threadId,
    selectedThreadTitle: selectedThread?.title,
    selectThread,
    selectAgentThread,
    setLeftSidebarView,
    setViewMode,
    setPendingComposerDraft,
    addThreadToCache,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,
    queryClient,
    addToast,
    t,
    agents,
  });

  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  const handleOpenAuth = useCallback(() => {
    useHubStore.getState().setShowAuthModal(true);
  }, []);

  const handleOpenHubAccount = useCallback(() => {
    if (hubAuthenticated) {
      openSettings('account');
      return;
    }
    handleOpenAuth();
  }, [handleOpenAuth, hubAuthenticated, openSettings]);

  const desktopWindowAvailable = isTauriRuntime();

  const { handleWindowCommand, handleEditCommand, handleCopyDiagnostics } = useDesktopCommands({
    online,
    isConnected,
    wsLatency,
    healthVersion: health?.version,
    selectedAgent,
    selectedThread,
    displayedRun,
  });

  const handleOpenFolder = useCallback(async () => {
    if (!desktopWindowAvailable) {
      addToast({ type: 'info', message: t('prompt.browseWorkDirUnavailable') });
      return;
    }
    try {
      const selected = await (await import('@tauri-apps/plugin-dialog')).open({ directory: true, multiple: false });
      const workDir = Array.isArray(selected) ? selected[0] : selected;
      if (typeof workDir !== 'string' || !workDir.trim()) return;
      window.localStorage.setItem('agenthub.prompt.workDir', workDir);
      window.dispatchEvent(new CustomEvent('agenthub:workdir-selected', { detail: { workDir } }));
      addToast({ type: 'success', message: t('toast.workDirSelected') });
      focusComposer();
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, desktopWindowAvailable, t]);

  const handleReviewApprovalsFromHome = useCallback(() => {
    if (permissionRequests.length === 0) {
      openSettings('permissions');
      return;
    }
    setLeftSidebarView('thread');
    if (displayedRun) setRightPanelOpen(true);
  }, [displayedRun, openSettings, permissionRequests.length, setLeftSidebarView, setRightPanelOpen]);

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

  const handleDelete = useCallback((messageId: string) => {
    setUserMessages((prev) => prev.filter((m) => m.id !== messageId));
    hideMessage(messageId);
  }, [hideMessage]);

  useEffect(() => {
    if (!pendingComposerDraft || leftSidebarView === 'home' || viewMode !== 'agent') return undefined;
    let attempts = 0;
    let timer: number | undefined;
    const tryApplyDraft = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label], textarea[placeholder]');
      if (!textarea) {
        attempts += 1;
        if (attempts < 12) timer = window.setTimeout(tryApplyDraft, 50);
        return;
      }
      setComposerDraft(pendingComposerDraft);
      focusComposer();
      setPendingComposerDraft('');
    };
    timer = window.setTimeout(tryApplyDraft, 0);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [leftSidebarView, pendingComposerDraft, viewMode]);

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

  const topMenus = useTopMenuConfig({
    desktopWindowAvailable,
    displayedRun,
    handleCopyDiagnostics,
    handleCreateThread,
    handleEditCommand,
    handleOpenHubAccount,
    handleOpenFolder,
    handleQuickChat,
    handleWindowCommand,
    leftSidebarCollapsed,
    online,
    openSettings,
    rightPanelOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setShortcutHelpOpen,
    setWorkspaceExpanded,
    t,
    theme,
    toggleTheme,
    workspaceExpanded,
  });

  useShellShortcuts({
    online,
    isMobile,
    workspaceExpanded,
    leftSidebarCollapsed,
    rightPanelOpen,
    shortcutHelpOpen,
    displayedRun,
    handleCreateThread,
    handleQuickChat,
    handleOpenFolder,
    handleWindowCommand: handleWindowCommand as (command: string) => Promise<void>,
    openSettings: openSettings as (section?: string) => void,
    setNavPanelOpen,
    setShortcutHelpOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
  });

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
          <TopMenuBar menus={topMenus} ariaLabel={t('menu.title')} />
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

      <ConnectionStatus
        isConnected={isConnected}
        isReconnecting={edgeStatus.retrying}
        onReconnect={edgeStatus.retry}
      />

      {settingsOpen ? (
        <Suspense fallback={null}>
        <SettingsPage
          initialSection={settingsInitialSection}
          onBack={() => setSettingsOpen(false)}
          onOpenAuth={handleOpenAuth}
        />
        </Suspense>
      ) : (
      <>

      {/* Mobile toolbar */}
      {isMobile && (
        <div className={styles.mobileToolbar}>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => setNavPanelOpen(true)} label={t('nav.openMenu')} aria-expanded={navPanelOpen}>
            <Menu size={17} />
          </ShellIconButton>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => openGlobalSearch()} label={t('search.openGlobal')}>
            <Search size={17} />
          </ShellIconButton>
          <span className={styles.mobileToolbarTitle}>{selectedAgent?.name ?? 'AgentHub'}</span>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={() => openSettings('general')} label={t('nav.settings')}>
            <Settings size={17} />
          </ShellIconButton>
          <ShellIconButton className={styles.mobileToolbarBtn} onClick={handleOpenHubAccount} label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}>
            {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <UserCircle size={17} />}
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
              <div className={`${styles.sidebarSection} ${styles.threadSection}`}>
                <div className={styles.sidebarScroll}>
                  <Slot name="thread-panel" online={online} selectedId={activeThreadId ?? undefined} onSelect={handleSelectThread} onCreate={handleCreateThread} onThreadTitleEdited={handleThreadTitleEdited} runs={allRunsData?.items ?? []} />
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
            <button
              type="button"
              className={styles.sidebarSearch}
              aria-label={t('search.openGlobal')}
              onClick={() => openGlobalSearch()}
            >
              <Search size={14} />
              <span>{t('search.sidebarPlaceholder')}</span>
            </button>

            {/* Agents section */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarScroll}>
                <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
              </div>
            </div>

            {/* Threads section */}
            <div className={`${styles.sidebarSection} ${styles.threadSection}`}>
              <div className={styles.sidebarScroll}>
                <Slot name="thread-panel" online={online} selectedId={activeThreadId ?? undefined} onSelect={handleSelectThread} onCreate={handleCreateThread} onThreadTitleEdited={handleThreadTitleEdited} runs={allRunsData?.items ?? []} />
              </div>
            </div>

            {/* Sidebar footer */}
            <div className={styles.sidebarFooter}>
              <ShellIconButton className={styles.navIconBtn} onClick={() => openSettings('general')} label={t('nav.settings')} tooltipSide="top">
                <Settings size={16} />
              </ShellIconButton>
              <ShellIconButton
                className={styles.navIconBtn}
                onClick={handleOpenHubAccount}
                label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
                tooltipSide="top"
                aria-pressed={hubAuthenticated}
              >
                {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <UserCircle size={16} />}
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
              {selectedThread && <span className={styles.workspaceThreadTitle}>{selectedThread.title}</span>}
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
                  label={teamRunButtonLabel}
                  tooltipSide="bottom"
                >
                  <span className={styles.iconBadgeHostInline}>
                    <Route size={15} />
                    {teamRunBadgeCount > 0 ? (
                      <span className={styles.iconBadge} aria-label={teamRunButtonLabel}>
                        {teamRunBadgeCount > 9 ? '9+' : teamRunBadgeCount}
                      </span>
                    ) : null}
                  </span>
                </ShellIconButton>
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
                <Suspense fallback={null}>
                <HomeDashboard
                  onNewThread={async () => {
                    try {
                      const thread = await createThread();
                      addThreadToCache(thread, { empty: true });
                      handleSelectThread(thread.threadId);
                    } catch {
                      // continue
                    }
                  }}
                  onSelectThread={handleSelectThread}
                  onQuickStart={async (prompt) => {
                    const title = buildAutomaticThreadTitle(prompt);
                    try {
                      const thread = await createThread(title ?? undefined);
                      addThreadToCache(thread);
                      handleSelectThread(thread.threadId);
                      await handleSend(prompt, selectedAgentId ?? undefined, {
                        threadId: thread.threadId,
                        threadInfo: thread,
                        createdEmptyThread: true,
                      });
                    } catch {
                      addToast({ type: 'error', message: t('toast.error') });
                    }
                  }}
                  onViewRuns={() => openSettings('tasks')}
                  onReviewApprovals={handleReviewApprovalsFromHome}
                  onViewAllThreads={() => setLeftSidebarView('thread')}
                  onOpenTeamRuns={() => openSettings('agentScheduling')}
                  onOpenHubAccount={handleOpenHubAccount}
                  permissionCount={permissionRequests.length}
                  agentTeamOverview={agentTeamsQuery.data}
                  agentTeamsLoading={agentTeamsQuery.isLoading || agentTeamsQuery.isFetching}
                  agentTeamsSignedIn={hubInventoryEnabled}
                  agents={agents}
                  selectedAgentId={selectedAgentId ?? undefined}
                  onSelectAgent={handleSelectAgent}
                  onStartLocalOrchestration={handleStartLocalOrchestration}
                />
                </Suspense>
              ) : viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" agents={agents} /></Suspense></ErrorBoundary>
              ) : (
                <Slot
                  name="main-view"
                  messages={messages}
                  allMessages={allMessages}
                  threadsCount={threads.length}
                  isStreaming={composerLocked}
                  isConnected={isConnected}
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={handleSelectAgent}
                  onRetry={handleRetry}
                  onFork={handleForkThread}
                  onDelete={handleDelete}
                  onSendMessage={handleSend}
                />
              )}
            </div>

            {/* Input area */}
            {leftSidebarView !== 'home' && viewMode === 'agent' && (
              <div className={styles.inputArea}>
                <Slot name="prompt-input" agents={agents} threads={threads} executionTargets={executionTargetsQuery.data?.items ?? []} modelCatalog={modelCatalogQuery.data} modelDisplayNames={modelsDevDisplayNamesQuery.data} selectedAgentId={selectedAgentId ?? undefined} onSelectAgent={handleSelectAgent} onSend={handleSend} isStreaming={runIsActive} isStarting={runStartPending} onCancel={handleCancel} disabled={!online} threadId={activeThreadId ?? undefined} onRetryLast={handleRetry} onForkThread={handleForkThread} />
              </div>
            )}

            {!isMobile && !workspaceExpanded && displayedRun && rightPanelMounted && (
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
        <Slot name="search-dialog" messages={allMessages} threads={threads} onSelect={handleSearchMessageSelect} onSelectThread={handleSearchThreadSelect} />
      </Suspense>
      <Slot name="permission-dialog" requests={permissionRequests} onDecide={handleDecidePermission} />
      <Slot name="shortcut-help" open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      {showAuthModal && (
        <div className={styles.modalOverlay} onClick={() => useHubStore.getState().setShowAuthModal(false)}>
          <div className={styles.authModal} onClick={(e) => e.stopPropagation()}>
            <Suspense fallback={null}>
            <AuthPage
              onLoginSuccess={() => useHubStore.getState().setShowAuthModal(false)}
              onClose={() => useHubStore.getState().setShowAuthModal(false)}
            />
            </Suspense>
          </div>
        </div>
      )}
      <ToastContainer />
    </div>
    </ErrorBoundary>
  );
}
