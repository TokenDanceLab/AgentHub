import type { AgentHubSurface, LocalCliDiscoveryManifest, WorkbenchAgent } from '@shared/platform';
import type {
  DocRow,
  ProjectDraft,
  ProjectInfo,
} from './pages';
import type { AgentConfig, SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { GlobalRailPage } from './GlobalRail';
import type { SettingsService } from './settingsService';
import type {
  WorkbenchContactsActions,
  WorkbenchContactsData,
} from './useWorkbenchContactsRoute';
import type { WorkbenchDocumentsActions } from './useWorkbenchDocsRoute';
import type { WorkbenchProjectsStatus } from './useWorkbenchProjectsRoute';
import type { WorkbenchProjectsPort } from './workbenchProjectsPort';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchRoutesTypes — public props/types for WorkbenchRoutes (#660).
   ═══════════════════════════════════════════════════════════════════════ */

export type WorkbenchPage = Exclude<GlobalRailPage, 'chat'>;

export interface WorkbenchAgentProfilesStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export interface WorkbenchRoutesProps {
  activePage: WorkbenchPage;
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  dataMode?: string | undefined;
  contacts?: WorkbenchContactsData | undefined;
  /** Hub contacts request failure (#1821) — renders an explicit error state. */
  contactsError?: string | undefined;
  documents?: DocRow[] | undefined;
  /** Hub documents request failure (#1821) — renders an explicit error state. */
  documentsError?: string | undefined;
  focusedAgentId?: string | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: WorkbenchProjectsStatus | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  /** Narrow domain port for direct project data access when callbacks are not provided (#1546). */
  projectsPort?: WorkbenchProjectsPort | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
  /** 用户在通讯录/群聊等处点击联系人，希望开始私聊时触发。 */
  onStartConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  /** Contact mutation actions — passed through to ContactsPage. */
  contactsActions?: WorkbenchContactsActions | undefined;
  /** Document mutation actions — wired to Hub Documents API. */
  documentsActions?: WorkbenchDocumentsActions | undefined;
  localCliDiscovery?: LocalCliDiscoveryManifest | null | undefined;
  /** Desktop settings: local runtime session import list (#1192). */
  sessionImportItems?: import('@shared/platform').RuntimeSessionSummary[] | undefined;
  sessionImportLoading?: boolean | undefined;
  sessionImportError?: string | null | undefined;
  sessionImportVisible?: boolean | undefined;
  onRefreshSessionImport?: (() => void) | undefined;
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
  /** Settings service for persistent user preferences. When provided,
   *  settings are read from / written to the backend adapter. */
  settingsService?: SettingsService | null | undefined;
  /** Public Skill market items from Hub API. */
  skillMarketItems?: SkillMarketItem[] | undefined;
  /** Whether Skill market data is loading. */
  skillMarketLoading?: boolean | undefined;
  /** Skill market load error (#1821) — drives the market error empty state. */
  skillMarketError?: string | undefined;
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** MCP market load error (#1821) — same contract as `skillMarketError`. */
  mcpMarketError?: string | undefined;
  /** Called when the user navigates between workbench pages.
   *  Used by the Settings page to navigate to Agents config. */
  onNavigatePage?: ((page: WorkbenchPage) => void) | undefined;
  /** Current user's Hub ID, used to filter "my" tasks. */
  currentUserId?: string | undefined;
  /**
   * Workbench surface (#1999): Tasks review-before-merge chrome fails
   * closed on Hub-only surfaces (web/mobile) and says merging needs
   * Desktop / Local Edge.
   */
  platformSurface?: AgentHubSurface | undefined;
  /** Current user display name for Settings page. */
  userDisplayName?: string | undefined;
  /* ── Devices / execution-target management (#1819) ── */
  /** Registered execution targets; undefined = shell not Hub-connected. */
  devicesTargets?: import('./pages/DevicesPage').DevicesPageTarget[] | undefined;
  devicesLoading?: boolean | undefined;
  devicesError?: string | null | undefined;
  onDevicesRetry?: (() => void) | undefined;
  /** Target id currently being pinged (row busy state). */
  devicesPingingId?: string | null | undefined;
  onDevicePing?: ((targetId: string) => void) | undefined;
  /* ── Token / cost usage board (#1819) ── */
  /** Per-team runs with recorded token counters; undefined = not Hub-connected. */
  usageTeams?: import('./pages/TokenUsagePage').TokenUsagePageTeam[] | undefined;
  usageLoading?: boolean | undefined;
  usageError?: string | null | undefined;
  onUsageRetry?: (() => void) | undefined;
}

export type { WorkbenchContactsActions, WorkbenchContactsData } from './useWorkbenchContactsRoute';
export type { WorkbenchDocumentsActions } from './useWorkbenchDocsRoute';
export type { WorkbenchProjectsStatus } from './useWorkbenchProjectsRoute';
