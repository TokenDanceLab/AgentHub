import {
  Bot,
  FileText,
  FolderKanban,
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
  TerminalSquare,
  Users,
  User,
  Wifi,
  WifiOff,
  Wrench,
  X,
  UserCog,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentList } from '@/api/agentQueries';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import { useThreads } from '@/api/threadQueries';
import { createHubClient, type AgentRunEvent } from '@/api/hubClient';
import { useTheme } from '@/contexts/ThemeContext';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import { useThreadStore } from '@/stores/threadStore';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useHubMainChat } from '@/hooks/useHubMainChat';
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery';
import { useHealth } from '@/hooks/useHealth';
import { useHubWSConnection } from '@/hooks/useHubWSConnection';
import { ActivityCard, ContextSummary, SectionHeader, TokenDanceMark } from '@shared/ui';
import { getSurfaceByWebRoute, getSurfaceMetadata, getSurfaceStatusMetadata, type SurfaceMetadata } from '@shared/surfaceMetadata';
import { HUB_EVENTS } from '@shared/hubEvents';
import { AppError } from '@shared/errors';
import type { AgentInfo, RunInfo } from '@shared/types';
import {
  mergeAgentRunEvents,
  newClientMessageId,
  projectRunDetail,
  projectRunEvents,
  type HubThreadInfo,
} from '@/utils/hubAdapters';
import { Slot } from '@/views/viewRegistry';
import AuthPage from '@/components/AuthPage';
import ErrorBoundary from '@/components/ErrorBoundary';
import { NotificationBell } from '@/components/NotificationBell';
import SettingsPage from '@/components/SettingsPage';
import { ToastContainer } from '@/components/Toast';
import styles from './WebLayout.module.css';

type MainSurface = 'workspace' | 'messages' | 'teamRun' | 'settings';
type WebRunInfo = RunInfo & ReturnType<typeof projectRunDetail>;

interface RouteContext {
  surface: SurfaceMetadata;
  id?: string;
}

const SURFACE_PATHS: Record<MainSurface, string> = {
  workspace: '/',
  messages: '/chats',
  teamRun: '/team',
  settings: '/settings',
};

function surfaceFromPath(pathname: string): MainSurface {
  if (pathname === '/chats' || pathname.startsWith('/chats/')) return 'messages';
  if (pathname === '/team' || pathname.startsWith('/team/')) return 'teamRun';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
  return 'workspace';
}

function routeContextFromPath(pathname: string): RouteContext | null {
  const surface = getSurfaceByWebRoute(pathname);
  if (!surface || surface.id === 'web.workbench' || surface.id === 'web.privateChats') return null;

  const groupMatch = pathname.match(/^\/group\/([^/]+)$/);
  const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
  const routeId = groupMatch?.[1] ?? projectMatch?.[1];

  return routeId
    ? {
        surface,
        id: decodeURIComponent(routeId),
      }
    : { surface };
}

function routeSourceLabelKey(surface: SurfaceMetadata): string {
  if (surface.id === 'web.agentSquare') return 'webShell.route.sources.catalog';
  if (surface.id === 'web.groupWorkspace') return 'webShell.route.sources.group';
  if (surface.id === 'web.projectPreview') return 'webShell.route.sources.project';
  return 'webShell.route.metrics.shell';
}

function resolveHubAgentType(agent?: AgentInfo): string {
  const key = `${agent?.runtimeId ?? ''} ${agent?.id ?? ''} ${agent?.name ?? ''} ${agent?.description ?? ''}`.toLowerCase();
  if (key.includes('claude')) return 'claude-code';
  if (key.includes('codex') || key.includes('gpt')) return 'codex';
  if (key.includes('opencode')) return 'opencode';
  return 'codex';
}

