import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isWorkbenchRealDataMode,
  normalizeWorkbenchDataMode,
  readWorkbenchDataModeOverride,
  workbenchDataModeDisplayLabel,
  writeWorkbenchDataModeOverride,
} from '../demo';
import {
  composerSubmitBehaviorFromLabel,
  composerSubmitBehaviorLabel,
  readComposerSubmitBehavior,
  writeComposerSubmitBehavior,
} from './workbenchPreferences';
import type { LocalCliDiscoveryManifest, WorkbenchAgent } from '../platform';
import type {
  ContactsPane,
  ContactGroup,
  ContactMember,
  DocRow,
  DocsPane,
  ProjectDraft,
  ProjectInfo,
  SettingsPaneId,
  ServiceDesk,
} from './pages';
import type { AgentConfig, SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { GlobalRailPage } from './GlobalRail';
import {
  fileTypeFromPreviewName,
  previewFilenameFromTitle,
  type WorkbenchDocumentPreview,
} from './documentPreview';
import {
  WORKBENCH_MOCK_AGENT_AUDIT_ROWS,
  WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES,
  WORKBENCH_MOCK_AGENT_MODEL_HEALTH,
  WORKBENCH_MOCK_AGENT_POLICY_RULES,
  WORKBENCH_MOCK_AGENT_TOOL_OPTIONS,
  WORKBENCH_MOCK_CONTACT_GROUPS,
  WORKBENCH_MOCK_CONTACT_MEMBERS,
  WORKBENCH_MOCK_CONTACT_SHORTCUTS,
  WORKBENCH_MOCK_DOC_ROWS,
  WORKBENCH_MOCK_EXTERNAL_CONTACTS,
  WORKBENCH_MOCK_PENDING_CONTACTS,
  WORKBENCH_MOCK_SERVICE_DESKS,
  WORKBENCH_MOCK_SETTINGS_DEFAULTS,
} from './mockData';
import type { SettingsService } from './settingsService';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';
import type { HubClient } from '../hubClient';
import { ContactsPage } from './pages/ContactsPage';
import { DocsPage } from './pages/DocsPage';
import { AgentsPage } from './pages/AgentsPage';
import { TasksPage } from './pages/TasksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useWorkbenchAgentsRoute } from './useWorkbenchAgentsRoute';
import {
  useWorkbenchProjectsRoute,
  type WorkbenchProjectsStatus,
} from './useWorkbenchProjectsRoute';
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

/** Contact mutation callbacks wired to Hub API. */
export interface WorkbenchContactsActions {
  onSearchUser?: ((query: string) => Promise<unknown> | void) | undefined;
  onSendFriendRequest?: ((userId: string, message?: string) => Promise<unknown> | void) | undefined;
  onAcceptRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRejectRequest?: ((requestId: string) => Promise<unknown> | void) | undefined;
  onRemoveContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onBlockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onUnblockContact?: ((userId: string) => Promise<unknown> | void) | undefined;
  onUpdateRemark?: ((userId: string, remark: string) => Promise<unknown> | void) | undefined;
  onCreateGroup?: ((name: string, memberIds: string[]) => Promise<unknown> | void) | undefined;
}

/** Document mutation callbacks wired to Hub Documents API. */
export interface WorkbenchDocumentsActions {
  onCreateDoc?: (() => Promise<unknown> | void) | undefined;
  onUpdateDoc?: ((documentId: string, data: Record<string, unknown>) => Promise<unknown> | void) | undefined;
  onDeleteDoc?: ((documentId: string) => Promise<unknown> | void) | undefined;
}

export interface WorkbenchAgentProfilesStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  savingAgentId?: string | undefined;
  deletingAgentId?: string | undefined;
}

export type { WorkbenchProjectsStatus } from './useWorkbenchProjectsRoute';

export interface WorkbenchContactsData {
  members: ContactMember[];
  externalContacts?: ContactMember[] | undefined;
  pendingContacts?: ContactMember[] | undefined;
  starredContacts?: ContactMember[] | undefined;
  groups?: ContactGroup[] | undefined;
  serviceDesks?: ServiceDesk[] | undefined;
  recentShortcuts?: string[] | undefined;
  orgName?: string | undefined;
  orgInitials?: string | undefined;
}

function persistDataModeLabel(value: string): void {
  writeWorkbenchDataModeOverride(normalizeWorkbenchDataMode(value));
}

