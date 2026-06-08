import React, { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  buildComposerIntent,
  canSubmitComposer,
  type ComposerMention,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '../platform';
import { toggleAppliedAgentHubTheme } from '../theme';
import { collectTranscriptEvidence } from '../transcript';
import type { TranscriptBlock } from '../transcript';
import { ConversationSidebar } from './ConversationSidebar';
import {
  ContextMenu,
  MultiSelectBar,
  ProfilePopover,
  Toast,
  type ContextMenuItem,
  type MultiSelectBarAction,
} from './floating';
import { GlobalRail, type GlobalRailPage } from './GlobalRail';
import { RightInspector } from './RightInspector';
import { TranscriptView, type TranscriptContextMenuEvent, type TranscriptPointerEvent } from './TranscriptView';
import type { FileItem } from './inspector';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import type { WorkbenchAgentProfilesStatus, WorkbenchContactsData } from './WorkbenchRoutes';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS } from './mockData';
import type { AgentConfig } from './pages';
import type { ProjectInfo } from './pages/ProjectsPage';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import { useComposerSubmitBehavior } from './workbenchPreferences';
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
const DEFAULT_BROWSER_PREVIEW_URL_BY_SURFACE = {
  desktop: 'http://127.0.0.1:5176/desktop/',
  web: 'http://127.0.0.1:5176/desktop/',
} as const;

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
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  projects?: ProjectInfo[] | undefined;
  projectsStatus?: { loading?: boolean | undefined; error?: string | undefined } | undefined;
  activeConversationId?: string;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  transcript: TranscriptBlock[];
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents,
  agentProfilesStatus,
  contacts,
  projects,
  projectsStatus,
  activeConversationId,
  onActiveConversationChange,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  transcript,
}: AgentHubWorkbenchProps): React.ReactElement {
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
  const [activeAgentProfile, setActiveAgentProfile] = useState<AgentProfileState | null>(null);
  const [activeHumanProfile, setActiveHumanProfile] = useState<HumanProfileState | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | undefined>(undefined);
  const [reviewFileRequest, setReviewFileRequest] = useState<FileItem | null>(null);
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
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );
  const composerSubmitBehavior = useComposerSubmitBehavior();
  const evidence = collectTranscriptEvidence(transcript);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
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

  useEffect(() => {
    if (!isChatPage || sidebarCollapsed) return;
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? workspace.getBoundingClientRect().width;
      if (width < WORKSPACE_AUTO_COLLAPSE_WIDTH) {
        setSidebarCollapsed(true);
      }
    });

    observer.observe(workspace);
    return () => observer.disconnect();
  }, [isChatPage, sidebarCollapsed]);

  async function submitComposer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitComposer(composer)) return;

    dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
    try {
      await platform.runs.submitComposerIntent(buildComposerIntent(composer));
      dispatchComposer({ type: 'resetAfterSubmit' });
    } catch {
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
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
    if (page === 'chat' && activePage === 'chat') {
      toggleSidebar();
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
      setActiveHumanProfile(humanProfileByName(agentName, anchor));
      return;
    }
    setActiveHumanProfile(null);
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
    setActiveAgentProfile({ ...agent, anchor });
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
    if (!conversation) {
      showWorkbenchToast(`还没有 ${activeAgentProfile.name} 的私聊会话`);
      return;
    }
    selectConversation(conversation.id);
    setActivePage('chat');
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function openHumanDirectMessage(): void {
    if (!activeHumanProfile) return;
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === activeHumanProfile.name.toLowerCase()
      || item.id.toLowerCase() === activeHumanProfile.id.toLowerCase()
    ));
    if (!conversation) {
      showWorkbenchToast(`还没有 ${activeHumanProfile.name} 的私聊会话`);
      return;
    }
    selectConversation(conversation.id);
    setActivePage('chat');
    setActiveHumanProfile(null);
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

  function blockTitle(block: TranscriptBlock): string {
    switch (block.kind) {
      case 'text':
        return block.text.slice(0, 28) || block.author.name;
      case 'tool_call':
        return block.toolName;
      case 'diff':
      case 'approval':
      case 'artifact':
      case 'subagent':
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
    if (action === 'copy') copyText(title);
    if (action === 'link') copyText(`agenthub://card/${blockId}`);
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => (
        current.includes(blockId) ? current : [...current, blockId]
      ));
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

  function contextMenuGroups(blockId: string): Array<Array<ContextMenuItem>> {
    return [
      [
        { label: '复制', icon: 'fileText', shortcut: 'Ctrl C', onClick: () => runContextAction('copy', blockId) },
        { label: '表情回复', icon: 'star', chevron: true, onClick: () => runContextAction('react', blockId) },
        { label: '回复', icon: 'notes', onClick: () => runContextAction('reply', blockId) },
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
        onToggleTheme={handleToggleTheme}
      />
      {isChatPage && (
        <div className={styles.sidebarFrame}>
          <ConversationSidebar
            activeConversationId={currentConversationId}
            conversations={conversations}
            onSelectConversation={selectConversation}
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
        data-mode={isChatPage ? 'chat' : 'workbench'}
        data-surface={platform.surface}
        data-workspace-main
      >
        {isChatPage ? (
          <>
            <WorkspaceHeader
              activeConversation={activeConversation}
              inspectorCollapsed={inspectorCollapsed}
              onToggleInspector={toggleInspector}
            />
            <TranscriptView
              actionedBlockIds={actionedBlockIds}
              contextBlockId={contextMenu?.blockId}
              onBlockContextMenu={openBlockContextMenu}
              onBlockPointerDown={beginBlockHoldSelection}
              onBlockPointerMove={(_block, event) => updateBlockHoldSelection(event)}
              onBlockPointerUp={handleBlockPointerUp}
              onBlockSelect={handleBlockSelect}
              onAgentProfileOpen={openAgentProfile}
              onReviewFile={openReviewFile}
              pinnedAnnouncement={activeConversation?.pinnedAnnouncement ? {
                ...activeConversation.pinnedAnnouncement,
                onCopy: () => showWorkbenchToast('已打开置顶内容'),
                onDismiss: () => showWorkbenchToast('已关闭置顶'),
              } : undefined}
              selectedBlockIds={selectedBlockIds}
              selectionMode={selectionMode}
              softHiddenBlockIds={softHiddenBlockIds}
              transcript={transcript}
            />
            {!selectionMode && (
              <UnifiedComposer
                composer={composer}
                dispatchComposer={dispatchComposer}
                inputRef={composerInputRef}
                mentionableAgents={mentionableAgents}
                onPickLocalAttachments={platform.attachments?.pickFiles}
                onSubmit={submitComposer}
                submitBehavior={composerSubmitBehavior}
                targetLabel={activeConversation?.title ?? 'AgentHub'}
              />
            )}
          </>
        ) : (
          <section aria-label="Workbench page" className={styles.workbenchPageHost}>
            <WorkbenchRoutes
              activePage={activePage}
              agents={agents}
              agentProfilesStatus={agentProfilesStatus}
              contacts={contacts}
              focusedAgentId={focusedAgentId}
              projects={projects}
              projectsStatus={projectsStatus}
              onAgentCreate={onAgentCreate}
              onAgentUpdate={onAgentUpdate}
              onAgentDelete={onAgentDelete}
              onAgentsRetry={onAgentsRetry}
              onAgentProfileOpen={openAgentProfileFromConfig}
            />
          </section>
        )}
      </main>

      {isChatPage && (
        <RightInspector
          browserPreviewEnabled={platform.capabilities.browserPreview}
          canOpenPreview={platform.preview?.canOpenEvidence}
          collapsed={inspectorCollapsed}
          defaultBrowserUrl={DEFAULT_BROWSER_PREVIEW_URL_BY_SURFACE[platform.surface]}
          evidence={evidence}
          maxWidth={INSPECTOR_MAX_WIDTH}
          minWidth={INSPECTOR_MIN_WIDTH}
          onOpenPreview={platform.preview?.openEvidence}
          reviewFileRequest={reviewFileRequest}
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
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
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
