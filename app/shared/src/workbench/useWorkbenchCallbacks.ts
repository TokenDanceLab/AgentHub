import { FormEvent, useCallback } from 'react';
import {
  buildComposerIntent,
  type ComposerMention,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import { toggleAppliedAgentHubTheme } from '../theme';
import type { TranscriptBlock, TextTranscriptBlock } from '../transcript';
import type { ApprovalDecisionAction } from '../transcript';
import type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
import type { FileItem } from './inspector';
import type { AttachmentUploadState } from './UnifiedComposer';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS } from './mockData';

/* ── Panel width constants ── */
export const INSPECTOR_MIN_WIDTH = 48;
export const INSPECTOR_MAX_WIDTH = 760;
export const INSPECTOR_DEFAULT_WIDTH = 400;
export const INSPECTOR_READABLE_WIDTH = 360;
export const INSPECTOR_COLLAPSE_SNAP_WIDTH = 96;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_COLLAPSE_SNAP_WIDTH = 96;
export const WORKSPACE_AUTO_COLLAPSE_WIDTH = 560;
export const SELECTION_HOLD_DELAY_MS = 520;
export const SELECTION_HOLD_CANCEL_DISTANCE = 36;

/* ── Types ── */
export interface AgentProfileState {
  id: string;
  name: string;
  role: string;
  engine: string;
  model: string;
  state: string;
  skills: string[];
  anchor: HTMLElement;
}

export interface HumanProfileState {
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

export interface GroupProfileState {
  id: string;
  name: string;
  memberNames: string[];
  anchor: HTMLElement;
}

interface SelectionHoldState {
  blockId: string;
  timer: number | null;
  x: number;
  y: number;
}

export type GlobalRailPage = 'chat' | 'agents' | 'projects' | 'tasks' | 'contacts' | 'docs' | 'settings';

export interface ContextMenuState {
  blockId: string;
  title: string;
  x: number;
  y: number;
}

export type AgentHubWorkbenchStatus = {
  dataMode?: string | undefined;
  replayLabel?: string | undefined;
  targetLabel?: string | undefined;
  targetState?: string | undefined;
  initialLoading?: boolean | undefined;
  loadError?: string | undefined;
};

/* ═══════════════════════════════════════════════════════════════════════
   Composer state shape (narrowed from reducer)
   ══════════════════════════════════════════════════════════════════════ */
export type ComposerState = ReturnType<typeof createInitialComposerState>;
export type ComposerAction = Parameters<typeof composerReducer>[1];

/* ── Parameters bag ── */
export interface UseWorkbenchCallbacksParams {
  /* ── Props values ── */
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents: WorkbenchAgent[] | undefined;
  composerExecutionTargets: Array<{ id: string; label: string }> | undefined;
  workbenchStatus: AgentHubWorkbenchStatus | undefined;
  onActiveConversationChange: ((conversationId: string) => void) | undefined;
  onNavigateToConversation: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  onApprovalDecision: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  onRegenerate: ((blockId: string) => void) | undefined;
  transcript: TranscriptBlock[];

  /* ── State setters ── */
  setLocalConversationId: (value: string | ((prev: string) => string)) => void;
  setInspectorWidth: (value: number | ((prev: number) => number)) => void;
  setInspectorCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  setInspectorResizing: (value: boolean) => void;
  setSidebarWidth: (value: number | ((prev: number) => number)) => void;
  setSidebarCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  setSidebarResizing: (value: boolean) => void;
  setActivePage: (page: GlobalRailPage) => void;
  setSelectedExecutionTargetId: (value: string) => void;
  setContextMenu: (value: ContextMenuState | null) => void;
  setSelectionMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedBlockIds: (value: string[] | ((prev: string[]) => string[])) => void;
  setActionedBlockIds: (value: string[] | ((prev: string[]) => string[])) => void;
  setSoftHiddenBlockIds: (value: string[] | ((prev: string[]) => string[])) => void;
  setToastMessage: (value: string) => void;
  setToastVisible: (value: boolean) => void;
  setDismissedPinnedIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setActiveAgentProfile: (value: AgentProfileState | null) => void;
  setActiveHumanProfile: (value: HumanProfileState | null) => void;
  setActiveGroupProfile: (value: GroupProfileState | null) => void;
  setFocusedAgentId: (value: string | undefined) => void;
  setReviewFileRequest: (value: FileItem | null) => void;
  setSearchOpen: (value: boolean) => void;
  setSearchHighlightId: (value: string | null) => void;
  setPendingUserBlock: (value: TextTranscriptBlock | null) => void;
  setUploadProgresses: (value: Record<string, AttachmentUploadState> | ((prev: Record<string, AttachmentUploadState>) => Record<string, AttachmentUploadState>)) => void;

  /* ── Refs ── */
  workspaceRef: React.RefObject<HTMLElement | null>;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  isSubmittingRef: React.MutableRefObject<boolean>;
  inspectorWidthRef: React.MutableRefObject<number>;
  sidebarWidthRef: React.MutableRefObject<number>;
  sidebarShouldCollapseRef: React.MutableRefObject<boolean>;
  selectionModeRef: React.MutableRefObject<boolean>;
  selectionHoldRef: React.MutableRefObject<SelectionHoldState | null>;
  suppressSelectionPointerUpRef: React.MutableRefObject<boolean>;