function dataModeLabel(): string {
  return workbenchDataModeDisplayLabel(readWorkbenchDataModeOverride());
}

function isRouteRealDataMode(value: string | undefined): boolean {
  return isWorkbenchRealDataMode(value);
}

function createDocPreview(doc: DocRow): WorkbenchDocumentPreview {
  const filename = previewFilenameFromTitle(doc.title);
  const tagLine = doc.tag ? `- 标签：${doc.tag}` : '- 标签：未标记';
  return {
    id: `doc:${doc.id}`,
    name: filename,
    type: fileTypeFromPreviewName(filename),
    owner: doc.owner,
    sourceLabel: doc.location,
    content: [
      `# ${doc.title}`,
      '',
      '## 文档信息',
      `- 所有者：${doc.owner}`,
      `- 位置：${doc.location}`,
      `- 创建时间：${doc.time}`,
      tagLine,
      '',
      '## 摘要',
      '这是 AgentHub 轻量文档预览。当前内容来自文档索引，后续可由 Hub artifact store、workspace 文件或外部文档 provider 提供正文。',
      '',
      '## 下一步',
      '- 接入全文搜索与项目归档索引。',
      '- 将外部云文档 provider 映射为同一预览合同。',
      '- 对 Markdown、Diff、表格和链接产物使用统一只读预览。',
    ].join('\n'),
  };
}

function persistedComposerSubmitBehaviorLabel(): string {
  return composerSubmitBehaviorLabel(readComposerSubmitBehavior());
}

