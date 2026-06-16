import React, { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  buildComposerIntent,
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
import type { TranscriptBlock, ContextUsageTranscriptBlock, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, ChildAgentTranscriptBlock, TextTranscriptBlock } from '../transcript';
import type { ApprovalDecisionAction } from '../transcript';
import { ConversationSidebar } from './ConversationSidebar';
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
import { TranscriptView, type TranscriptContextMenuEvent, type TranscriptPointerEvent } from './TranscriptView';
import { ChatViewTranscript } from '../chatview/ChatViewTranscript';
import type { EvidenceRef } from '../transcript';
import type { FileItem } from './inspector';
import { UnifiedComposer, type AttachmentUploadState } from './UnifiedComposer';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import type { WorkbenchAgentProfilesStatus, WorkbenchContactsData, WorkbenchContactsActions, WorkbenchDocumentsActions } from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
import { WorkspaceHeader } from './WorkspaceHeader';

import MessageSearchPanel from '../ui/MessageSearchPanel';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS, WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import type { AgentConfig, ProjectDraft, DocRow } from './pages';
import type { SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import { useComposerSubmitBehavior } from './workbenchPreferences';
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

type MainchainStatusKind = 'done' | 'active' | 'waiting' | 'blocked' | 'empty';

function isSidebarOnlyTranscriptBlock(block: TranscriptBlock): boolean {
  switch (block.kind) {
    case 'run_step_group':
    case 'run_session':
    case 'agent_timeline':
    case 'route_decision':
    case 'subagent':
    case 'subtask':
    case 'child_agent':
    case 'context_usage':
      return true;
    default:
      return false;
  }
}

interface MainchainNode {
  id: string;
  label: string;
  detail: string;
  state: MainchainStatusKind;
}

interface MainchainSummary {
  nodes: MainchainNode[];
  exportEnabled: boolean;
  exportLabel: string;
  exportDetail: string;
}

const LOCAL_CLI_DISCOVERY_FALLBACK: LocalCliDiscoveryManifest = {
  mode: 'no-spend-discovery',
  readinessManifest: 'docs/audit/p0-edge-cli-real-readiness.md',
  readinessScript: 'scripts/verify-edge-cli-real-readiness.ps1',
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
    dataMode?: string | undefined;
    replayLabel?: string | undefined;
    targetLabel?: string | undefined;
    targetState?: string | undefined;
    /** Whether the workbench is loading initial data (threads/conversations not yet loaded). */
    initialLoading?: boolean | undefined;
    /** Error message from initial data load, if any. */
    loadError?: string | undefined;
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
}: AgentHubWorkbenchProps): React.ReactElement {
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
  const isSubmittingRef = useRef(false);
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
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, AttachmentUploadState>>({});
  /** Optimistic user message shown in transcript before the API confirms the run. */
  const [pendingUserBlock, setPendingUserBlock] = useState<TextTranscriptBlock | null>(null);
  const composerSubmitBehavior = useComposerSubmitBehavior();
  const chatTranscript = useMemo(
    () => transcript.filter((block) => !isSidebarOnlyTranscriptBlock(block)),
    [transcript],
  );
  // Chat transcript with optimistic user message appended (for rendering only).
  // Derived data (evidence, inspector blocks) continues to use the raw transcript.
  const displayTranscript = useMemo(
    () => pendingUserBlock ? [...chatTranscript, pendingUserBlock] : chatTranscript,
    [chatTranscript, pendingUserBlock],
  );
  // Clear the optimistic block as soon as the real transcript gains new blocks
  // (i.e. the API response has arrived and the query cache was updated).
  useEffect(() => {
    if (!pendingUserBlock) return;
    if (transcript.some((block) => block.id === pendingUserBlock.id)) {
      setPendingUserBlock(null);
    }
  }, [transcript, pendingUserBlock]);
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
  });

  // ── Inspector data: route decisions, context usage, deploy preview ──
  const inspectorRouteBlocks = useMemo(
    () => transcript.filter((block): block is RouteDecisionTranscriptBlock | SubagentTranscriptBlock | ChildAgentTranscriptBlock =>
      block.kind === 'route_decision' || block.kind === 'subagent' || block.kind === 'child_agent',
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
      .catch(() => {
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
        runMultiAction('copy');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        runMultiAction('delete');
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

  async function submitComposer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Guard against double-submit race: two rapid Enter presses
    if (isSubmittingRef.current) return;

    // Read the textarea's current DOM value to avoid stale React state.
    // When the user types and presses Enter quickly, React may not have
    // re-rendered yet, so composer.text can be stale.
    const form = event.currentTarget;
    const textarea = form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Composer input"]');
    const liveText = textarea?.value ?? composer.text;

    if (liveText.trim().length === 0 && composer.attachments.length === 0) return;

    // Capture conversation ID to prevent thread-switch race:
    // if the user switches threads during async operations, the intent
    // must still target the original conversation.
    const capturedConversationId = currentConversationId;

    isSubmittingRef.current = true;
    dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });

    try {
      // Build intent and capture attachment state BEFORE resetting the composer.
      const intent = buildComposerIntent(composer);
      const intentWithLiveText = { ...intent, text: liveText.trim(), conversationId: capturedConversationId };
      const capturedAttachments = composer.attachments;
      const pendingAttachments = capturedAttachments.filter((a) => !a.attachmentRef && a.file);

      // ── Optimistic UI: reset the composer immediately so the user can
      // type the next message while uploads and the API call are in flight. ──
      const optimisticId = `pending-user-${Date.now()}`;
      setPendingUserBlock({
        id: optimisticId,
        kind: 'text',
        text: liveText.trim(),
        author: { id: 'user', name: 'You', role: 'human' as const },
        createdAt: new Date().toISOString(),
        ...(composer.replyTo ? { replyToMessageId: composer.replyTo.messageId, replyPreview: composer.replyTo.preview, replyAuthor: composer.replyTo.author } : {}),
        ...(composer.quote ? { quote: composer.quote.text } : {}),
      });

      dispatchComposer({ type: 'resetAfterSubmit' });
      dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
      setUploadProgresses({});

      // Upload attachments in background (composer is already cleared).
      let enrichedAttachments = capturedAttachments;
      if (pendingAttachments.length > 0 && platform.attachments?.uploadAttachment) {
        const uploadPort = platform.attachments;
        for (const attachment of pendingAttachments) {
          if (!attachment.file) continue;
          try {
            setUploadProgresses((prev) => ({
              ...prev,
              [attachment.id]: { percent: 5, phase: 'hashing' },
            }));
            const ref = await uploadPort.uploadAttachment(attachment.file);
            setUploadProgresses((prev) => ({
              ...prev,
              [attachment.id]: { percent: 100, phase: 'done' },
            }));
            enrichedAttachments = enrichedAttachments.map((a) =>
              a.id === attachment.id ? { ...a, attachmentRef: ref } : a,
            );
          } catch {
            setUploadProgresses((prev) => {
              const next = { ...prev };
              delete next[attachment.id];
              return next;
            });
          }
        }
      }

      const finalIntent = enrichedAttachments.length > 0
        ? { ...intentWithLiveText, attachments: enrichedAttachments }
        : intentWithLiveText;

      const submitPayload = {
        ...finalIntent,
        ...(selectedExecutionTargetId ? { executionTargetId: selectedExecutionTargetId } : {}),
      };

      await platform.runs.submitComposerIntent(submitPayload);

      setPendingUserBlock(null);
      dispatchComposer({ type: 'setSubmitState', submitState: 'idle' });
    } catch (err) {
      setPendingUserBlock(null);
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
      setUploadProgresses({});
      showWorkbenchToast(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      isSubmittingRef.current = false;
    }
  }

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
    setToastMessage(message);
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 1700);
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
      role: runtimeAgent.description ?? 'Agent',
      engine: 'AgentHub',
      model: runtimeAgent.model ?? '未配置',
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
      org: contact?.org ?? '联系人',
      status: contact?.status ?? conversation?.updatedLabel ?? '在线',
      tag: contact?.tag ?? (conversation?.kind === 'group' ? '群聊' : '好友'),
      subtitle: conversation?.subtitle ?? contact?.org ?? '好友',
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
      showWorkbenchToast(`还没有 ${activeAgentProfile.name} 的私聊会话`);
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
      showWorkbenchToast(`还没有 ${activeHumanProfile.name} 的私聊会话`);
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
    showWorkbenchToast(`已打开 ${activeAgentProfile.name} 配置`);
  }

  function openReviewFile(file: FileItem): void {
    openInspector();
    setReviewFileRequest({ ...file });
  }

  function handleSearchJump(messageId: string, _messageIndex?: number): void {
    setSearchOpen(false);
    setSearchHighlightId(messageId);
  }

  function handleSearchHighlightEnd(): void {
    setSearchHighlightId(null);
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
        return block.title ?? '运行时间线';
      case 'result':
        return block.summary || (block.success ? '运行结果' : '运行失败');
      case 'thinking':
        return '思考过程';
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
    return block ? blockTitle(block) : '选中卡片';
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
    setActionedBlockIds((current) => (
      current.includes(blockId) ? current : [...current, blockId]
    ));
    window.setTimeout(() => {
      setActionedBlockIds((current) => current.filter((id) => id !== blockId));
    }, 900);
  }

  function cardActionLabel(action: string, title: string): string {
    const labels: Record<string, string> = {
      copy: '已复制卡片内容',
      react: '已打开表情回复',
      reply: `正在回复 ${title}`,
      forward: '已加入转发队列',
      topic: '已创建话题草稿',
      pin: '已更新置顶',
      link: '已复制消息链接',
      translate: '已加入翻译队列',
      task: '已添加到任务草稿',
      export: '已导出到云文档草稿',
      apps: '已打开快捷应用',
      delete: '已标记删除',
    };
    return labels[action] ?? '操作已记录';
  }

  function multiActionLabel(action: string, count: number): string {
    const labels: Record<string, string> = {
      copy: `已复制 ${count} 项`,
      forward: `已准备转发 ${count} 项`,
      task: `已为 ${count} 项创建任务草稿`,
      export: `已导出 ${count} 项到文档草稿`,
      delete: `已删除 ${count} 项`,
    };
    return labels[action] ?? `已处理 ${count} 项`;
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

  function runMultiAction(action: string): void {
    const count = selectedBlockIds.length;
    if (!count) {
      showWorkbenchToast('还没有选择卡片');
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

  function exportMainchainEvidence(): void {
    if (!mainchainSummary.exportEnabled) {
      showWorkbenchToast('暂无可导出的主链证据');
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
    showWorkbenchToast('已复制主链证据 JSON');
  }

  function contextMenuGroups(blockId: string): Array<Array<ContextMenuItem>> {
    const block = transcript.find((item) => item.id === blockId);
    const isAgentText = block?.kind === 'text' && block.author.role === 'agent';
    const isTextBlock = block?.kind === 'text';
    return [
      [
        { label: '复制', icon: 'fileText', shortcut: 'Ctrl C', onClick: () => runContextAction('copy', blockId) },
        { label: '表情回复', icon: 'star', chevron: true, onClick: () => runContextAction('react', blockId) },
        { label: '回复', icon: 'notes', onClick: () => runContextAction('reply', blockId) },
        ...(isTextBlock ? [{ label: '引用', icon: 'copy' as const, onClick: () => runContextAction('quote', blockId) }] : []),
        { label: '转发', icon: 'external', onClick: () => runContextAction('forward', blockId) },
      ],
      [
        { label: '创建话题', icon: 'groups', onClick: () => runContextAction('topic', blockId) },
        { label: '多选', icon: 'grid', shortcut: 'Shift', onClick: () => enterSelection(blockId) },
        { label: '置顶消息', icon: 'bell', onClick: () => runContextAction('pin', blockId) },
        { label: '复制消息链接', icon: 'external', onClick: () => runContextAction('link', blockId) },
        { label: '翻译', icon: 'library', onClick: () => runContextAction('translate', blockId) },
      ],
      [
        ...(isAgentText ? [{ label: '重新生成', icon: 'refresh' as const, onClick: () => runContextAction('regenerate', blockId) }] : []),
        { label: '添加任务', icon: 'running', onClick: () => runContextAction('task', blockId) },
        { label: '导出到文档', icon: 'download', onClick: () => runContextAction('export', blockId) },
        { label: '快捷应用', icon: 'tools', chevron: true, onClick: () => runContextAction('apps', blockId) },
        { label: '删除', icon: 'archive', danger: true, onClick: () => runContextAction('delete', blockId) },
      ],
    ];
  }

  const multiSelectActions: Array<MultiSelectBarAction> = [
    {
      label: '全选',
      icon: 'done',
      onClick: () => setSelectedBlockIds(transcript.map((block) => block.id)),
    },
    {
      label: '清空',
      icon: 'filter',
      onClick: () => setSelectedBlockIds([]),
    },
    { label: '复制', icon: 'fileText', onClick: () => runMultiAction('copy') },
    { label: '转发', icon: 'external', onClick: () => runMultiAction('forward') },
    { label: '添加任务', icon: 'running', onClick: () => runMultiAction('task') },
    { label: '导出文档', icon: 'download', onClick: () => runMultiAction('export') },
    { label: '删除', icon: 'archive', danger: true, onClick: () => runMultiAction('delete') },
    {
      label: '退出',
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
            aria-label="调整最近频道宽度"
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
        aria-label="Workspace"
        className={styles.workspace}
        data-mainchain={showMainchainStatus ? 'true' : 'false'}
        data-mode={isChatPage ? 'chat' : 'workbench'}
        data-surface={platform.surface}
        data-workspace-main
      >
        {workbenchStatus?.initialLoading && conversations.length === 0 ? (
          <div className={styles.workspaceLoading} role="status">
            <span className={styles.workspaceLoadingSpinner} />
            <span className={styles.workspaceLoadingLabel}>正在连接 Edge 并加载数据...</span>
          </div>
        ) : isChatPage ? (
          <>
            <WorkspaceHeader
              activeConversation={activeConversation}
              dataMode={workbenchStatus?.dataMode}
              inspectorCollapsed={inspectorCollapsed}
              onToggleInspector={toggleInspector}
              onOpenSearch={() => setSearchOpen(true)}
            />
            {showMainchainStatus ? (
              <MainchainStatusStrip
                summary={mainchainSummary}
                onExportEvidence={exportMainchainEvidence}
              />
            ) : null}
            {/* ── CHATVIEW (new design system — primary view) ── */}
            <ChatViewTranscript transcript={displayTranscript} />
            {/* ── TranscriptView (legacy — reference below) ── */}
            <TranscriptView
            <MessageSearchPanel
              open={searchOpen}
              onClose={() => setSearchOpen(false)}
              onJumpToMessage={handleSearchJump}
              highlightMessageId={searchHighlightId}
              onHighlightEnd={handleSearchHighlightEnd}
              transcriptBlocks={displayTranscript}
              searchLabel="搜索消息"
              searchPlaceholder="搜索消息内容..."
              noResultsLabel="未找到匹配的消息"
            />
            {!selectionMode && (
              <UnifiedComposer
                composer={composer}
                dispatchComposer={dispatchComposer}
                executionTargets={composerExecutionTargets}
                executionTargetId={selectedExecutionTargetId}
                inputRef={composerInputRef}
                mentionableAgents={showComposerAgentPicker ? mentionableAgents : []}
                onExecutionTargetChange={setSelectedExecutionTargetId}
                onPickLocalAttachments={platform.attachments?.pickFiles}
                onSubmit={submitComposer}
                status={showComposerStatus ? workbenchStatus : undefined}
                submitBehavior={composerSubmitBehavior}
                targetLabel={activeConversation?.title ?? 'AgentHub'}
                uploadProgresses={uploadProgresses}
              />
            )}
          </>
        ) : (
          <section aria-label="Workbench page" className={styles.workbenchPageHost}>
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
            { label: '发送消息' },
            { label: 'Agent 配置' },
          ]}
          anchorElement={activeAgentProfile.anchor}
          avatar={workbenchProfileInitials(activeAgentProfile.name)}
          avatarColor={workbenchAgentColor(activeAgentProfile)}
          badge={agentStateLabel(activeAgentProfile.state)}
          isOpen
          meta={[
            { label: '职责', value: activeAgentProfile.role },
            { label: '引擎', value: activeAgentProfile.engine },
            { label: '模型', value: activeAgentProfile.model },
            { label: 'Skills', value: activeAgentProfile.skills.join(' · ') || '未配置' },
          ]}
          name={activeAgentProfile.name}
          onAction={(action) => {
            if (action === '发送消息') openAgentDirectMessage();
            if (action === 'Agent 配置') openAgentConfig();
          }}
          onClose={() => setActiveAgentProfile(null)}
          subtitle={`${activeAgentProfile.role} · ${activeAgentProfile.engine}`}
          variant="agent"
        />
      )}
      {activeHumanProfile && (
        <ProfilePopover
          actions={[
            { label: '发送消息' },
            { label: '复制链接' },
          ]}
          anchorElement={activeHumanProfile.anchor}
          avatar={activeHumanProfile.initials}
          avatarColor={activeHumanProfile.avatarColor ?? 'var(--surface-highest)'}
          badge={activeHumanProfile.tag}
          isOpen
          meta={[
            { label: '身份', value: activeHumanProfile.tag },
            { label: '组织', value: activeHumanProfile.org },
            { label: '状态', value: activeHumanProfile.status },
            { label: '最近消息', value: activeHumanProfile.subtitle },
          ]}
          name={activeHumanProfile.name}
          onAction={(action) => {
            if (action === '发送消息') openHumanDirectMessage();
            if (action === '复制链接') {
              copyText(`agenthub://user/${activeHumanProfile.id}`);
              showWorkbenchToast('已复制联系人链接');
            }
          }}
          onClose={() => setActiveHumanProfile(null)}
          subtitle={`${activeHumanProfile.tag} · ${activeHumanProfile.org}`}
        />
      )}
      {activeGroupProfile && (
        <ProfilePopover
          actions={[
            { label: '发送消息' },
          ]}
          anchorElement={activeGroupProfile.anchor}
          avatar={workbenchProfileInitials(activeGroupProfile.name)}
          avatarColor="var(--primary)"
          badge="群聊"
          isOpen
          meta={[
            { label: '类型', value: '协作群' },
            ...(activeGroupProfile.memberNames.length > 0
              ? [{ label: '成员', value: activeGroupProfile.memberNames.join(' · ') }]
              : []),
          ]}
          name={activeGroupProfile.name}
          onAction={(action) => {
            if (action === '发送消息') {
              selectConversation(activeGroupProfile.id);
              setActiveGroupProfile(null);
            }
          }}
          onClose={() => setActiveGroupProfile(null)}
          subtitle={activeGroupProfile.memberNames.length > 0
            ? `${activeGroupProfile.memberNames.length} 人`
            : '群聊会话'}
          variant="group"
        />
      )}
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}

function MainchainStatusStrip({
  onExportEvidence,
  summary,
}: {
  onExportEvidence: () => void;
  summary: MainchainSummary;
}): React.ReactElement {
  return (
    <section className={styles.mainchainStrip} aria-label="Demo main chain status">
      <div className={styles.mainchainTrack} role="list">
        {summary.nodes.map((node) => (
          <div className={styles.mainchainNode} data-state={node.state} key={node.id} role="listitem">
            <span className={styles.mainchainDot} aria-hidden="true" />
            <span className={styles.mainchainCopy}>
              <strong>{node.label}</strong>
              <em>{node.detail}</em>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.mainchainExport}
        disabled={!summary.exportEnabled}
        onClick={onExportEvidence}
        title={summary.exportDetail}
      >
        {summary.exportLabel}
      </button>
    </section>
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
}: {
  composerTargetLabel?: string | undefined;
  evidence: EvidenceRef[];
  platformSurface: AgentHubPlatform['surface'];
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  selectedExecutionTargetId: string;
  targetRequired: boolean;
  transcript: TranscriptBlock[];
  workbenchStatus?: AgentHubWorkbenchProps['workbenchStatus'];
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
      detail: taskId ? taskId : workbenchStatus?.replayLabel ?? '等待 task/replay',
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
      detail: workerLabel ?? '等待 worker route',
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
      detail: targetLabel ?? (targetBlocked ? '没有在线 Desktop/Edge target' : '待选择 Desktop/Edge target'),
      state: targetState,
    },
    {
      id: 'edge',
      label: 'Active run',
      detail: edgeRunId ?? runId ?? runtimeEvidenceSourceSummary(runtimeEvidence),
      state: runId || edgeRunId ? 'active' : hasRuntimeEvidence ? 'done' : 'waiting',
    },
    {
      id: 'replay',
      label: 'Replay',
      detail: transcript.length > 0 ? `${transcript.length} transcript blocks` : '暂无 transcript',
      state: transcript.length > 0 ? 'done' : 'empty',
    },
    {
      id: 'evidence-path',
      label: 'Approval/artifact',
      detail: artifactCount + approvalCount + diffCount + previewCount > 0
        ? `${evidencePathDetail} / ${diffCount} diff / ${previewCount} preview`
        : '无 approval/artifact evidence',
      state: approvalCount > 0 ? 'active' : artifactCount + diffCount + previewCount > 0 ? 'done' : 'empty',
    },
  ];

  return {
    nodes,
    exportEnabled: hasExportEvidence,
    exportLabel: hasExportEvidence ? '导出证据 JSON' : '等待证据',
    exportDetail: hasExportEvidence
      ? '复制 Web -> Hub task -> target -> Edge -> replay/artifact/approval evidence JSON'
      : '暂无 transcript、runtime evidence 或 run session 可导出',
  };
}

function runtimeEvidenceSourceSummary(runtimeEvidence: RuntimeEvidenceSnapshot | undefined): string {
  if (!runtimeEvidence) return '等待 Edge evidence';
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

function agentStateLabel(state: string): string {
  switch (state) {
    case 'running':
      return '运行中';
    case 'ready':
    case 'available':
      return '可运行';
    case 'waiting':
      return '等待中';
    case 'configuring':
      return '配置中';
    case 'unavailable':
      return '不可用';
    default:
      return state || 'Agent';
  }
}
