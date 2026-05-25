import {
  LogIn,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Sun,
  User,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentList } from '@/api/agentQueries';
import { useThreads } from '@/api/threadQueries';
import { createHubClient } from '@/api/hubClient';
import { useTheme } from '@/contexts/ThemeContext';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import { useThreadStore } from '@/stores/threadStore';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubMainChat } from '@/hooks/useHubMainChat';
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery';
import { useHealth } from '@/hooks/useHealth';
import { useHubWSConnection } from '@/hooks/useHubWSConnection';
import { HUB_EVENTS } from '@shared/hubEvents';
import { AppError } from '@shared/errors';
import type { AgentInfo, RunInfo } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { newClientMessageId, type HubThreadInfo } from '@/utils/hubAdapters';
import { Slot } from '@/views/viewRegistry';
import AuthPage from '@/components/AuthPage';
import ErrorBoundary from '@/components/ErrorBoundary';
import SettingsPage from '@/components/SettingsPage';
import { ToastContainer } from '@/components/Toast';
import styles from './WebLayout.module.css';

type MainSurface = 'workspace' | 'messages' | 'settings';

function resolveHubAgentType(agent?: AgentInfo): string {
  const key = `${agent?.id ?? ''} ${agent?.name ?? ''}`.toLowerCase();
  if (key.includes('claude')) return 'claude';
  if (key.includes('codex') || key.includes('gpt')) return 'codex';
  if (key.includes('opencode')) return 'opencode';
  return 'codex';
}

function isAgentMissing(error: unknown): boolean {
  return error instanceof AppError && error.code === 'AGENT_NOT_FOUND';
}

function messageText(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === 'agent')
    .flatMap((message) => message.blocks)
    .filter((block) => block.kind === 'text' || block.kind === 'code')
    .map((block) => block.content)
    .join('\n\n');
}

