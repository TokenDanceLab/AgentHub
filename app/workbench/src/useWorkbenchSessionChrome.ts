import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { SetStateAction } from 'react';
import {
  composerReducer,
  createInitialComposerState,
  saveDraft,
  serializeDraft,
} from '@shared/composer';
import { toggleAppliedAgentHubTheme } from '@shared/theme';
import { collectTranscriptEvidence } from '@shared/transcript';
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
  isEditableKeyboardTarget,
  mapAgentsToComposerMentions,
  resolveComposerTargetLabel,
  resolveCurrentConversationId,
  resolveDefaultExecutionTargetId,
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
  resolveDefaultExecutionTargetId,
  serializeMainchainEvidenceExport,
  shouldClearSelectedExecutionTarget,
  shouldLoadLocalCliDiscovery,
  shouldLoadSessionImport,
  type ComposerExecutionTargetOption,
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
  // #1819: once the picker (user) explicitly sets or clears the target,
  // default auto-selection stops re-firing — the user's choice wins.
  const executionTargetUserTouchedRef = useRef(false);
  const selectExecutionTarget = useCallback((value: SetStateAction<string>) => {
    executionTargetUserTouchedRef.current = true;
    setSelectedExecutionTargetId(value);
  }, []);
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

  // Perf #21 residual: `evidence` / `mainchainSummary` feed ConversationHost
  // (MainchainStatusStrip) and the evidence-export callback. Memoized so their
  // identity survives shell re-renders (keystrokes etc.) — transcript /
  // runtimeEvidence / composerExecutionTargets / workbenchStatus are
  // shell-derived (memoized or state) and only change identity when the
  // underlying data actually changes.
  const evidence = useMemo(() => collectTranscriptEvidence(transcript), [transcript]);
  const mainchainSummary = useMemo(
    () => buildMainchainSummary({
      composerTargetLabel: resolveComposerTargetLabel(composerExecutionTargets, selectedExecutionTargetId),
      evidence,
      platformSurface: platform.surface,
      runtimeEvidence,
      selectedExecutionTargetId,
      targetRequired: Boolean(composerExecutionTargets),
      transcript,
      workbenchStatus,
      t,
    }),
    [
      composerExecutionTargets,
      evidence,
      platform.surface,
      runtimeEvidence,
      selectedExecutionTargetId,
      transcript,
      workbenchStatus,
      t,
    ],
  );

  const inspectorViews = useMemo(() => buildInspectorTranscriptViews(transcript), [transcript]);
  const activeConversation = findConversationById(conversations, currentConversationId);
  // Stable across shell re-renders so the UnifiedComposer memo gate holds;
  // `agents` is app-shell state derived via useMemo — identity changes only
  // when the agent data actually changes.
  const mentionableAgents = useMemo(() => mapAgentsToComposerMentions(agents), [agents]);

  useEffect(() => {
    // Flush current composer state as a draft for the outgoing session
    // before resetting so the draft is available on switch-back (CF20).
    // #1822: serialize attachments (ref'd ones) + reply/quote context too —
    // the old text+mentions-only save dropped them on conversation switch.
    if (composer.text || composer.mentions.length > 0 || composer.attachments.length > 0 ||
        composer.replyTo !== null || composer.quote !== null) {
      saveDraft(composer.conversationId, serializeDraft({
        text: composer.text,
        mentions: composer.mentions,
        attachments: composer.attachments,
        replyTo: composer.replyTo,
        quote: composer.quote,
      }));
    }
    dispatchComposer({ type: 'setConversationId', conversationId: currentConversationId });
  }, [currentConversationId]);

  useEffect(() => {
    if (shouldClearSelectedExecutionTarget(composerExecutionTargets, selectedExecutionTargetId)) {
      setSelectedExecutionTargetId('');
      return;
    }
    if (executionTargetUserTouchedRef.current) return;
    // System-owned selection (#1819): if the auto-picked target lost its
    // confirmed-health marker, drop it so the next healthy candidate takes
    // over instead of routing work to a target known to be unhealthy.
    const selectedEntry = composerExecutionTargets?.find(
      (target) => target.id === selectedExecutionTargetId,
    );
    if (selectedExecutionTargetId && selectedEntry && selectedEntry.healthy === false) {
      setSelectedExecutionTargetId('');
      return;
    }
    // #1819: auto-select the first confirmed-healthy execution target while
    // nothing is selected and the user has not made an explicit choice, so
    // send/run flows start with a live target instead of an empty picker.
    if (!selectedExecutionTargetId) {
      const defaultTargetId = resolveDefaultExecutionTargetId(composerExecutionTargets);
      if (defaultTargetId) setSelectedExecutionTargetId(defaultTargetId);
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
      // #1822: never hijack Ctrl+F while the user is typing in the composer
      // or any editable target — the default behavior (browser find, text
      // editing) must win there.
      if (isEditableKeyboardTarget(event.target)) return;
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

  // Stable callbacks — both feed ChatViewBridge (onReviewFile/onDeploySubmit),
  // so identity must survive shell re-renders for its memo gate. Deps are the
  // only values they capture: openInspector (layout useCallback, stable) and
  // state setters / refs / t (stable).
  const openReviewFile = useCallback((file: FileItem): void => {
    openInspector();
    setReviewFileRequest({ ...file });
  }, [openInspector, setReviewFileRequest]);

  const handleDeploySubmit = useCallback((_id: string): void => {
    openInspector();
    showWorkbenchToastRef.current(t('toast.deployPreviewOpened'));
  }, [openInspector, t]);

  // Stable: evidence/mainchainSummary are memoized above (identity changes
  // only when the underlying data changes) and platform / workbenchStatus /
  // runtimeEvidence / t are shell-stable, so the callback survives shell
  // re-renders and the ConversationHost / MainchainStatusStrip memo gates
  // hold (perf #21 residual).
  const exportMainchainEvidence = useCallback((): void => {
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
  }, [mainchainSummary, evidence, platform, runtimeEvidence, workbenchStatus, t]);

  return {
    settingsService,
    currentConversationId,
    selectConversation,
    activeConversation,
    selectedExecutionTargetId,
    setSelectedExecutionTargetId: selectExecutionTarget,
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
