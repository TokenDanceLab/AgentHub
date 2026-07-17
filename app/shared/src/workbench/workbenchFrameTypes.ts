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
import type { MCPMarketItem, SkillMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import type { WorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import type { WorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import type { WorkbenchProfileChrome } from './useWorkbenchProfileChrome';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchFrame prop contract — residual extract from WorkbenchFrame
   (#637). Pure types only.
   ═══════════════════════════════════════════════════════════════════════ */

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
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
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
  connectionStatus?: ConnectionStatusKind | undefined;
  setActivePage: (page: GlobalRailPage) => void;
  children?: React.ReactNode;
}
