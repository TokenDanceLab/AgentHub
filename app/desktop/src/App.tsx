import { useState, useEffect, useCallback, useRef, Suspense, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useEdgeStatus } from '@/hooks/useEdgeStatus';
import { useAgentList } from '@/api/agentQueries';
import { startRun, cancelRun, decidePermission as decidePermissionRest } from '@/api/edgeClient';
import { useThreads } from '@/api/threadQueries';
import type { StartRunRequest } from '@shared/types';
import { AppError } from '@shared/errors';
import type { ChatMessage } from '@/components/ChatView.types';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useUIStore } from '@/stores/uiStore';
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
  const { selectedThreadId, selectThread } = useThreadStore(
    useShallow((s) => ({ selectedThreadId: s.selectedThreadId, selectThread: s.selectThread })),
  );
  const { data: agentData } = useAgentList(online);
  const agents = agentData?.items ?? [];
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
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
  const allMessages = [...userMessages, ...messages];
  const displayedRun = currentRun ?? optimisticRun;
  const runIsActive = isRunActiveStatus(displayedRun?.status);
  const composerLocked = runStartPending || runIsActive;
  const shellStyle = {
    '--left-sidebar-width': `${leftSidebarWidth}px`,
    '--right-panel-width': `${rightPanelWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (currentRun) setOptimisticRun(null);
  }, [currentRun]);

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string }) => {
    if (runStartPending || runIsActive) {
      setRightPanelOpen(true);
      addToast({ type: 'info', message: t('error.activeRunExists') });
      return false;
    }
    const tempRunId = `starting-${Date.now()}`;
    setRunStartPending(true);
    try {
      const req: StartRunRequest = { prompt };
      if (agentId) req.agentId = agentId;
      if (opts?.model) req.model = opts.model;
      if (opts?.reasoningEffort) req.reasoningEffort = opts.reasoningEffort;
      if (selectedThread) req.threadId = selectedThread.threadId;
      setOptimisticRun({ runId: tempRunId, status: 'queued', outputText: '', toolCalls: [], changedFiles: [] });
      setRightPanelOpen(true);
      const started = await startRun(req);
      setUserMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', timestamp: new Date().toISOString(), blocks: [{ kind: 'text', content: prompt }] }]);
      setOptimisticRun({ ...started, outputText: '', toolCalls: [], changedFiles: [] });
      return true;
    } catch (e) {
      const activeRunId = getActiveRunConflictId(e);
      if (activeRunId) {
        setOptimisticRun({ runId: activeRunId, status: 'running', outputText: '', toolCalls: [], changedFiles: [] });
        setRightPanelOpen(true);
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
  const handleSelectAgent = useCallback((id: string) => setSelectedAgentId(id), []);
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

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setNavPanelOpen(false); }
      if (e.key === '?' && !(e.target as HTMLElement)?.closest('input,textarea,[contenteditable]') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); setShortcutHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
            <button className={styles.winBtn} onClick={() => getCurrentWindow().minimize()} title="最小化">
              <Minus size={13} />
            </button>
            <button className={styles.winBtn} onClick={async () => {
              const w = getCurrentWindow();
              (await w.isMaximized()) ? w.unmaximize() : w.maximize();
            }} title="最大化">
              <Square size={11} />
            </button>
            <button className={`${styles.winBtn} ${styles.winBtnClose}`} onClick={() => getCurrentWindow().close()} title="关闭">
              <X size={14} />
            </button>
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
          <button className={styles.mobileToolbarBtn} onClick={() => setNavPanelOpen(true)} aria-label={t('nav.openMenu')}>
            <Menu size={17} />
          </button>
          <span className={styles.mobileToolbarTitle}>{selectedAgent?.name ?? 'AgentHub'}</span>
          <button className={styles.mobileToolbarBtn} onClick={() => openSettings('general')} aria-label={t('nav.settings')}>
            <Settings size={17} />
          </button>
          <button className={styles.mobileToolbarBtn} onClick={() => useHubStore.getState().setShowAuthModal(true)} aria-label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}>
            {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={17} />}
          </button>
          <button className={styles.mobileToolbarBtn} onClick={toggleTheme} aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
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
            <button className={styles.railBtn} onClick={() => setLeftSidebarCollapsed(false)} title={t('nav.expandSidebar')} aria-label={t('nav.expandSidebar')}>
              <PanelLeftOpen size={17} />
            </button>
            <button className={styles.railBtn} onClick={() => openSettings('general')} title={t('nav.settings')} aria-label={t('nav.settings')}>
              <Settings size={17} />
            </button>
            <button className={styles.railBtn} onClick={() => useHubStore.getState().setShowAuthModal(true)} title={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}>
              {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={17} />}
            </button>
            <button className={styles.railBtn} onClick={toggleTheme} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
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
              <button className={styles.navIconBtn} onClick={() => setLeftSidebarCollapsed(true)} title={t('nav.collapseSidebar')} aria-label={t('nav.collapseSidebar')}>
                <PanelLeftClose size={16} />
              </button>
              <button className={styles.navIconBtn} onClick={() => openSettings('general')} title={t('nav.settings')} aria-label={t('nav.settings')}>
                <Settings size={16} />
              </button>
              <button className={styles.navIconBtn} onClick={() => useHubStore.getState().setShowAuthModal(true)} title={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}>
                {hubAuthenticated ? <Circle size={10} fill="var(--color-success)" color="var(--color-success)" /> : <LogIn size={16} />}
              </button>
              <button className={styles.navIconBtn} onClick={toggleTheme} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizeLeft')}
            onPointerDown={handleStartResize('left')}
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
                <button
                  className={styles.workspaceHeaderBtn}
                  onClick={handleShareWorkspace}
                  title={t('workspace.share')}
                  aria-label={t('workspace.share')}
                >
                  <Copy size={15} />
                </button>
                <button
                  className={styles.workspaceHeaderBtn}
                  onClick={() => setViewMode((mode) => (mode === 'agent' ? 'im' : 'agent'))}
                  title={viewMode === 'agent' ? t('im.groupChat') : t('nav.agent')}
                  aria-label={viewMode === 'agent' ? t('im.groupChat') : t('nav.agent')}
                >
                  <MessageSquareText size={15} />
                </button>
                <button
                  className={styles.workspaceHeaderBtn}
                  onClick={() => openSettings('tasks')}
                  title={t('settings.tasks')}
                  aria-label={t('settings.tasks')}
                >
                  <ClipboardList size={15} />
                </button>
                <button
                  className={styles.workspaceHeaderBtn}
                  onClick={() => openSettings('agentScheduling')}
                  title={t('settings.agentScheduling')}
                  aria-label={t('settings.agentScheduling')}
                >
                  <Route size={15} />
                </button>
                {displayedRun && !rightPanelOpen && (
                  <button
                    className={styles.workspaceHeaderBtn}
                    onClick={() => setRightPanelOpen(true)}
                    title={t('run.open')}
                    aria-label={t('run.open')}
                  >
                    <PanelRightOpen size={15} />
                  </button>
                )}
                <button
                  className={styles.workspaceHeaderBtn}
                  onClick={() => setWorkspaceExpanded((v) => !v)}
                  title={workspaceExpanded ? t('workspace.collapse') : t('workspace.expand')}
                  aria-label={workspaceExpanded ? t('workspace.collapse') : t('workspace.expand')}
                >
                  {workspaceExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </div>

            {/* Chat area */}
            <div className={styles.chatArea}>
              {viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" /></Suspense></ErrorBoundary>
              ) : (
                <Slot name="main-view" messages={messages} allMessages={allMessages} threadsCount={threads.length} isStreaming={composerLocked} isConnected={isConnected} onRetry={handleRetry} onDelete={handleDelete} onSendMessage={handleSend} />
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
            onPointerDown={handleStartResize('right')}
          />
          <div className={styles.rightPanel}>
            <div className={styles.rightPanelHeader}>
              <div className={styles.rightPanelSegmented}>
                <button className={`${styles.rightPanelTab} ${styles.rightPanelTabActive}`}>{t('run.output')}</button>
                <button className={styles.rightPanelTab}>{t('run.files')}</button>
              </div>
              <button className={styles.rightPanelCollapseBtn} onClick={() => setRightPanelOpen(false)} title={t('run.close')} aria-label={t('run.close')}>
                <PanelRightClose size={15} />
              </button>
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
            <button
              className={styles.railBtn}
              onClick={() => setRightPanelOpen(true)}
              title={t('run.open')}
              aria-label={t('run.open')}
            >
              <PanelRightOpen size={17} />
            </button>
            <span className={`${styles.railStatusDot} ${runIsActive ? styles.railStatusDotActive : ''}`} />
            <button
              className={styles.railBtn}
              onClick={() => openSettings('tasks')}
              title={t('settings.tasks')}
              aria-label={t('settings.tasks')}
            >
              <ClipboardList size={17} />
            </button>
            <button
              className={styles.railBtn}
              onClick={() => openSettings('agentScheduling')}
              title={t('settings.agentScheduling')}
              aria-label={t('settings.agentScheduling')}
            >
              <Route size={17} />
            </button>
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
