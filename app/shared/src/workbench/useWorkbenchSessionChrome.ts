import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  composerReducer,
  createInitialComposerState,
  saveDraft,
} from '../composer';
import { toggleAppliedAgentHubTheme } from '../theme';
import { collectTranscriptEvidence } from '../transcript';
import { buildMainchainSummary } from './mainchain';
import type { FileItem } from './inspector';
import { WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import { createSettingsService, type SettingsService } from './settingsService';
import { INSPECTOR_DEFAULT_COLLAPSE_EVENT } from './workbenchLayoutConstants';
import {
  LOCAL_CLI_DISCOVERY_FALLBACK,
  buildInspectorTranscriptViews,
  buildMainchainEvidenceExportPayload,
  findConversationById,
  isChatSearchShortcut,
  mapAgentsToComposerMentions,
  resolveComposerTargetLabel,
  resolveCurrentConversationId,
  serializeMainchainEvidenceExport,
  shouldClearSelectedExecutionTarget,
  shouldLoadLocalCliDiscovery,
  shouldLoadSessionImport,
  type UseWorkbenchSessionChromeOptions,
  type WorkbenchSessionChrome,
} from './workbenchSessionChromeHelpers';

export {
  LOCAL_CLI_DISCOVERY_FALLBACK,
  buildInspectorTranscriptViews,
  buildMainchainEvidenceExportPayload,
  findConversationById,
  isChatSearchShortcut,
  mapAgentsToComposerMentions,
  resolveComposerTargetLabel,
  resolveCurrentConversationId,
  serializeMainchainEvidenceExport,
  shouldClearSelectedExecutionTarget,
  shouldLoadLocalCliDiscovery,
  shouldLoadSessionImport,
  type UseWorkbenchSessionChromeOptions,
  type WorkbenchSessionChrome,
} from './workbenchSessionChromeHelpers';

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

  // Settings gate: inspectorVisible=false means the inspector starts collapsed
  // (default hidden). Re-runs on every snapshot change, so toggling 右侧概览 off
  // in Settings collapses the inspector immediately; toggling it on never
  // force-opens — manual/last-session state wins for expansion. The layout
  // hook listens for INSPECTOR_DEFAULT_COLLAPSE_EVENT to apply the collapse.
  useEffect(() => {
    if (!settingsService) return undefined;
    const service = settingsService;

    function applyInspectorVisibleDefault(): void {
      if (!service.initialized) return;
      if (service.readAll()['inspectorVisible'] === false) {
        window.dispatchEvent(new CustomEvent(INSPECTOR_DEFAULT_COLLAPSE_EVENT));
      }
    }

    applyInspectorVisibleDefault();
    return service.subscribe(applyInspectorVisibleDefault);
  }, [settingsService]);

  const fallbackConversationId = conversations[0]?.id ?? 'default';
  const [localConversationId, setLocalConversationId] = useState(fallbackConversationId);
  const currentConversationId = resolveCurrentConversationId({
    conversations,
    activeConversationId,
    localConversationId,
    fallbackConversationId,
  });

  const [selectedExecutionTargetId, setSelectedExecutionTargetId] = useState('');
  const [dismissedPinnedIds, setDismissedPinnedIds] = useState<Set<string>>(new Set());
  const [localCliDiscovery, setLocalCliDiscovery] = useState<WorkbenchSessionChrome['localCliDiscovery']>(null);
  const [sessionImportItems, setSessionImportItems] = useState<WorkbenchSessionChrome['sessionImportItems']>([]);
  const [sessionImportLoading, setSessionImportLoading] = useState(false);
  const [sessionImportError, setSessionImportError] = useState<string | null>(null);
  const [sessionImportTick, setSessionImportTick] = useState(0);
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
    composerTargetLabel: resolveComposerTargetLabel(composerExecutionTargets, selectedExecutionTargetId),
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
  const activeConversation = findConversationById(conversations, currentConversationId);
  const mentionableAgents = mapAgentsToComposerMentions(agents);

  useEffect(() => {
    // Flush current composer state as a draft for the outgoing session
    // before resetting so the draft is available on switch-back (CF20).
    if (composer.text || composer.mentions.length > 0 || composer.attachments.length > 0) {
      saveDraft(composer.conversationId, { text: composer.text, mentions: composer.mentions });
    }
    dispatchComposer({ type: 'setConversationId', conversationId: currentConversationId });
  }, [currentConversationId]);

  useEffect(() => {
    if (shouldClearSelectedExecutionTarget(composerExecutionTargets, selectedExecutionTargetId)) {
      setSelectedExecutionTargetId('');
    }
  }, [composerExecutionTargets, selectedExecutionTargetId]);

  useEffect(() => {
    if (!shouldLoadLocalCliDiscovery({
      activePage,
      surface: platform.surface,
      hasLocalCliDiscovery: Boolean(platform.host?.localCliDiscovery),
    })) {
      setLocalCliDiscovery(null);
      return undefined;
    }

    let cancelled = false;
    setLocalCliDiscovery(LOCAL_CLI_DISCOVERY_FALLBACK);
    platform.host!.localCliDiscovery!()
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

  const sessionImportVisible = shouldLoadSessionImport({
    activePage,
    surface: platform.surface,
    localEdge: Boolean(platform.capabilities.localEdge),
    hasListRuntimeSessions: Boolean(platform.host?.listRuntimeSessions),
  });

  useEffect(() => {
    if (!sessionImportVisible) {
      setSessionImportItems([]);
      setSessionImportError(null);
      setSessionImportLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSessionImportLoading(true);
    setSessionImportError(null);
    platform.host!.listRuntimeSessions!(50)
      .then((items) => {
        if (!cancelled) {
          setSessionImportItems(items);
          setSessionImportLoading(false);
        }
      })
      .catch((err: unknown) => {
        console.error('listRuntimeSessions failed:', err);
        if (!cancelled) {
          setSessionImportItems([]);
          setSessionImportError(err instanceof Error ? err.message : '加载本地会话失败');
          setSessionImportLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [platform, sessionImportTick, sessionImportVisible]);

  function refreshSessionImport(): void {
    setSessionImportTick((n) => n + 1);
  }

  useEffect(() => {
    if (!isChatPage) return;

    function handleSearchShortcut(event: KeyboardEvent): void {
      if (isChatSearchShortcut(event)) {
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
    copyTextRef.current(serializeMainchainEvidenceExport(buildMainchainEvidenceExportPayload({
      exportedAt: new Date().toISOString(),
      surface: platform.surface,
      status: workbenchStatus,
      nodes: mainchainSummary.nodes,
      evidence,
      runtimeEvidence,
    })));
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
    sessionImportItems,
    sessionImportLoading,
    sessionImportError,
    sessionImportVisible,
    refreshSessionImport,
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
    inspectorRouteBlocks: inspectorViews.routeBlocks,
    inspectorContextBlocks: inspectorViews.contextBlocks,
    inspectorDeployPreviewUrl: inspectorViews.deployPreviewUrl,
    inspectorRunResult: inspectorViews.runResult,
    mentionableAgents,
    handleToggleTheme,
    openReviewFile,
    handleDeploySubmit,
    exportMainchainEvidence,
  };
}