function createSettingsDefaults(): typeof WORKBENCH_MOCK_SETTINGS_DEFAULTS {
  return {
    ...WORKBENCH_MOCK_SETTINGS_DEFAULTS,
    dataMode: dataModeLabel(),
    composerSubmitBehavior: persistedComposerSubmitBehaviorLabel(),
  };
}

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
  const [contactsPane, setContactsPane] = useState<ContactsPane>('internal');
  const [docsNav, setDocsNav] = useState('home');
  const [docsTab, setDocsTab] = useState<DocsPane>('recent');
  const realDataMode = isRouteRealDataMode(dataMode);

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

  const [docsPreview, setDocsPreview] = useState<WorkbenchDocumentPreview | null>(null);
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('appearance');
  const [settings, setSettings] = useState(createSettingsDefaults);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsErrorKind, setSettingsErrorKind] = useState<'init' | 'write' | null>(null);

  const syncSettingsServiceState = useCallback(() => {
    if (!settingsService) {
      setSettingsLoading(false);
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    setSettings(settingsService.readAll() as typeof settings);
    setSettingsLoading(settingsService.loading);
    setSettingsError(settingsService.error);
    setSettingsErrorKind(settingsService.errorKind);
  }, [settingsService]);

  // When a settingsService is provided, initialize it and subscribe to remote changes.
  useEffect(() => {
    if (!settingsService) {
      setSettingsLoading(false);
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    const unsub = settingsService.subscribe(syncSettingsServiceState);
    syncSettingsServiceState();
    settingsService.init().catch((err) => {
      console.error('settingsService.init failed in WorkbenchRoutes:', err);
      /* init failure is surfaced via settingsService.error */
      syncSettingsServiceState();
    });
    return unsub;
  }, [settingsService, syncSettingsServiceState]);

  const handleRetrySettingsLoad = useCallback(() => {
    if (!settingsService) return;
    settingsService.init().catch((err) => {
      console.error('settingsService.init retry failed in WorkbenchRoutes:', err);
      syncSettingsServiceState();
    });
  }, [settingsService, syncSettingsServiceState]);

  const handleDismissSettingsError = useCallback(() => {
    if (!settingsService) {
      setSettingsError(null);
      setSettingsErrorKind(null);
      return;
    }
    settingsService.clearError();
    syncSettingsServiceState();
  }, [settingsService, syncSettingsServiceState]);

  const contactsData = contacts ?? {
    members: WORKBENCH_MOCK_CONTACT_MEMBERS,
    externalContacts: WORKBENCH_MOCK_EXTERNAL_CONTACTS,
    pendingContacts: WORKBENCH_MOCK_PENDING_CONTACTS,
    starredContacts: WORKBENCH_MOCK_CONTACT_MEMBERS.slice(0, 2),
    groups: WORKBENCH_MOCK_CONTACT_GROUPS,
    serviceDesks: WORKBENCH_MOCK_SERVICE_DESKS,
    recentShortcuts: WORKBENCH_MOCK_CONTACT_SHORTCUTS,
    orgName: 'TokenDance',
    orgInitials: 'TD',
  };
  const profileSources = useMemo(() => [
    ...agentsRoute.agentConfigs.map((agent) => ({ ...agent, kind: 'agent' as const })),
    ...contactsData.members.map((member) => ({ ...member, kind: 'user' as const })),
  ], [agentsRoute.agentConfigs, contactsData.members]);

  function handleSettingChange(key: string, value: string | boolean): void {
    if (key === 'dataMode' && typeof value === 'string') {
      persistDataModeLabel(value);
    }
    if (key === 'composerSubmitBehavior' && typeof value === 'string') {
      writeComposerSubmitBehavior(composerSubmitBehaviorFromLabel(value));
    }
    setSettings((current) => {
      let next: typeof current;
      if (key.startsWith('perm_')) {
        next = {
          ...current,
          permissions: { ...current.permissions, [key.slice(5)]: String(value) },
        };
      } else if (key.startsWith('stateStrategy_')) {
        const strategy = key.slice('stateStrategy_'.length) as keyof typeof current.stateStrategies;
        next = {
          ...current,
          stateStrategies: { ...current.stateStrategies, [strategy]: Boolean(value) },
        };
      } else {
        next = { ...current, [key]: value };
      }
      // Persist to settingsService (fire-and-forget)
      if (settingsService) {
        if (key.startsWith('perm_')) {
          settingsService.write('permissions', next.permissions);
        } else if (key.startsWith('stateStrategy_')) {
          settingsService.write('stateStrategies', next.stateStrategies);
        } else {
          settingsService.write(key, value);
        }
      }
      return next;
    });
  }

  switch (activePage) {
    case 'contacts':
      return (
        <ContactsPage
          activePane={contactsPane}
          externalContacts={contactsData.externalContacts ?? []}
          groups={contactsData.groups ?? []}
          members={contactsData.members}
          onMemberClick={onStartConversation ? (member) => {
            onStartConversation({ name: member.name, id: member.id, kind: 'dm' });
          } : undefined}
          onPaneChange={setContactsPane}
          orgInitials={contactsData.orgInitials ?? 'TD'}
          orgName={contactsData.orgName ?? 'TokenDance'}
          pendingContacts={contactsData.pendingContacts ?? []}
          recentShortcuts={contactsData.recentShortcuts ?? []}
          serviceDesks={contactsData.serviceDesks ?? []}
          starredContacts={contactsData.starredContacts ?? []}
          onSearchUser={contactsActions?.onSearchUser}
          onSendFriendRequest={contactsActions?.onSendFriendRequest}
          onAcceptRequest={contactsActions?.onAcceptRequest}
          onRejectRequest={contactsActions?.onRejectRequest}
          onRemoveContact={contactsActions?.onRemoveContact}
          onBlockContact={contactsActions?.onBlockContact}
          onUpdateRemark={contactsActions?.onUpdateRemark}
        />
      );
    case 'docs':
      return (
        <DocsPage
          activeNav={docsNav}
          activeTab={docsTab}
          navItems={[]}
          onNavChange={setDocsNav}
          onTabChange={setDocsTab}
          profiles={profileSources}
          activePreview={docsPreview}
          onClosePreview={() => setDocsPreview(null)}
          onDocClick={(doc) => setDocsPreview(createDocPreview(doc))}
          rows={documents ?? WORKBENCH_MOCK_DOC_ROWS}
          onCreateDoc={documentsActions?.onCreateDoc}
          onDeleteDoc={documentsActions?.onDeleteDoc}
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
          {...settings}
          activePane={settingsPane}
          onChangeSetting={handleSettingChange}
          localCliDiscovery={localCliDiscovery}
          onOpenAgentConfig={() => {
            agentsRoute.setAgentsPane('installed');
            onNavigatePage?.('agents');
          }}
          onSelectPane={setSettingsPane}
          spaceMeta="桌面设计 demo"
          spaceTitle="AgentHub Desktop"
          currentUserDisplayName={userDisplayName}
          settingsLoading={settingsLoading}
          settingsError={settingsError}
          settingsErrorKind={settingsErrorKind}
          onRetrySettingsLoad={settingsService ? handleRetrySettingsLoad : undefined}
          onDismissSettingsError={settingsService ? handleDismissSettingsError : undefined}
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