function stringFromRecord(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function resolveHubModelParams(agent?: AgentInfo, opts?: { model?: string; reasoningEffort?: string }): string | undefined {
  const params: Record<string, unknown> = {};
  const model = agent?.model || opts?.model;
  const provider = agent?.provider;
  const reasoningEffort = agent?.reasoningEffort || opts?.reasoningEffort;
  const workDir = stringFromRecord(agent?.targetPreferences, ['work_dir', 'workDir']);
  if (model) params.model = model;
  if (provider) params.provider = provider;
  if (reasoningEffort) params.reasoning_effort = reasoningEffort;
  if (agent?.permissionMode) params.permission_mode = agent.permissionMode;
  if (agent?.toolAllowlist?.length) params.tool_allowlist = agent.toolAllowlist;
  if (workDir) params.work_dir = workDir;
  return Object.keys(params).length > 0 ? JSON.stringify(params) : undefined;
}

function isAgentMissing(error: unknown): boolean {
  return error instanceof AppError && error.code === 'AGENT_NOT_FOUND';
}

export default function WebLayout() {
  const { t } = useTranslation();
  const { tryAutoLogin } = useAuth();
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
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const recoveryState = useConnectionStore((s) => s.recoveryState);
  const recoveryError = useConnectionStore((s) => s.recoveryError);
  const setRecoveryState = useConnectionStore((s) => s.setRecoveryState);
  const setRecoveryError = useConnectionStore((s) => s.setRecoveryError);
  const setLastEventSeq = useConnectionStore((s) => s.setLastEventSeq);
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
  const [optimisticRun, setOptimisticRun] = useState<WebRunInfo | null>(null);
  const [taskRunEvents, setTaskRunEvents] = useState<AgentRunEvent[]>([]);
  const [runStartPending, setRunStartPending] = useState(false);
  const [selectedExecutionTargetId, setSelectedExecutionTargetId] = useState('');
  const [mainSurface, setMainSurface] = useState<MainSurface>('workspace');
  const agents = agentData?.items ?? [];
  const threads = threadData?.items ?? [];
  const executionTargetsQuery = useHubExecutionTargets({ enabled: hubAuthenticated });
  const executionTargets = executionTargetsQuery.data?.items ?? [];
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
  const chatRunDetail = useMemo(() => projectRunDetail(hubMessages), [hubMessages]);
  const eventRunDetail = useMemo(() => projectRunEvents(taskRunEvents), [taskRunEvents]);
  const runDetail = taskRunEvents.length > 0 ? eventRunDetail : chatRunDetail;
  const { outputText, toolCalls, changedFiles } = runDetail;
  const hasProjectedRunDetail = outputText.length > 0 || toolCalls.length > 0 || changedFiles.length > 0;
  const projectedRun = hasProjectedRunDetail
    ? {
        runId: selectedThreadId ?? 'hub-thread',
        projectId: selectedThread?.projectId ?? 'hub',
        threadId: selectedThreadId ?? selectedThread?.threadId ?? 'hub-thread',
        status: 'finished',
      }
    : null;

  useEffect(() => {
    let cancelled = false;
    void tryAutoLogin()
      .then((authenticated) => {
        if (authenticated && !cancelled) {
          void queryClient.refetchQueries({ queryKey: ['threads'] });
          void queryClient.refetchQueries({ queryKey: ['agents'] });
        }
      })
      .catch(() => {
        /* Auth surfaces handle explicit login errors. */
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, tryAutoLogin]);

  useEffect(() => {
    setOnline(online, health);
  }, [health, online, setOnline]);

  useEffect(() => {
    if (selectedThreadId || threads.length === 0) return;
    const firstThread = threads[0];
    if (firstThread?.threadId) {
      selectThread(firstThread.threadId);
    }
  }, [selectThread, selectedThreadId, threads]);

  useEffect(() => {
    const syncSurfaceFromPath = () => {
      setMainSurface(surfaceFromPath(window.location.pathname));
      setRouteContext(routeContextFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', syncSurfaceFromPath);
    return () => window.removeEventListener('popstate', syncSurfaceFromPath);
  }, []);

  // Track last event seq cursor for stream recovery
  useEffect(() => {
    const taskId = optimisticRun?.runId;
    if (!taskId || taskRunEvents.length === 0) return;
    let maxSeq = 0;
    for (const event of taskRunEvents) {
      if (event.event_seq != null && event.event_seq > maxSeq) {
        maxSeq = event.event_seq;
      }
    }
    if (maxSeq > 0) {
      setLastEventSeq(taskId, maxSeq);
    }
  }, [optimisticRun?.runId, setLastEventSeq, taskRunEvents]);

  // Stream recovery on WebSocket reconnection
  useEffect(() => {
    const taskId = optimisticRun?.runId;

    // Detect reconnection via the justReconnected flag from useHubWSConnection
    if (hubRealtime.justReconnected && taskId && !recoveryInProgressRef.current) {
      recoveryInProgressRef.current = true;
      setRecoveryState('recovering');
      setRecoveryError(null);

      hubClient.listTaskRunEvents(taskId)
        .then((recovered) => {
          // Merge recovered events with existing ones (mergeAgentRunEvents deduplicates by key)
          setTaskRunEvents((current) => mergeAgentRunEvents(current, recovered));
          setRecoveryState('idle');
          recoveryInProgressRef.current = false;
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Failed to recover stream events';
          setRecoveryError(message);
          setRecoveryState('failed');
          recoveryInProgressRef.current = false;
        });
    }

    // Reset when connection is lost
    const isConnected = hubRealtime.authenticated && hubRealtime.status === 'connected';
    if (!isConnected) {
      recoveryInProgressRef.current = false;
    }
  }, [hubRealtime.justReconnected, hubRealtime.authenticated, hubRealtime.status, optimisticRun?.runId, hubClient, setRecoveryState, setRecoveryError]);

  // Clear recovery state when optimisticRun changes (new task started)
  useEffect(() => {
    if (!optimisticRun?.runId) {
      setRecoveryState('idle');
      setRecoveryError(null);
      recoveryInProgressRef.current = false;
    }
  }, [optimisticRun?.runId, setRecoveryState, setRecoveryError]);

  const selectMainSurface = useCallback((surface: MainSurface) => {
    setMainSurface(surface);
    setRouteContext(null);

    if (typeof window === 'undefined') return;
    const nextPath = SURFACE_PATHS[surface];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
  }, []);

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

  useEffect(() => {
    if (executionTargets.length === 0) {
      if (selectedExecutionTargetId) setSelectedExecutionTargetId('');
      return;
    }
    const current = executionTargets.find((target) => target.id === selectedExecutionTargetId);
    if (current && (current.target_type === 'local_edge' || current.target_type === 'hub_relay')) return;
    const preferred =
      executionTargets.find((target) => (target.target_type === 'local_edge' || target.target_type === 'hub_relay') && target.is_online) ??
      executionTargets.find((target) => target.target_type === 'local_edge' || target.target_type === 'hub_relay');
    setSelectedExecutionTargetId(preferred?.id ?? '');
  }, [executionTargets, selectedExecutionTargetId]);

  const handleSend = useCallback(
    async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string; targetId?: string }) => {
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
      const agentType = resolveHubAgentType(resolvedAgent);
      const modelParams = resolveHubModelParams(resolvedAgent, opts);
      const triggerOptions = {
        agent_type: agentType,
        ...(modelParams ? { model_params: modelParams } : {}),
        ...(opts?.targetId ? { target_id: opts.targetId } : {}),
      };
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
          task = await hubClient.triggerAgentTask(sent.message_id, triggerOptions);
        } catch (error) {
          if (!isAgentMissing(error)) throw error;
          await hubClient.addAgentToSession(targetThread.threadId, {
            agent_type: agentType,
            display_name: resolvedAgent?.name ?? 'Codex',
          });
          task = await hubClient.triggerAgentTask(sent.message_id, triggerOptions);
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
        setTaskRunEvents([]);
        void refreshMessages().catch(() => {});
        addToast({ type: 'success', message: t('webChat.taskQueued') });
        return true;
      } catch (error) {
        if (!messagePersisted) removeMessage(messageId);
        addToast({ type: 'error', message: error instanceof Error ? error.message : t('webChat.startFailed') });
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

  useEffect(() => {
    const taskId = optimisticRun?.runId;
    if (!taskId || !hubAuthenticated || !getAccessToken()) {
      setTaskRunEvents([]);
      return;
    }

    let cancelled = false;
    void hubClient.listTaskRunEvents(taskId)
      .then((events) => {
        if (!cancelled) {
          setTaskRunEvents((current) => mergeAgentRunEvents(current, events));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [hubAuthenticated, hubClient, optimisticRun?.runId]);

  useEffect(() => {
    const taskId = optimisticRun?.runId;
    if (!hubRealtime.hubWS || !taskId) return;
    const unsub = hubRealtime.hubWS.on(HUB_EVENTS.AGENT_STREAM, (payload: unknown) => {
      const event = payload as AgentRunEvent | null;
      if (!event || event.task_id !== taskId) return;
      setTaskRunEvents((current) => mergeAgentRunEvents(current, [event]));
    });
    return unsub;
  }, [hubRealtime.hubWS, optimisticRun?.runId]);

  const handleCancel = useCallback(async () => {
    if (!optimisticRun) return;
    await hubClient.cancelAgentTask(optimisticRun.runId);
    setOptimisticRun({ ...optimisticRun, status: 'cancelled', finishedAt: new Date().toISOString(), outputText, toolCalls, changedFiles });
    addToast({ type: 'info', message: t('webChat.taskCancelled') });
  }, [addToast, changedFiles, hubClient, optimisticRun, outputText, t, toolCalls]);

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
          toolCalls,
          changedFiles,
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
  }, [addToast, changedFiles, hubRealtime.hubWS, optimisticRun?.runId, outputText, toolCalls]);

  const shellProps = useMemo(
    () => ({
      agents,
      online,
      health,
      hubWS: hubRealtime.hubWS,
      hubWSStatus: hubRealtime.status,
      hubWSAuthenticated: hubRealtime.authenticated,
      hubReconnecting: reconnecting,
      hubRecoveryState: recoveryState,
      hubRecoveryError: recoveryError,
      hubAuthenticated,
      isConnected: online,
      isStreaming: runStartPending || optimisticRun?.status === 'queued' || optimisticRun?.status === 'running',
      executionTargets,
      selectedTargetId: selectedExecutionTargetId,
      selectedAgentId: activeAgentId,
      selectedId: selectedThreadId ?? undefined,
      messages: hubMessages,
      allMessages: hubMessages,
      threadsCount: threads.length,
      requests: [],
      run: optimisticRun ?? projectedRun,
      toolCalls,
      changedFiles,
      outputText,
      chatMessages: hubMessages,
      onSelectAgent: handleSelectAgent,
      onSelect: handleSelectThread,
      onSelectTarget: setSelectedExecutionTargetId,
      onRetry: () => {
        const lastUserMessage = [...hubMessages].reverse().find((message) => message.role === 'user');
        const text = lastUserMessage?.blocks.find((block) => block.kind === 'text')?.content;
        if (text) void handleSend(text, activeAgentId, selectedExecutionTargetId ? { targetId: selectedExecutionTargetId } : undefined);
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
      executionTargets,
      handleCancel,
      handleSelectAgent,
      handleSelectThread,
      handleSend,
      health,
      hubAuthenticated,
      hubRealtime.authenticated,
      hubRealtime.hubWS,
      hubRealtime.status,
      reconnecting,
      recoveryState,
      recoveryError,
      online,
      optimisticRun,
      projectedRun,
      outputText,
      toolCalls,
      changedFiles,
      removeMessage,
      runStartPending,
      selectedExecutionTargetId,
      selectedThreadId,
      threads.length,
      hubMessages,
    ],
  );

  const runDetailFallback = (
    <div className={styles.runDetailFallback} role="region" aria-label={t('run.title')}>
      <div className={styles.runDetailFallbackTitle}>{t('run.title')}</div>
      <div className={styles.runDetailFallbackStack}>
        <ActivityCard
          className={styles.runDetailFallbackCard}
          icon={<TerminalSquare size={16} />}
          iconClassName={styles.runDetailFallbackIcon}
          bodyClassName={styles.runDetailFallbackBody}
          label={t('run.empty')}
        />
        <ActivityCard
          className={styles.runDetailFallbackCard}
          icon={<FileText size={16} />}
          iconClassName={styles.runDetailFallbackIcon}
          bodyClassName={styles.runDetailFallbackBody}
          label={t('run.emptyOutput')}
        />
        <ActivityCard
          className={styles.runDetailFallbackCard}
          icon={<Wrench size={16} />}
          iconClassName={styles.runDetailFallbackIcon}
          bodyClassName={styles.runDetailFallbackBody}
          label={t('run.emptySources')}
        />
      </div>
    </div>
  );

  const sidebarOpen = isMobile ? mobileSidebarOpen : true;
  const detailOpen = isMobile ? mobileRightPanelOpen : rightPanelOpen;
  const showDesktopDetail = !isMobile && rightPanelOpen;
  const realtimeLabel = !hubAuthenticated
    ? t('webShell.status.realtimeSignIn')
    : recoveryState === 'recovering'
      ? t('status.reconnecting')
      : recoveryState === 'failed'
        ? t('webChat.recoveryFailed')
        : reconnecting
          ? t('status.reconnecting')
          : hubRealtime.authenticated
            ? t('webShell.status.realtimeLive')
            : t('webShell.status.realtimeState', { state: hubRealtime.status });
  const routeContextIcon =
    routeContext?.surface.id === 'web.agentSquare'
      ? <Bot size={16} />
      : routeContext?.surface.id === 'web.groupWorkspace'
        ? <Users size={16} />
        : <FolderKanban size={16} />;
  const routeContextStatus = routeContext ? getSurfaceStatusMetadata(routeContext.surface.defaultStatus) : null;
  const mobileAccountSurface = getSurfaceMetadata('mobile.account');
  const mobileAccountLabel = t(mobileAccountSurface.labelKey);
  const mobileAccountDescription = t(mobileAccountSurface.descriptionKey);

  return (
    <ErrorBoundary>
      <div className={styles.root}>
        <header className={styles.topbar}>
          <div className={styles.brandCluster}>
            {isMobile ? (
              <button
                className={styles.iconBtn}
                onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                aria-label={mobileSidebarOpen ? t('webShell.nav.close') : t('webShell.nav.open')}
                type="button"
              >
                {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            ) : (
              <button
                className={styles.iconBtn}
                onClick={() => setLeftSidebarCollapsed(!sidebarCollapsed)}
                aria-label={sidebarCollapsed ? t('webShell.nav.expand') : t('webShell.nav.collapse')}
                type="button"
              >
                {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            )}

            <TokenDanceMark className={styles.brandMark} alt="" aria-hidden="true" />
            <div className={styles.brandText}>
              <strong>AgentHub</strong>
              <span>{t('webShell.brand.subtitle')}</span>
            </div>
          </div>

          <div className={styles.statusCluster}>
            <div className={styles.surfaceTabs} role="tablist" aria-label={t('webShell.surface.aria')}>
              <button
                className={mainSurface === 'workspace' ? styles.surfaceTabActive : styles.surfaceTab}
                onClick={() => selectMainSurface('workspace')}
                aria-label={t('webShell.surface.workspace')}
                aria-selected={mainSurface === 'workspace'}
                role="tab"
                type="button"
              >
                <PanelLeftOpen size={15} />
                <span>{t('webShell.surface.workspace')}</span>
              </button>
              <button
                className={mainSurface === 'messages' ? styles.surfaceTabActive : styles.surfaceTab}
                onClick={() => selectMainSurface('messages')}
                aria-label={t('webShell.surface.messages')}
                aria-selected={mainSurface === 'messages'}
                role="tab"
                type="button"
              >
                <MessageSquare size={15} />
                <span>{t('webShell.surface.messages')}</span>
              </button>
              <button
                className={mainSurface === 'teamRun' ? styles.surfaceTabActive : styles.surfaceTab}
                onClick={() => selectMainSurface('teamRun')}
                aria-label={t('view.teamRun', 'TeamRun')}
                aria-selected={mainSurface === 'teamRun'}
                role="tab"
                type="button"
              >
                <UserCog size={15} />
                <span>{t('view.teamRun', 'TeamRun')}</span>
              </button>
            </div>
            <span className={online ? styles.statusPillOnline : styles.statusPill}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>
                {online
                  ? t('webShell.status.restReady', { version: health?.version ?? t('webShell.status.ready') })
                  : t('webShell.status.restIdle')}
              </span>
            </span>
            <span className={
              recoveryState === 'failed' ? styles.statusPillError :
              recoveryState === 'recovering' || reconnecting ? styles.statusPillReconnecting :
              hubRealtime.authenticated ? styles.statusPillOnline : styles.statusPill
            }>
              {hubRealtime.authenticated ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{realtimeLabel}</span>
            </span>
            <span className={styles.notificationSlot}>
              <NotificationBell />
            </span>
            <button
              className={styles.accountBtn}
              onClick={() => setShowAuthModal(true)}
              type="button"
            >
              {hubAuthenticated ? <User size={15} /> : <LogIn size={15} />}
              <span>{hubAuthenticated ? username || t('webShell.account.account') : t('webShell.account.signIn')}</span>
            </button>
            <button
              className={styles.iconBtn}
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
              type="button"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {!isMobile && (
              <button
                className={styles.iconBtn}
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                aria-label={rightPanelOpen ? t('webShell.runDetail.close') : t('webShell.runDetail.open')}
                type="button"
              >
                {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            )}
            <button
              className={mainSurface === 'settings' ? styles.iconBtnActive : styles.iconBtn}
              onClick={() => selectMainSurface(mainSurface === 'settings' ? 'workspace' : 'settings')}
              aria-label={t('settings.open')}
              type="button"
            >
              <Settings size={17} />
            </button>
            {isMobile && (
              <button
                className={styles.iconBtn}
                onClick={() => setMobileRightPanelOpen(!mobileRightPanelOpen)}
                aria-label={mobileRightPanelOpen ? t('webShell.runDetail.close') : t('webShell.runDetail.open')}
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
              aria-label={t('webShell.nav.closeOverlay')}
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
                    aria-label={t('webShell.nav.expand')}
                    type="button"
                  >
                    <PanelLeftOpen size={18} />
                  </button>
                </div>
              ) : (
                <div className={styles.sidebarContent}>
                  <section className={styles.sidebarSection}>
                    <SectionHeader
                      className={styles.sectionHeader ?? ''}
                      titleClassName={styles.sectionHeaderTitle ?? ''}
                      title={t('webShell.sidebar.agents')}
                    />
                    <div className={styles.sidebarScroll}>
                      <Slot name="agent-list" {...shellProps} />
                    </div>
                  </section>
                  <section className={styles.sidebarSection}>
                    <SectionHeader
                      className={styles.sectionHeader ?? ''}
                      titleClassName={styles.sectionHeaderTitle ?? ''}
                      title={t('webShell.sidebar.threads')}
                    />
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
                  onBack={() => selectMainSurface('workspace')}
                  onOpenAuth={() => setShowAuthModal(true)}
                />
              ) : mainSurface === 'messages' ? (
                <Slot name="im-view" {...shellProps} />
              ) : mainSurface === 'teamRun' ? (
                <Slot name="team-run-console" {...shellProps} />
              ) : (
                <>
                  {routeContext && (
                    <ContextSummary
                      className={styles.routeContextPanel}
                      headerClassName={styles.routeContextHeader}
                      iconClassName={styles.routeContextIcon}
                      eyebrowClassName={styles.routeEyebrow}
                      titleClassName={styles.routeContextTitle}
                      descriptionClassName={styles.routeContextCopy}
                      listClassName={styles.routeContextGrid}
                      itemClassName={styles.routeMetric}
                      valueClassName={styles.routeMetricValue}
                      labelClassName={styles.routeMetricLabel}
                      actionsClassName={styles.routeActionRow}
                      ariaLabel={t('webShell.route.aria', { surface: t(routeContext.surface.labelKey) })}
                      icon={routeContextIcon}
                      eyebrow={t('webShell.route.eyebrow')}
                      title={t(routeContext.surface.labelKey)}
                      description={t(routeContext.surface.descriptionKey)}
                      items={[
                        { id: 'agents', value: agents.length, label: t('webShell.route.metrics.agents') },
                        { id: 'threads', value: threads.length, label: t('webShell.route.metrics.threads') },
                        { id: 'source', value: routeContext.id ?? t('webShell.route.metrics.shell'), label: t(routeSourceLabelKey(routeContext.surface)) },
                        ...(routeContextStatus
                          ? [{ id: 'status', value: t(routeContextStatus.labelKey), label: t('webShell.route.sources.status') }]
                          : []),
                        { id: 'registry', value: routeContext.surface.platform, label: t('webShell.route.sources.registry') },
                      ]}
                      actions={(
                        <>
                        <button className={styles.routeAction} type="button" onClick={() => selectMainSurface('messages')}>
                          <MessageSquare size={16} />
                          <span>{t('webShell.route.actions.messages')}</span>
                        </button>
                        <button className={styles.routeAction} type="button" onClick={() => selectMainSurface('settings')}>
                          <Settings size={16} />
                          <span>{t('webShell.route.actions.settings')}</span>
                        </button>
                        </>
                      )}
                    />
                  )}
                  {recoveryState === 'failed' && optimisticRun && (
                    <div className={styles.recoveryBanner}>
                      <span>{t('webChat.recoveryFailed')}</span>
                      <button
                        className={styles.recoveryRetryBtn}
                        type="button"
                        onClick={() => {
                          if (optimisticRun?.runId) {
                            setRecoveryState('recovering');
                            hubClient.listTaskRunEvents(optimisticRun.runId)
                              .then((recovered) => {
                                setTaskRunEvents((current) => mergeAgentRunEvents(current, recovered));
                                setRecoveryState('idle');
                                setRecoveryError(null);
                              })
                              .catch((err) => {
                                setRecoveryError(err instanceof Error ? err.message : 'Recovery failed');
                                setRecoveryState('failed');
                              });
                          }
                        }}
                      >
                        {t('chat.action.retry')}
                      </button>
                    </div>
                  )}
                  <Slot name="main-view" {...shellProps} />
                  <Slot name="prompt-input" {...shellProps} />
                </>
              )}
            </div>
          </main>

          {showDesktopDetail && (
            <aside className={isTablet ? styles.rightOverlay : styles.rightPanel}>
              <Slot name="run-detail" fallback={runDetailFallback} {...shellProps} />
            </aside>
          )}

          {isMobile && detailOpen && (
            <>
              <button
                className={styles.scrim}
                onClick={() => setMobileRightPanelOpen(false)}
                aria-label={t('webShell.runDetail.closeOverlay')}
                type="button"
              />
              <aside className={styles.rightOverlay}>
                <Slot name="run-detail" fallback={runDetailFallback} {...shellProps} />
              </aside>
            </>
          )}
        </div>

        {isMobile && (
          <nav className={styles.mobileSurfaceNav} aria-label={t('webShell.surface.aria')}>
            <button
              className={mainSurface === 'workspace' ? styles.mobileSurfaceNavItemActive : styles.mobileSurfaceNavItem}
              type="button"
              aria-current={mainSurface === 'workspace' ? 'page' : undefined}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRightPanelOpen(false);
                selectMainSurface('workspace');
              }}
            >
              <PanelLeftOpen size={20} />
              <span>{t('webShell.surface.workspace')}</span>
            </button>
            <button
              className={mainSurface === 'messages' ? styles.mobileSurfaceNavItemActive : styles.mobileSurfaceNavItem}
              type="button"
              aria-current={mainSurface === 'messages' ? 'page' : undefined}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRightPanelOpen(false);
                selectMainSurface('messages');
              }}
            >
              <MessageSquare size={20} />
              <span>{t('webShell.surface.messages')}</span>
            </button>
            <button
              className={mainSurface === 'teamRun' ? styles.mobileSurfaceNavItemActive : styles.mobileSurfaceNavItem}
              type="button"
              aria-current={mainSurface === 'teamRun' ? 'page' : undefined}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRightPanelOpen(false);
                selectMainSurface('teamRun');
              }}
            >
              <UserCog size={20} />
              <span>{t('view.teamRun', 'TeamRun')}</span>
            </button>
            <button
              className={detailOpen ? styles.mobileSurfaceNavItemActive : styles.mobileSurfaceNavItem}
              type="button"
              aria-pressed={detailOpen}
              aria-label={detailOpen ? t('webShell.runDetail.close') : t('webShell.runDetail.open')}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRightPanelOpen(!mobileRightPanelOpen);
              }}
            >
              <PanelRightOpen size={20} />
              <span>{t('webShell.surface.runDetail')}</span>
            </button>
            <button
              className={styles.mobileSurfaceNavItem}
              type="button"
              aria-label={`${hubAuthenticated ? username || mobileAccountLabel : mobileAccountLabel}. ${mobileAccountDescription}`}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRightPanelOpen(false);
                setShowAuthModal(true);
              }}
            >
              {hubAuthenticated ? <User size={20} /> : <LogIn size={20} />}
              <span>{hubAuthenticated ? username || mobileAccountLabel : mobileAccountLabel}</span>
            </button>
          </nav>
        )}

        <Slot name="permission-dialog" {...shellProps} />
        <Slot name="search-dialog" {...shellProps} onSelect={() => undefined} />
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
