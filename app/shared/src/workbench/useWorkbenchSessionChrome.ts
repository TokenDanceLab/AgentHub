import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  type ComposerMention,
  type ComposerAction,
  type ComposerState,
  composerReducer,
  createInitialComposerState,
} from '../composer';
import type {
  AgentHubPlatform,
  LocalCliDiscoveryManifest,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import type { RuntimeEvidenceSnapshot } from '../inspector';
import { toggleAppliedAgentHubTheme } from '../theme';
import {
  collectTranscriptEvidence,
  type TranscriptBlock,
  type ContextUsageTranscriptBlock,
  type RouteDecisionTranscriptBlock,
  type SubagentTranscriptBlock,
  type SubtaskTranscriptBlock,
  type ChildAgentTranscriptBlock,
  type EvidenceRef,
} from '../transcript';
import { buildMainchainSummary, type MainchainSummary } from './mainchain';
import type { FileItem, RunResultInfo } from './inspector';
import { WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import { createSettingsService, type SettingsService } from './settingsService';
import type { GlobalRailPage } from './GlobalRail';

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

export interface UseWorkbenchSessionChromeOptions {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  activeConversationId?: string | undefined;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  agents?: WorkbenchAgent[] | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  transcript: TranscriptBlock[];
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    initialLoading?: boolean;
    loadError?: string;
  } | undefined;
  activePage: GlobalRailPage;
  isChatPage: boolean;
  openInspector: () => void;
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
  resetSelection: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface WorkbenchSessionChrome {
  settingsService: SettingsService | null;
  currentConversationId: string;
  selectConversation: (conversationId: string) => void;
  activeConversation: WorkbenchConversation | undefined;
  selectedExecutionTargetId: string;
  setSelectedExecutionTargetId: Dispatch<SetStateAction<string>>;
  dismissedPinnedIds: Set<string>;
  setDismissedPinnedIds: Dispatch<SetStateAction<Set<string>>>;
  localCliDiscovery: LocalCliDiscoveryManifest | null;
  reviewFileRequest: FileItem | null;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  searchHighlightId: string | null;
  setSearchHighlightId: Dispatch<SetStateAction<string | null>>;
  workspaceRef: RefObject<HTMLElement | null>;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  composer: ComposerState;
  dispatchComposer: Dispatch<ComposerAction>;
  evidence: EvidenceRef[];
  mainchainSummary: MainchainSummary;
  inspectorRouteBlocks: Array<
    RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock
  >;
  inspectorContextBlocks: ContextUsageTranscriptBlock[];
  inspectorDeployPreviewUrl: string | undefined;
  inspectorRunResult: RunResultInfo | undefined;
  mentionableAgents: ComposerMention[];
  handleToggleTheme: () => void;
  openReviewFile: (file: FileItem) => void;
  handleDeploySubmit: (id: string) => void;
  exportMainchainEvidence: () => void;
}

/** Pure inspector transcript projections — kept exportable for unit tests. */
export function buildInspectorTranscriptViews(transcript: TranscriptBlock[]): {
  routeBlocks: Array<
    RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock
  >;
  contextBlocks: ContextUsageTranscriptBlock[];
  deployPreviewUrl: string | undefined;
  runResult: RunResultInfo | undefined;
} {
  const routeBlocks = transcript.filter(
    (block): block is RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock =>
      block.kind === 'route_decision'
      || block.kind === 'subagent'
      || block.kind === 'subtask'
      || block.kind === 'child_agent',
  );
  const contextBlocks = transcript.filter(
    (block): block is ContextUsageTranscriptBlock => block.kind === 'context_usage',
  );

  let deployPreviewUrl: string | undefined;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const block = transcript[i]!;
    if (block.kind === 'preview' && block.url) {
      deployPreviewUrl = block.url;
      break;
    }
  }

  let runResult: RunResultInfo | undefined;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const block = transcript[i]!;
    if (block.kind === 'result') {
      runResult = { success: block.success, summary: block.summary, duration: block.duration };
      break;
    }
    if (block.kind === 'finished') {
      runResult = { success: true, summary: block.title, duration: block.duration };
      break;
    }
    if (block.kind === 'failure') {
      runResult = { success: false, summary: block.reason ?? block.title };
      break;
    }
  }

  return { routeBlocks, contextBlocks, deployPreviewUrl, runResult };
}

