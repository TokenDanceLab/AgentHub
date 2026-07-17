import React, { useMemo } from 'react';
import type { LocalCliDiscoveryManifest, WorkbenchAgent } from '../platform';
import type {
  DocRow,
  ProjectDraft,
  ProjectInfo,
} from './pages';
import type { AgentConfig, SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { GlobalRailPage } from './GlobalRail';
import type { SettingsService } from './settingsService';
import type { HubClient } from '../hubClient';
import { ContactsPage } from './pages/ContactsPage';
import { DocsPage } from './pages/DocsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkbenchAgentsRouteView } from './WorkbenchAgentsRouteView';
import { WorkbenchTasksRouteView } from './WorkbenchTasksRouteView';
import { useWorkbenchAgentsRoute } from './useWorkbenchAgentsRoute';
import {
  useWorkbenchContactsRoute,
  type WorkbenchContactsActions,
  type WorkbenchContactsData,
} from './useWorkbenchContactsRoute';
import {
  useWorkbenchDocsRoute,
  type WorkbenchDocumentsActions,
} from './useWorkbenchDocsRoute';
import {
  useWorkbenchProjectsRoute,
  type WorkbenchProjectsStatus,
} from './useWorkbenchProjectsRoute';
import { useWorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import { useWorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { buildWorkbenchProfileSources } from './workbenchProfileSources';
import styles from './AgentHubWorkbench.module.css';

// ── Static page imports (no React.lazy — lazy 在 jsdom 测试中无法同步解析) ──

type WorkbenchPage = Exclude<GlobalRailPage, 'chat'>;

export interface WorkbenchRoutesProps {
  activePage: WorkbenchPage;
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  dataMode?: string | undefined;
  contacts?: WorkbenchContactsData | undefined;
  documents?: DocRow[] | undefined;
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
  /** Hub client for direct project API access when callbacks are not provided. */
  hubClient?: HubClient | undefined;
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
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** Called when the user navigates between workbench pages.
   *  Used by the Settings page to navigate to Agents config. */
  onNavigatePage?: ((page: WorkbenchPage) => void) | undefined;
  /** Current user's Hub ID, used to filter "my" tasks. */
  currentUserId?: string | undefined;
  /** Current user display name for Settings page. */
  userDisplayName?: string | undefined;
}

export type { WorkbenchContactsActions, WorkbenchContactsData } from './useWorkbenchContactsRoute';
export type { WorkbenchDocumentsActions } from './useWorkbenchDocsRoute';

export interface WorkbenchAgentProfilesStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export type { WorkbenchProjectsStatus } from './useWorkbenchProjectsRoute';

export function WorkbenchRoutes({
  activePage,
  agents,
  agentProfilesStatus,
  dataMode,
  contacts,
  documents,
  focusedAgentId,
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onAgentProfileOpen,
  onStartConversation,
  contactsActions,
  localCliDiscovery,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  settingsService,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  onNavigatePage,
  currentUserId,
  userDisplayName,
}: WorkbenchRoutesProps): React.ReactElement {
  const settingsRoute = useWorkbenchSettingsRoute({
    settingsService,
    dataMode,
  });
  const { realDataMode } = settingsRoute;

  const agentsRoute = useWorkbenchAgentsRoute({
    agents,
    agentProfilesStatus,
    focusedAgentId,
    realDataMode,
    modelCatalog,
    onAgentCreate,
    onAgentUpdate,
    onAgentDelete,
  });

  const tasksRoute = useWorkbenchTasksRoute({
    realDataMode,
    currentUserId,
    userDisplayName,
  });

  const projectsRoute = useWorkbenchProjectsRoute({
    projects,
    activeProjectId,
    projectsStatus,
    onActiveProjectChange,
    onProjectCreate,
    onProjectUpdate,
    hubClient,
    realDataMode,
  });

  const contactsRoute = useWorkbenchContactsRoute({
    contacts,
    contactsActions,
    onStartConversation,
  });

  const docsRoute = useWorkbenchDocsRoute({
    documents,
    documentsActions,
  });

  const profileSources = useMemo(
    () => buildWorkbenchProfileSources(
      agentsRoute.agentConfigs,
      contactsRoute.contactsData.members,
    ),
    [agentsRoute.agentConfigs, contactsRoute.contactsData.members],
  );

  switch (activePage) {
    case 'contacts':
      return (
        <ContactsPage
          activePane={contactsRoute.contactsPane}
          externalContacts={contactsRoute.contactsData.externalContacts ?? []}
          groups={contactsRoute.contactsData.groups ?? []}
          members={contactsRoute.contactsData.members}
          onMemberClick={contactsRoute.handleMemberClick}
          onPaneChange={contactsRoute.setContactsPane}
          orgInitials={contactsRoute.contactsData.orgInitials ?? 'TD'}
          orgName={contactsRoute.contactsData.orgName ?? 'TokenDance'}
          pendingContacts={contactsRoute.contactsData.pendingContacts ?? []}
          recentShortcuts={contactsRoute.contactsData.recentShortcuts ?? []}
          serviceDesks={contactsRoute.contactsData.serviceDesks ?? []}
          starredContacts={contactsRoute.contactsData.starredContacts ?? []}
          onSearchUser={contactsRoute.contactsActions?.onSearchUser}
          onSendFriendRequest={contactsRoute.contactsActions?.onSendFriendRequest}
          onAcceptRequest={contactsRoute.contactsActions?.onAcceptRequest}
          onRejectRequest={contactsRoute.contactsActions?.onRejectRequest}
          onRemoveContact={contactsRoute.contactsActions?.onRemoveContact}
          onBlockContact={contactsRoute.contactsActions?.onBlockContact}
          onUpdateRemark={contactsRoute.contactsActions?.onUpdateRemark}
        />
      );
    case 'docs':
      return (
        <DocsPage
          activeNav={docsRoute.docsNav}
          activeTab={docsRoute.docsTab}
          navItems={[]}
          onNavChange={docsRoute.setDocsNav}
          onTabChange={docsRoute.setDocsTab}
          profiles={profileSources}
          activePreview={docsRoute.docsPreview}
          onClosePreview={docsRoute.closeDocPreview}
          onDocClick={docsRoute.openDocPreview}
          rows={docsRoute.rows}
          onCreateDoc={docsRoute.documentsActions?.onCreateDoc}
          onDeleteDoc={docsRoute.documentsActions?.onDeleteDoc}
        />
      );
    case 'agents':
      return (
        <WorkbenchAgentsRouteView
          agents={agents}
          agentsRoute={agentsRoute}
          agentProfilesStatus={agentProfilesStatus}
          onAgentProfileOpen={onAgentProfileOpen}
          onAgentsRetry={onAgentsRetry}
          skillMarketItems={skillMarketItems}
          skillMarketLoading={skillMarketLoading}
          mcpMarketItems={mcpMarketItems}
          mcpMarketLoading={mcpMarketLoading}
          ccSwitchStatus={ccSwitchStatus}
          ccSwitchProviders={ccSwitchProviders}
        />
      );
    case 'runs':
      return (
        <WorkbenchTasksRouteView
          tasksRoute={tasksRoute}
          realDataMode={realDataMode}
          profiles={profileSources}
        />
      );
    case 'projects':
      return (
        <ProjectsPage
          activeFilter={projectsRoute.projectFilter}
          activeProjectId={projectsRoute.projectId}
          activeTab={projectsRoute.projectTab}
          activePreview={projectsRoute.projectPreview}
          onFilterChange={projectsRoute.setProjectFilter}
          profiles={profileSources}
          onArtifactClick={projectsRoute.openArtifactPreview}
          onClosePreview={() => projectsRoute.setProjectPreview(null)}
          onProjectCreate={projectsRoute.canMutateProject ? projectsRoute.handleProjectCreate : undefined}
          onProjectSelect={projectsRoute.selectProject}
          onProjectUpdate={projectsRoute.canMutateProject ? projectsRoute.handleProjectUpdate : undefined}
          onTabChange={projectsRoute.setProjectTab}
          projectActionError={projectsRoute.effectiveProjectsStatus?.actionError}
          projectSaving={projectsRoute.effectiveProjectsStatus?.saving}
          projects={projectsRoute.sourceProjects}
          projectsError={projectsRoute.effectiveProjectsStatus?.error}
          projectsLoading={projectsRoute.effectiveProjectsStatus?.loading}
        />
      );
    case 'settings':
      return (
        <SettingsPage
          {...settingsRoute.settings}
          activePane={settingsRoute.settingsPane}
          onChangeSetting={settingsRoute.handleSettingChange}
          localCliDiscovery={localCliDiscovery}
          onOpenAgentConfig={() => {
            agentsRoute.setAgentsPane('installed');
            onNavigatePage?.('agents');
          }}
          onSelectPane={settingsRoute.setSettingsPane}
          spaceMeta="桌面设计 demo"
          spaceTitle="AgentHub Desktop"
          currentUserDisplayName={userDisplayName}
          settingsLoading={settingsRoute.settingsLoading}
          settingsError={settingsRoute.settingsError}
          settingsErrorKind={settingsRoute.settingsErrorKind}
          onRetrySettingsLoad={settingsRoute.hasSettingsService ? settingsRoute.handleRetrySettingsLoad : undefined}
          onDismissSettingsError={settingsRoute.hasSettingsService ? settingsRoute.handleDismissSettingsError : undefined}
        />
      );
    default:
      return (
        <div className={styles.routeMissing} role="status">
          路由未配置：{activePage}
        </div>
      );
  }
}
