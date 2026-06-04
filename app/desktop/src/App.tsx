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
import { useHubAgentTeams, type AgentTeamOverview } from '@/api/agentTeamQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useModelsDevDisplayNames } from '@/api/modelsDevCatalog';
import { createHubClient } from '@/api/hubClient';
import {
  startRun,
  cancelRun,
  createThread,
  renameThread,
  decidePermission as decidePermissionRest,
} from '@/api/edgeClient';
import { useThreads, useThreadMessages } from '@/api/threadQueries';
import { useRuns } from '@/api/runQueries';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';
import type { ListResponse, StartRunRequest, ThreadInfo } from '@shared/types';
import { AppError } from '@shared/errors';
import type { ChatMessage } from '@/components/ChatView.types';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useUIStore } from '@/stores/uiStore';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { useSearchStore } from '@/stores/searchStore';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import { readCustomInstructions } from '@/utils/customInstructions';
import { buildForkDraft, findRetryPrompt } from '@/utils/messageActions';
import { useShallow } from 'zustand/shallow';
import { SkeletonLine } from '@shared/ui';
import { useToastStore } from '@/stores/toastStore';
import { useHubStore } from '@/stores/hubStore';
import { Slot } from '@/views/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';
import AuthPage from '@/components/AuthPage';
import HomeDashboard from '@/components/HomeDashboard';
import ConnectionStatus from '@/components/ConnectionStatus';
import { ToastContainer } from '@/components/Toast';
import SettingsPage, { type SectionId as SettingsSectionId } from '@/components/SettingsPage';
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
import { resolveTopMenuClickState, type TopMenuId } from '@/utils/topMenuState';
import { buildAutomaticThreadTitle, canAutoRenameThreadTitle, getAutomaticThreadTitle } from '@/utils/threadTitle';
import { getCurrentWindow } from '@tauri-apps/api/window';
import styles from '@/App.module.css';

interface OptimisticRun {
  runId: string;
  status: string;
  outputText: string;
  toolCalls: [];
  changedFiles: [];
}

interface SendRunOptions {
  model?: string;
  provider?: string;
  modelAlias?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  workDir?: string;
  threadId?: string;
  threadInfo?: ThreadInfo;
  createdEmptyThread?: boolean;
}

interface TopMenuItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  action: () => void | Promise<void>;
}

type TopMenuDefinition = Record<TopMenuId, { label: string; items: TopMenuItem[] }>;

const LEFT_SIDEBAR_MIN = 248;
const LEFT_SIDEBAR_MAX = 420;
const RUN_CARD_MIN_WORKSPACE_WIDTH = 760;
const TOP_MENU_ORDER: TopMenuId[] = ['file', 'edit', 'view', 'window', 'help'];
const HIDDEN_MESSAGES_STORAGE_PREFIX = 'agenthub.chat.hiddenMessages.';

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

function focusComposer() {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label], textarea[placeholder]');
  if (!textarea) return;
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => textarea.focus(), 120);
}

function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent('agenthub:set-composer-draft', { detail: { text } }));
}

function hiddenMessagesStorageKey(threadId: string): string {
  return `${HIDDEN_MESSAGES_STORAGE_PREFIX}${threadId}`;
}

function readHiddenMessageIds(threadId: string | null | undefined): Set<string> {
  if (!threadId || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(hiddenMessagesStorageKey(threadId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
  } catch {
    return new Set();
  }
}

function writeHiddenMessageIds(threadId: string | null | undefined, ids: Set<string>): void {
  if (!threadId || typeof window === 'undefined') return;
  try {
    const key = hiddenMessagesStorageKey(threadId);
    if (ids.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // localStorage can be unavailable in restricted browser contexts; in-memory hiding still works.
  }
}

function hideMessages(messages: ChatMessage[], hiddenIds: Set<string>): ChatMessage[] {
  if (hiddenIds.size === 0) return messages;
  return messages.filter((message) => !hiddenIds.has(message.id));
}

function isTeamRunActiveStatus(status: string | undefined): boolean {
  if (!status) return false;
  return [
    'queued',
    'planning',
    'dispatching',
    'running',
    'waiting_for_approval',
    'merging',
  ].includes(status);
}

function isPendingTeamApprovalStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(status.toLowerCase());
}

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

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

const FOCUS_NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function useFocusSourceTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const setPointerSource = () => {
      root.dataset.focusSource = 'pointer';
    };
    const setKeyboardSource = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (FOCUS_NAVIGATION_KEYS.has(event.key)) {
        root.dataset.focusSource = 'keyboard';
      }
    };

    root.dataset.focusSource ||= 'keyboard';
    window.addEventListener('pointerdown', setPointerSource, true);
    window.addEventListener('mousedown', setPointerSource, true);
    window.addEventListener('touchstart', setPointerSource, true);
    window.addEventListener('keydown', setKeyboardSource, true);

    return () => {
      window.removeEventListener('pointerdown', setPointerSource, true);
      window.removeEventListener('mousedown', setPointerSource, true);
      window.removeEventListener('touchstart', setPointerSource, true);
      window.removeEventListener('keydown', setKeyboardSource, true);
    };
  }, []);
}

