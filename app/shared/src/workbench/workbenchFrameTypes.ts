import type React from 'react';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import type { TranscriptBlock } from '../transcript';
import type { ConnectionStatusKind, GlobalRailPage } from './GlobalRail';
import type { RuntimeEvidenceSnapshot } from './RightInspector';
import type {
  WorkbenchAgentProfilesStatus,
  WorkbenchContactsActions,
  WorkbenchContactsData,
  WorkbenchDocumentsActions,
} from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
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

/* ==========================================================================
   WorkbenchFrame prop contract -- residual extract from WorkbenchFrame
   (#637) + WorkbenchFrameParts prop contracts (#698). Pure types only.
   ========================================================================== */

export interface WorkbenchFrameWorkbenchStatus {
  dataMode?: string;
  replayLabel?: string;
  targetLabel?: string;
  targetState?: string;
  initialLoading?: boolean;
  loadError?: string;
}

export interface WorkbenchFrameProjectsStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  saving?: boolean | undefined;
}

export interface WorkbenchFrameModelCatalogItem {
  id: string;
  label: string;
  value: string;
  provider?: string;
  status: string;
  description?: string;
  default?: boolean;
  tags?: string[];
}

export interface WorkbenchFrameProps {
  platform: AgentHubPlatform;
  activePage: GlobalRailPage;
  isChatPage: boolean;
  layout: WorkbenchPanelLayout;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;

  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[] | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  workbenchStatus?: WorkbenchFrameWorkbenchStatus | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: WorkbenchFrameProjectsStatus | undefined;
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
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
  hubClient?: HubClient | undefined;
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  contactsActions?: WorkbenchContactsActions | undefined;
  documents?: DocRow[] | undefined;
  documentsActions?: WorkbenchDocumentsActions | undefined;
  modelCatalog?: WorkbenchFrameModelCatalogItem[] | undefined;
  ccSwitchStatus?: CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: CCSwitchProviderInfo[] | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  showMainchainStatus: boolean;
  transcript: TranscriptBlock[];
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  currentUserId?: string | undefined;
  skillMarketItems?: SkillMarketItem[] | undefined;
  skillMarketLoading?: boolean | undefined;
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  highlightedBlockId?: string | undefined;
  onHighlightEnd?: (() => void) | undefined;
  /** Whether an agent run is currently active (stop button morph, #1462 CF13). */
  isAgentRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancelRun?: (() => void) | undefined;
  /** Edit an already-sent message (#1462 CF16). Receives block id + new content. */
  onEditMessage?: ((blockId: string, content: string) => Promise<void> | void) | undefined;
  connectionStatus?: ConnectionStatusKind | undefined;
  setActivePage: (page: GlobalRailPage) => void;
  children?: React.ReactNode;
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
  connectionStatus?: ConnectionStatusKind | undefined;
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  showMainchainStatus: boolean;
  workbenchStatus?: WorkbenchFrameWorkbenchStatus | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
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
}

export interface WorkbenchRoutesFrameProps {
  activePage: Exclude<GlobalRailPage, 'chat'>;
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
  hubClient?: HubClient | undefined;
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
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  onNavigatePage: (page: GlobalRailPage) => void;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
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