export function useWorkbenchSessionChrome({
  platform,
  conversations,
  activeConversationId,
  onActiveConversationChange,
  agents,
  composerExecutionTargets,
  transcript,
  runtimeEvidence,
  workbenchStatus,
  activePage,
  isChatPage,
  openInspector,
  showWorkbenchToast,
  copyText,
  resetSelection,
  t,
}: UseWorkbenchSessionChromeOptions): WorkbenchSessionChrome {
  // Transcript chrome may be composed after this hook; keep latest helpers in refs.
  const showWorkbenchToastRef = useRef(showWorkbenchToast);
  const copyTextRef = useRef(copyText);
  const resetSelectionRef = useRef(resetSelection);
  showWorkbenchToastRef.current = showWorkbenchToast;
  copyTextRef.current = copyText;
  resetSelectionRef.current = resetSelection;

  const settingsService = useMemo<SettingsService | null>(
    () => (platform.settings ? createSettingsService(platform.settings, WORKBENCH_MOCK_SETTINGS_DEFAULTS) : null),
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

  const [selectedExecutionTargetId, setSelectedExecutionTargetId] = useState('');
  const [dismissedPinnedIds, setDismissedPinnedIds] = useState<Set<string>>(new Set());
  const [localCliDiscovery, setLocalCliDiscovery] = useState<LocalCliDiscoveryManifest | null>(null);
  const [reviewFileRequest, setReviewFileRequest] = useState<FileItem | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [composer, dispatchComposer] = useReducer(
    composerReducer,
    currentConversationId,
    createInitialComposerState,
  );

  function selectConversation(conversationId: string): void {
    setLocalConversationId(conversationId);
    resetSelectionRef.current();
    onActiveConversationChange?.(conversationId);
  }

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
    t,
  });

  const inspectorViews = useMemo(() => buildInspectorTranscriptViews(transcript), [transcript]);
  const inspectorRouteBlocks = inspectorViews.routeBlocks;
  const inspectorContextBlocks = inspectorViews.contextBlocks;
  const inspectorDeployPreviewUrl = inspectorViews.deployPreviewUrl;
  const inspectorRunResult = inspectorViews.runResult;

  const activeConversation = conversations.find((conversation) => conversation.id === currentConversationId);
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

  function handleToggleTheme(): void {
    toggleAppliedAgentHubTheme();
  }

  function openReviewFile(file: FileItem): void {
    openInspector();
    setReviewFileRequest({ ...file });
  }

  function handleDeploySubmit(_id: string): void {
    openInspector();
    showWorkbenchToastRef.current(t('toast.deployPreviewOpened'));
  }

  function exportMainchainEvidence(): void {
    if (!mainchainSummary.exportEnabled) {
      showWorkbenchToastRef.current(t('toast.noEvidence'));
      return;
    }
    copyTextRef.current(JSON.stringify({
      exportedAt: new Date().toISOString(),
      surface: platform.surface,
      status: workbenchStatus,
      nodes: mainchainSummary.nodes,
      evidence,
      runtimeEvidence,
    }, null, 2));
    showWorkbenchToastRef.current(t('toast.evidenceCopied'));
  }

  return {
    settingsService,
    currentConversationId,
    selectConversation,
    activeConversation,
    selectedExecutionTargetId,
    setSelectedExecutionTargetId,
    dismissedPinnedIds,
    setDismissedPinnedIds,
    localCliDiscovery,
    reviewFileRequest,
    searchOpen,
    setSearchOpen,
    searchHighlightId,
    setSearchHighlightId,
    workspaceRef,
    composerInputRef,
    composer,
    dispatchComposer,
    evidence,
    mainchainSummary,
    inspectorRouteBlocks,
    inspectorContextBlocks,
    inspectorDeployPreviewUrl,
    inspectorRunResult,
    mentionableAgents,
    handleToggleTheme,
    openReviewFile,
    handleDeploySubmit,
    exportMainchainEvidence,
  };
}
