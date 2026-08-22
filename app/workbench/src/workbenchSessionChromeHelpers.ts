import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react';
import type {
  ComposerMention,
  ComposerAction,
  ComposerState,
} from '@shared/composer';
import type {
  AgentHubPlatform,
  LocalCliDiscoveryManifest,
  RuntimeSessionSummary,
  WorkbenchAgent,
  WorkbenchConversation,
} from '@shared/platform';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type {
  TranscriptBlock,
  ContextUsageTranscriptBlock,
  RouteDecisionTranscriptBlock,
  SubagentTranscriptBlock,
  SubtaskTranscriptBlock,
  ChildAgentTranscriptBlock,
  EvidenceRef,
} from '@shared/transcript';
import type { MainchainSummary } from './mainchain';
import type { FileItem, RunResultInfo } from './inspector';
import type { SettingsService } from './settingsService';
import type { GlobalRailPage } from './GlobalRail';
import { matchesShortcut } from '@shared/utils/keyboardUtils';
import type { KeyboardEventLike } from '@shared/utils/keyboardUtils';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchSessionChromeHelpers — pure residual slices from
   useWorkbenchSessionChrome (#674).

   Public option/return types, local-CLI fallback, conversation id
   resolution, mention mapping, inspector transcript projections, export
   payload builders, and residual effect planners. No React hooks /
   no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

export type InspectorRouteTranscriptBlock =
  | RouteDecisionTranscriptBlock
  | SubagentTranscriptBlock
  | SubtaskTranscriptBlock
  | ChildAgentTranscriptBlock;

export interface InspectorTranscriptViews {
  routeBlocks: InspectorRouteTranscriptBlock[];
  contextBlocks: ContextUsageTranscriptBlock[];
  deployPreviewUrl: string | undefined;
  runResult: RunResultInfo | undefined;
}

/**
 * Execution-target entry the shell feeds the composer picker. `healthy` is an
 * optional marker (#1819): shells that pre-filter to healthy/online targets may
 * omit it, entries explicitly flagged `false` are skipped by default
 * selection, and unmarked entries are treated as selectable.
 */
export interface ComposerExecutionTargetOption {
  id: string;
  label: string;
  healthy?: boolean | undefined;
}

export interface UseWorkbenchSessionChromeOptions {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  activeConversationId?: string | undefined;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  agents?: WorkbenchAgent[] | undefined;
  composerExecutionTargets?: ComposerExecutionTargetOption[] | undefined;
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
  /** Desktop settings: local runtime session import list (#1192). */
  sessionImportItems: RuntimeSessionSummary[];
  sessionImportLoading: boolean;
  sessionImportError: string | null;
  sessionImportVisible: boolean;
  refreshSessionImport: () => void;
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
  inspectorRouteBlocks: InspectorRouteTranscriptBlock[];
  inspectorContextBlocks: ContextUsageTranscriptBlock[];
  inspectorDeployPreviewUrl: string | undefined;
  inspectorRunResult: RunResultInfo | undefined;
  mentionableAgents: ComposerMention[];
  handleToggleTheme: () => void;
  openReviewFile: (file: FileItem) => void;
  handleDeploySubmit: (id: string) => void;
  exportMainchainEvidence: () => void;
}

export const LOCAL_CLI_DISCOVERY_FALLBACK: LocalCliDiscoveryManifest = {
  mode: 'no-spend-discovery',
  readinessManifest: '.tmp/evidence/p0-edge-cli-real-readiness.json',
  readinessScript: 'scripts/verify/verify-edge-cli-real-readiness.py',
  generatedAt: null,
  items: [
    { id: 'codex', name: 'Codex CLI', installed: false, version: null, path: 'codex', noSpend: true },
    { id: 'claude-code', name: 'Claude Code', installed: false, version: null, path: 'claude', noSpend: true },
    { id: 'opencode', name: 'OpenCode', installed: false, version: null, path: 'opencode', noSpend: true },
  ],
};

/** Resolve controlled / local / fallback conversation id for session chrome. */
export function resolveCurrentConversationId(input: {
  conversations: WorkbenchConversation[];
  activeConversationId?: string | undefined;
  localConversationId: string;
  fallbackConversationId: string;
}): string {
  const controlledConversationExists = input.conversations.some(
    (conversation) => conversation.id === input.activeConversationId,
  );
  if (controlledConversationExists) {
    return input.activeConversationId!;
  }

  const localConversationExists = input.conversations.some(
    (conversation) => conversation.id === input.localConversationId,
  );
  return localConversationExists
    ? input.localConversationId
    : input.fallbackConversationId;
}

export function findConversationById(
  conversations: WorkbenchConversation[],
  conversationId: string,
): WorkbenchConversation | undefined {
  return conversations.find((conversation) => conversation.id === conversationId);
}

/** Map workbench agents to composer mention rows (exactOptionalPropertyTypes-safe). */
export function mapAgentsToComposerMentions(
  agents: WorkbenchAgent[] | undefined,
): ComposerMention[] {
  return (agents ?? []).map((agent) => {
    const mention: ComposerMention = {
      id: agent.id,
      label: agent.name,
      dispatchRole: 'dispatch',
    };
    if (agent.description !== undefined) mention.description = agent.description;
    if (agent.status !== undefined) mention.status = agent.status;
    if (agent.model !== undefined) mention.model = agent.model;
    if (agent.provider !== undefined) mention.provider = agent.provider;
    if (agent.runtimeId !== undefined) mention.runtimeId = agent.runtimeId;
    return mention;
  });
}

/** Pure inspector transcript projections — kept exportable for unit tests. */
export function buildInspectorTranscriptViews(
  transcript: TranscriptBlock[],
): InspectorTranscriptViews {
  const routeBlocks = transcript.filter(
    (block): block is InspectorRouteTranscriptBlock =>
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

/** Clear selected execution target when it no longer exists in the target list. */
export function shouldClearSelectedExecutionTarget(
  composerExecutionTargets: ComposerExecutionTargetOption[] | undefined,
  selectedExecutionTargetId: string,
): boolean {
  if (!composerExecutionTargets || !selectedExecutionTargetId) return false;
  return !composerExecutionTargets.some((target) => target.id === selectedExecutionTargetId);
}

/**
 * Default execution target for auto-selection (#1819): the first entry not
 * explicitly flagged unhealthy. Returns undefined when the list is missing,
 * empty, or every entry carries `healthy: false` — an empty picker is more
 * honest than preselecting a target known to be down.
 */
export function resolveDefaultExecutionTargetId(
  composerExecutionTargets: ComposerExecutionTargetOption[] | undefined,
): string | undefined {
  if (!composerExecutionTargets) return undefined;
  const preferred = composerExecutionTargets.find((target) => target.healthy !== false);
  return preferred?.id;
}

/** Local CLI discovery only loads on desktop settings with a host discovery port. */
export function shouldLoadLocalCliDiscovery(input: {
  activePage: GlobalRailPage;
  surface: string;
  hasLocalCliDiscovery: boolean;
}): boolean {
  return input.activePage === 'settings'
    && input.surface === 'desktop'
    && input.hasLocalCliDiscovery;
}

/** Runtime session import only loads on desktop settings with host + localEdge. */
export function shouldLoadSessionImport(input: {
  activePage: GlobalRailPage;
  surface: string;
  localEdge: boolean;
  hasListRuntimeSessions: boolean;
}): boolean {
  return input.activePage === 'settings'
    && input.surface === 'desktop'
    && input.localEdge
    && input.hasListRuntimeSessions;
}

/** Ctrl/Cmd+F search shortcut for chat page. */
export function isChatSearchShortcut(event: KeyboardEventLike): boolean {
  return matchesShortcut(event, ['Ctrl/⌘', 'F']);
}

export interface MainchainEvidenceExportPayload {
  exportedAt: string;
  surface: string;
  status: unknown;
  nodes: MainchainSummary['nodes'];
  evidence: EvidenceRef[];
  runtimeEvidence: unknown;
}

/** Build the JSON payload copied by exportMainchainEvidence. */
export function buildMainchainEvidenceExportPayload(input: {
  exportedAt: string;
  surface: string;
  status: unknown;
  nodes: MainchainSummary['nodes'];
  evidence: EvidenceRef[];
  runtimeEvidence: unknown;
}): MainchainEvidenceExportPayload {
  return {
    exportedAt: input.exportedAt,
    surface: input.surface,
    status: input.status,
    nodes: input.nodes,
    evidence: input.evidence,
    runtimeEvidence: input.runtimeEvidence,
  };
}

export function serializeMainchainEvidenceExport(
  payload: MainchainEvidenceExportPayload,
): string {
  return JSON.stringify(payload, null, 2);
}

export function resolveComposerTargetLabel(
  composerExecutionTargets: ComposerExecutionTargetOption[] | undefined,
  selectedExecutionTargetId: string,
): string | undefined {
  return composerExecutionTargets?.find((target) => target.id === selectedExecutionTargetId)?.label;
}
