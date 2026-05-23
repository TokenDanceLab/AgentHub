import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { startRun, cancelRun, fetchAgents, fetchThreads, fetchHealth } from '@/api/edgeClient';
import type { AgentInfo, ThreadInfo, StartRunRequest } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useRunStore } from '@/stores/runStore';
import StatusBar from '@/components/StatusBar';
import ThreadPanel from '@/components/ThreadPanel';
import AgentList from '@/components/AgentList';
import ErrorBoundary from '@/components/ErrorBoundary';
import ResizeHandle from '@/components/ResizeHandle';
import PromptInput from '@/components/PromptInput';
import { SkeletonLine, SkeletonCircle } from '@/components/Skeleton';
import styles from '@/App.module.css';

// ── Lazy-loaded heavy components ──────────────
const ChatView = lazy(() => import('@/components/ChatView'));
const RunDetail = lazy(() => import('@/components/RunDetail'));
const SearchDialog = lazy(() => import('@/components/SearchDialog'));

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 420;
const MIN_RIGHT = 240;
const MAX_RIGHT = 600;

export default function App() {
  const { online, health } = useHealth();
  const { messages, isConnected, currentRun } = useChatMessages(online);
  const { t } = useTranslation();

  // ── Edge disconnected banner state ──
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lastEdgeError, setLastEdgeError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const wasOnlineRef = useRef(false);

  // Zustand stores
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const setOnline = useConnectionStore((s) => s.setOnline);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const setThreads = useThreadStore((s) => s.setThreads);
  const selectThread = useThreadStore((s) => s.selectThread);
  const runStoreSetCurrentRun = useRunStore((s) => s.setCurrentRun);
  const runStoreSetStreaming = useRunStore((s) => s.setIsStreaming);
  const isStreaming = useRunStore((s) => s.isStreaming);
  const runStoreClear = useRunStore((s) => s.clear);

  // Local state (lightweight, not worth a store yet)
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);

  // Search → scroll state
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Sync health hook → connection store
  useEffect(() => {
    setOnline(online, health);
  }, [online, health, setOnline]);

  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  // Banner lifecycle: show when offline after being online; auto-dismiss on reconnect
  useEffect(() => {
    if (online) {
      setBannerDismissed(false);
      setLastEdgeError(null);
    } else if (wasOnlineRef.current) {
      // Transition: online → offline — surface the error
      if (!lastEdgeError) {
        setLastEdgeError(t('banner.disconnected'));
      }
    }
    wasOnlineRef.current = online;
    // Only react to online transitions; lastEdgeError is read inside via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const handleRetryEdge = useCallback(async () => {
    setRetrying(true);
    try {
      await fetchHealth();
      // Success — useHealth will pick it up on its own poll, but give it a moment
    } catch (e) {
      setLastEdgeError(
        e instanceof Error ? e.message : t('banner.disconnected'),
      );
    } finally {
      setRetrying(false);
    }
  }, [t]);

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

  // Poll threads
  useEffect(() => {
    if (!online) {
      setThreads([]);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchThreads();
        if (active) setThreads(res.items);
      } catch {
        /* Edge may not have threads yet */
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [online, setThreads]);

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

  const handleCreateThread = useCallback(async () => {
    try {
      const res = await fetchThreads();
      setThreads(res.items);
    } catch {
      /* ignore */
    }
  }, [setThreads]);

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

  // Stable callbacks for memoized presentational components
  const handleSelectAgent = useCallback((agent: AgentInfo) => {
    setSelectedAgentId(agent.id);
  }, []);

  const handleSelectThread = useCallback(
    (thread: ThreadInfo) => {
      selectThread(thread.threadId);
    },
    [selectThread],
  );

  const allMessages = [...userMessages, ...messages];

  // Scroll to a message when SearchDialog selects one
  useEffect(() => {
    if (!scrollToMessageId) return;
    const idx = allMessages.findIndex((m) => m.id === scrollToMessageId);
    if (idx < 0) return;
    // ChatView renders messages inside [role="log"] in array order
    const log = chatContainerRef.current?.querySelector('[role="log"]');
    if (log && log.children[idx]) {
      (log.children[idx] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setScrollToMessageId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToMessageId]);

  return (
    <div className={styles.root}>
      <StatusBar online={online} health={health} isConnected={isConnected} error={lastEdgeError} />

      {!online && !bannerDismissed && (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerIcon} aria-hidden="true">&#9888;</span>
          <span className={styles.bannerMsg}>
            {lastEdgeError ?? t('banner.disconnected')}
          </span>
          <span className={styles.bannerActions}>
            <button
              className={styles.bannerBtn}
              onClick={handleRetryEdge}
              disabled={retrying}
            >
              {retrying ? '...' : t('banner.retry')}
            </button>
            <button
              className={styles.bannerBtn}
              onClick={() => setBannerDismissed(true)}
            >
              {t('banner.dismiss')}
            </button>
          </span>
        </div>
      )}

      <div className={styles.body}>
        <div style={{ width: sidebarWidth, flexShrink: 0 }}>
          <ThreadPanel
            threads={threads}
            online={online}
            selectedId={selectedThreadId ?? undefined}
            onSelect={handleSelectThread}
            onCreate={handleCreateThread}
          />
        </div>

        <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />

        <div className={styles.center}>
          <div className={styles.centerSidebar}>
            {agents.length === 0 && online ? (
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
            ) : (
              <AgentList
                agents={agents}
                online={online}
                selectedId={selectedAgentId}
                onSelect={handleSelectAgent}
              />
            )}
          </div>

          <div ref={chatContainerRef}>
          <ErrorBoundary>
            {messages.length === 0 && isStreaming ? (
              <div className={styles.skeletonChat} aria-busy="true" aria-label="Generating response">
                <div className={styles.skeletonChatBubble}>
                  <SkeletonLine width="90%" height="14px" />
                  <SkeletonLine width="75%" height="14px" />
                  <SkeletonLine width="60%" height="14px" />
                  <SkeletonLine width="45%" height="14px" />
                </div>
                <div className={styles.skeletonChatBubbleRight}>
                  <SkeletonLine width="80%" height="14px" />
                </div>
                <div className={styles.skeletonChatBubble}>
                  <SkeletonLine width="70%" height="14px" />
                  <SkeletonLine width="55%" height="14px" />
                  <SkeletonLine width="35%" height="14px" />
                </div>
                <div className={styles.skeletonChatBubble}>
                  <SkeletonLine width="85%" height="14px" />
                  <SkeletonLine width="65%" height="14px" />
                </div>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className={styles.skeletonChat} aria-busy="true" aria-label="Loading chat">
                    <div className={styles.skeletonChatBubble}>
                      <SkeletonLine width="90%" height="14px" />
                      <SkeletonLine width="75%" height="14px" />
                      <SkeletonLine width="60%" height="14px" />
                      <SkeletonLine width="45%" height="14px" />
                    </div>
                    <div className={styles.skeletonChatBubbleRight}>
                      <SkeletonLine width="80%" height="14px" />
                    </div>
                    <div className={styles.skeletonChatBubble}>
                      <SkeletonLine width="70%" height="14px" />
                      <SkeletonLine width="55%" height="14px" />
                      <SkeletonLine width="35%" height="14px" />
                    </div>
                  </div>
                }
              >
                <ChatView messages={allMessages} isStreaming={isStreaming} />
              </Suspense>
            )}
          </ErrorBoundary>
          </div>
        </div>

        <ResizeHandle direction="horizontal" onResize={handleRightResize} />

        <div style={{ width: rightPanelWidth, flexShrink: 0 }}>
          <ErrorBoundary>
            <Suspense
              fallback={
                <div style={{ padding: '16px', color: 'var(--foreground)' }}>
                  <SkeletonLine width="60%" height="1em" />
                  <SkeletonLine width="40%" height="1em" />
                </div>
              }
            >
              <RunDetail
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
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      <PromptInput
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onSend={handleSend}
        isStreaming={isStreaming}
        onCancel={handleCancel}
        disabled={!online}
      />
      <Suspense fallback={null}>
        <SearchDialog messages={allMessages} onSelect={handleSearchSelect} />
      </Suspense>
    </div>
  );
}
