import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ComposerMention,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type {
  AgentHubPlatform,
  LocalCliDiscoveryManifest,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import { toggleAppliedAgentHubTheme } from '../theme';
import { collectTranscriptEvidence } from '../transcript';
import type { TranscriptBlock, ContextUsageTranscriptBlock, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, SubtaskTranscriptBlock, ChildAgentTranscriptBlock } from '../transcript';
import type { ApprovalDecisionAction } from '../transcript';
import { ConversationHost, type MainchainSummary } from './ConversationHost';
import { ConversationSidebar } from './ConversationSidebar';
import type { MainchainNode } from './WorkbenchShell';
import {
  ContextMenu,
  MultiSelectBar,
  ProfilePopover,
  Toast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import { GlobalRail, type GlobalRailPage, type ConnectionStatusKind } from './GlobalRail';
import { RightInspector, type RuntimeEvidenceSnapshot } from './RightInspector';
import { type TranscriptContextMenuEvent, type TranscriptPointerEvent } from './transcriptEventTypes';
import type { EvidenceRef } from '../transcript';
import type { FileItem } from './inspector';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import type { WorkbenchAgentProfilesStatus, WorkbenchContactsData, WorkbenchContactsActions, WorkbenchDocumentsActions } from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS, WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import type { AgentConfig, ProjectDraft, DocRow } from './pages';
import type { SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import { createSettingsService, type SettingsService } from './settingsService';
import styles from './AgentHubWorkbench.module.css';

const INSPECTOR_MIN_WIDTH = 48;
const INSPECTOR_MAX_WIDTH = 760;
const INSPECTOR_DEFAULT_WIDTH = 400;
const INSPECTOR_READABLE_WIDTH = 360;
const INSPECTOR_COLLAPSE_SNAP_WIDTH = 96;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_COLLAPSE_SNAP_WIDTH = 96;
const WORKSPACE_AUTO_COLLAPSE_WIDTH = 560;
const SELECTION_HOLD_DELAY_MS = 520;
const SELECTION_HOLD_CANCEL_DISTANCE = 36;
const DEFAULT_BROWSER_PREVIEW_URL = '/demo-preview.html';

const LOCAL_CLI_DISCOVERY_FALLBACK: LocalCliDiscoveryManifest = {
  mode: 'no-spend-discovery',
  readinessManifest: '.tmp/evidence/p0-edge-cli-real-readiness.json',
  readinessScript: 'scripts/verify/verify-edge-cli-real-readiness.ps1',
  generatedAt: null,
  items: [
    { id: 'codex', name: 'Codex CLI', installed: false, version: null, path: 'codex', noSpend: true },
    { id: 'claude-code', name: 'Claude Code', installed: false, version: null, path: 'claude', noSpend: true },
    { id: 'opencode', name: 'OpenCode', installed: false, version: null, path: 'opencode', noSpend: true },
  ],
};

interface AgentProfileState {
  id: string;
  name: string;
  role: string;
  engine: string;
  model: string;
  state: string;
  skills: string[];
  anchor: HTMLElement;
}

interface HumanProfileState {
  id: string;
  name: string;
  initials: string;
  org: string;
  status: string;
  tag: string;
  subtitle: string;
  avatarColor?: string | undefined;
  anchor: HTMLElement;
}

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    /** Whether the workbench is loading initial data (threads/conversations not yet loaded). */
    initialLoading?: boolean;
    /** Error message from initial data load, if any. */
    loadError?: string;
  } | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: {
    loading?: boolean | undefined;
    error?: string | undefined;
    actionError?: string | undefined;
    saving?: boolean | undefined;
  } | undefined;
  activeConversationId?: string;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  /** Called when the user toggles pin on a session. Parent should call Hub API and refresh. */
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  /** Called when the user toggles archive on a session. Parent should call Hub API and refresh. */
  onConversationArchive?: ((conversationId: string, archived: boolean) => void) | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onLogout?: (() => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  /** Hub client for direct project API access when onProjectCreate/Update are not provided. */
  hubClient?: HubClient | undefined;
  onApprovalDecision?: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  /** 用户想与某个联系人/Agent 开始私聊，但当前没有已有会话时触发。上层负责创建会话并切换。 */
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  /** Contact mutation actions passed through to ContactsPage. */
  contactsActions?: WorkbenchContactsActions | undefined;
  /** Document rows for DocsPage (real data first, mock fallback). */
  documents?: DocRow[] | undefined;
  /** Document mutation actions wired to Hub Documents API. */
  documentsActions?: WorkbenchDocumentsActions | undefined;
  /** Model catalog items from Edge API. When provided, the Agents page
   *  Models tab shows real model data instead of mock fixtures. */
  modelCatalog?: Array<{
    id: string;
    label: string;
    value: string;
    provider?: string;
    status: string;
    description?: string;
    default?: boolean;
    tags?: string[];
  }> | undefined;
  /** cc-switch transparent proxy status from Edge API. */
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  /** cc-switch provider model alias mappings. */
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker?: boolean | undefined;
  showComposerStatus?: boolean | undefined;
  showMainchainStatus?: boolean | undefined;
  transcript: TranscriptBlock[];
  /** Current user profile info, shown in GlobalRail avatar and profile popover. */
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  /** Current user's Hub ID, used to distinguish "my" messages/tasks from others. */
  currentUserId?: string | undefined;
  /** Public Skill market items from Hub API. */
  skillMarketItems?: SkillMarketItem[] | undefined;
  /** Whether Skill market data is loading. */
  skillMarketLoading?: boolean | undefined;
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** Block ID to highlight (e.g. from a search result click). Cleared after 3 s animation. */
  highlightedBlockId?: string | undefined;
  /** Called when the highlight animation ends. */
  onHighlightEnd?: (() => void) | undefined;
  /** Called when the user requests regeneration of an agent message. Receives the block ID. */
  onRegenerate?: ((blockId: string) => void) | undefined;
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: ConnectionStatusKind | undefined;
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents,
  composerExecutionTargets,
  workbenchStatus,
  agentProfilesStatus,
  contacts,
  projects,
  activeProjectId,
  projectsStatus,
  activeConversationId,
  onActiveConversationChange,
  onConversationPin,
  onConversationArchive,
  onActiveProjectChange,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onLogout,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  onApprovalDecision,
  onNavigateToConversation,
  contactsActions,
  documents,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  runtimeEvidence,
  showComposerAgentPicker = true,
  showComposerStatus = true,
  showMainchainStatus = true,
  transcript,
  userDisplayName,
  userAvatarUrl,
  currentUserId,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  highlightedBlockId,
  onHighlightEnd,
  onRegenerate,
  connectionStatus,
}: AgentHubWorkbenchProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  // Create settings service if platform provides a settings port
  const settingsService = useMemo<SettingsService | null>(
    () => platform.settings ? createSettingsService(platform.settings, WORKBENCH_MOCK_SETTINGS_DEFAULTS) : null,
    [platform.settings],
  );

  const fallbackConversationId = conversations[0]?.id ?? 'default';
  const [localConversationId, setLocalConversationId] = useState(fallbackConversationId);
  const controlledConversationExists = conversations.some((conversation) => conversation.id === activeConversationId);
  const localConversationExists = conversations.some((conversation) => conversation.id === localConversationId);
  const currentConversationId = controlledConversationExists
    ? activeConversationId!
    : localConversationExists
      ? localConversationId
      : fallbackConversationId;
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const [selectedExecutionTargetId, setSelectedExecutionTargetId] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    blockId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [actionedBlockIds, setActionedBlockIds] = useState<string[]>([]);
  const [softHiddenBlockIds, setSoftHiddenBlockIds] = useState<string[]>([]);
  const [selectBarRect, setSelectBarRect] = useState<{ left: number; width: number } | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [dismissedPinnedIds, setDismissedPinnedIds] = useState<Set<string>>(new Set());
  const [localCliDiscovery, setLocalCliDiscovery] = useState<LocalCliDiscoveryManifest | null>(null);
  const [activeAgentProfile, setActiveAgentProfile] = useState<AgentProfileState | null>(null);
  const [activeHumanProfile, setActiveHumanProfile] = useState<HumanProfileState | null>(null);
  const [activeGroupProfile, setActiveGroupProfile] = useState<{
    id: string;
    name: string;
    memberNames: string[];
    anchor: HTMLElement;
  } | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | undefined>(undefined);
  const [reviewFileRequest, setReviewFileRequest] = useState<FileItem | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const inspectorWidthRef = useRef(INSPECTOR_DEFAULT_WIDTH);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const sidebarShouldCollapseRef = useRef(false);
  const selectionModeRef = useRef(false);
  const selectionHoldRef = useRef<{
    blockId: string;
    timer: number | null;
    x: number;
    y: number;
  } | null>(null);
  const suppressSelectionPointerUpRef = useRef(false);
  const runMultiActionRef = useRef<((action: string) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pulseTimersRef = useRef<Map<string, number>>(new Map());
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );
  const evidence = collectTranscriptEvidence(transcript);
  const mainchainSummary = buildMainchainSummary({
    composerTargetLabel: composerExecutionTargets?.find((target) => target.id === selectedExecutionTargetId)?.label,
    evidence,
    platformSurface: platform.surface,
    runtimeEvidence,
    selectedExecutionTargetId,
    targetRequired: Boolean(composerExecutionTargets),
    transcript,
    workbenchStatus,
    t: t as (key: string, options?: Record<string, unknown>) => string,
  });

  // ── Inspector data: route decisions, context usage, deploy preview ──
  const inspectorRouteBlocks = useMemo(
    () => transcript.filter((block): block is RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock =>
      block.kind === 'route_decision' || block.kind === 'subagent' || block.kind === 'subtask' || block.kind === 'child_agent',
    ),
    [transcript],
  );
  const inspectorContextBlocks = useMemo(
    () => transcript.filter((block): block is ContextUsageTranscriptBlock => block.kind === 'context_usage'),
    [transcript],
  );
  const inspectorDeployPreviewUrl = useMemo(() => {
    // Look for the latest preview block with a URL (deploy preview)
    for (let i = transcript.length - 1; i >= 0; i--) {
      const block = transcript[i]!;
      if (block.kind === 'preview' && block.url) return block.url;
    }
    return undefined;
  }, [transcript]);

  const inspectorRunResult = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const block = transcript[i]!;
      if (block.kind === 'result') return { success: block.success, summary: block.summary, duration: block.duration };
      if (block.kind === 'finished') return { success: true, summary: block.title, duration: block.duration };
      if (block.kind === 'failure') return { success: false, summary: block.reason ?? block.title };
    }
    return undefined;
  }, [transcript]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (platform.surface !== 'desktop' || activePage !== 'chat') return undefined;

    function handleDesktopToggleSidebar(): void {
      toggleSidebar();
    }

    window.addEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
    return () => window.removeEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
  }, [activePage, platform.surface, sidebarWidth]);

  const activeConversation = conversations.find((conversation) => conversation.id === currentConversationId);
  const isChatPage = activePage === 'chat';
  const mentionableAgents: ComposerMention[] = (agents ?? []).map((agent) => ({
    id: agent.id,
    label: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.status ? { status: agent.status } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.runtimeId ? { runtimeId: agent.runtimeId } : {}),
  }));

  useEffect(() => {
    dispatchComposer({ type: 'setConversationId', conversationId: currentConversationId });
  }, [currentConversationId]);

  useEffect(() => {
    if (!composerExecutionTargets || !selectedExecutionTargetId) return;
    if (!composerExecutionTargets.some((target) => target.id === selectedExecutionTargetId)) {
      setSelectedExecutionTargetId('');
    }
  }, [composerExecutionTargets, selectedExecutionTargetId]);

  useEffect(() => {
    if (activePage !== 'settings' || platform.surface !== 'desktop' || !platform.host?.localCliDiscovery) {
      setLocalCliDiscovery(null);
      return undefined;
    }

    let cancelled = false;
    setLocalCliDiscovery(LOCAL_CLI_DISCOVERY_FALLBACK);
    platform.host.localCliDiscovery()
      .then((discovery) => {
        if (!cancelled) setLocalCliDiscovery(discovery);
      })
      .catch((err) => {
        console.error('localCliDiscovery failed:', err);
        if (!cancelled) setLocalCliDiscovery(LOCAL_CLI_DISCOVERY_FALLBACK);
      });

    return () => {
      cancelled = true;
    };
  }, [activePage, platform]);

  useEffect(() => {
    if (!inspectorResizing) return;

    function updateFromPointer(event: PointerEvent): void {
      updateInspectorWidthFromClientX(event.clientX);
    }

    function stopResize(): void {
      setInspectorResizing(false);
      if (inspectorWidthRef.current <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
        const collapse = () => setInspectorCollapsed(true);
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(collapse);
          return;
        }
        collapse();
      }
    }

    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [inspectorResizing]);

  useEffect(() => {
    if (!sidebarResizing) return;

    function updateFromPointer(event: PointerEvent): void {
      updateSidebarWidthFromClientX(event.clientX);
    }

    function stopResize(): void {
      setSidebarResizing(false);
      if (sidebarShouldCollapseRef.current) {
        sidebarShouldCollapseRef.current = false;
        const collapse = () => setSidebarCollapsed(true);
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(collapse);
          return;
        }
        collapse();
      }
    }

    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [sidebarResizing]);

  useEffect(() => {
    if (!selectionMode) return;

    function handleSelectionKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSelectionMode(false);
        setSelectedBlockIds([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedBlockIds(transcript.map((block) => block.id));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        runMultiActionRef.current?.('copy');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        runMultiActionRef.current?.('delete');
      }
    }

    document.addEventListener('keydown', handleSelectionKey);
    return () => document.removeEventListener('keydown', handleSelectionKey);
  }, [selectedBlockIds, selectionMode, transcript]);

  // Ctrl/Cmd+F opens search when on chat page
  useEffect(() => {
    if (!isChatPage) return;

    function handleSearchShortcut(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }

    document.addEventListener('keydown', handleSearchShortcut);
    return () => document.removeEventListener('keydown', handleSearchShortcut);
  }, [isChatPage]);

  useEffect(() => () => {
    if (selectionHoldRef.current?.timer) {
      window.clearTimeout(selectionHoldRef.current.timer);
    }
    selectionHoldRef.current = null;
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    pulseTimersRef.current.forEach((id) => window.clearTimeout(id));
    pulseTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!selectionMode) return;

    function updateSelectBarRect(): void {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSelectBarRect({
        left: rect.left,
        width: rect.width,
      });
    }

    updateSelectBarRect();
    window.addEventListener('resize', updateSelectBarRect);
    return () => window.removeEventListener('resize', updateSelectBarRect);
  }, [selectionMode, inspectorCollapsed, inspectorWidth]);

  function clampInspectorWidth(value: number): number {
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)));
  }

  function clampSidebarWidth(value: number): number {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
  }

  function setSyncedInspectorWidth(width: number): void {
    inspectorWidthRef.current = width;
    setInspectorWidth(width);
  }

  function setSyncedSidebarWidth(width: number): void {
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
  }

  function restoreInspectorWidth(width = INSPECTOR_DEFAULT_WIDTH): void {
    setInspectorWidth((currentWidth) => {
      const nextWidth = currentWidth < INSPECTOR_READABLE_WIDTH
        ? clampInspectorWidth(width)
        : currentWidth;
      inspectorWidthRef.current = nextWidth;
      return nextWidth;
    });
  }

  function openInspector(width = INSPECTOR_DEFAULT_WIDTH): void {
    restoreInspectorWidth(width);
    setInspectorCollapsed(false);
  }

  function collapseSidebarForWorkspacePressure(nextInspectorWidth: number): void {
    if (!isChatPage || sidebarCollapsed) return;
    const availableWorkspaceWidth = window.innerWidth - 52 - sidebarWidthRef.current - nextInspectorWidth;
    if (availableWorkspaceWidth < WORKSPACE_AUTO_COLLAPSE_WIDTH) {
      setSidebarCollapsed(true);
    }
  }

  function restoreSidebarWidth(width = SIDEBAR_DEFAULT_WIDTH): void {
    setSidebarWidth((currentWidth) => {
      const nextWidth = currentWidth < SIDEBAR_MIN_WIDTH
        ? clampSidebarWidth(width)
        : currentWidth;
      sidebarWidthRef.current = nextWidth;
      return nextWidth;
    });
  }

  function toggleSidebar(): void {
    setSidebarCollapsed((collapsed) => {
      if (collapsed || sidebarWidth < SIDEBAR_MIN_WIDTH) {
        setSyncedSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
        return false;
      }
      return true;
    });
  }

  function navigateRail(page: GlobalRailPage): void {
    if (page === 'chat') {
      setActivePage('chat');
      setSidebarCollapsed(false);
      restoreSidebarWidth();
      return;
    }
    setActivePage(page);
  }

  function updateInspectorWidthFromClientX(clientX: number): void {
    const nextWidth = window.innerWidth - clientX;
    setInspectorCollapsed(false);
    const clampedWidth = clampInspectorWidth(nextWidth);
    collapseSidebarForWorkspacePressure(clampedWidth);
    if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
      setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH);
      setInspectorResizing(false);
      const collapse = () => setInspectorCollapsed(true);
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(collapse);
        return;
      }
      collapse();
      return;
    }
    setSyncedInspectorWidth(
      clampedWidth,
    );
  }

  function updateSidebarWidthFromClientX(clientX: number): void {
    const nextWidth = clientX - 52;
    setSidebarCollapsed(false);
    if (nextWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH) {
      sidebarShouldCollapseRef.current = true;
      setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH);
      return;
    }
    sidebarShouldCollapseRef.current = false;
    setSyncedSidebarWidth(clampSidebarWidth(nextWidth));
  }

  function beginInspectorResize(clientX: number): void {
    if (inspectorCollapsed) return;
    setInspectorResizing(true);
    updateInspectorWidthFromClientX(clientX);
  }

  function beginSidebarResize(clientX: number): void {
    if (sidebarCollapsed) return;
    sidebarShouldCollapseRef.current = false;
    setSidebarResizing(true);
    updateSidebarWidthFromClientX(clientX);
  }

  function resizeInspectorBy(delta: number): void {
    const nextWidth = clampInspectorWidth(inspectorWidth + delta);
    setInspectorCollapsed(false);
    collapseSidebarForWorkspacePressure(nextWidth);
    if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
      setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH);
      setInspectorCollapsed(true);
      return;
    }
    setSyncedInspectorWidth(nextWidth);
  }

  function resizeSidebarBy(delta: number): void {
    const rawWidth = sidebarWidth + delta;
    setSidebarCollapsed(false);
    if (rawWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH || (sidebarWidth <= SIDEBAR_MIN_WIDTH && rawWidth < SIDEBAR_MIN_WIDTH)) {
      setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH);
      setSidebarCollapsed(true);
      return;
    }
    setSyncedSidebarWidth(clampSidebarWidth(rawWidth));
  }

  function toggleInspector(): void {
    setInspectorCollapsed((collapsed) => {
      if (collapsed || inspectorWidth < INSPECTOR_READABLE_WIDTH) {
        setInspectorWidth(INSPECTOR_DEFAULT_WIDTH);
        return false;
      }
      return true;
    });
  }

  function handleToggleTheme(): void {
    toggleAppliedAgentHubTheme();
  }

  function showWorkbenchToast(message: string): void {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 1700);
  }

  function openAgentProfile(agentName: string, anchor: HTMLElement): void {
    const profile = agentProfileByName(agentName);
    if (!profile) {
      setActiveAgentProfile(null);
      setActiveGroupProfile(null);
      setActiveHumanProfile(humanProfileByName(agentName, anchor));
      return;
    }
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    setActiveAgentProfile({ ...profile, anchor });
  }

  function openAgentProfileFromConfig(
    agent: {
      id: string;
      name: string;
      role: string;
      engine: string;
      model: string;
      state: string;
      skills: string[];
    },
    anchor: HTMLElement,
  ): void {
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    setActiveAgentProfile({ ...agent, anchor });
  }

  function openConversationAvatar(conversation: WorkbenchConversation, anchor: HTMLElement): void {
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);

    if (conversation.kind === 'group') {
      setActiveGroupProfile({
        id: conversation.id,
        name: conversation.title,
        memberNames: conversation.members ?? [],
        anchor,
      });
      return;
    }

    const profile = agentProfileByName(conversation.title);
    if (profile) {
      setActiveAgentProfile({ ...profile, anchor });
    } else {
      setActiveHumanProfile(humanProfileByName(conversation.title, anchor));
    }
  }

  function agentProfileByName(agentName: string): Omit<AgentProfileState, 'anchor'> | null {
    const normalized = agentName.toLowerCase();
    const runtimeAgent = (agents ?? []).find((agent) => agent.name.toLowerCase() === normalized);
    const configured = configuredAgentProfiles().find((agent) => (
      agent.name.toLowerCase() === normalized || agent.id.toLowerCase() === normalized
    ));

    if (configured) return configured;
    if (!runtimeAgent) return null;

    return {
      id: runtimeAgent.id,
      name: runtimeAgent.name,
      role: runtimeAgent.description ?? t('label.agent'),
      engine: t('label.agentHub'),
      model: runtimeAgent.model ?? t('status.unconfigured'),
      state: runtimeAgent.status ?? 'available',
      skills: [],
    };
  }

  function humanProfileByName(name: string, anchor: HTMLElement): HumanProfileState {
    const normalized = name.toLowerCase();
    const contact = WORKBENCH_MOCK_CONTACT_MEMBERS.find((item) => (
      item.name.toLowerCase() === normalized || item.id.toLowerCase() === normalized
    ));
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === normalized || item.id.toLowerCase() === normalized
    ));
    const resolvedName = contact?.name ?? conversation?.title ?? name;

    return {
      id: contact?.id ?? conversation?.id ?? resolvedName.toLowerCase(),
      name: resolvedName,
      initials: contact?.initials ?? conversation?.avatarLabel ?? resolvedName.slice(0, 1).toUpperCase(),
      org: contact?.org ?? t('label.contact'),
      status: contact?.status ?? conversation?.updatedLabel ?? t('status.online'),
      tag: contact?.tag ?? (conversation?.kind === 'group' ? t('chat.kind.group') : t('chat.kind.friend')),
      subtitle: conversation?.subtitle ?? contact?.org ?? t('chat.kind.friend'),
      avatarColor: conversation?.avatarColor,
      anchor,
    };
  }

  function openAgentDirectMessage(): void {
    if (!activeAgentProfile) return;
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === activeAgentProfile.name.toLowerCase()
      || item.id.toLowerCase() === activeAgentProfile.id.toLowerCase()
    ));
    if (conversation) {
      selectConversation(conversation.id);
    } else if (onNavigateToConversation) {
      onNavigateToConversation({ name: activeAgentProfile.name, id: activeAgentProfile.id, kind: 'dm' });
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: activeAgentProfile.name }));
      return;
    }
    setActivePage('chat');
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function openHumanDirectMessage(): void {
    if (!activeHumanProfile) return;
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === activeHumanProfile.name.toLowerCase()
      || item.id.toLowerCase() === activeHumanProfile.id.toLowerCase()
    ));
    if (conversation) {
      selectConversation(conversation.id);
    } else if (onNavigateToConversation) {
      onNavigateToConversation({ name: activeHumanProfile.name, id: activeHumanProfile.id, kind: 'dm' });
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: activeHumanProfile.name }));
      return;
    }
    setActivePage('chat');
    setActiveHumanProfile(null);
    setActiveAgentProfile(null);
    setActiveGroupProfile(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function openAgentConfig(): void {
    if (!activeAgentProfile) return;
    setFocusedAgentId(activeAgentProfile.id);
    setActivePage('agents');
    setActiveAgentProfile(null);
    showWorkbenchToast(t('toast.agentConfigOpened', { name: activeAgentProfile.name }));
  }

  function openReviewFile(file: FileItem): void {
    openInspector();
    setReviewFileRequest({ ...file });
  }

  function handleDeploySubmit(_id: string): void {
    openInspector();
    showWorkbenchToast(t('toast.deployPreviewOpened'));
  }

  function blockTitle(block: TranscriptBlock): string {
    switch (block.kind) {
      case 'text':
        return block.text.slice(0, 28) || block.author.name;
      case 'tool_call':
        return block.toolName;
      case 'tool_result':
        return `${block.toolName} result`;
      case 'file_change':
        return block.path;
      case 'permission_request':
      case 'permission_result':
      case 'failure':
      case 'finished':
        return block.title;
      case 'preview':
        return block.url ?? block.previewId;
      case 'diff':
      case 'approval':
      case 'artifact':
      case 'subagent':
      case 'subtask':
      case 'child_agent':
      case 'run_session':
      case 'run_step_group':
        return block.title;
      case 'agent_timeline':
        return block.title ?? t('mainchain.timeline');
      case 'result':
        return block.summary || (block.success ? t('mainchain.result') : t('mainchain.fail'));
      case 'thinking':
        return t('mainchain.thinking');
      case 'route_decision':
        return block.targetAgent || block.action;
      case 'context_usage':
        return block.modelLabel || '上下文用量';
      default:
        return '消息卡片';
    }
  }

  function blockTitleById(blockId: string): string {
    const block = transcript.find((item) => item.id === blockId);
    return block ? blockTitle(block) : t('mainchain.selectedCard');
  }

  function openBlockContextMenu(
    block: TranscriptBlock,
    event: TranscriptContextMenuEvent,
  ): void {
    event.preventDefault();
    setContextMenu({
      blockId: block.id,
      title: blockTitle(block),
      x: event.clientX,
      y: event.clientY,
    });
  }

  function selectBlock(blockId: string): void {
    setSelectedBlockIds((current) => (
      current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId]
    ));
  }

  function selectRangeTo(blockId: string): void {
    const selectedIndexes = selectedBlockIds
      .map((id) => transcript.findIndex((block) => block.id === id))
      .filter((index) => index >= 0);
    const anchorIndex = selectedIndexes.length
      ? selectedIndexes[selectedIndexes.length - 1]!
      : transcript.findIndex((block) => block.id === blockId);
    const targetIndex = transcript.findIndex((block) => block.id === blockId);

    if (anchorIndex < 0 || targetIndex < 0) {
      selectBlock(blockId);
      return;
    }

    const [from, to] = anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const rangeIds = transcript.slice(from, to + 1).map((block) => block.id);
    setSelectionMode(true);
    setSelectedBlockIds((current) => Array.from(new Set([...current, ...rangeIds])));
  }

  function handleBlockSelect(blockId: string, event?: { shiftKey?: boolean }): void {
    if (event?.shiftKey) {
      selectRangeTo(blockId);
      return;
    }
    selectBlock(blockId);
  }

  function selectConversation(conversationId: string): void {
    setLocalConversationId(conversationId);
    setContextMenu(null);
    setSelectionMode(false);
    setSelectedBlockIds([]);
    setActionedBlockIds([]);
    setSoftHiddenBlockIds([]);
    onActiveConversationChange?.(conversationId);
  }

  function enterSelection(blockId: string): void {
    selectionModeRef.current = true;
    setSelectionMode(true);
    setSelectedBlockIds([blockId]);
  }

  function clearSelectionHold(): void {
    if (selectionHoldRef.current?.timer) {
      window.clearTimeout(selectionHoldRef.current.timer);
    }
    selectionHoldRef.current = null;
  }

  function beginBlockHoldSelection(block: TranscriptBlock, event: TranscriptPointerEvent): void {
    if (event.button !== 0 || isNestedInteractiveTarget(event.target, event.currentTarget)) return;
    clearSelectionHold();
    selectionHoldRef.current = {
      blockId: block.id,
      timer: window.setTimeout(() => {
        enterSelection(block.id);
        suppressSelectionPointerUpRef.current = true;
        selectionHoldRef.current = null;
      }, SELECTION_HOLD_DELAY_MS),
      x: event.clientX,
      y: event.clientY,
    };
  }

  function updateBlockHoldSelection(event: TranscriptPointerEvent): void {
    const hold = selectionHoldRef.current;
    if (!hold) return;
    const dx = Math.abs(event.clientX - hold.x);
    const dy = Math.abs(event.clientY - hold.y);
    if (dx > SELECTION_HOLD_CANCEL_DISTANCE || dy > SELECTION_HOLD_CANCEL_DISTANCE) {
      clearSelectionHold();
    }
  }

  function handleBlockPointerUp(block: TranscriptBlock, event: TranscriptPointerEvent): void {
    clearSelectionHold();
    if (suppressSelectionPointerUpRef.current) {
      suppressSelectionPointerUpRef.current = false;
      return;
    }
    if (!selectionModeRef.current || event.button !== 0 || isNestedInteractiveTarget(event.target, event.currentTarget)) return;
    handleBlockSelect(block.id, { shiftKey: event.shiftKey });
  }

  function isNestedInteractiveTarget(target: EventTarget | null, card: HTMLElement): boolean {
    if (!(target instanceof Element)) return false;
    const interactive = target.closest('button, a, input, textarea, select, label, [contenteditable="true"]');
    return Boolean(interactive && interactive !== card && !interactive.hasAttribute('data-selectable-card'));
  }

  function copyText(text: string): void {
    try {
      navigator.clipboard?.writeText?.(text)?.catch?.(() => {});
    } catch {
      // Clipboard is optional in local preview and test environments.
    }
  }

  function pulseBlock(blockId: string): void {
    const existing = pulseTimersRef.current.get(blockId);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    setActionedBlockIds((current) => (
      current.includes(blockId) ? current : [...current, blockId]
    ));
    const timerId = window.setTimeout(() => {
      setActionedBlockIds((current) => current.filter((id) => id !== blockId));
      pulseTimersRef.current.delete(blockId);
    }, 900);
    pulseTimersRef.current.set(blockId, timerId);
  }

  function cardActionLabel(action: string, title: string): string {
    const labels: Record<string, string> = {
      copy: t('toast.cardCopied'),
      react: t('toast.reactOpened'),
      reply: `${t('context.reply')} ${title}`,
      forward: t('toast.forwardQueued'),
      topic: t('toast.topicDraft'),
      pin: t('toast.pinUpdated'),
      link: t('toast.linkCopied'),
      translate: t('toast.translateQueued'),
      task: t('toast.taskDraft'),
      export: t('toast.exportDraft'),
      apps: t('toast.appsOpened'),
      delete: t('toast.deleteQueued'),
    };
    return labels[action] ?? t('toast.actionRecorded');
  }

  function multiActionLabel(action: string, count: number): string {
    const labels: Record<string, string> = {
      copy: t('toast.multiCopy', { count }),
      forward: t('toast.multiForward', { count }),
      task: t('toast.multiTaskDraft', { count }),
      export: t('toast.multiExport', { count }),
      delete: t('toast.multiDelete', { count }),
    };
    return labels[action] ?? t('toast.multiProcessed', { count });
  }

  function runContextAction(action: string, blockId: string): void {
    const title = blockTitleById(blockId);
    const block = transcript.find((item) => item.id === blockId);
    if (action === 'copy') copyText(title);
    if (action === 'link') copyText(`agenthub://card/${blockId}`);
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => (
        current.includes(blockId) ? current : [...current, blockId]
      ));
    }
    if (action === 'reply' && block) {
      dispatchComposer({
        type: 'setReplyTo',
        replyTo: {
          messageId: blockId,
          author: block.author.name,
          preview: title,
        },
      });
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    }
    if (action === 'quote' && block && block.kind === 'text') {
      const selectedText = window.getSelection()?.toString().trim();
      const quoteText = selectedText || block.text.slice(0, 80);
      const quoted = `> ${quoteText.split('\n').join('\n> ')}\n\n`;
      dispatchComposer({ type: 'setText', text: quoted });
      dispatchComposer({
        type: 'setQuote',
        quote: {
          text: quoteText,
          author: block.author.name,
          messageId: block.id,
        },
      });
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    }
    if (action === 'regenerate' && block && block.kind === 'text' && block.author.role === 'agent') {
      // Mark old message as having a newer version so it renders grayed out
      setSoftHiddenBlockIds((current) => {
        const next = new Set(current);
        next.add(block.id);
        return Array.from(next);
      });
      onRegenerate?.(blockId);
      pulseBlock(blockId);
      showWorkbenchToast(cardActionLabel(action, title));
      return;
    }
    pulseBlock(blockId);
    showWorkbenchToast(cardActionLabel(action, title));
  }

  /** Handles block actions (approve/deny/retry/copy/regenerate) from the ChatViewTranscript component chain. */
  function handleTranscriptBlockAction(action: string, blockId: string, metadata?: Record<string, unknown>): void {
    const block = transcript.find((b) => b.id === blockId);
    if (!block) return;

    if (action === 'approve' || action === 'deny') {
      // Approval blocks carry PermissionRequestTranscriptBlock data
      if (block.kind === 'permission_request') {
        const decision: ApprovalDecisionAction = {
          approvalId: block.requestId,
          decision: action === 'approve' ? 'allow' : 'deny',
          ...(block.teamId !== undefined ? { teamId: block.teamId } : {}),
          ...(block.teamRunId !== undefined ? { teamRunId: block.teamRunId } : {}),
          ...(block.agentTaskId !== undefined ? { agentTaskId: block.agentTaskId } : {}),
          ...(block.targetId !== undefined ? { targetId: block.targetId } : {}),
          ...(block.edgeDeviceId !== undefined ? { edgeDeviceId: block.edgeDeviceId } : {}),
          ...(block.correlationId !== undefined ? { correlationId: block.correlationId } : {}),
        };
        onApprovalDecision?.(decision);
        pulseBlock(blockId);
        showWorkbenchToast(action === 'approve' ? t('action.approved') : t('action.denied'));
      }
    }

    if (action === 'retry' || action === 'regenerate') {
      // Retry a failed agent message -- dispatch regeneration
      if (block.kind === 'text' && block.author.role === 'agent') {
        setSoftHiddenBlockIds((current) => {
          const next = new Set(current);
          next.add(block.id);
          return Array.from(next);
        });
        onRegenerate?.(blockId);
        pulseBlock(blockId);
        showWorkbenchToast(t('action.regenerating'));
      }
    }

    if (action === 'copy') {
      const title = (metadata?.text as string) || blockTitle(block);
      copyText(title);
      pulseBlock(blockId);
      showWorkbenchToast(cardActionLabel('copy', title));
    }
  }

  function runMultiAction(action: string): void {
    const count = selectedBlockIds.length;
    if (!count) {
      showWorkbenchToast(t('toast.noCardSelected'));
      return;
    }
    if (action === 'copy') {
      copyText(selectedBlockIds.map(blockTitleById).join('\n'));
    }
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => {
        const next = new Set(current);
        selectedBlockIds.forEach((id) => next.add(id));
        return Array.from(next);
      });
      setSelectionMode(false);
      setSelectedBlockIds([]);
    }
    showWorkbenchToast(multiActionLabel(action, count));
  }
  runMultiActionRef.current = runMultiAction;

  function exportMainchainEvidence(): void {
    if (!mainchainSummary.exportEnabled) {
      showWorkbenchToast(t('toast.noEvidence'));
      return;
    }
    copyText(JSON.stringify({
      exportedAt: new Date().toISOString(),
      surface: platform.surface,
      status: workbenchStatus,
      nodes: mainchainSummary.nodes,
      evidence,
      runtimeEvidence,
    }, null, 2));
    showWorkbenchToast(t('toast.evidenceCopied'));
  }

  function contextMenuGroups(blockId: string): Array<Array<ContextMenuItem>> {
    const block = transcript.find((item) => item.id === blockId);
    const isAgentText = block?.kind === 'text' && block.author.role === 'agent';
    const isTextBlock = block?.kind === 'text';
    return [
      [
        { label: t('context.copy'), icon: 'fileText', shortcut: 'Ctrl C', onClick: () => runContextAction('copy', blockId) },
        { label: t('context.react'), icon: 'star', chevron: true, onClick: () => runContextAction('react', blockId) },
        { label: t('context.reply'), icon: 'notes', onClick: () => runContextAction('reply', blockId) },
        ...(isTextBlock ? [{ label: t('context.quote'), icon: 'copy' as const, onClick: () => runContextAction('quote', blockId) }] : []),
        { label: t('context.forward'), icon: 'external', onClick: () => runContextAction('forward', blockId) },
      ],
      [
        { label: t('context.createTopic'), icon: 'groups', onClick: () => runContextAction('topic', blockId) },
        { label: t('context.multiSelect'), icon: 'grid', shortcut: 'Shift', onClick: () => enterSelection(blockId) },
        { label: t('context.pinMessage'), icon: 'bell', onClick: () => runContextAction('pin', blockId) },
        { label: t('context.copyLink'), icon: 'external', onClick: () => runContextAction('link', blockId) },
        { label: t('context.translate'), icon: 'library', onClick: () => runContextAction('translate', blockId) },
      ],
      [
        ...(isAgentText ? [{ label: t('context.regenerate'), icon: 'refresh' as const, onClick: () => runContextAction('regenerate', blockId) }] : []),
        { label: t('context.addTask'), icon: 'running', onClick: () => runContextAction('task', blockId) },
        { label: t('context.exportDoc'), icon: 'download', onClick: () => runContextAction('export', blockId) },
        { label: t('context.apps'), icon: 'tools', chevron: true, onClick: () => runContextAction('apps', blockId) },
        { label: t('context.delete'), icon: 'archive', danger: true, onClick: () => runContextAction('delete', blockId) },
      ],
    ];
  }

  const multiSelectActions: Array<MultiSelectBarAction> = [
    {
      label: t('bar.selectAll'),
      icon: 'done',
      onClick: () => setSelectedBlockIds(transcript.map((block) => block.id)),
    },
    {
      label: t('bar.clear'),
      icon: 'filter',
      onClick: () => setSelectedBlockIds([]),
    },
    { label: t('context.copy'), icon: 'fileText', onClick: () => runMultiAction('copy') },
    { label: t('context.forward'), icon: 'external', onClick: () => runMultiAction('forward') },
    { label: t('context.addTask'), icon: 'running', onClick: () => runMultiAction('task') },
    { label: t('context.exportDoc'), icon: 'download', onClick: () => runMultiAction('export') },
    { label: t('context.delete'), icon: 'archive', danger: true, onClick: () => runMultiAction('delete') },
    {
      label: t('bar.exit'),
      icon: 'close',
      ghost: true,
      onClick: () => {
        setSelectionMode(false);
        setSelectedBlockIds([]);
      },
    },
  ];

  const shellStyle = {
    '--inspector-w': `${inspectorWidth}px`,
    '--sidebar-w': `${sidebarWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className={styles.shell}
      data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
      data-inspector-resizing={inspectorResizing ? 'true' : 'false'}
      data-page={activePage}
      data-selection-mode={selectionMode ? 'true' : 'false'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      data-sidebar-resizing={sidebarResizing ? 'true' : 'false'}
      data-data-mode={workbenchStatus?.dataMode}
      data-testid="agenthub-workbench"
      style={shellStyle}
    >
      <GlobalRail
        activePage={activePage}
        onNavigate={navigateRail}
        onLogout={onLogout}
        onToggleTheme={handleToggleTheme}
        userDisplayName={userDisplayName}
        userAvatarUrl={userAvatarUrl}
      />
      {isChatPage && (
        <div className={styles.sidebarFrame}>
          <ConversationSidebar
            activeConversationId={currentConversationId}
            conversations={conversations}
            onAvatarClick={openConversationAvatar}
            onSelectConversation={selectConversation}
            onPinConversation={onConversationPin}
            onArchiveConversation={onConversationArchive}
          />
          <div
            aria-label={t('aria.resizeSidebar')}
            aria-orientation="vertical"
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuenow={sidebarWidth}
            className={styles.sidebarResizer}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.shiftKey ? 40 : 16;
              resizeSidebarBy(event.key === 'ArrowLeft' ? -step : step);
            }}
            onPointerDown={(event) => {
              if (sidebarCollapsed) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              beginSidebarResize(event.clientX);
            }}
            role="separator"
            tabIndex={sidebarCollapsed ? -1 : 0}
          />
        </div>
      )}

      <main
        ref={workspaceRef}
        aria-label={t('aria.workspace')}
        className={styles.workspace}
        data-mainchain={showMainchainStatus ? 'true' : 'false'}
        data-mode={isChatPage ? 'chat' : 'workbench'}
        data-surface={platform.surface}
        data-workspace-main
      >
        {workbenchStatus?.initialLoading && conversations.length === 0 ? (
          <div className={styles.workspaceLoading} role="status">
            <span className={styles.workspaceLoadingSpinner} />
            <span className={styles.workspaceLoadingLabel}>{t('connection.connecting')}</span>
          </div>
        ) : isChatPage ? (
          <ConversationHost
            transcript={transcript}
            activeConversation={activeConversation}
            connectionStatus={connectionStatus}
            inspectorCollapsed={inspectorCollapsed}
            onToggleInspector={toggleInspector}
            showMainchainStatus={showMainchainStatus}
            mainchainSummary={mainchainSummary}
            onExportMainchainEvidence={exportMainchainEvidence}
            workbenchStatus={workbenchStatus}
            onAgentClick={openAgentProfile}
            onBlockContextMenu={(blockId, event) => {
              const block = transcript.find((b) => b.id === blockId);
              if (block) openBlockContextMenu(block, event as unknown as TranscriptContextMenuEvent);
            }}
            onBlockSelect={(blockId, shiftKey) => handleBlockSelect(blockId, { shiftKey: shiftKey ?? false })}
            onBlockAction={handleTranscriptBlockAction}
            onReviewFile={openReviewFile}
            onDeploySubmit={handleDeploySubmit}
            selectedBlockIds={new Set(selectedBlockIds)}
            selectionMode={selectionMode}
            softHiddenBlockIds={new Set(softHiddenBlockIds)}
            actionedBlockIds={new Set(actionedBlockIds)}
            highlightedBlockId={highlightedBlockId}
            onHighlightEnd={onHighlightEnd}
            dismissedPinnedIds={dismissedPinnedIds}
            onToast={showWorkbenchToast}
            composerExecutionTargets={composerExecutionTargets}
            selectedExecutionTargetId={selectedExecutionTargetId}
            onExecutionTargetChange={setSelectedExecutionTargetId}
            mentionableAgents={mentionableAgents}
            showComposerAgentPicker={showComposerAgentPicker}
            showComposerStatus={showComposerStatus}
            composerTargetLabel={activeConversation?.title ?? 'AgentHub'}
            currentConversationId={currentConversationId}
            platform={platform}
            composer={composer}
            dispatchComposer={dispatchComposer}
            composerInputRef={composerInputRef}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
          />
        ) : (
          <section aria-label={t('aria.workbenchPage')} className={styles.workbenchPageHost}>
            <WorkbenchRoutes
              activePage={activePage}
              agents={agents}
              agentProfilesStatus={agentProfilesStatus}
              dataMode={workbenchStatus?.dataMode}
              contacts={contacts}
              documents={documents}
              focusedAgentId={focusedAgentId}
              projects={projects}
              activeProjectId={activeProjectId}
              projectsStatus={projectsStatus}
              onActiveProjectChange={onActiveProjectChange}
              onProjectCreate={onProjectCreate}
              onProjectUpdate={onProjectUpdate}
              hubClient={hubClient}
              onAgentCreate={onAgentCreate}
              onAgentUpdate={onAgentUpdate}
              onAgentDelete={onAgentDelete}
              onAgentsRetry={onAgentsRetry}
              onAgentProfileOpen={openAgentProfileFromConfig}
              onStartConversation={onNavigateToConversation}
              contactsActions={contactsActions}
              documentsActions={documentsActions}
              localCliDiscovery={localCliDiscovery}
              modelCatalog={modelCatalog}
              ccSwitchStatus={ccSwitchStatus}
              ccSwitchProviders={ccSwitchProviders}
              settingsService={settingsService}
              skillMarketItems={skillMarketItems}
              skillMarketLoading={skillMarketLoading}
              mcpMarketItems={mcpMarketItems}
              mcpMarketLoading={mcpMarketLoading}
              onNavigatePage={setActivePage}
              currentUserId={currentUserId}
              userDisplayName={userDisplayName}
            />
          </section>
        )}
      </main>

      {isChatPage && (
        <RightInspector
          browserPreviewEnabled={platform.capabilities.browserPreview}
          canOpenPreview={platform.preview?.canOpenEvidence}
          collapsed={inspectorCollapsed}
          contextBlocks={inspectorContextBlocks}
          defaultBrowserUrl={DEFAULT_BROWSER_PREVIEW_URL}
          deployPreviewUrl={inspectorDeployPreviewUrl}
          evidence={evidence}
          maxWidth={INSPECTOR_MAX_WIDTH}
          minWidth={INSPECTOR_MIN_WIDTH}
          onOpenPreview={platform.preview?.openEvidence}
          reviewFileRequest={reviewFileRequest}
          routeBlocks={inspectorRouteBlocks}
          runtimeEvidence={runtimeEvidence}
          runResult={inspectorRunResult}
          workDir={composer.workDir?.trim() || undefined}
          onResizeBy={resizeInspectorBy}
          onResizeStart={beginInspectorResize}
          width={inspectorWidth}
        />
      )}
      {isChatPage && contextMenu && (
        <ContextMenu
          groups={contextMenuGroups(contextMenu.blockId)}
          isOpen={Boolean(contextMenu)}
          title={contextMenu.title}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
      {isChatPage && selectionMode && (
        <MultiSelectBar
          actions={multiSelectActions}
          count={selectedBlockIds.length}
          total={transcript.length}
          workspaceLeft={selectBarRect?.left}
          workspaceWidth={selectBarRect?.width}
        />
      )}
      {activeAgentProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
            { label: t('profile.agentConfig') },
          ]}
          anchorElement={activeAgentProfile.anchor}
          avatar={workbenchProfileInitials(activeAgentProfile.name)}
          avatarColor={workbenchAgentColor(activeAgentProfile)}
          badge={agentStateLabel(t, activeAgentProfile.state)}
          isOpen
          meta={[
            { label: t('profile.role'), value: activeAgentProfile.role },
            { label: t('profile.engine'), value: activeAgentProfile.engine },
            { label: t('profile.model'), value: activeAgentProfile.model },
            { label: t('profile.skills'), value: activeAgentProfile.skills.join(' · ') || t('status.unconfigured') },
          ]}
          name={activeAgentProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) openAgentDirectMessage();
            if (action === t('profile.agentConfig')) openAgentConfig();
          }}
          onClose={() => setActiveAgentProfile(null)}
          subtitle={`${activeAgentProfile.role} · ${activeAgentProfile.engine}`}
          variant="agent"
        />
      )}
      {activeHumanProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
            { label: t('profile.copyLink') },
          ]}
          anchorElement={activeHumanProfile.anchor}
          avatar={activeHumanProfile.initials}
          avatarColor={activeHumanProfile.avatarColor ?? 'var(--surface-highest)'}
          badge={activeHumanProfile.tag}
          isOpen
          meta={[
            { label: t('profile.identity'), value: activeHumanProfile.tag },
            { label: t('profile.org'), value: activeHumanProfile.org },
            { label: t('profile.state'), value: activeHumanProfile.status },
            { label: t('profile.recentMessage'), value: activeHumanProfile.subtitle },
          ]}
          name={activeHumanProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) openHumanDirectMessage();
            if (action === t('profile.copyLink')) {
              copyText(`agenthub://user/${activeHumanProfile.id}`);
              showWorkbenchToast(t('toast.contactLinkCopied'));
            }
          }}
          onClose={() => setActiveHumanProfile(null)}
          subtitle={`${activeHumanProfile.tag} · ${activeHumanProfile.org}`}
        />
      )}
      {activeGroupProfile && (
        <ProfilePopover
          actions={[
            { label: t('profile.sendMessage') },
          ]}
          anchorElement={activeGroupProfile.anchor}
          avatar={workbenchProfileInitials(activeGroupProfile.name)}
          avatarColor="var(--primary)"
          badge={t('profile.groupChat')}
          isOpen
          meta={[
            { label: t('profile.type'), value: t('profile.groupType') },
            ...(activeGroupProfile.memberNames.length > 0
              ? [{ label: t('profile.members'), value: activeGroupProfile.memberNames.join(' · ') }]
              : []),
          ]}
          name={activeGroupProfile.name}
          onAction={(action) => {
            if (action === t('profile.sendMessage')) {
              selectConversation(activeGroupProfile.id);
              setActiveGroupProfile(null);
            }
          }}
          onClose={() => setActiveGroupProfile(null)}
          subtitle={activeGroupProfile.memberNames.length > 0
            ? `${activeGroupProfile.memberNames.length} ${t('profile.members').toLowerCase()}`
            : t('profile.groupSession')}
          variant="group"
        />
      )}
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}

