import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery';
import { useEdgeStatus } from '@/hooks/useEdgeStatus';
import { useAgents } from '@/hooks/useAgents';
import { startRun, cancelRun, decidePermission as decidePermissionRest } from '@/api/edgeClient';
import { useThreads } from '@/api/threadQueries';
import type { AgentInfo, ThreadInfo, StartRunRequest } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useRunStore } from '@/stores/runStore';
import { useShallow } from 'zustand/shallow';
import { SkeletonLine } from '@/components/Skeleton';
import { useToastStore } from '@/stores/toastStore';
import { useHubStore } from '@/stores/hubStore';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import AuthPage from '@/components/AuthPage';
import { MessageSquare, Bot, Sun, Moon, Wifi, WifiOff, Circle, LogIn, Settings } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { getCurrentWindow } from '@tauri-apps/api/window';
import styles from '@/App.module.css';

export default function App() {
  const { online, health } = useHealth();
  const { messages, isConnected, currentRun, permissionRequests, decidePermission } = useChatMessages(online);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
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
  const { setCurrentRun: runStoreSetCurrentRun, setIsStreaming: runStoreSetStreaming, clear: runStoreClear } =
    useRunStore(useShallow((s) => ({ setCurrentRun: s.setCurrentRun, setIsStreaming: s.setIsStreaming, clear: s.clear })));

  const agents = useAgents(online);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [viewMode, setViewMode] = useState<'agent' | 'im'>('agent');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

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

  // Sync currentRun → run store
  const prevRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentRun) {
      if (prevRunIdRef.current !== currentRun.runId) {
        prevRunIdRef.current = currentRun.runId;
        runStoreSetCurrentRun(currentRun);
        runStoreSetStreaming(true);
      }
    } else {
      prevRunIdRef.current = null;
      runStoreClear();
    }
  }, [currentRun, runStoreSetCurrentRun, runStoreSetStreaming, runStoreClear]);

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

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string }) => {
    try {
      const req: StartRunRequest = { prompt };
      if (agentId) req.agentId = agentId;
      if (opts?.model) req.model = opts.model;
      if (opts?.reasoningEffort) req.reasoningEffort = opts.reasoningEffort;
      if (selectedThread) req.threadId = selectedThread.threadId;
      setUserMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', timestamp: new Date().toISOString(), blocks: [{ kind: 'text', content: prompt }] }]);
      await startRun(req);
    } catch (e) { console.error('Failed to start run:', e); }
  }, [selectedThread]);

  const handleCancel = useCallback(async () => {
    if (currentRun?.runId) {
      try { await cancelRun(currentRun.runId); } catch {}
    }
  }, [currentRun?.runId]);

  const handleSelectThread = useCallback((id: string) => { selectThread(id); setUserMessages([]); }, [selectThread]);
  const handleSelectAgent = useCallback((id: string) => setSelectedAgentId(id), []);

  const handleDecidePermission = useCallback((requestId: string, decision: 'allow' | 'deny', reason?: string) => {
    decidePermission(requestId, decision, reason);
    decidePermissionRest(requestId, decision, reason).catch(() => {});
  }, [decidePermission]);

  const handleRetry = useCallback((messageId: string) => {
    const msg = allMessages.find((m) => m.id === messageId);
    if (!msg) return;
    const prompt = msg.blocks.find((b) => b.kind === 'text')?.content;
    if (prompt) handleSend(prompt, selectedAgentId);
  }, [allMessages, handleSend, selectedAgentId]);

  const handleDelete = useCallback((messageId: string) => {
    setUserMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

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

  // ── Drag handler for frameless window (Tauri v2 programmatic API)
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a')) return;
    try { await getCurrentWindow().startDragging(); } catch {}
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
      <div className={styles.topBar} onMouseDown={handleDragStart} onDoubleClick={handleTopBarDoubleClick}>
        <div className={styles.topBarLeft}>
          <span className={styles.statusBadge}>
            <span className={`${styles.statusBadgeDot} ${online ? styles.statusBadgeDotOnline : styles.statusBadgeDotOffline}`} />
            {online ? `Edge ${health?.version ?? 'v1'}` : t('status.offline')}
          </span>
          {wsLatency != null && <span className={styles.topBarDim} style={{ marginLeft: 6 }}>{wsLatency}ms</span>}
          {isConnected ? <Wifi size={12} className={styles.topBarDim} /> : <WifiOff size={12} className={styles.topBarDim} />}
          {edgeStatus.lastError && <span className={styles.topBarDim} title={edgeStatus.lastError} style={{ marginLeft: 4 }}>⚠</span>}
        </div>
        <div className={styles.topBarRight}>
          <button className={styles.topBarBtn} onClick={toggleTheme} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Window controls — no drag region so clicks register */}
          <div className={styles.winControls}>
            <button className={styles.winBtn} onClick={() => getCurrentWindow().minimize()} title="最小化">
              <svg width="10" height="1" viewBox="0 0 10 1" fill="none"><path d="M0 0.5H10" stroke="currentColor"/></svg>
            </button>
            <button className={styles.winBtn} onClick={async () => {
              const w = getCurrentWindow();
              (await w.isMaximized()) ? w.unmaximize() : w.maximize();
            }} title="最大化">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>
            </button>
            <button className={`${styles.winBtn} ${styles.winBtnClose}`} onClick={() => getCurrentWindow().close()} title="关闭">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          </div>
        </div>
      </div>

      {edgeStatus.showBanner && (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerIcon}>&#9888;</span>
          <span className={styles.bannerMsg}>{edgeStatus.lastError ?? t('banner.disconnected')}</span>
          <span className={styles.bannerActions}>
            <button className={styles.bannerBtn} onClick={edgeStatus.retry} disabled={edgeStatus.retrying}>{edgeStatus.retrying ? '...' : t('banner.retry')}</button>
            <button className={styles.bannerBtn} onClick={edgeStatus.dismissBanner}>{t('banner.dismiss')}</button>
          </span>
        </div>
      )}

      {/* Mobile toolbar */}
      {isMobile && (
        <div style={{ display: 'flex', padding: '4px 8px', gap: 8, background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setNavPanelOpen(true)} style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--background)', color: 'var(--foreground)', cursor: 'pointer', fontSize: 12 }}>☰ Menu</button>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--muted-foreground)', alignSelf: 'center' }}>{selectedAgent?.name ?? 'AgentHub'}</span>
        </div>
      )}

      {/* Mobile nav overlay */}
      {isMobile && (
        <>
          <div className={`${styles.overlay} ${navPanelOpen ? styles.overlayActive : ''}`} onClick={() => setNavPanelOpen(false)} />
          <div className={`${styles.overlayPanel} ${styles.overlayPanelLeft} ${navPanelOpen ? styles.overlayPanelLeftActive : ''}`}>
            <Slot name="thread-panel" online={online} selectedId={selectedThreadId ?? undefined} onSelect={handleSelectThread} />
          </div>
        </>
      )}

      <div className={styles.body}>
        {/* Left icon nav (desktop/tablet) */}
        {!isMobile && (
          <div className={styles.nav}>
            <button className={`${styles.navBtn} ${viewMode === 'agent' ? styles.navBtnActive : ''}`} onClick={() => setViewMode('agent')} title={t('nav.agent')}>
              <Bot size={18} />
            </button>
            <button className={`${styles.navBtn} ${viewMode === 'im' ? styles.navBtnActive : ''}`} onClick={() => setViewMode('im')} title={t('nav.messages')}>
              <MessageSquare size={18} />
            </button>
            <div className={styles.navSpacer} />
            {/* Settings + Hub at bottom */}
            <button className={styles.navBtn} onClick={() => useHubStore.getState().setShowAuthModal(true)} title={t('nav.settings')}>
              <Settings size={18} />
            </button>
            <button
              className={styles.navBtn}
              onClick={() => useHubStore.getState().setShowAuthModal(true)}
              title={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
            >
              {hubAuthenticated ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Circle size={10} fill="var(--color-success)" color="var(--color-success)" />
                </span>
              ) : (
                <LogIn size={18} />
              )}
              </button>
          </div>
        )}

        {/* Desktop Thread panel */}
        {!isMobile && !isTablet && (
          <div className={styles.sidebarPanel}>
            <Slot name="thread-panel" online={online} selectedId={selectedThreadId ?? undefined} onSelect={handleSelectThread} />
          </div>
        )}

        {/* Agent list panel (desktop only) */}
        {!isMobile && !isTablet && (
          <div className={styles.sidebarPanel}>
            <Slot name="agent-list" agents={agents} online={online} selectedId={selectedAgentId} onSelect={handleSelectAgent} />
          </div>
        )}

        {/* Main zone */}
        <div className={styles.main}>
          <div className={styles.workspace}>
            {/* Workspace header */}
            <div className={styles.workspaceHeader}>
              <div className={`${styles.workspaceHeaderDot} ${online ? styles.workspaceHeaderDotOnline : styles.workspaceHeaderDotOffline}`} />
              <h2>{selectedAgent ? selectedAgent.name : 'AgentHub'}</h2>
              {selectedThread && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--muted-foreground)' }}>{selectedThread.title}</span>}
            </div>

            {/* Chat area */}
            <div className={styles.chatArea}>
              {viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" /></Suspense></ErrorBoundary>
              ) : (
                <Slot name="main-view" messages={messages} allMessages={allMessages} threadsCount={threads.length} isStreaming={currentRun != null} isConnected={isConnected} onRetry={handleRetry} onDelete={handleDelete} onSendMessage={handleSend} />
              )}
            </div>

            {/* Input area */}
            {viewMode === 'agent' && (
              <div className={styles.inputArea}>
                <Slot name="prompt-input" agents={agents} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} onSend={handleSend} isStreaming={currentRun != null} onCancel={handleCancel} disabled={!online} threadId={selectedThreadId ?? undefined} />
              </div>
            )}
          </div>
        </div>

        {/* Right panel (desktop/tablet) */}
        {!isMobile && (
          <div className={styles.rightPanel}>
            <div className={styles.rightPanelHeader}>
              <div className={styles.rightPanelSegmented}>
                <button className={`${styles.rightPanelTab} ${styles.rightPanelTabActive}`}>{t('run.output')}</button>
                <button className={styles.rightPanelTab}>{t('run.files')}</button>
              </div>
            </div>
            <div className={styles.rightPanelBody}>
              <ErrorBoundary>
                <Suspense fallback={<div style={{ padding: 16, color: 'var(--muted-foreground)' }}><SkeletonLine width="60%" height="1em" /><SkeletonLine width="40%" height="1em" /></div>}>
                  <Slot name="run-detail" run={currentRun ? { runId: currentRun.runId, projectId: '', threadId: selectedThread?.threadId ?? '', status: currentRun.status } : null} outputText={currentRun?.outputText} toolCalls={currentRun?.toolCalls ?? []} changedFiles={currentRun?.changedFiles ?? []} />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>

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
    </div>
    </ErrorBoundary>
  );
}
