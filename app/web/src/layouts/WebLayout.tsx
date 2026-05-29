import {
  Bot,
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
  Users,
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
import { createHubClient, type AgentRunEvent } from '@/api/hubClient';
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
import { ContextSummary, TokenDanceMark } from '@shared/ui';
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
import SettingsPage from '@/components/SettingsPage';
import { ToastContainer } from '@/components/Toast';
import styles from './WebLayout.module.css';

type MainSurface = 'workspace' | 'messages' | 'settings';
type WebRunInfo = RunInfo & ReturnType<typeof projectRunDetail>;

interface RouteContext {
  surface: SurfaceMetadata;
  id?: string;
}

const SURFACE_PATHS: Record<MainSurface, string> = {
  workspace: '/',
  messages: '/chats',
  settings: '/settings',
};

function surfaceFromPath(pathname: string): MainSurface {
  if (pathname === '/chats' || pathname.startsWith('/chats/')) return 'messages';
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
  const [optimisticRun, setOptimisticRun] = useState<WebRunInfo | null>(null);
  const [taskRunEvents, setTaskRunEvents] = useState<AgentRunEvent[]>([]);
  const [runStartPending, setRunStartPending] = useState(false);
  const [mainSurface, setMainSurface] = useState<MainSurface>(() =>
    typeof window === 'undefined' ? 'workspace' : surfaceFromPath(window.location.pathname),
  );
  const [routeContext, setRouteContext] = useState<RouteContext | null>(() =>
    typeof window === 'undefined' ? null : routeContextFromPath(window.location.pathname),
  );
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
  const chatRunDetail = useMemo(() => projectRunDetail(hubMessages), [hubMessages]);
  const eventRunDetail = useMemo(() => projectRunEvents(taskRunEvents), [taskRunEvents]);
  const runDetail = taskRunEvents.length > 0 ? eventRunDetail : chatRunDetail;
  const { outputText, toolCalls, changedFiles } = runDetail;

  useEffect(() => {
    setOnline(online, health);
  }, [health, online, setOnline]);

  useEffect(() => {
    const syncSurfaceFromPath = () => {
      setMainSurface(surfaceFromPath(window.location.pathname));
      setRouteContext(routeContextFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', syncSurfaceFromPath);
    return () => window.removeEventListener('popstate', syncSurfaceFromPath);
  }, []);

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

  const handleSend = useCallback(
    async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string }) => {
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
      toolCalls: optimisticRun ? toolCalls : [],
      changedFiles: optimisticRun ? changedFiles : [],
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
      toolCalls,
      changedFiles,
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
    ? t('webShell.status.realtimeSignIn')
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
            </div>
            <span className={online ? styles.statusPillOnline : styles.statusPill}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>
                {online
                  ? t('webShell.status.restReady', { version: health?.version ?? t('webShell.status.ready') })
                  : t('webShell.status.restIdle')}
              </span>
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
                    <div className={styles.sectionHeader}>
                      <span>{t('webShell.sidebar.agents')}</span>
                    </div>
                    <div className={styles.sidebarScroll}>
                      <Slot name="agent-list" {...shellProps} />
                    </div>
                  </section>
                  <section className={styles.sidebarSection}>
                    <div className={styles.sectionHeader}>
                      <span>{t('webShell.sidebar.threads')}</span>
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
                  onBack={() => selectMainSurface('workspace')}
                  onOpenAuth={() => setShowAuthModal(true)}
                />
              ) : mainSurface === 'messages' ? (
                <Slot name="im-view" {...shellProps} />
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
                aria-label={t('webShell.runDetail.closeOverlay')}
                type="button"
              />
              <aside className={styles.rightOverlay}>
                <Slot name="run-detail" {...shellProps} />
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