function DesktopHubTaskBridge() {
  const hubAuth = useAuth();

  useEffect(() => {
    if (!hubAuth.isAuthenticated && !hubAuth.token) {
      void hubAuth.tryAutoLogin();
    }
  }, [hubAuth.isAuthenticated, hubAuth.token, hubAuth.tryAutoLogin]);

  if (!hubAuth.isAuthenticated || !hubAuth.token) {
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
  const pendingCreatedThreadIdsRef = useRef<Set<string>>(new Set());
  const emptyCreatedThreadIdsRef = useRef<Set<string>>(new Set());
  const manuallyNamedThreadIdsRef = useRef<Set<string>>(new Set());
  const silentCreatedThreadToastIdsRef = useRef<Set<string>>(new Set());
  const addThreadToCache = useCallback((thread: ThreadInfo, opts?: { suppressCreatedToast?: boolean; empty?: boolean }) => {
    pendingCreatedThreadIdsRef.current.add(thread.threadId);
    if (opts?.empty) {
      emptyCreatedThreadIdsRef.current.add(thread.threadId);
    }
    if (opts?.suppressCreatedToast) {
      silentCreatedThreadToastIdsRef.current.add(thread.threadId);
    }
    queryClient.setQueriesData<ListResponse<ThreadInfo>>({ queryKey: ['threads'] }, (current) => {
      if (!current) return current;
      if (current.items.some((item) => item.threadId === thread.threadId)) return current;
      return { ...current, items: [thread, ...current.items] };
    });
  }, [queryClient]);
  const updateThreadInCache = useCallback((thread: ThreadInfo) => {
    queryClient.setQueriesData<ListResponse<ThreadInfo>>({ queryKey: ['threads'] }, (current) => {
      if (!current) return current;
      let found = false;
      const items = current.items.map((item) => {
        if (item.threadId !== thread.threadId) return item;
        found = true;
        return { ...item, ...thread };
      });
      return { ...current, items: found ? items : [thread, ...items] };
    });
  }, [queryClient]);
  const setThreadTitleInCache = useCallback((threadId: string, title: string) => {
    queryClient.setQueriesData<ListResponse<ThreadInfo>>({ queryKey: ['threads'] }, (current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((thread) =>
          thread.threadId === threadId ? { ...thread, title } : thread,
        ),
      };
    });
  }, [queryClient]);

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
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => readHiddenMessageIds(activeThreadId));
  const [viewMode, setViewMode] = useState<'agent' | 'im'>('agent');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('general');
  const [pendingComposerDraft, setPendingComposerDraft] = useState('');
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [hoverOpenedTopMenu, setHoverOpenedTopMenu] = useState<TopMenuId | null>(null);
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
  const [rightPanelMounted, setRightPanelMounted] = useState(rightPanelOpen);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const topMenuRef = useRef<HTMLElement | null>(null);
  const hoverOpenedTopMenuRef = useRef<TopMenuId | null>(null);

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
    setHiddenMessageIds(readHiddenMessageIds(activeThreadId));
  }, [activeThreadId]);

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
    if (!openTopMenu) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && topMenuRef.current?.contains(target)) return;
      setOpenTopMenu(null);
      setHoverOpenedTopMenu(null);
      hoverOpenedTopMenuRef.current = null;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenTopMenu(null);
      setHoverOpenedTopMenu(null);
      hoverOpenedTopMenuRef.current = null;
    };

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openTopMenu]);

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

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: SendRunOptions) => {
    if (runStartPending || runIsActive) {
      addToast({ type: 'info', message: t('error.activeRunExists') });
      return false;
    }
    const tempRunId = `starting-${Date.now()}`;
    const tempUserMessageId = `user-${tempRunId}`;
    const initialThreadId = opts?.threadId ?? activeThreadId ?? undefined;
    setRunStartPending(true);
    setUserMessages((prev) => [
      ...prev,
      {
        id: tempUserMessageId,
        role: 'user',
        timestamp: new Date().toISOString(),
        ...(initialThreadId ? { threadId: initialThreadId } : {}),
        blocks: [{ kind: 'text', content: prompt }],
      },
    ]);
    try {
      let requestThreadId = opts?.threadId ?? activeThreadId;
      let requestThread = opts?.threadInfo ?? (requestThreadId ? threads.find((thread) => thread.threadId === requestThreadId) : undefined);
      let createdThreadForPrompt = Boolean(opts?.createdEmptyThread);
      if (!requestThreadId) {
        const agent = agentId ? agents.find((item) => item.id === agentId) : undefined;
        const initialTitle = buildAutomaticThreadTitle(prompt) ?? (agent?.name ? `${agent.name}` : undefined);
        const thread = await createThread(initialTitle);
        addThreadToCache(thread);
        requestThread = thread;
        requestThreadId = thread.threadId;
        createdThreadForPrompt = true;
        if (agentId) {
          useThreadStore.getState().selectAgentThread(agentId, thread.threadId);
        } else {
          selectThread(thread.threadId);
        }
        queryClient.invalidateQueries({ queryKey: ['threads'] });
      }
      const req: StartRunRequest = {
        prompt,
        ...useModelSettingsStore.getState().resolveRunRequestOptions({
          model: opts?.model,
          provider: opts?.provider,
          modelAlias: opts?.modelAlias,
          reasoningEffort: opts?.reasoningEffort,
        }),
      };
      const customInstructions = readCustomInstructions();
      if (customInstructions) req.appendSystemPrompt = customInstructions;
      if (opts?.permissionMode) req.permissionMode = opts.permissionMode;
      if (opts?.workDir) req.workDir = opts.workDir;
      if (agentId) req.agentId = agentId;
      if (requestThreadId) {
        setUserMessages((prev) => prev.map((msg) => (
          msg.id === tempUserMessageId ? { ...msg, threadId: requestThreadId } : msg
        )));
        req.threadId = requestThreadId;
      }
      setOptimisticRun({ runId: tempRunId, status: 'queued', outputText: '', toolCalls: [], changedFiles: [] });
      const started = await startRun(req);
      setOptimisticRun({ ...started, outputText: '', toolCalls: [], changedFiles: [] });
      if (started.threadId) {
        setUserMessages((prev) => prev.map((msg) => (
          msg.id === tempUserMessageId ? { ...msg, threadId: started.threadId } : msg
        )));
      }
      if (started.threadId && started.threadId !== requestThreadId) {
        selectThread(started.threadId);
      }
      const renameThreadId = started.threadId || requestThreadId;
      const runtimeNames = agents.map((item) => item.name);
      const currentThreadItemCount = threadItemData?.items?.length;
      const wasLocallyCreatedEmptyThread = Boolean(renameThreadId && emptyCreatedThreadIdsRef.current.has(renameThreadId));
      const wasManuallyNamedThread = Boolean(renameThreadId && manuallyNamedThreadIdsRef.current.has(renameThreadId));
      const canAutoRenameThread = canAutoRenameThreadTitle({
        createdThreadForPrompt,
        currentThreadItemCount,
        manuallyNamedThread: wasManuallyNamedThread,
        locallyCreatedEmptyThread: wasLocallyCreatedEmptyThread,
      });
      const autoTitle = canAutoRenameThread
        ? getAutomaticThreadTitle({
          currentTitle: requestThread?.title,
          prompt,
          runtimeNames,
        })
        : null;
      if (renameThreadId && autoTitle) {
        setThreadTitleInCache(renameThreadId, autoTitle);
        try {
          const renamedThread = await renameThread(renameThreadId, autoTitle);
          updateThreadInCache(renamedThread);
        } catch (renameError) {
          queryClient.invalidateQueries({ queryKey: ['threads'] });
          console.error('Failed to auto-rename thread:', renameError);
        }
      }
      if (renameThreadId) emptyCreatedThreadIdsRef.current.delete(renameThreadId);
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['threadItems', started.threadId] });
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
  }, [activeThreadId, addThreadToCache, addToast, agents, queryClient, runIsActive, runStartPending, selectThread, setThreadTitleInCache, threadItemData?.items?.length, threads, t, updateThreadInCache]);

  const handleCancel = useCallback(async () => {
    const runId = currentRun?.runId ?? (optimisticRun?.runId.startsWith('starting-') ? undefined : optimisticRun?.runId);
    if (runId) {
      try { await cancelRun(runId); } catch {}
    }
  }, [currentRun?.runId, optimisticRun?.runId]);

  const handleSelectThread = useCallback((selection: ThreadSelectionInput) => {
    const id = resolveThreadSelectionId(selection);
    if (!id) return;
    selectThread(id);
    setLeftSidebarView('thread');
  }, [selectThread, setLeftSidebarView]);
  const handleThreadTitleEdited = useCallback((threadId: string) => {
    emptyCreatedThreadIdsRef.current.delete(threadId);
    manuallyNamedThreadIdsRef.current.add(threadId);
  }, []);
  const openGlobalSearch = useCallback((initialQuery = '') => {
    useSearchStore.getState().openDialog(initialQuery);
  }, []);
  const handleSearchMessageSelect = useCallback((messageId: string) => {
    setLeftSidebarView('thread');
    window.requestAnimationFrame(() => {
      const selector = `[data-message-id="${CSS.escape(messageId)}"]`;
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [setLeftSidebarView]);
  const handleSearchThreadSelect = useCallback((thread: ThreadInfo) => {
    handleSelectThread(thread.threadId);
  }, [handleSelectThread]);
  const handleSelectAgent = useCallback(async (agentId: string) => {
    const store = useThreadStore.getState();
    const agent = agents.find((a) => a.id === agentId);
    try {
      const thread = await createThread(agent?.name ? `${agent.name}` : undefined);
        addThreadToCache(thread, { empty: true });
        store.selectAgentThread(agentId, thread.threadId);
        setLeftSidebarView('thread');
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    } catch {
      // still select the agent visually even if thread creation fails
      store.selectAgentThread(agentId, '');
    }
  }, [addThreadToCache, agents, queryClient, setLeftSidebarView]);

  const handleStartLocalOrchestration = useCallback(async (agentId: string, draft: string) => {
    await handleSelectAgent(agentId);
    setViewMode('agent');
    setPendingComposerDraft(draft);
  }, [handleSelectAgent]);

  const handleCreateThread = useCallback(async () => {
    try {
      const thread = await createThread(selectedAgent?.name ? `${selectedAgent.name}` : undefined);
      addThreadToCache(thread, { empty: true });
      if (selectedAgent?.id) {
        selectAgentThread(selectedAgent.id, thread.threadId);
        setLeftSidebarView('thread');
      } else {
        handleSelectThread(thread.threadId);
      }
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      focusComposer();
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addThreadToCache, addToast, handleSelectThread, queryClient, selectAgentThread, selectedAgent?.id, selectedAgent?.name, setLeftSidebarView, t]);

  const handleQuickChat = useCallback(async () => {
    await handleCreateThread();
    focusComposer();
  }, [handleCreateThread]);

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
  const handleWindowCommand = useCallback(async (command: 'minimize' | 'toggleMaximize' | 'close') => {
    if (!desktopWindowAvailable) {
      addToast({ type: 'info', message: t('menu.nativeWindowUnavailable') });
      return;
    }
    try {
      const windowHandle = getCurrentWindow();
      if (command === 'minimize') {
        await windowHandle.minimize();
        return;
      }
      if (command === 'close') {
        await windowHandle.close();
        return;
      }
      (await windowHandle.isMaximized()) ? await windowHandle.unmaximize() : await windowHandle.maximize();
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, desktopWindowAvailable, t]);

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

  const handleEditCommand = useCallback((command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll') => {
    const active = document.activeElement;
    if (command === 'selectAll' && active instanceof HTMLInputElement) {
      active.select();
      return;
    }
    if (command === 'selectAll' && active instanceof HTMLTextAreaElement) {
      active.select();
      return;
    }
    const commandMap = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      delete: 'delete',
      selectAll: 'selectAll',
    } as const;
    try {
      document.execCommand(commandMap[command]);
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, t]);

  const handleCopyDiagnostics = useCallback(async () => {
    const diagnostic = [
      'AgentHub Desktop diagnostics',
      `Edge: ${online ? `online ${health?.version ?? 'v1'}` : 'offline'}`,
      `WebSocket: ${isConnected ? 'connected' : 'disconnected'}`,
      wsLatency != null ? `Latency: ${wsLatency}ms` : null,
      selectedAgent ? `Agent: ${selectedAgent.name} (${selectedAgent.id})` : null,
      selectedThread ? `Thread: ${selectedThread.threadId}` : null,
      displayedRun ? `Run: ${displayedRun.runId} (${displayedRun.status})` : null,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(diagnostic);
      addToast({ type: 'success', message: t('toast.copied') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, displayedRun, health?.version, isConnected, online, selectedAgent, selectedThread, t, wsLatency]);

  const handleReviewApprovalsFromHome = useCallback(() => {
    if (permissionRequests.length === 0) {
      openSettings('permissions');
      return;
    }
    setLeftSidebarView('thread');
    if (displayedRun) setRightPanelOpen(true);
  }, [displayedRun, openSettings, permissionRequests.length, setLeftSidebarView, setRightPanelOpen]);

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

  const handleRetry = useCallback(async (messageId?: string) => {
    const retry = findRetryPrompt(allMessages, messageId);
    if (!retry) {
      addToast({ type: 'info', message: t('toast.retryNoPrompt') });
      return;
    }
    await handleSend(retry.prompt, selectedAgentId ?? undefined);
  }, [addToast, allMessages, handleSend, selectedAgentId, t]);

  const handleForkThread = useCallback(async (messageId?: string) => {
    try {
      const sourceTitle = selectedThread?.title ?? selectedAgent?.name ?? 'AgentHub';
      const forkTitle = `Fork: ${sourceTitle}`.slice(0, 96);
      const thread = await createThread(forkTitle);
      addThreadToCache(thread, { suppressCreatedToast: true });
      if (selectedAgent?.id) {
        selectAgentThread(selectedAgent.id, thread.threadId);
        setLeftSidebarView('thread');
      } else {
        handleSelectThread(thread.threadId);
      }
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      const draft = buildForkDraft({
        sourceTitle,
        sourceThreadId: selectedThread?.threadId ?? activeThreadId ?? undefined,
        messages: allMessages,
        messageId,
      });
      setPendingComposerDraft(draft);
      addToast({ type: 'success', message: t('toast.forkCreated') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [
    activeThreadId,
    addThreadToCache,
    addToast,
    allMessages,
    handleSelectThread,
    queryClient,
    selectAgentThread,
    selectedAgent?.id,
    selectedAgent?.name,
    selectedThread?.threadId,
    selectedThread?.title,
    setLeftSidebarView,
    t,
  ]);

  const handleDelete = useCallback((messageId: string) => {
    setUserMessages((prev) => prev.filter((m) => m.id !== messageId));
    setHiddenMessageIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      writeHiddenMessageIds(activeThreadId, next);
      return next;
    });
  }, [activeThreadId]);

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

  const topMenus = useMemo<TopMenuDefinition>(() => ({
    file: {
      label: t('menu.file'),
      items: [
        {
          id: 'close',
          label: t('window.close'),
          shortcut: 'Ctrl+W',
          detail: desktopWindowAvailable ? undefined : t('menu.desktopOnly'),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('close'),
        },
        {
          id: 'new-thread',
          label: t('menu.file.newThread'),
          shortcut: 'Ctrl+N',
          detail: online ? undefined : t('menu.requiresEdge'),
          disabled: !online,
          action: handleCreateThread,
        },
        {
          id: 'quick-chat',
          label: t('menu.file.quickChat'),
          shortcut: 'Alt+Ctrl+N',
          detail: online ? undefined : t('menu.requiresEdge'),
          disabled: !online,
          action: handleQuickChat,
        },
        {
          id: 'open-folder',
          label: t('menu.file.openFolder'),
          shortcut: 'Ctrl+O',
          detail: desktopWindowAvailable ? undefined : t('menu.desktopOnly'),
          disabled: !desktopWindowAvailable,
          action: handleOpenFolder,
        },
        {
          id: 'settings',
          label: t('menu.file.settings'),
          shortcut: 'Ctrl+,',
          separatorBefore: true,
          action: () => openSettings('general'),
        },
        {
          id: 'account',
          label: t('menu.file.account'),
          action: handleOpenHubAccount,
        },
        {
          id: 'about',
          label: t('menu.help.about'),
          separatorBefore: true,
          action: () => openSettings('general'),
        },
      ],
    },
    edit: {
      label: t('menu.edit'),
      items: [
        {
          id: 'undo',
          label: t('menu.edit.undo'),
          shortcut: 'Ctrl+Z',
          action: () => handleEditCommand('undo'),
        },
        {
          id: 'redo',
          label: t('menu.edit.redo'),
          shortcut: 'Ctrl+Y',
          action: () => handleEditCommand('redo'),
        },
        {
          id: 'cut',
          label: t('menu.edit.cut'),
          shortcut: 'Ctrl+X',
          separatorBefore: true,
          action: () => handleEditCommand('cut'),
        },
        {
          id: 'copy',
          label: t('menu.edit.copy'),
          shortcut: 'Ctrl+C',
          action: () => handleEditCommand('copy'),
        },
        {
          id: 'paste',
          label: t('menu.edit.paste'),
          shortcut: 'Ctrl+V',
          action: () => handleEditCommand('paste'),
        },
        {
          id: 'delete',
          label: t('menu.edit.delete'),
          action: () => handleEditCommand('delete'),
        },
        {
          id: 'select-all',
          label: t('menu.edit.selectAll'),
          shortcut: 'Ctrl+A',
          separatorBefore: true,
          action: () => handleEditCommand('selectAll'),
        },
      ],
    },
    view: {
      label: t('menu.view'),
      items: [
        {
          id: 'toggle-sidebar',
          label: leftSidebarCollapsed ? t('menu.view.showSidebar') : t('menu.view.hideSidebar'),
          shortcut: 'Ctrl+B',
          action: () => setLeftSidebarCollapsed(!leftSidebarCollapsed),
        },
        {
          id: 'toggle-run-detail',
          label: rightPanelOpen ? t('menu.view.hideRunDetail') : t('menu.view.showRunDetail'),
          detail: displayedRun ? undefined : t('menu.requiresRun'),
          shortcut: 'Ctrl+J',
          disabled: !displayedRun,
          action: () => setRightPanelOpen(!rightPanelOpen),
        },
        {
          id: 'toggle-workspace',
          label: workspaceExpanded ? t('menu.view.restoreWorkspace') : t('menu.view.expandWorkspace'),
          action: () => setWorkspaceExpanded((value) => !value),
        },
        {
          id: 'tasks',
          label: t('menu.view.tasks'),
          separatorBefore: true,
          action: () => openSettings('tasks'),
        },
        {
          id: 'team-runs',
          label: t('menu.view.teamRuns'),
          action: () => openSettings('agentScheduling'),
        },
        {
          id: 'theme',
          label: theme === 'dark' ? t('theme.light') : t('theme.dark'),
          separatorBefore: true,
          action: toggleTheme,
        },
      ],
    },
    window: {
      label: t('menu.window'),
      items: [
        {
          id: 'minimize',
          label: t('window.minimize'),
          detail: desktopWindowAvailable ? undefined : t('menu.desktopOnly'),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('minimize'),
        },
        {
          id: 'toggle-maximize',
          label: t('window.maximize'),
          detail: desktopWindowAvailable ? undefined : t('menu.desktopOnly'),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('toggleMaximize'),
        },
        {
          id: 'close',
          label: t('window.close'),
          detail: desktopWindowAvailable ? undefined : t('menu.desktopOnly'),
          disabled: !desktopWindowAvailable,
          separatorBefore: true,
          danger: true,
          action: () => handleWindowCommand('close'),
        },
      ],
    },
    help: {
      label: t('menu.help'),
      items: [
        {
          id: 'shortcuts',
          label: t('menu.help.shortcuts'),
          shortcut: '?',
          action: () => setShortcutHelpOpen(true),
        },
        {
          id: 'diagnostics',
          label: t('menu.help.copyDiagnostics'),
          separatorBefore: true,
          action: handleCopyDiagnostics,
        },
        {
          id: 'desktop-settings',
          label: t('menu.help.desktopSettings'),
          action: () => openSettings('general'),
        },
        {
          id: 'about',
          label: t('menu.help.about'),
          action: () => openSettings('general'),
        },
      ],
    },
  }), [
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
    t,
    theme,
    toggleTheme,
    workspaceExpanded,
  ]);

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
      if (shellModifier && e.altKey && e.key.toLowerCase() === 'n' && online) {
        e.preventDefault();
        void handleQuickChat();
      } else if (shellModifier && e.key.toLowerCase() === 'n' && online) {
        e.preventDefault();
        void handleCreateThread();
      } else if (shellModifier && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFolder();
      } else if (shellModifier && e.key === ',') {
        e.preventDefault();
        openSettings('general');
      } else if (shellModifier && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        void handleWindowCommand('close');
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
    handleCreateThread,
    handleOpenFolder,
    handleQuickChat,
    handleWindowCommand,
    isMobile,
    leftSidebarCollapsed,
    online,
    openSettings,
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
          <nav className={styles.appMenu} aria-label={t('menu.title')} ref={topMenuRef}>
            {TOP_MENU_ORDER.map((menuId) => {
              const menu = topMenus[menuId];
              const expanded = openTopMenu === menuId;
              const panelId = `top-menu-${menuId}`;
              return (
                <div
                  key={menuId}
                  className={styles.topMenuGroup}
                  onMouseEnter={() => {
                    if (!openTopMenu) return;
                    setHoverOpenedTopMenu(menuId);
                    hoverOpenedTopMenuRef.current = menuId;
                  }}
                >
                  <button
                    type="button"
                    className={`${styles.topMenuTrigger} ${expanded ? styles.topMenuTriggerActive : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={expanded}
                    aria-controls={expanded ? panelId : undefined}
                    onClick={() => {
                      setOpenTopMenu((current) => resolveTopMenuClickState(current, menuId, hoverOpenedTopMenuRef.current ?? hoverOpenedTopMenu));
                      setHoverOpenedTopMenu(null);
                      hoverOpenedTopMenuRef.current = null;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpenTopMenu(menuId);
                        setHoverOpenedTopMenu(null);
                        hoverOpenedTopMenuRef.current = null;
                      }
                    }}
                  >
                    {menu.label}
                  </button>
                  {expanded && (
                    <div id={panelId} className={styles.topMenuPanel} role="menu" aria-label={menu.label}>
                      {menu.items.map((item) => (
                        <div key={item.id} className={styles.topMenuItemWrap}>
                          {item.separatorBefore && <div className={styles.topMenuSeparator} role="separator" />}
                          <button
                            type="button"
                            role="menuitem"
                            className={`${styles.topMenuItem} ${item.danger ? styles.topMenuItemDanger : ''}`}
                            disabled={item.disabled}
                            aria-disabled={item.disabled ? true : undefined}
                            title={item.disabled && item.detail ? item.detail : undefined}
                            onClick={() => {
                              if (item.disabled) return;
                              const result = item.action();
                              setOpenTopMenu(null);
                              setHoverOpenedTopMenu(null);
                              hoverOpenedTopMenuRef.current = null;
                              if (result instanceof Promise) void result;
                            }}
                          >
                            <span className={styles.topMenuItemLabel}>{item.label}</span>
                            {item.shortcut && <kbd>{item.shortcut}</kbd>}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
        <SettingsPage
          initialSection={settingsInitialSection}
          onBack={() => setSettingsOpen(false)}
          onOpenAuth={handleOpenAuth}
        />
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
              ) : viewMode === 'im' ? (
                <ErrorBoundary><Suspense fallback={null}><Slot name="im-view" /></Suspense></ErrorBoundary>
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
