import type React from 'react';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import type { ConnectionStatusKind, GlobalRailPage } from './GlobalRail';
import type { RuntimeEvidenceSnapshot } from './RightInspector';
import type {
  WorkbenchAgentProfilesStatus,
  WorkbenchContactsActions,
  WorkbenchContactsData,
  WorkbenchDocumentsActions,
} from './WorkbenchRoutes';
import type { AgentConfig, DocRow, ProjectDraft } from './pages';
import type {
  CCSwitchStatusInfo,
  CCSwitchProviderInfo,
  MCPMarketItem,
  SkillMarketItem,
} from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import type { WorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import type { WorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import type { WorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import type { WorkbenchProjectsPort } from './workbenchProjectsPort';
import type {
  ConversationLiveStatus,
  WorkbenchAttentionCounts,
} from './workbenchAttentionModel';
import type {
  AgentHubWorkbenchModelCatalogItem,
  AgentHubWorkbenchProjectsStatus,
  AgentHubWorkbenchProps,
  AgentHubWorkbenchStatus,
} from './AgentHubWorkbenchTypes';

/* ==========================================================================
   WorkbenchFrame prop contract -- residual extract from WorkbenchFrame
   (#637) + WorkbenchFrameParts prop contracts (#698). Pure types only.

   WorkbenchFrameProps is the frame's view of AgentHubWorkbenchProps: it
   omits the 9 conversation/message-action handlers that the frame does not
   thread (the parent shell owns them) and re-adds its 8 frame-unique
   fields (activePage/isChatPage/layout/session/transcriptChrome/profile/
   setActivePage/children). The three shared-status shapes are aliased to
   the AgentHubWorkbench* SSOT instead of being redefined, so the contract
   stays a pure type intersection (Pick) and tsc stays green (#56-prop Step1).
   ========================================================================== */

// Status/catalog shapes are aliases of the AgentHubWorkbench* SSOT — keeping
// a single definition removes the triple-copy drift risk and lets consumers
// reference either name interchangeably.
export type WorkbenchFrameWorkbenchStatus = AgentHubWorkbenchStatus;
export type WorkbenchFrameProjectsStatus = AgentHubWorkbenchProjectsStatus;
export type WorkbenchFrameModelCatalogItem = AgentHubWorkbenchModelCatalogItem;

/* ── Split view (#1997, UX F3) ─────────────────────────────────────────
   Conversation-header split controls. Absent (undefined) when the honesty
   gate hides the surface (<2 conversations) — the header renders no entry. */

/** Another pane offered as a Move-to-Group target (labeled by its title). */
export interface WorkbenchSplitMoveTarget {
  paneId: string;
  title: string;
}

export interface WorkbenchSplitControls {
  /** Whether a split (>=2 panes) is currently active. */
  hasSplit: boolean;
  /** Other panes of the layout, labeled for the Move-to-Group submenu. */
  moveTargets: WorkbenchSplitMoveTarget[];
  /** Absent on read-only pane chrome (splitting targets the active pane). */
  onSplitRight?: (() => void) | undefined;
  onSplitDown?: (() => void) | undefined;
  /** Active pane: collapse the whole layout. Inactive pane: close that pane. */
  onUnsplit: () => void;
  onMoveToPane: (paneId: string) => void;
}

export interface WorkbenchFrameProps
  extends Omit<
    AgentHubWorkbenchProps,
    | 'activeConversationId'
    | 'onActiveConversationChange'
    | 'onApprovalDecision'
    | 'onRegenerate'
    | 'onPinMessage'
    | 'onUnpinMessage'
    | 'onForwardMessage'
    | 'onRecallMessage'
    | 'onAddMessageReaction'
  > {
  // ── Frame-unique fields (not part of AgentHubWorkbenchProps) ──
  activePage: GlobalRailPage;
  isChatPage: boolean;
  layout: WorkbenchPanelLayout;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;
  setActivePage: (page: GlobalRailPage) => void;
  children?: React.ReactNode;

  // ── Required-where-AWB-optional redeclarations ──
  // AgentHubWorkbenchProps marks these optional so demo/legacy shells can
  // omit them; the frame requires them because the chat chrome always
  // renders the composer/mainchain from these flags.
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  showMainchainStatus: boolean;
}

/* ==========================================================================
   WorkbenchFrameParts prop contracts (#698)
   ========================================================================== */

export interface ChatSidebarFrameProps {
  conversations: WorkbenchConversation[];
  currentConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onAvatarClick: (conversation: WorkbenchConversation, anchor: HTMLElement) => void;
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  onConversationArchive?: ((conversationId: string, archived: boolean) => void) | undefined;
  /** Started when the user clicks the sidebar "new conversation" entry (#1819). */
  onStartNewConversation?: (() => void) | undefined;
  /** F1 live status dots per conversation (absent = no run inventory). */
  liveStatusByConversation?: Record<string, ConversationLiveStatus> | undefined;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  resizeSidebarBy: (delta: number) => void;
  beginSidebarResize: (clientX: number) => void;
}

export interface WorkspaceLoadingStateProps {
  label: string;
}

export interface WorkspaceLoadErrorStateProps {
  title: string;
  description: string;
  meta?: string | undefined;
  retryLabel: string;
  onRetry?: (() => void) | undefined;
}

export interface ChatConversationHostFrameProps {
  platform: AgentHubPlatform;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;
  transcript: TranscriptBlock[];
  transcriptUnreadDivider?: import('@shared/chatview').UnreadDividerDescriptor | undefined;
  connectionStatus?: ConnectionStatusKind | undefined;
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  workbenchStatus?: WorkbenchFrameWorkbenchStatus | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string; healthy?: boolean }> | undefined;
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  highlightedBlockId?: string | undefined;
  onHighlightEnd?: (() => void) | undefined;
  /** Whether an agent run is currently active (stop button morph, #1462 CF13). */
  isAgentRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancelRun?: (() => void) | undefined;
  /** Edit an already-sent message (#1462 CF16). Receives block id + new content. */
  onEditMessage?: ((blockId: string, content: string) => Promise<void> | void) | undefined;
  /**
   * Transcript items are loading (#1821). With an empty transcript the chat
   * shows an honest loading state instead of the "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined;
  /** Split-view header controls (#1997); absent hides the split entry. */
  splitControls?: WorkbenchSplitControls | undefined;
}

export interface WorkbenchRoutesFrameProps {
  activePage: Exclude<GlobalRailPage, 'chat'>;
  /** Workbench surface for the Tasks review-before-merge gate (#1999). */
  platformSurface?: import('@shared/platform').AgentHubSurface | undefined;
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  dataMode?: string | undefined;
  contacts?: WorkbenchContactsData | undefined;
  documents?: DocRow[] | undefined;
  focusedAgentId?: string | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: WorkbenchFrameProjectsStatus | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  projectsPort?: WorkbenchProjectsPort | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onAgentProfileOpen: WorkbenchProfileChrome['openAgentProfileFromConfig'];
  onStartConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  contactsActions?: WorkbenchContactsActions | undefined;
  documentsActions?: WorkbenchDocumentsActions | undefined;
  localCliDiscovery: WorkbenchSessionChrome['localCliDiscovery'];
  sessionImportItems: WorkbenchSessionChrome['sessionImportItems'];
  sessionImportLoading: WorkbenchSessionChrome['sessionImportLoading'];
  sessionImportError: WorkbenchSessionChrome['sessionImportError'];
  sessionImportVisible: WorkbenchSessionChrome['sessionImportVisible'];
  onRefreshSessionImport: WorkbenchSessionChrome['refreshSessionImport'];
  modelCatalog?: WorkbenchFrameModelCatalogItem[] | undefined;
  ccSwitchStatus?: CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: CCSwitchProviderInfo[] | undefined;
  settingsService: WorkbenchSessionChrome['settingsService'];
  skillMarketItems?: SkillMarketItem[] | undefined;
  skillMarketLoading?: boolean | undefined;
  skillMarketError?: string | undefined;
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  mcpMarketError?: string | undefined;
  onNavigatePage: (page: GlobalRailPage) => void;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
  /* ── Devices / execution-target management (#1819) ── */
  devicesTargets?: import('./pages/DevicesPage').DevicesPageTarget[] | undefined;
  devicesLoading?: boolean | undefined;
  devicesError?: string | null | undefined;
  onDevicesRetry?: (() => void) | undefined;
  devicesPingingId?: string | null | undefined;
  onDevicePing?: ((targetId: string) => void) | undefined;
  /* ── Token / cost usage board (#1819) ── */
  usageTeams?: import('./pages/TokenUsagePage').TokenUsagePageTeam[] | undefined;
  usageLoading?: boolean | undefined;
  usageError?: string | null | undefined;
  onUsageRetry?: (() => void) | undefined;
}

export interface ChatInspectorFrameProps {
  platform: AgentHubPlatform;
  session: WorkbenchSessionChrome;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  inspectorCollapsed: boolean;
  inspectorWidth: number;
  resizeInspectorBy: (delta: number) => void;
  beginInspectorResize: (clientX: number) => void;
}