  /* ── Reducer ── */
  composer: ComposerState;
  dispatchComposer: React.Dispatch<ComposerAction>;

  /* ── Derived / current values ── */
  currentConversationId: string;
  mentionableAgents: ComposerMention[];
  selectedBlockIds: string[];
  selectedExecutionTargetId: string;
  inspectorWidth: number;
  inspectorCollapsed: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  isChatPage: boolean;
  activeConversation: WorkbenchConversation | undefined;

  /* ── Active profile state (needed by DM/config openers) ── */
  activeAgentProfile: AgentProfileState | null;
  activeHumanProfile: HumanProfileState | null;
  activeGroupProfile: GroupProfileState | null;
}

/* ── Return type ── */
export interface WorkbenchCallbacks {
  submitComposer: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  clampInspectorWidth: (value: number) => number;
  clampSidebarWidth: (value: number) => number;
  setSyncedInspectorWidth: (width: number) => void;
  setSyncedSidebarWidth: (width: number) => void;
  restoreInspectorWidth: (width?: number) => void;
  restoreSidebarWidth: (width?: number) => void;
  openInspector: (width?: number) => void;
  collapseSidebarForWorkspacePressure: (nextInspectorWidth: number) => void;
  toggleSidebar: () => void;
  navigateRail: (page: GlobalRailPage) => void;
  updateInspectorWidthFromClientX: (clientX: number) => void;
  updateSidebarWidthFromClientX: (clientX: number) => void;
  beginInspectorResize: (clientX: number) => void;
  beginSidebarResize: (clientX: number) => void;
  resizeInspectorBy: (delta: number) => void;
  resizeSidebarBy: (delta: number) => void;
  toggleInspector: () => void;
  handleToggleTheme: () => void;
  showWorkbenchToast: (message: string) => void;
  openAgentProfile: (agentName: string, anchor: HTMLElement) => void;
  openAgentProfileFromConfig: (agent: Omit<AgentProfileState, 'anchor'>, anchor: HTMLElement) => void;
  openConversationAvatar: (conversation: WorkbenchConversation, anchor: HTMLElement) => void;
  openAgentDirectMessage: () => void;
  openHumanDirectMessage: () => void;
  openAgentConfig: () => void;
  openReviewFile: (file: FileItem) => void;
  handleDeploySubmit: (_id: string) => void;
  handleSearchJump: (messageId: string, _messageIndex?: number) => void;
  handleSearchHighlightEnd: () => void;
  blockTitle: (block: TranscriptBlock) => string;
  blockTitleById: (blockId: string) => string;
  openBlockContextMenu: (block: TranscriptBlock, event: TranscriptContextMenuEvent) => void;
  selectBlock: (blockId: string) => void;
  selectRangeTo: (blockId: string) => void;
  handleBlockSelect: (blockId: string, event?: { shiftKey?: boolean }) => void;
  selectConversation: (conversationId: string) => void;
  enterSelection: (blockId: string) => void;
  clearSelectionHold: () => void;
  beginBlockHoldSelection: (block: TranscriptBlock, event: TranscriptPointerEvent) => void;
  updateBlockHoldSelection: (event: TranscriptPointerEvent) => void;
  handleBlockPointerUp: (block: TranscriptBlock, event: TranscriptPointerEvent) => void;
  isNestedInteractiveTarget: (target: EventTarget | null, card: HTMLElement) => boolean;
  copyText: (text: string) => void;
  pulseBlock: (blockId: string) => void;
  cardActionLabel: (action: string, title: string) => string;
  multiActionLabel: (action: string, count: number) => string;
  runContextAction: (action: string, blockId: string) => void;
  runMultiAction: (action: string) => void;
  handleTranscriptBlockAction: (action: string, blockId: string, metadata?: Record<string, unknown>) => void;
  contextMenuGroups: (blockId: string) => Array<Array<{ label: string; icon?: string; shortcut?: string; chevron?: boolean; danger?: boolean; onClick: () => void }>>;
}

/* ═══════════════════════════════════════════════════════════════════════
   isNestedInteractiveTarget  (pure utility, not a hook)
   ══════════════════════════════════════════════════════════════════════ */
export function isNestedInteractiveTarget(target: EventTarget | null, card: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest('button, a, input, textarea, select, label, [contenteditable="true"]');
  return Boolean(interactive && interactive !== card && !interactive.hasAttribute('data-selectable-card'));
}

/* ═══════════════════════════════════════════════════════════════════════
   HOOK
   ══════════════════════════════════════════════════════════════════════ */

export function useWorkbenchCallbacks(p: UseWorkbenchCallbacksParams): WorkbenchCallbacks {
  const {
    platform, conversations, agents, composerExecutionTargets,
    onActiveConversationChange, onNavigateToConversation,
    onApprovalDecision, onRegenerate, transcript,
    setLocalConversationId, setInspectorWidth, setInspectorCollapsed, setInspectorResizing,
    setSidebarWidth, setSidebarCollapsed, setSidebarResizing, setActivePage,
    setSelectedExecutionTargetId, setContextMenu, setSelectionMode, setSelectedBlockIds,
    setActionedBlockIds, setSoftHiddenBlockIds, setToastMessage, setToastVisible,
    setDismissedPinnedIds, setActiveAgentProfile, setActiveHumanProfile,
    setActiveGroupProfile, setFocusedAgentId, setReviewFileRequest,
    setSearchOpen, setSearchHighlightId, setPendingUserBlock, setUploadProgresses,
    workspaceRef, composerInputRef, isSubmittingRef, inspectorWidthRef,
    sidebarWidthRef, sidebarShouldCollapseRef, selectionModeRef, selectionHoldRef,
    suppressSelectionPointerUpRef, composer, dispatchComposer,
    currentConversationId, selectedBlockIds, selectedExecutionTargetId,
    inspectorWidth, inspectorCollapsed, sidebarWidth, sidebarCollapsed,
    isChatPage, activeConversation,
    activeAgentProfile, activeHumanProfile, activeGroupProfile,
  } = p;

  /* ── Toast ── */
  const showWorkbenchToast = useCallback(
    (message: string): void => {
      setToastMessage(message);
      setToastVisible(true);
      window.setTimeout(() => setToastVisible(false), 1700);
    },
    [setToastMessage, setToastVisible],
  );

  /* ── Panel width helpers ── */
  const clampInspectorWidth = useCallback(
    (value: number): number => Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value))),
    [],
  );
  const clampSidebarWidth = useCallback(
    (value: number): number => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value))),
    [],
  );
  const setSyncedInspectorWidth = useCallback(
    (width: number): void => { inspectorWidthRef.current = width; setInspectorWidth(width); },
    [inspectorWidthRef, setInspectorWidth],
  );
  const setSyncedSidebarWidth = useCallback(
    (width: number): void => { sidebarWidthRef.current = width; setSidebarWidth(width); },
    [sidebarWidthRef, setSidebarWidth],
  );
  const restoreInspectorWidth = useCallback(
    (width = INSPECTOR_DEFAULT_WIDTH): void => {
      setInspectorWidth((currentWidth) => {
        const nextWidth = currentWidth < INSPECTOR_READABLE_WIDTH ? clampInspectorWidth(width) : currentWidth;
        inspectorWidthRef.current = nextWidth;
        return nextWidth;
      });
    },
    [clampInspectorWidth, inspectorWidthRef, setInspectorWidth],
  );
  const restoreSidebarWidth = useCallback(
    (width = SIDEBAR_DEFAULT_WIDTH): void => {
      setSidebarWidth((currentWidth) => {
        const nextWidth = currentWidth < SIDEBAR_MIN_WIDTH ? clampSidebarWidth(width) : currentWidth;
        sidebarWidthRef.current = nextWidth;
        return nextWidth;
      });
    },
    [clampSidebarWidth, sidebarWidthRef, setSidebarWidth],
  );
  const openInspector = useCallback(
    (width = INSPECTOR_DEFAULT_WIDTH): void => { restoreInspectorWidth(width); setInspectorCollapsed(false); },
    [restoreInspectorWidth, setInspectorCollapsed],
  );
  const collapseSidebarForWorkspacePressure = useCallback(
    (nextInspectorWidth: number): void => {
      if (!isChatPage || sidebarCollapsed) return;
      const availableWorkspaceWidth = window.innerWidth - 52 - sidebarWidthRef.current - nextInspectorWidth;
      if (availableWorkspaceWidth < WORKSPACE_AUTO_COLLAPSE_WIDTH) {
        setSidebarCollapsed(true);
      }
    },
    [isChatPage, sidebarCollapsed, sidebarWidthRef, setSidebarCollapsed],
  );
  const toggleSidebar = useCallback(
    (): void => {
      setSidebarCollapsed((collapsed) => {
        if (collapsed || sidebarWidth < SIDEBAR_MIN_WIDTH) { setSyncedSidebarWidth(SIDEBAR_DEFAULT_WIDTH); return false; }
        return true;
      });
    },
    [sidebarWidth, setSidebarCollapsed, setSyncedSidebarWidth],
  );
  const navigateRail = useCallback(
    (page: GlobalRailPage): void => {
      if (page === 'chat') { setActivePage('chat'); setSidebarCollapsed(false); restoreSidebarWidth(); return; }
      setActivePage(page);
    },
    [setActivePage, setSidebarCollapsed, restoreSidebarWidth],
  );
  const updateInspectorWidthFromClientX = useCallback(
    (clientX: number): void => {
      const nextWidth = window.innerWidth - clientX;
      setInspectorCollapsed(false);
      const clampedWidth = clampInspectorWidth(nextWidth);
      collapseSidebarForWorkspacePressure(clampedWidth);
      if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
        setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH);
        setInspectorResizing(false);
        const collapse = () => setInspectorCollapsed(true);
        if (typeof window.requestAnimationFrame === 'function') { window.requestAnimationFrame(collapse); return; }
        collapse();
        return;
      }
      setSyncedInspectorWidth(clampedWidth);
    },
    [clampInspectorWidth, collapseSidebarForWorkspacePressure, setSyncedInspectorWidth, setInspectorResizing, setInspectorCollapsed],
  );
  const updateSidebarWidthFromClientX = useCallback(
    (clientX: number): void => {
      const nextWidth = clientX - 52;
      setSidebarCollapsed(false);
      if (nextWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH) { sidebarShouldCollapseRef.current = true; setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH); return; }
      sidebarShouldCollapseRef.current = false;
      setSyncedSidebarWidth(clampSidebarWidth(nextWidth));
    },
    [clampSidebarWidth, sidebarShouldCollapseRef, setSyncedSidebarWidth, setSidebarCollapsed],
  );
  const beginInspectorResize = useCallback(
    (clientX: number): void => { if (inspectorCollapsed) return; setInspectorResizing(true); updateInspectorWidthFromClientX(clientX); },
    [inspectorCollapsed, setInspectorResizing, updateInspectorWidthFromClientX],
  );
  const beginSidebarResize = useCallback(
    (clientX: number): void => { if (sidebarCollapsed) return; sidebarShouldCollapseRef.current = false; setSidebarResizing(true); updateSidebarWidthFromClientX(clientX); },
    [sidebarCollapsed, sidebarShouldCollapseRef, setSidebarResizing, updateSidebarWidthFromClientX],
  );
  const resizeInspectorBy = useCallback(
    (delta: number): void => {
      const nextWidth = clampInspectorWidth(inspectorWidth + delta);
      setInspectorCollapsed(false);
      collapseSidebarForWorkspacePressure(nextWidth);
      if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) { setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH); setInspectorCollapsed(true); return; }
      setSyncedInspectorWidth(nextWidth);
    },
    [inspectorWidth, clampInspectorWidth, collapseSidebarForWorkspacePressure, setSyncedInspectorWidth, setInspectorCollapsed],
  );
  const resizeSidebarBy = useCallback(
    (delta: number): void => {
      const rawWidth = sidebarWidth + delta;
      setSidebarCollapsed(false);
      if (rawWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH || (sidebarWidth <= SIDEBAR_MIN_WIDTH && rawWidth < SIDEBAR_MIN_WIDTH)) { setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH); setSidebarCollapsed(true); return; }
      setSyncedSidebarWidth(clampSidebarWidth(rawWidth));
    },
    [sidebarWidth, clampSidebarWidth, setSyncedSidebarWidth, setSidebarCollapsed],
  );
  const toggleInspector = useCallback(
    (): void => {
      setInspectorCollapsed((collapsed) => {
        if (collapsed || inspectorWidth < INSPECTOR_READABLE_WIDTH) { setInspectorWidth(INSPECTOR_DEFAULT_WIDTH); return false; }
        return true;
      });
    },
    [inspectorWidth, setInspectorCollapsed, setInspectorWidth],
  );
  const handleToggleTheme = useCallback(
    (): void => { toggleAppliedAgentHubTheme(); },
    [],
  );

  /* ── Copy & toast helpers ── */
  const copyText = useCallback(
    (text: string): void => { try { navigator.clipboard?.writeText?.(text)?.catch?.(() => {}); } catch { /* noop */ } },
    [],
  );
  const pulseBlock = useCallback(
    (blockId: string): void => {
      setActionedBlockIds((current) => (current.includes(blockId) ? current : [...current, blockId]));
      window.setTimeout(() => { setActionedBlockIds((current) => current.filter((id) => id !== blockId)); }, 900);
    },
    [setActionedBlockIds],
  );
  const cardActionLabel = useCallback(
    (action: string, title: string): string => {
      const labels: Record<string, string> = {
        copy: '已复制卡片内容', react: '已打开表情回复', reply: `正在回复 ${title}`,
        forward: '已加入转发队列', topic: '已创建话题草稿', pin: '已更新置顶',
        link: '已复制消息链接', translate: '已加入翻译队列', task: '已添加到任务草稿',
        export: '已导出到云文档草稿', apps: '已打开快捷应用', delete: '已标记删除',
      };
      return labels[action] ?? '操作已记录';
    },
    [],
  );
  const multiActionLabel = useCallback(
    (action: string, count: number): string => {
      const labels: Record<string, string> = {
        copy: `已复制 ${count} 项`, forward: `已准备转发 ${count} 项`,
        task: `已为 ${count} 项创建任务草稿`, export: `已导出 ${count} 项到文档草稿`, delete: `已删除 ${count} 项`,
      };
      return labels[action] ?? `已处理 ${count} 项`;
    },
    [],
  );

  /* ── Block title ── */
  const blockTitle = useCallback(
    (block: TranscriptBlock): string => {
      switch (block.kind) {
        case 'text': return block.text.slice(0, 28) || block.author.name;
        case 'tool_call': return block.toolName;
        case 'tool_result': return `${block.toolName} result`;
        case 'file_change': return block.path;
        case 'permission_request': case 'permission_result': case 'failure': case 'finished': return block.title;
        case 'preview': return block.url ?? block.previewId;
        case 'diff': case 'approval': case 'artifact': case 'subagent': case 'subtask':
        case 'child_agent': case 'run_session': case 'run_step_group': return block.title;
        case 'agent_timeline': return block.title ?? '运行时间线';
        case 'result': return block.summary || (block.success ? '运行结果' : '运行失败');
        case 'thinking': return '思考过程';
        case 'route_decision': return block.targetAgent || block.action;
        case 'context_usage': return block.modelLabel || '上下文用量';
        default: return '消息卡片';
      }
    },
    [],
  );
  const blockTitleById = useCallback(
    (blockId: string): string => { const block = transcript.find((item) => item.id === blockId); return block ? blockTitle(block) : '选中卡片'; },
    [transcript, blockTitle],
  );

  /* ── Context menu ── */
  const openBlockContextMenu = useCallback(
    (block: TranscriptBlock, event: TranscriptContextMenuEvent): void => {
      event.preventDefault();
      setContextMenu({ blockId: block.id, title: blockTitle(block), x: event.clientX, y: event.clientY });
    },
    [blockTitle, setContextMenu],
  );

  /* ── Selection ── */
  const selectBlock = useCallback(
    (blockId: string): void => {
      setSelectedBlockIds((current) => (current.includes(blockId) ? current.filter((id) => id !== blockId) : [...current, blockId]));
    },
    [setSelectedBlockIds],
  );
  const selectRangeTo = useCallback(
    (blockId: string): void => {
      const selectedIndexes = selectedBlockIds.map((id) => transcript.findIndex((block) => block.id === id)).filter((index) => index >= 0);
      const anchorIndex = selectedIndexes.length ? selectedIndexes[selectedIndexes.length - 1]! : transcript.findIndex((block) => block.id === blockId);
      const targetIndex = transcript.findIndex((block) => block.id === blockId);
      if (anchorIndex < 0 || targetIndex < 0) { selectBlock(blockId); return; }
      const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const rangeIds = transcript.slice(from, to + 1).map((block) => block.id);
      setSelectionMode(true);
      setSelectedBlockIds((current) => Array.from(new Set([...current, ...rangeIds])));
    },
    [selectedBlockIds, transcript, selectBlock, setSelectionMode, setSelectedBlockIds],
  );
  const handleBlockSelect = useCallback(
    (blockId: string, event?: { shiftKey?: boolean }): void => { if (event?.shiftKey) { selectRangeTo(blockId); return; } selectBlock(blockId); },
    [selectBlock, selectRangeTo],
  );
  const selectConversation = useCallback(
    (conversationId: string): void => {
      setLocalConversationId(conversationId);
      setContextMenu(null);
      setSelectionMode(false);
      setSelectedBlockIds([]);
      setActionedBlockIds([]);
      setSoftHiddenBlockIds([]);
      onActiveConversationChange?.(conversationId);
    },
    [setLocalConversationId, setContextMenu, setSelectionMode, setSelectedBlockIds, setActionedBlockIds, setSoftHiddenBlockIds, onActiveConversationChange],
  );
  const enterSelection = useCallback(
    (blockId: string): void => { selectionModeRef.current = true; setSelectionMode(true); setSelectedBlockIds([blockId]); },
    [selectionModeRef, setSelectionMode, setSelectedBlockIds],
  );
  const clearSelectionHold = useCallback(
    (): void => {
      if (selectionHoldRef.current?.timer != null) { window.clearTimeout(selectionHoldRef.current.timer); }
      selectionHoldRef.current = null;
    },
    [selectionHoldRef],
  );
  const beginBlockHoldSelection = useCallback(
    (block: TranscriptBlock, event: TranscriptPointerEvent): void => {
      if (event.button !== 0 || isNestedInteractiveTarget(event.target, event.currentTarget)) return;
      clearSelectionHold();
      selectionHoldRef.current = {
        blockId: block.id,
        timer: window.setTimeout(() => { enterSelection(block.id); suppressSelectionPointerUpRef.current = true; selectionHoldRef.current = null; }, SELECTION_HOLD_DELAY_MS),
        x: event.clientX, y: event.clientY,
      };
    },
    [clearSelectionHold, enterSelection, selectionHoldRef, suppressSelectionPointerUpRef],
  );
  const updateBlockHoldSelection = useCallback(
    (event: TranscriptPointerEvent): void => {
      const hold = selectionHoldRef.current;
      if (!hold) return;
      const dx = Math.abs(event.clientX - hold.x);
      const dy = Math.abs(event.clientY - hold.y);
      if (dx > SELECTION_HOLD_CANCEL_DISTANCE || dy > SELECTION_HOLD_CANCEL_DISTANCE) { clearSelectionHold(); }
    },
    [clearSelectionHold, selectionHoldRef],
  );
  const handleBlockPointerUp = useCallback(
    (block: TranscriptBlock, event: TranscriptPointerEvent): void => {
      clearSelectionHold();
      if (suppressSelectionPointerUpRef.current) { suppressSelectionPointerUpRef.current = false; return; }
      if (!selectionModeRef.current || event.button !== 0 || isNestedInteractiveTarget(event.target, event.currentTarget)) return;
      handleBlockSelect(block.id, { shiftKey: event.shiftKey });
    },
    [clearSelectionHold, suppressSelectionPointerUpRef, selectionModeRef, handleBlockSelect],
  );

  /* ── Profile helpers ── */
  const agentProfileByName = useCallback(
    (agentName: string): Omit<AgentProfileState, 'anchor'> | null => {
      const normalized = agentName.toLowerCase();
      const runtimeAgent = (agents ?? []).find((agent) => agent.name.toLowerCase() === normalized);
      const configured = WORKBENCH_MOCK_AGENT_CONFIGS.map((a) => ({ id: a.id, name: a.name, role: a.role, engine: a.engine, model: a.model, state: a.state, skills: a.skills })).find((a) => a.name.toLowerCase() === normalized || a.id.toLowerCase() === normalized);
      if (configured) return configured;
      if (!runtimeAgent) return null;
      return { id: runtimeAgent.id, name: runtimeAgent.name, role: runtimeAgent.description ?? 'Agent', engine: 'AgentHub', model: runtimeAgent.model ?? '未配置', state: runtimeAgent.status ?? 'available', skills: [] };
    },
    [agents],
  );
  const humanProfileByName = useCallback(
    (name: string, anchor: HTMLElement): HumanProfileState => {
      const normalized = name.toLowerCase();
      const contact = WORKBENCH_MOCK_CONTACT_MEMBERS.find((item) => item.name.toLowerCase() === normalized || item.id.toLowerCase() === normalized);
      const conversation = conversations.find((item) => item.title.toLowerCase() === normalized || item.id.toLowerCase() === normalized);
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
    },
    [conversations],
  );

  const openAgentProfile = useCallback(
    (agentName: string, anchor: HTMLElement): void => {
      const profile = agentProfileByName(agentName);
      if (!profile) { setActiveAgentProfile(null); setActiveGroupProfile(null); setActiveHumanProfile(humanProfileByName(agentName, anchor)); return; }
      setActiveHumanProfile(null); setActiveGroupProfile(null); setActiveAgentProfile({ ...profile, anchor });
    },
    [agentProfileByName, humanProfileByName, setActiveAgentProfile, setActiveHumanProfile, setActiveGroupProfile],
  );
  const openAgentProfileFromConfig = useCallback(
    (agent: Omit<AgentProfileState, 'anchor'>, anchor: HTMLElement): void => {
      setActiveHumanProfile(null); setActiveGroupProfile(null); setActiveAgentProfile({ ...agent, anchor });
    },
    [setActiveAgentProfile, setActiveHumanProfile, setActiveGroupProfile],
  );
  const openConversationAvatar = useCallback(
    (conversation: WorkbenchConversation, anchor: HTMLElement): void => {
      setActiveAgentProfile(null); setActiveHumanProfile(null); setActiveGroupProfile(null);
      if (conversation.kind === 'group') { setActiveGroupProfile({ id: conversation.id, name: conversation.title, memberNames: conversation.members ?? [], anchor }); return; }
      const profile = agentProfileByName(conversation.title);
      if (profile) { setActiveAgentProfile({ ...profile, anchor }); } else { setActiveHumanProfile(humanProfileByName(conversation.title, anchor)); }
    },
    [agentProfileByName, humanProfileByName, setActiveAgentProfile, setActiveHumanProfile, setActiveGroupProfile],
  );

  const openAgentDirectMessage = useCallback(
    (): void => {
      if (!activeAgentProfile) return;
      const conversation = conversations.find((item) => item.title.toLowerCase() === activeAgentProfile.name.toLowerCase() || item.id.toLowerCase() === activeAgentProfile.id.toLowerCase());
      if (conversation) { selectConversation(conversation.id); }
      else if (onNavigateToConversation) { onNavigateToConversation({ name: activeAgentProfile.name, id: activeAgentProfile.id, kind: 'dm' }); }
      else { showWorkbenchToast(`还没有 ${activeAgentProfile.name} 的私聊会话`); return; }
      setActivePage('chat'); setActiveAgentProfile(null); setActiveHumanProfile(null); setActiveGroupProfile(null);
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    },
    [activeAgentProfile, conversations, selectConversation, onNavigateToConversation, showWorkbenchToast, setActivePage, setActiveAgentProfile, setActiveHumanProfile, setActiveGroupProfile, composerInputRef],
  );
  const openHumanDirectMessage = useCallback(
    (): void => {
      if (!activeHumanProfile) return;
      const conversation = conversations.find((item) => item.title.toLowerCase() === activeHumanProfile.name.toLowerCase() || item.id.toLowerCase() === activeHumanProfile.id.toLowerCase());
      if (conversation) { selectConversation(conversation.id); }
      else if (onNavigateToConversation) { onNavigateToConversation({ name: activeHumanProfile.name, id: activeHumanProfile.id, kind: 'dm' }); }
      else { showWorkbenchToast(`还没有 ${activeHumanProfile.name} 的私聊会话`); return; }
      setActivePage('chat'); setActiveHumanProfile(null); setActiveAgentProfile(null); setActiveGroupProfile(null);
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    },
    [activeHumanProfile, conversations, selectConversation, onNavigateToConversation, showWorkbenchToast, setActivePage, setActiveHumanProfile, setActiveAgentProfile, setActiveGroupProfile, composerInputRef],
  );
  const openAgentConfig = useCallback(
    (): void => {
      if (!activeAgentProfile) return;
      setFocusedAgentId(activeAgentProfile.id);
      setActivePage('agents');
      setActiveAgentProfile(null);
      showWorkbenchToast(`已打开 ${activeAgentProfile.name} 配置`);
    },
    [activeAgentProfile, setFocusedAgentId, setActivePage, setActiveAgentProfile, showWorkbenchToast],
  );

  /* ── Search / review ── */
  const openReviewFile = useCallback(
    (file: FileItem): void => { openInspector(); setReviewFileRequest({ ...file }); },
    [openInspector, setReviewFileRequest],
  );
  const handleDeploySubmit = useCallback(
    (_id: string): void => { openInspector(); showWorkbenchToast('已打开部署预览'); },
    [openInspector, showWorkbenchToast],
  );
  const handleSearchJump = useCallback(
    (messageId: string, _messageIndex?: number): void => { setSearchOpen(false); setSearchHighlightId(messageId); },
    [setSearchOpen, setSearchHighlightId],
  );
  const handleSearchHighlightEnd = useCallback(
    (): void => { setSearchHighlightId(null); },
    [setSearchHighlightId],
  );

  /* ── Context actions ── */
  const runContextAction = useCallback(
    (action: string, blockId: string): void => {
      const title = blockTitleById(blockId);
      const block = transcript.find((item) => item.id === blockId);
      if (action === 'copy') copyText(title);
      if (action === 'link') copyText(`agenthub://card/${blockId}`);
      if (action === 'delete') { setSoftHiddenBlockIds((current) => (current.includes(blockId) ? current : [...current, blockId])); }
      if (action === 'reply' && block) {
        dispatchComposer({ type: 'setReplyTo', replyTo: { messageId: blockId, author: block.author.name, preview: title } });
        window.setTimeout(() => composerInputRef.current?.focus(), 0);
      }
      if (action === 'quote' && block && block.kind === 'text') {
        const selectedText = window.getSelection()?.toString().trim();
        const quoteText = selectedText || block.text.slice(0, 80);
        const quoted = `> ${quoteText.split('\n').join('\n> ')}\n\n`;
        dispatchComposer({ type: 'setText', text: quoted });
        dispatchComposer({ type: 'setQuote', quote: { text: quoteText, author: block.author.name, messageId: block.id } });
        window.setTimeout(() => composerInputRef.current?.focus(), 0);
      }
      if (action === 'regenerate' && block && block.kind === 'text' && block.author.role === 'agent') {
        setSoftHiddenBlockIds((current) => { const next = new Set(current); next.add(block.id); return Array.from(next); });
        onRegenerate?.(blockId);
        pulseBlock(blockId);
        showWorkbenchToast(cardActionLabel(action, title));
        return;
      }
      pulseBlock(blockId);
      showWorkbenchToast(cardActionLabel(action, title));
    },
    [blockTitleById, transcript, copyText, setSoftHiddenBlockIds, dispatchComposer, composerInputRef, onRegenerate, pulseBlock, showWorkbenchToast, cardActionLabel],
  );
  const handleTranscriptBlockAction = useCallback(
    (action: string, blockId: string, metadata?: Record<string, unknown>): void => {
      const block = transcript.find((b) => b.id === blockId);
      if (!block) return;
      if (action === 'approve' || action === 'deny') {
        if (block.kind === 'permission_request') {
          const decision: ApprovalDecisionAction = {
            approvalId: block.requestId, decision: action === 'approve' ? 'allow' : 'deny',
            ...(block.teamId !== undefined ? { teamId: block.teamId } : {}),
            ...(block.teamRunId !== undefined ? { teamRunId: block.teamRunId } : {}),
            ...(block.agentTaskId !== undefined ? { agentTaskId: block.agentTaskId } : {}),
            ...(block.targetId !== undefined ? { targetId: block.targetId } : {}),
            ...(block.edgeDeviceId !== undefined ? { edgeDeviceId: block.edgeDeviceId } : {}),
            ...(block.correlationId !== undefined ? { correlationId: block.correlationId } : {}),
          };
          onApprovalDecision?.(decision);
          pulseBlock(blockId);
          showWorkbenchToast(action === 'approve' ? '已批准' : '已拒绝');
        }
      }
      if (action === 'retry' || action === 'regenerate') {
        if (block.kind === 'text' && block.author.role === 'agent') {
          setSoftHiddenBlockIds((current) => { const next = new Set(current); next.add(block.id); return Array.from(next); });
          onRegenerate?.(blockId);
          pulseBlock(blockId);
          showWorkbenchToast('正在重新生成');
        }
      }
      if (action === 'copy') {
        const title = (metadata?.text as string) || blockTitle(block);
        copyText(title);
        pulseBlock(blockId);
        showWorkbenchToast(cardActionLabel('copy', title));
      }
    },
    [transcript, onApprovalDecision, onRegenerate, blockTitle, copyText, pulseBlock, showWorkbenchToast, cardActionLabel, setSoftHiddenBlockIds],
  );
  const runMultiAction = useCallback(
    (action: string): void => {
      const count = selectedBlockIds.length;
      if (!count) { showWorkbenchToast('还没有选择卡片'); return; }
      if (action === 'copy') { copyText(selectedBlockIds.map(blockTitleById).join('\n')); }
      if (action === 'delete') {
        setSoftHiddenBlockIds((current) => { const next = new Set(current); selectedBlockIds.forEach((id) => next.add(id)); return Array.from(next); });
        setSelectionMode(false); setSelectedBlockIds([]);
      }
      showWorkbenchToast(multiActionLabel(action, count));
    },
    [selectedBlockIds, blockTitleById, copyText, setSoftHiddenBlockIds, setSelectionMode, setSelectedBlockIds, showWorkbenchToast, multiActionLabel],
  );
  const contextMenuGroups = useCallback(
    (blockId: string): Array<Array<{ label: string; icon?: string; shortcut?: string; chevron?: boolean; danger?: boolean; onClick: () => void }>> => {
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
    },
    [transcript, runContextAction, enterSelection],
  );

  /* ── Composer submit ── */
  const submitComposer = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (isSubmittingRef.current) return;
      const form = event.currentTarget;
      const textarea = form.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]');
      const liveText = textarea?.value ?? composer.text;
      if (liveText.trim().length === 0 && composer.attachments.length === 0) return;
      const capturedConversationId = currentConversationId;
      isSubmittingRef.current = true;
      dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
      try {
        const intent = buildComposerIntent(composer);
        const intentWithLiveText = { ...intent, text: liveText.trim(), conversationId: capturedConversationId };
        const capturedAttachments = composer.attachments;
        const pendingAttachments = capturedAttachments.filter((a) => !a.attachmentRef && a.file);
        const optimisticId = `pending-user-${Date.now()}`;
        setPendingUserBlock({
          id: optimisticId, kind: 'text', text: liveText.trim(),
          author: { id: 'user', name: 'You', role: 'human' as const },
          createdAt: new Date().toISOString(),
          ...(composer.replyTo ? { replyToMessageId: composer.replyTo.messageId, replyPreview: composer.replyTo.preview, replyAuthor: composer.replyTo.author } : {}),
          ...(composer.quote ? { quote: composer.quote.text } : {}),
        });
        dispatchComposer({ type: 'resetAfterSubmit' });
        dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
        setUploadProgresses({});
        let enrichedAttachments = capturedAttachments;
        if (pendingAttachments.length > 0 && platform.attachments?.uploadAttachment) {
          const uploadPort = platform.attachments;
          for (const attachment of pendingAttachments) {
            if (!attachment.file) continue;
            try {
              setUploadProgresses((prev) => ({ ...prev, [attachment.id]: { percent: 5, phase: 'hashing' } }));
              const ref = await uploadPort.uploadAttachment(attachment.file);
              setUploadProgresses((prev) => ({ ...prev, [attachment.id]: { percent: 100, phase: 'done' } }));
              enrichedAttachments = enrichedAttachments.map((a) => (a.id === attachment.id ? { ...a, attachmentRef: ref } : a));
            } catch {
              setUploadProgresses((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
            }
          }
        }
        const finalIntent = enrichedAttachments.length > 0 ? { ...intentWithLiveText, attachments: enrichedAttachments } : intentWithLiveText;
        const submitPayload = { ...finalIntent, ...(selectedExecutionTargetId ? { executionTargetId: selectedExecutionTargetId } : {}) };
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
    },
    [isSubmittingRef, composer, currentConversationId, dispatchComposer, setPendingUserBlock, setUploadProgresses, platform, selectedExecutionTargetId, showWorkbenchToast],
  );

  return {
    submitComposer,
    clampInspectorWidth, clampSidebarWidth,
    setSyncedInspectorWidth, setSyncedSidebarWidth,
    restoreInspectorWidth, restoreSidebarWidth,
    openInspector,
    collapseSidebarForWorkspacePressure,
    toggleSidebar, navigateRail,
    updateInspectorWidthFromClientX, updateSidebarWidthFromClientX,
    beginInspectorResize, beginSidebarResize,
    resizeInspectorBy, resizeSidebarBy,
    toggleInspector,
    handleToggleTheme,
    showWorkbenchToast,
    openAgentProfile, openAgentProfileFromConfig, openConversationAvatar,
    openAgentDirectMessage, openHumanDirectMessage, openAgentConfig,
    openReviewFile, handleDeploySubmit,
    handleSearchJump, handleSearchHighlightEnd,
    blockTitle, blockTitleById,
    openBlockContextMenu,
    selectBlock, selectRangeTo, handleBlockSelect,
    selectConversation,
    enterSelection, clearSelectionHold, beginBlockHoldSelection,
    updateBlockHoldSelection, handleBlockPointerUp,
    isNestedInteractiveTarget,
    copyText, pulseBlock,
    cardActionLabel, multiActionLabel,
    runContextAction, runMultiAction,
    handleTranscriptBlockAction,
    contextMenuGroups,
  };
}
