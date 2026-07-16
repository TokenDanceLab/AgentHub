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
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import type { HubClient } from '../hubClient';
import { ContactsPage } from './pages/ContactsPage';
import { DocsPage } from './pages/DocsPage';
import { AgentsPage } from './pages/AgentsPage';
import { TasksPage } from './pages/TasksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  WORKBENCH_MOCK_AGENT_AUDIT_ROWS,
  WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES,
  WORKBENCH_MOCK_AGENT_MODEL_HEALTH,
  WORKBENCH_MOCK_AGENT_POLICY_RULES,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
} from './mockData';
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

  const profileSources = useMemo(() => [
    ...agentsRoute.agentConfigs.map((agent) => ({ ...agent, kind: 'agent' as const })),
    ...contactsRoute.contactsData.members.map((member) => ({ ...member, kind: 'user' as const })),
  ], [agentsRoute.agentConfigs, contactsRoute.contactsData.members]);

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
        <AgentsPage
          activePane={agentsRoute.agentsPane}
          agents={agentsRoute.agentConfigs}
          agentActionError={agentProfilesStatus?.actionError}
          agentsError={agentProfilesStatus?.error}
          agentsLoading={agentProfilesStatus?.loading}
          allSkills={agentsRoute.resolvedSkills}
          allTools={agentsRoute.resolvedTools}
          auditEntries={WORKBENCH_MOCK_AGENT_AUDIT_ROWS}
          confirmCount={agentsRoute.agentConfigs.reduce((total, agent) => total + agentsRoute.resolvedTools.filter((tool) => agent.tools[tool] === '需确认').length, 0)}
          defaultModelLabel={agentsRoute.agentConfigs[0]?.model ?? '未配置模型'}
          installedCount={agentsRoute.agentConfigs.length}
          marketFeatured={WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES.slice(0, 3)}
          marketTemplates={WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES.slice(3)}
          modelHealthRows={WORKBENCH_MOCK_AGENT_MODEL_HEALTH}
          modelRoutes={agentsRoute.agentConfigs.map((agent) => ({
            agentId: agent.id,
            agentName: agent.name,
            agentInitials: workbenchProfileInitials(agent.name),
            agentColor: workbenchAgentColor(agent),
            role: agent.role,
            mode: agent.mode,
            model: agent.model,
          }))}
          models={agentsRoute.resolvedModels}
          onPaneChange={agentsRoute.setAgentsPane}
          onAgentAdd={agentsRoute.handleAgentAdd}
          onAgentDelete={agentsRoute.handleAgentDelete}
          onAgentFieldChange={agentsRoute.handleAgentFieldChange}
          onAgentProfileOpen={onAgentProfileOpen}
          onAgentSave={agentsRoute.handleAgentSave}
          onAgentSelect={agentsRoute.setSelectedAgentId}
          onAgentSkillToggle={agentsRoute.handleAgentSkillToggle}
          onMarketInstall={agentsRoute.handleMarketInstall}
          onAgentsRetry={onAgentsRetry}
          onToolPermissionSet={agentsRoute.handleToolPermissionSet}
          policyRules={WORKBENCH_MOCK_AGENT_POLICY_RULES}
          recentShortcuts={agents === undefined ? ['Builder 权限更新', 'Browser QA 已安装', 'DeepSeek-V4-Pro 路由'] : agentsRoute.agentConfigs.slice(0, 3).map((agent) => `${agent.name} 已同步`)}
          runnableCount={agentsRoute.agentConfigs.filter((agent) => agent.state === 'running' || agent.state === 'ready').length}
          saveStateLabel={agentsRoute.agentSaveStateLabel()}
          isDirty={agentsRoute.selectedAgentIsDirty}
          savingAgentId={agentProfilesStatus?.savingAgentId}
          deletingAgentId={agentProfilesStatus?.deletingAgentId}
          toolMatrixAgents={agentsRoute.agentConfigs.map((agent) => ({
            id: agent.id,
            name: agent.name,
            initials: workbenchProfileInitials(agent.name),
            color: workbenchAgentColor(agent),
            permissions: agent.tools,
          }))}
          toolMatrixTools={WORKBENCH_MOCK_AGENT_TOOL_OPTIONS}
          {...(agentsRoute.effectiveSelectedAgentId ? { selectedAgentId: agentsRoute.effectiveSelectedAgentId } : {})}
          skillMarketItems={skillMarketItems ?? []}
          skillMarketLoading={skillMarketLoading ?? false}
          mcpMarketItems={mcpMarketItems ?? []}
          mcpMarketLoading={mcpMarketLoading ?? false}
          ccSwitchStatus={ccSwitchStatus}
          ccSwitchProviders={ccSwitchProviders}
        />
      );
    case 'runs':
      return (
        <TasksPage
          activePane={tasksRoute.tasksPane}
          activeFilterCount={tasksRoute.taskFilterActive ? 1 : 0}
          crossProjectCount={new Set(tasksRoute.visibleTasks.map((task) => task.project)).size}
          dueTodayCount={tasksRoute.visibleTasks.filter((task) => task.dueDate.includes('今天')).length}
          fieldConfigActive={!tasksRoute.taskShowCreator}
          fieldConfigLabel={tasksRoute.taskShowCreator ? '字段配置' : '字段配置 5/6'}
          emptyStateLabel={realDataMode ? 'Hub tasks are not loaded in this replay.' : undefined}
          groupActive={tasksRoute.taskGroupMode !== 'custom' || tasksRoute.taskViewMode !== 'list'}
          groupLabel={
            tasksRoute.taskViewMode === 'board'
              ? '分组：状态看板'
              : tasksRoute.taskViewMode === 'dashboard'
                ? '分组：项目仪表盘'
                : tasksRoute.taskGroupMode === 'project'
                  ? '分组：所属项目'
                  : tasksRoute.taskGroupMode === 'status'
                    ? '分组：任务状态'
                    : '分组：自定义分组'
          }
          groups={tasksRoute.visibleTaskGroups}
          profiles={profileSources}
          editingDraft={tasksRoute.editingTaskDraft}
          editingTaskId={tasksRoute.editingTaskId}
          navMenuOpen={tasksRoute.taskNavMenuOpen}
          incompleteCount={tasksRoute.visibleTasks.filter((task) => task.status !== '已完成').length}
          onAddTaskRow={realDataMode ? undefined : tasksRoute.handleCreateTask}
          onAssignSelectedTaskToMe={tasksRoute.handleAssignSelectedTaskToMe}
          onCycleSelectedTaskStatus={tasksRoute.handleCycleSelectedTaskStatus}
          onCreateTask={realDataMode ? undefined : tasksRoute.handleCreateTask}
          onCancelTaskEdit={tasksRoute.handleCancelTaskEdit}
          onDeleteSelectedTask={tasksRoute.handleDeleteSelectedTask}
          onEditDraftChange={tasksRoute.handleEditTaskDraftChange}
          onEditSelectedTask={tasksRoute.handleEditSelectedTask}
          onFilterBySelectedTaskAssignee={tasksRoute.handleFilterBySelectedTaskAssignee}
          onGroupBySelectedTaskProject={tasksRoute.handleGroupBySelectedTaskProject}
          onNewGroup={realDataMode ? undefined : tasksRoute.handleNewTaskGroup}
          onNavMore={tasksRoute.handleNavMore}
          onPaneChange={tasksRoute.handleTaskPaneChange}
          onTaskClick={tasksRoute.handleTaskClick}
          onSaveTaskEdit={tasksRoute.handleSaveTaskEdit}
          onTaskList={tasksRoute.handleTaskList}
          onToolbarFieldConfig={tasksRoute.handleToolbarFieldConfig}
          onToolbarFilter={tasksRoute.handleToolbarFilter}
          onToolbarGroup={tasksRoute.handleTaskGroup}
          onToolbarSort={tasksRoute.handleTaskSort}
          onViewModeChange={tasksRoute.setTaskViewMode}
          selectedTaskId={tasksRoute.selectedTaskId}
          selectedTask={tasksRoute.selectedTask}
          showCreatorColumn={tasksRoute.taskShowCreator}
          sortActive={tasksRoute.taskSortMode !== 'custom'}
          sortLabel={tasksRoute.taskSortMode === 'custom' ? '排序：拖拽自定义' : '排序：截止时间'}
          taskActionLabel={tasksRoute.taskActionLabel}
          viewMode={tasksRoute.taskViewMode}
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