export default function WebLayout() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { online, health } = useHealth();
  const hubRealtime = useHubWSConnection();
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const { theme, toggleTheme } = useTheme();
  const sidebarCollapsed = useUIStore((s) => s.leftSidebarCollapsed);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen);
  const mobileRightPanelOpen = useUIStore((s) => s.mobileRightPanelOpen);
  const setLeftSidebarCollapsed = useUIStore((s) => s.setLeftSidebarCollapsed);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const setMobileRightPanelOpen = useUIStore((s) => s.setMobileRightPanelOpen);
  const setOnline = useConnectionStore((s) => s.setOnline);
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const username = useHubStore((s) => s.username);
  const showAuthModal = useHubStore((s) => s.showAuthModal);
  const setAuthenticated = useHubStore((s) => s.setAuthenticated);
  const setShowAuthModal = useHubStore((s) => s.setShowAuthModal);
  const addToast = useToastStore((s) => s.addToast);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const selectedAgentId = useThreadStore((s) => s.selectedAgentId);
  const selectThread = useThreadStore((s) => s.selectThread);
  const selectAgentThread = useThreadStore((s) => s.selectAgentThread);
  const { data: agentData } = useAgentList(true);
  const { data: threadData } = useThreads();
  const [optimisticRun, setOptimisticRun] = useState<(RunInfo & { outputText: string; toolCalls: []; changedFiles: [] }) | null>(null);
  const [runStartPending, setRunStartPending] = useState(false);
  const [mainSurface, setMainSurface] = useState<MainSurface>('workspace');
  const agents = agentData?.items ?? [];
  const threads = threadData?.items ?? [];
  const activeAgentId = selectedAgentId ?? agents[0]?.id;
  const selectedThread = (threads.find((thread) => thread.threadId === selectedThreadId) ?? null) as HubThreadInfo | null;
  const selectedAgent = agents.find((agent) => agent.id === activeAgentId);
  const {
    messages: hubMessages,
    appendOptimistic,
    removeMessage,
    refreshMessages,
  } = useHubMainChat({
    sessionId: selectedThreadId,
    authenticated: hubAuthenticated,
    hubWS: hubRealtime.hubWS,
  });
  const outputText = useMemo(() => messageText(hubMessages), [hubMessages]);

  useEffect(() => {
    setOnline(online, health);
  }, [health, online, setOnline]);

  const createWorkspaceThread = useCallback(async (): Promise<HubThreadInfo> => {
    const title = t('thread.defaultTitle');
    const created = await hubClient.createGroupSession({ name: title, member_ids: [] });
    const now = new Date().toISOString();
    const thread: HubThreadInfo = {
      threadId: created.session_id,
      projectId: 'hub',
      title,
      status: created.type,
      sessionType: created.type,
      createdAt: now,
      updatedAt: now,
    };
    selectThread(thread.threadId);
    await queryClient.invalidateQueries({ queryKey: ['threads'] });
    return thread;
  }, [hubClient, queryClient, selectThread, t]);

  const handleSelectThread = useCallback(
    (thread: { threadId: string }) => {
      selectThread(thread.threadId);
    },
    [selectThread],
  );

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      const existing = useThreadStore.getState().agentThreadMap[agentId];
      if (existing) {
        selectAgentThread(agentId, existing);
        return;
      }

      if (!hubAuthenticated || !getAccessToken()) {
        setShowAuthModal(true);
        addToast({ type: 'error', message: t('webChat.signInRequired') });
        return;
      }

      let groupThread =
        selectedThread?.sessionType === 'group'
          ? selectedThread
          : (threads as HubThreadInfo[]).find((thread) => thread.sessionType === 'group');
      if (!groupThread) {
        groupThread = await createWorkspaceThread();
      }
      selectAgentThread(agentId, groupThread.threadId);
    },
    [addToast, createWorkspaceThread, hubAuthenticated, selectAgentThread, selectedThread, setShowAuthModal, t, threads],
  );

  const handleSend = useCallback(
    async (prompt: string, agentId?: string, _opts?: { model?: string; reasoningEffort?: string }) => {
      if (!prompt.trim() || runStartPending) return false;
      if (!hubAuthenticated || !getAccessToken()) {
        setShowAuthModal(true);
        addToast({ type: 'error', message: t('webChat.signInRequired') });
        return false;
      }
      let targetThread = selectedThread;
      if (!targetThread) {
        targetThread = await createWorkspaceThread();
      }
      if (targetThread.sessionType !== 'group') {
        addToast({ type: 'error', message: t('webChat.groupSessionRequired') });
        return false;
      }

      const now = new Date().toISOString();
      const messageId = newClientMessageId();
      const resolvedAgent = agents.find((agent) => agent.id === (agentId ?? activeAgentId)) ?? selectedAgent;
      setRunStartPending(true);
      appendOptimistic({
        id: messageId,
        role: 'user',
        timestamp: now,
        agentName: resolvedAgent?.name,
        blocks: [{ kind: 'text', content: prompt.trim() }],
      });

      let messagePersisted = false;
      try {
        const sent = await hubClient.sendMessage(targetThread.threadId, {
          client_msg_id: messageId,
          content_type: 'text',
          content: prompt.trim(),
        });
        messagePersisted = true;

        let task;
        try {
          task = await hubClient.triggerAgentTask(sent.message_id);
        } catch (error) {
          if (!isAgentMissing(error)) throw error;
          await hubClient.addAgentToSession(targetThread.threadId, {
            agent_type: resolveHubAgentType(resolvedAgent),
            display_name: resolvedAgent?.name ?? 'Codex',
          });
          task = await hubClient.triggerAgentTask(sent.message_id);
        }

        setOptimisticRun({
          runId: task.id,
          projectId: 'hub',
          threadId: targetThread.threadId,
          status: 'running',
          createdAt: task.created_at ?? now,
          outputText: '',
          toolCalls: [],
          changedFiles: [],
        });
        void refreshMessages().catch(() => {});
        addToast({ type: 'success', message: t('webChat.taskQueued') });
        return true;
      } catch (error) {
        if (!messagePersisted) removeMessage(messageId);
        addToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to start run' });
        return false;
      } finally {
        setRunStartPending(false);
      }
    },
    [
      activeAgentId,
      addToast,
      agents,
      appendOptimistic,
      createWorkspaceThread,
      hubAuthenticated,
      hubClient,
      refreshMessages,
      removeMessage,
      runStartPending,
      selectedAgent,
      selectedThread,
      setShowAuthModal,
      t,
    ],
  );

  const handleCancel = useCallback(async () => {
    if (!optimisticRun) return;
    await hubClient.cancelAgentTask(optimisticRun.runId);
    setOptimisticRun({ ...optimisticRun, status: 'cancelled', finishedAt: new Date().toISOString(), outputText, toolCalls: [], changedFiles: [] });
    addToast({ type: 'info', message: t('webChat.taskCancelled') });
  }, [addToast, hubClient, optimisticRun, outputText, t]);

  useEffect(() => {
    if (!hubRealtime.hubWS) return;
    const updateTask = (status: string, finished = false) => (payload: unknown) => {
      const task = payload as { task_id?: string; session_id?: string; error?: string };
      setOptimisticRun((current) => {
        if (!current || task.task_id !== current.runId) return current;
        return {
          ...current,
          status,
          finishedAt: finished ? new Date().toISOString() : current.finishedAt,
          outputText,
          toolCalls: [],
          changedFiles: [],
        };
      });
      if (task.task_id === optimisticRun?.runId && task.error) {
        addToast({ type: 'error', message: task.error });
      }
    };
    const unsubDone = hubRealtime.hubWS.on(HUB_EVENTS.AGENT_DONE, updateTask('finished', true));
    const unsubFailed = hubRealtime.hubWS.on(HUB_EVENTS.AGENT_FAILED, updateTask('failed', true));
    const unsubCancel = hubRealtime.hubWS.on(HUB_EVENTS.AGENT_CANCEL, updateTask('cancelled', true));
    return () => {
      unsubDone();
      unsubFailed();
      unsubCancel();
    };
  }, [addToast, hubRealtime.hubWS, optimisticRun?.runId, outputText]);

  const shellProps = useMemo(
    () => ({
      agents,
      online,
      health,
      hubWS: hubRealtime.hubWS,
      hubWSStatus: hubRealtime.status,
      hubWSAuthenticated: hubRealtime.authenticated,
      hubAuthenticated,
      isConnected: online,
      isStreaming: runStartPending || optimisticRun?.status === 'queued' || optimisticRun?.status === 'running',
      selectedAgentId: activeAgentId,
      selectedId: selectedThreadId ?? undefined,
      messages: hubMessages,
      allMessages: hubMessages,
      threadsCount: threads.length,
      requests: [],
      run: optimisticRun,
      toolCalls: optimisticRun?.toolCalls ?? [],
      changedFiles: optimisticRun?.changedFiles ?? [],
      outputText,
      onSelectAgent: handleSelectAgent,
      onSelect: handleSelectThread,
      onRetry: () => {
        const lastUserMessage = [...hubMessages].reverse().find((message) => message.role === 'user');
        const text = lastUserMessage?.blocks.find((block) => block.kind === 'text')?.content;
        if (text) void handleSend(text, activeAgentId);
      },
      onDelete: (messageId: string) => {
        removeMessage(messageId);
      },
      onCancel: handleCancel,
      onDecide: () => undefined,
      onSend: handleSend,
      onSendMessage: handleSend,
    }),
    [
      activeAgentId,
      agents,
      handleCancel,
      handleSelectAgent,
      handleSelectThread,
      handleSend,
      health,
      hubAuthenticated,
      hubRealtime.authenticated,
      hubRealtime.hubWS,
      hubRealtime.status,
      online,
      optimisticRun,
      outputText,
      removeMessage,
      runStartPending,
      selectedThreadId,
      threads.length,
      hubMessages,
    ],
  );

  const sidebarOpen = isMobile ? mobileSidebarOpen : true;
  const detailOpen = isMobile ? mobileRightPanelOpen : rightPanelOpen;
  const showDesktopDetail = !isMobile && rightPanelOpen;
  const realtimeLabel = !hubAuthenticated
    ? 'Sign in for realtime'
    : hubRealtime.authenticated
      ? 'Hub WS live'
      : `Hub WS ${hubRealtime.status}`;

  return (
    <ErrorBoundary>
      <div className={styles.root}>
        <header className={styles.topbar}>
          <div className={styles.brandCluster}>
            {isMobile ? (
              <button
                className={styles.iconBtn}
                onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                aria-label={mobileSidebarOpen ? 'Close navigation' : 'Open navigation'}
                type="button"
              >
                {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            ) : (
              <button
                className={styles.iconBtn}
                onClick={() => setLeftSidebarCollapsed(!sidebarCollapsed)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                type="button"
              >
                {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            )}

            <div className={styles.brandMark} aria-hidden="true">
              AH
            </div>
            <div className={styles.brandText}>
              <strong>AgentHub</strong>
              <span>Web workspace</span>
            </div>
          </div>

          <div className={styles.statusCluster}>
            <div className={styles.surfaceTabs} role="tablist" aria-label="Main surface">
              <button
                className={mainSurface === 'workspace' ? styles.surfaceTabActive : styles.surfaceTab}
                onClick={() => setMainSurface('workspace')}
                aria-label="Workspace"
                aria-selected={mainSurface === 'workspace'}
                role="tab"
                type="button"
              >
                <PanelLeftOpen size={15} />
                <span>Workspace</span>
              </button>
              <button
                className={mainSurface === 'messages' ? styles.surfaceTabActive : styles.surfaceTab}
                onClick={() => setMainSurface('messages')}
                aria-label="Messages"
                aria-selected={mainSurface === 'messages'}
                role="tab"
                type="button"
              >
                <MessageSquare size={15} />
                <span>Messages</span>
              </button>
            </div>
            <span className={online ? styles.statusPillOnline : styles.statusPill}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{online ? `Hub REST ${health?.version ?? 'ready'}` : 'Hub path idle'}</span>
            </span>
            <span className={hubRealtime.authenticated ? styles.statusPillOnline : styles.statusPill}>
              {hubRealtime.authenticated ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{realtimeLabel}</span>
            </span>
            <button
              className={styles.accountBtn}
              onClick={() => setShowAuthModal(true)}
              type="button"
            >
              {hubAuthenticated ? <User size={15} /> : <LogIn size={15} />}
              <span>{hubAuthenticated ? username || 'Account' : 'Sign in'}</span>
            </button>
            <button
              className={styles.iconBtn}
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              type="button"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {!isMobile && (
              <button
                className={styles.iconBtn}
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                aria-label={rightPanelOpen ? 'Close run detail' : 'Open run detail'}
                type="button"
              >
                {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            )}
            <button
              className={mainSurface === 'settings' ? styles.iconBtnActive : styles.iconBtn}
              onClick={() => setMainSurface((surface) => (surface === 'settings' ? 'workspace' : 'settings'))}
              aria-label="Settings"
              type="button"
            >
              <Settings size={17} />
            </button>
            {isMobile && (
              <button
                className={styles.iconBtn}
                onClick={() => setMobileRightPanelOpen(!mobileRightPanelOpen)}
                aria-label={mobileRightPanelOpen ? 'Close run detail' : 'Open run detail'}
                type="button"
              >
                {mobileRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            )}
          </div>
        </header>

        <div className={styles.body}>
          {isMobile && sidebarOpen && (
            <button
              className={styles.scrim}
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close navigation overlay"
              type="button"
            />
          )}

          {sidebarOpen && (
            <aside
              className={[
                styles.sidebar,
                isMobile ? styles.sidebarMobile : sidebarCollapsed ? styles.sidebarRail : styles.sidebarExpanded,
              ].join(' ')}
            >
              {sidebarCollapsed && !isMobile ? (
                <div className={styles.rail}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setLeftSidebarCollapsed(false)}
                    aria-label="Expand sidebar"
                    type="button"
                  >
                    <PanelLeftOpen size={18} />
                  </button>
                </div>
              ) : (
                <div className={styles.sidebarContent}>
                  <section className={styles.sidebarSection}>
                    <div className={styles.sectionHeader}>
                      <span>Agents</span>
                    </div>
                    <div className={styles.sidebarScroll}>
                      <Slot name="agent-list" {...shellProps} />
                    </div>
                  </section>
                  <section className={styles.sidebarSection}>
                    <div className={styles.sectionHeader}>
                      <span>Threads</span>
                    </div>
                    <div className={styles.sidebarScroll}>
                      <Slot name="thread-panel" {...shellProps} />
                    </div>
                  </section>
                </div>
              )}
            </aside>
          )}

          <main className={styles.workspace}>
            <div className={styles.workspaceGlass}>
              {mainSurface === 'settings' ? (
                <SettingsPage
                  onBack={() => setMainSurface('workspace')}
                  onOpenAuth={() => setShowAuthModal(true)}
                />
              ) : mainSurface === 'messages' ? (
                <Slot name="im-view" {...shellProps} />
              ) : (
                <>
                  <Slot name="main-view" {...shellProps} />
                  <Slot name="prompt-input" {...shellProps} />
                </>
              )}
            </div>
          </main>

          {showDesktopDetail && (
            <aside className={isTablet ? styles.rightOverlay : styles.rightPanel}>
              <Slot name="run-detail" {...shellProps} />
            </aside>
          )}

          {isMobile && detailOpen && (
            <>
              <button
                className={styles.scrim}
                onClick={() => setMobileRightPanelOpen(false)}
                aria-label="Close run detail overlay"
                type="button"
              />
              <aside className={styles.rightOverlay}>
                <Slot name="run-detail" {...shellProps} />
              </aside>
            </>
          )}
        </div>

        <Slot name="permission-dialog" {...shellProps} />
        <Slot name="shortcut-help" />
        {showAuthModal && (
          <div className={styles.modalLayer}>
            <AuthPage
              onClose={() => setShowAuthModal(false)}
              onLoginSuccess={(user) => {
                setAuthenticated(true, user.id, user.username || user.nickname);
              }}
            />
          </div>
        )}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}