function buildMainchainSummary({
  composerTargetLabel,
  evidence,
  platformSurface,
  runtimeEvidence,
  selectedExecutionTargetId,
  targetRequired,
  transcript,
  workbenchStatus,
  t,
}: {
  composerTargetLabel?: string | undefined;
  evidence: EvidenceRef[];
  platformSurface: AgentHubPlatform['surface'];
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  selectedExecutionTargetId: string;
  targetRequired: boolean;
  transcript: TranscriptBlock[];
  workbenchStatus?: AgentHubWorkbenchProps['workbenchStatus'];
  t: (key: string, options?: Record<string, unknown>) => string;
}): MainchainSummary {
  const runSession = transcript.find((block) => block.kind === 'run_session');
  const taskId = runSession?.kind === 'run_session' ? runSession.taskId : undefined;
  const edgeRunId = runSession?.kind === 'run_session' ? runSession.edgeRunId : undefined;
  const runId = runtimeEvidence?.runId ?? (runSession?.kind === 'run_session' ? runSession.runId : undefined);
  const artifactCount = runtimeEvidence
    ? runtimeEvidence.artifacts.length
    : evidence.filter((item) => item.kind === 'artifact').length;
  const approvalCount = evidence.filter((item) => item.kind === 'approval').length
    + transcript.filter((block) => block.kind === 'approval' || block.kind === 'permission_request').length;
  const diffCount = runtimeEvidence?.diffs.length ?? evidence.filter((item) => item.kind === 'file').length;
  const previewCount = runtimeEvidence?.previews.length ?? evidence.filter((item) => item.kind === 'preview').length;
  const routeBlocks = transcript.filter((block) => block.kind === 'route_decision');
  const workerBlocks = transcript.filter((block) => (
    block.kind === 'subagent' || block.kind === 'subtask' || block.kind === 'child_agent'
  ));
  const eventBlocks = transcript.filter((block) => (
    block.kind === 'agent_timeline' || block.kind === 'tool_call' || block.kind === 'run_step_group'
  ));
  const supervisorLabel = runSession?.kind === 'run_session'
    ? runSession.agentLabel ?? runSession.author.name
    : routeBlocks[0]?.author.name ?? 'Supervisor';
  const workerLabel = workerBlocks.map((block) => {
    if (block.kind === 'subagent' || block.kind === 'subtask') return block.worker;
    return block.agent;
  }).find(Boolean) ?? routeBlocks.find((block) => block.kind === 'route_decision')?.targetAgent;
  const evidencePathDetail = `${approvalCount} approval / ${artifactCount} artifact`;
  const hasRuntimeEvidence = Boolean(runtimeEvidence && (
    runtimeEvidence.diffs.length > 0
    || runtimeEvidence.artifacts.length > 0
    || runtimeEvidence.previews.length > 0
    || runtimeEvidence.runId
    || runtimeEvidence.loading?.diff
    || runtimeEvidence.loading?.artifacts
    || runtimeEvidence.loading?.previews
    || runtimeEvidence.errors?.diff
    || runtimeEvidence.errors?.artifacts
    || runtimeEvidence.errors?.previews
  ));
  const hasExportEvidence = evidence.length > 0 || hasRuntimeEvidence || Boolean(runSession);
  const targetLabel = composerTargetLabel
    ?? workbenchStatus?.targetLabel
    ?? (runSession?.kind === 'run_session' ? runSession.targetLabel : undefined);
  const targetBlocked = targetRequired
    && !selectedExecutionTargetId
    && (workbenchStatus?.targetState === 'no-target' || !targetLabel);
  const targetState = targetBlocked
    ? 'blocked'
    : targetLabel
      ? 'done'
      : targetRequired
        ? 'waiting'
        : 'empty';

  const nodes: MainchainNode[] = [
    {
      id: 'web',
      label: platformSurface === 'web' ? 'Web' : 'Shared UI',
      detail: platformSurface === 'web' ? 'Shared/Web workbench' : 'Desktop shared workbench',
      state: 'done',
    },
    {
      id: 'hub-task',
      label: 'Hub task',
      detail: taskId ? taskId : workbenchStatus?.replayLabel ?? t('mainchain.waitingTask'),
      state: taskId ? 'done' : workbenchStatus?.replayLabel ? 'active' : 'waiting',
    },
    {
      id: 'supervisor',
      label: 'Supervisor',
      detail: supervisorLabel,
      state: supervisorLabel === 'Supervisor' ? 'waiting' : 'done',
    },
    {
      id: 'worker',
      label: 'Worker',
      detail: workerLabel ?? t('mainchain.waitingWorker'),
      state: workerLabel ? 'active' : 'waiting',
    },
    {
      id: 'route-event',
      label: 'Route + event',
      detail: `${routeBlocks.length} route / ${eventBlocks.length} event`,
      state: routeBlocks.length + eventBlocks.length > 0 ? 'done' : 'empty',
    },
    {
      id: 'target',
      label: 'Exact target',
      detail: targetLabel ?? (targetBlocked ? t('mainchain.noTarget') : t('mainchain.pickTarget')),
      state: targetState,
    },
    {
      id: 'edge',
      label: 'Active run',
      detail: edgeRunId ?? runId ?? runtimeEvidenceSourceSummary(runtimeEvidence, t),
      state: runId || edgeRunId ? 'active' : hasRuntimeEvidence ? 'done' : 'waiting',
    },
    {
      id: 'replay',
      label: 'Replay',
      detail: transcript.length > 0 ? `${transcript.length} transcript blocks` : t('mainchain.noTranscript'),
      state: transcript.length > 0 ? 'done' : 'empty',
    },
    {
      id: 'evidence-path',
      label: 'Approval/artifact',
      detail: artifactCount + approvalCount + diffCount + previewCount > 0
        ? `${evidencePathDetail} / ${diffCount} diff / ${previewCount} preview`
        : t('mainchain.noApprovalArtifact'),
      state: approvalCount > 0 ? 'active' : artifactCount + diffCount + previewCount > 0 ? 'done' : 'empty',
    },
  ];

  return {
    nodes,
    exportEnabled: hasExportEvidence,
    exportLabel: hasExportEvidence ? t('mainchain.exportJson') : t('mainchain.waitingEvidence'),
    exportDetail: hasExportEvidence
      ? 'Copy Web -> Hub task -> target -> Edge -> replay/artifact/approval evidence JSON'
      : t('mainchain.noRuntimeEvidence'),
  };
}

