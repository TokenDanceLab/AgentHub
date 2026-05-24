import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, X, PanelRightClose, PanelRightOpen, Bot } from 'lucide-react';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery';
import { useEdgeStatus } from '@/hooks/useEdgeStatus';
import { startRun, cancelRun, fetchAgents, decidePermission as decidePermissionRest } from '@/api/edgeClient';
import { useThreads } from '@/api/threadQueries';
import type { AgentInfo, ThreadInfo, StartRunRequest } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useRunStore } from '@/stores/runStore';
import { useShallow } from 'zustand/shallow';
import { SkeletonLine, SkeletonCircle } from '@/components/Skeleton';
import { useToastStore } from '@/stores/toastStore';
import { useHubStore } from '@/stores/hubStore';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import ResizeHandle from '@/components/ResizeHandle';
import styles from '@/App.module.css';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 420;
const MIN_RIGHT = 240;
const MAX_RIGHT = 600;

/** Shared skeleton shown while AgentList data is loading. */
function AgentListSkeleton() {
  return (
    <div className={styles.skeletonAgentList} aria-busy="true" aria-label="Loading agents">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={styles.skeletonAgentItem}>
          <SkeletonCircle width={8} height={8} />
          <div className={styles.skeletonAgentInfo}>
            <SkeletonLine width={`${55 + (i % 3) * 10}%`} height="14px" />
            <SkeletonLine width={`${35 + (i % 4) * 8}%`} height="10px" />
            <div className={styles.skeletonAgentTags}>
              <SkeletonLine width="42px" height="14px" />
              <SkeletonLine width="50px" height="14px" />
              <SkeletonLine width="36px" height="14px" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { online, health } = useHealth();
  const { messages, isConnected, currentRun, permissionRequests, decidePermission } = useChatMessages(online);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const edgeStatus = useEdgeStatus(online);
  const addToast = useToastStore((s) => s.addToast);

  // TanStack Query — replaces setInterval polling for threads
  const { data: threadData } = useThreads();
  const threads = threadData?.items ?? [];

  // Zustand stores — batched with useShallow to minimize re-renders
  const { sidebarWidth, rightPanelWidth, setSidebarWidth, setRightPanelWidth } = useUIStore(
    useShallow((s) => ({
      sidebarWidth: s.sidebarWidth,
      rightPanelWidth: s.rightPanelWidth,
      setSidebarWidth: s.setSidebarWidth,
      setRightPanelWidth: s.setRightPanelWidth,
    })),
  );
  const { setOnline, setConnected, wsLatency } = useConnectionStore(
    useShallow((s) => ({
      setOnline: s.setOnline,
      setConnected: s.setConnected,
      wsLatency: s.wsLatency,
    })),
  );
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const { selectedThreadId, selectThread } = useThreadStore(
    useShallow((s) => ({
      selectedThreadId: s.selectedThreadId,
      selectThread: s.selectThread,
    })),
  );
  const {
    setCurrentRun: runStoreSetCurrentRun,
    setIsStreaming: runStoreSetStreaming,
    isStreaming,
    clear: runStoreClear,
  } = useRunStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      setCurrentRun: s.setCurrentRun,
      setIsStreaming: s.setIsStreaming,
      clear: s.clear,
    })),
  );

  // Local state (lightweight, not worth a store yet)
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRunDetailOpen, setMobileRunDetailOpen] = useState(false);
  const [tabletAgentOpen, setTabletAgentOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // Search → scroll state
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Close mobile/tablet panels on desktop resize
  useEffect(() => {
    if (!isMobile && !isTablet) {
      setMobileSidebarOpen(false);
      setMobileRunDetailOpen(false);
      setTabletAgentOpen(false);
    }
  }, [isMobile, isTablet]);

  // Escape key closes mobile overlays / modals; ? opens keyboard shortcut help
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        setMobileSidebarOpen(false);
        setMobileRunDetailOpen(false);
        setTabletAgentOpen(false);
      }
      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sync health hook → connection store
  useEffect(() => {
    setOnline(online, health);
  }, [online, health, setOnline]);

  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  // Sync chat messages → run store (Kanna dual-Map pattern)
  useEffect(() => {
    if (currentRun) {
      runStoreSetCurrentRun(currentRun);
      runStoreSetStreaming(true);
    } else {
      runStoreClear();
    }
  }, [currentRun, runStoreSetCurrentRun, runStoreSetStreaming, runStoreClear]);

  // Poll agents
  useEffect(() => {
    if (!online) {
      setAgents([]);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchAgents();
        if (active) setAgents(res.items);
      } catch {
        /* Edge may not have /v1/agents yet */
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [online]);

  // Toast when a new thread appears (detected via TanStack Query data changes)
  const prevThreadIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!online || threads.length === 0) {
      prevThreadIdsRef.current = new Set();
      return;
    }
    const currentIds = new Set(threads.map((th) => th.threadId));
    const wasInitial = prevThreadIdsRef.current.size === 0;
    if (!wasInitial) {
      for (const th of threads) {
        if (!prevThreadIdsRef.current.has(th.threadId)) {
          addToast({ type: 'success', message: t('toast.threadCreated') });
        }
      }
    }
    prevThreadIdsRef.current = currentIds;
  }, [threads, online, addToast, t]);

  const selectedThread = threads.find((th) => th.threadId === selectedThreadId);

  const handleSend = useCallback(
    async (
      prompt: string,
      agentId?: string,
      opts?: { model?: string; reasoningEffort?: string },
    ) => {
      try {
        const req: StartRunRequest = { prompt };
        if (agentId) req.agentId = agentId;
        if (opts?.model) req.model = opts.model;
        if (opts?.reasoningEffort) req.reasoningEffort = opts.reasoningEffort;
        if (selectedThread) req.threadId = selectedThread.threadId;
        setUserMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            timestamp: new Date().toISOString(),
            blocks: [{ kind: 'text', content: prompt }],
          },
        ]);
        await startRun(req);
      } catch (e) {
        console.error('Failed to start run:', e);
      }
    },
    [selectedThread],
  );

  const handleCancel = useCallback(async () => {
    const run = useRunStore.getState().currentRun;
    if (run?.runId) {
      try {
        await cancelRun(run.runId);
      } catch (e) {
        console.error('Failed to cancel run:', e);
      }
    }
  }, []);

  const handleSearchSelect = useCallback((messageId: string) => {
    setScrollToMessageId(messageId);
  }, []);

  const handleSidebarResize = useCallback(
    (delta: number) =>
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, sidebarWidth + delta))),
    [sidebarWidth, setSidebarWidth],
  );

  const handleRightResize = useCallback(
    (delta: number) =>
      setRightPanelWidth(Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, rightPanelWidth - delta))),
    [rightPanelWidth, setRightPanelWidth],
  );

  const handleSelectAgent = useCallback((agent: AgentInfo) => {
    setSelectedAgentId(agent.id);
    setTabletAgentOpen(false);
  }, []);

  const handleSelectThread = useCallback(
    (thread: ThreadInfo) => {
      selectThread(thread.threadId);
      setMobileSidebarOpen(false);
    },
    [selectThread],
  );

  const handleDecidePermission = useCallback(
    (requestId: string, decision: 'allow' | 'deny', reason?: string) => {
      // 1. Update local state and send via WebSocket
      decidePermission(requestId, decision, reason);
      // 2. Also notify Edge via REST (fallback if WebSocket send is not processed)
      const runId = currentRun?.runId ?? '';
      decidePermissionRest({ requestId, decision, reason, runId }).catch((e: unknown) => {
        console.error('Failed to send permission decision via REST:', e);
      });
    },
    [decidePermission, currentRun?.runId],
  );

  const allMessages = [...userMessages, ...messages];

  const handleRetry = useCallback((messageId: string) => {
    const msg = allMessages.find((m) => m.id === messageId);
    if (!msg) return;
    const prompt = msg.blocks.find((b) => b.kind === 'text')?.content;
    if (prompt) handleSend(prompt, selectedAgentId);
  }, [allMessages, handleSend, selectedAgentId]);

  const handleDelete = useCallback((messageId: string) => {
    setUserMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  // Scroll to a message when SearchDialog selects one
  useEffect(() => {
    if (!scrollToMessageId) return;
    const idx = allMessages.findIndex((m) => m.id === scrollToMessageId);
    if (idx < 0) return;
    const log = chatContainerRef.current?.querySelector('[role="log"]');
    if (log && log.children[idx]) {
      (log.children[idx] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setScrollToMessageId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToMessageId]);

  return (
    <div className={styles.root}>
      <Slot
        name="status-bar"
        online={online}
        health={health}
        isConnected={isConnected}
        error={edgeStatus.lastError}
        wsLatency={wsLatency}
        hubAuthenticated={hubAuthenticated}
      />

      {edgeStatus.showBanner && (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerIcon} aria-hidden="true">&#9888;</span>
          <span className={styles.bannerMsg}>
            {edgeStatus.lastError ?? t('banner.disconnected')}
          </span>
          <span className={styles.bannerActions}>
            <button
              className={styles.bannerBtn}
              onClick={edgeStatus.retry}
              disabled={edgeStatus.retrying}
            >
              {edgeStatus.retrying ? '...' : t('banner.retry')}
            </button>
            <button
              className={styles.bannerBtn}
              onClick={edgeStatus.dismissBanner}
            >
              {t('banner.dismiss')}
            </button>
          </span>
        </div>
      )}

      {/* Mobile/Tablet header bar with toggles */}
      {(isMobile || isTablet) && (
        <div className={styles.mobileToolbar}>
          {isMobile && (
            <button
              className={styles.mobileToggle}
              onClick={() => { setMobileSidebarOpen((v) => !v); setMobileRunDetailOpen(false); }}
              aria-label={mobileSidebarOpen ? t('nav.closeSidebar') : t('nav.openSidebar')}
              aria-expanded={mobileSidebarOpen}
            >
              {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
          {isTablet && (
            <button
              className={styles.mobileToggle}
              onClick={() => { setTabletAgentOpen((v) => !v); setMobileRunDetailOpen(false); }}
              aria-label={tabletAgentOpen ? t('agent.close') : t('agent.open')}
              aria-expanded={tabletAgentOpen}
            >
              {tabletAgentOpen ? <X size={20} /> : <Bot size={20} />}
            </button>
          )}
          <span className={styles.mobileTitle}>
            {selectedThread?.title ?? 'AgentHub'}
          </span>
          <button
            className={styles.mobileToggle}
            onClick={() => { setMobileRunDetailOpen((v) => !v); setMobileSidebarOpen(false); setTabletAgentOpen(false); }}
            aria-label={mobileRunDetailOpen ? t('run.close') : t('run.open')}
            aria-expanded={mobileRunDetailOpen}
          >
            {mobileRunDetailOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
          </button>
        </div>
      )}

      <div className={styles.body}>
        {/* Sidebar overlay backdrop */}
        {mobileSidebarOpen && (
          <div
            className={styles.overlay}
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Right panel overlay backdrop */}
        {mobileRunDetailOpen && (
          <div
            className={styles.overlay}
            onClick={() => setMobileRunDetailOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Agent panel overlay backdrop (tablet) */}
        {tabletAgentOpen && (
          <div
            className={styles.overlay}
            onClick={() => setTabletAgentOpen(false)}
            aria-hidden="true"
          />
        )}

        <div
          className={`${styles.sidebarWrapper} ${mobileSidebarOpen ? styles.sidebarOpen : ''}`}
          style={isMobile ? undefined : { width: sidebarWidth, flexShrink: 0 }}
        >
          <Slot
            name="thread-panel"
            online={online}
            selectedId={selectedThreadId ?? undefined}
            onSelect={handleSelectThread}
          />
        </div>

        {/* Agent panel overlay (tablet) — slides in from left */}
        <div
          className={`${styles.agentOverlayWrapper} ${tabletAgentOpen ? styles.agentOverlayOpen : ''}`}
        >
          {agents.length === 0 && online ? (
            <AgentListSkeleton />
          ) : (
            <Slot
              name="agent-list"
              agents={agents}
              online={online}
              selectedId={selectedAgentId}
              onSelect={handleSelectAgent}
            />
          )}
        </div>

        {!isMobile && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />}

        <div className={styles.center}>
          {!isMobile && !isTablet && (
            <div className={styles.centerSidebar}>
              {agents.length === 0 && online ? (
                <AgentListSkeleton />
              ) : (
                <Slot
                  name="agent-list"
                  agents={agents}
                  online={online}
                  selectedId={selectedAgentId}
                  onSelect={handleSelectAgent}
                />
              )}
            </div>
          )}

          <div ref={chatContainerRef} className={styles.chatWrapper}>
            <Slot
              name="main-view"
              messages={messages}
              allMessages={allMessages}
              threadsCount={threads.length}
              isStreaming={isStreaming}
              isConnected={isConnected}
              onRetry={handleRetry}
              onDelete={handleDelete}
              onSendMessage={handleSend}
            />
          </div>
        </div>

        {!isMobile && <ResizeHandle direction="horizontal" onResize={handleRightResize} />}

        <div
          className={`${styles.rightPanelWrapper} ${mobileRunDetailOpen ? styles.rightPanelOpen : ''}`}
          style={isMobile ? undefined : { width: rightPanelWidth, flexShrink: 0 }}
        >
          <ErrorBoundary>
            <Suspense
              fallback={
                <div style={{ padding: '16px', color: 'var(--foreground)' }}>
                  <SkeletonLine width="60%" height="1em" />
                  <SkeletonLine width="40%" height="1em" />
                </div>
              }
            >
              <Slot
                name="run-detail"
                run={
                  currentRun
                    ? {
                        runId: currentRun.runId,
                        projectId: '',
                        threadId: selectedThread?.threadId ?? '',
                        status: currentRun.status,
                      }
                    : null
                }
                toolCalls={currentRun?.toolCalls ?? []}
                changedFiles={currentRun?.changedFiles ?? []}
                outputText={currentRun?.outputText ?? ''}
                chatMessages={allMessages}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      <Slot
        name="prompt-input"
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onSend={handleSend}
        isStreaming={isStreaming}
        onCancel={handleCancel}
        disabled={!online}
        threadId={selectedThreadId ?? undefined}
      />
      <Suspense fallback={null}>
        <Slot name="search-dialog" messages={allMessages} onSelect={handleSearchSelect} />
      </Suspense>
      <Slot name="permission-dialog" requests={permissionRequests} onDecide={handleDecidePermission} />
      <Slot name="shortcut-help" open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  );
}