function runtimeEvidenceSourceSummary(runtimeEvidence: RuntimeEvidenceSnapshot | undefined, t: (key: string) => string): string {
  if (!runtimeEvidence) return t('mainchain.waitingEdgeEvidence');
  const loading = [
    runtimeEvidence.loading?.diff ? 'diff loading' : undefined,
    runtimeEvidence.loading?.artifacts ? 'artifact loading' : undefined,
    runtimeEvidence.loading?.previews ? 'preview loading' : undefined,
  ].filter(Boolean);
  if (loading.length > 0) return loading.join(' / ');
  const errors = [
    runtimeEvidence.errors?.diff ? 'diff error' : undefined,
    runtimeEvidence.errors?.artifacts ? 'artifact error' : undefined,
    runtimeEvidence.errors?.previews ? 'preview error' : undefined,
  ].filter(Boolean);
  if (errors.length > 0) return errors.join(' / ');
  return 'Edge evidence empty';
}

function configuredAgentProfiles(): Array<Omit<AgentProfileState, 'anchor'>> {
  return WORKBENCH_MOCK_AGENT_CONFIGS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    engine: agent.engine,
    model: agent.model,
    state: agent.state,
    skills: agent.skills,
  }));
}

function agentStateLabel(t: (key: string) => string, state: string): string {
  switch (state) {
    case 'running':
      return t('agent.state.running');
    case 'ready':
    case 'available':
      return t('agent.state.ready');
    case 'waiting':
      return t('agent.state.waiting');
    case 'configuring':
      return t('agent.state.configuring');
    case 'unavailable':
      return t('agent.state.unavailable');
    default:
      return state || t('label.agent');
  }
}
