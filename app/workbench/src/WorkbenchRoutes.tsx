import React, { useCallback, useMemo } from 'react';
import { WorkbenchAgentsRouteView } from './WorkbenchAgentsRouteView';
import { WorkbenchContactsRouteView } from './WorkbenchContactsRouteView';
import { WorkbenchDevicesRouteView } from './WorkbenchDevicesRouteView';
import { WorkbenchDocsRouteView } from './WorkbenchDocsRouteView';
import { WorkbenchProjectsRouteView } from './WorkbenchProjectsRouteView';
import { WorkbenchSettingsRouteView } from './WorkbenchSettingsRouteView';
import { WorkbenchTasksRouteView } from './WorkbenchTasksRouteView';
import { WorkbenchUsageRouteView } from './WorkbenchUsageRouteView';
import { PageErrorBoundary } from './PageErrorBoundary';
import { useWorkbenchAgentsRoute } from './useWorkbenchAgentsRoute';
import { useWorkbenchContactsRoute } from './useWorkbenchContactsRoute';
import { useWorkbenchDocsRoute } from './useWorkbenchDocsRoute';
import { useWorkbenchProjectsRoute } from './useWorkbenchProjectsRoute';
import { useWorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import { useWorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { resolveTaskQueueDemoSource } from './useWorkbenchTaskDeepLinks';
import type { WorkbenchTaskQueueSource } from './workbenchTaskDeepLinks';
import { buildWorkbenchProfileSources } from './workbenchProfileSources';
import type { WorkbenchRoutesProps } from './workbenchRoutesTypes';
import type { WorkbenchProfileSource } from './profileRegistry';
import styles from './AgentHubWorkbench.module.css';

// ── Static page imports (no React.lazy — lazy 在 jsdom 测试中无法同步解析) ──

export type {
  WorkbenchAgentProfilesStatus,
  WorkbenchPage,
  WorkbenchRoutesProps,
} from './workbenchRoutesTypes';
export type { WorkbenchContactsActions, WorkbenchContactsData } from './useWorkbenchContactsRoute';
export type { WorkbenchDocumentsActions } from './useWorkbenchDocsRoute';
export type { WorkbenchProjectsStatus } from './useWorkbenchProjectsRoute';

/* ═══════════════════════════════════════════════════════════════════════
   #21 性能：route hook 条件化（保留状态的最小方案）

   问题：所有 6 个 route hook 曾在 WorkbenchRoutes 中无条件执行 —— 不管
   active page 是哪一页，agents/projects/contacts/docs/tasks/settings 的
   hook 每次渲染都跑。

   约束排查：
   - hooks 规则禁条件调用；route hook 内 "inactive 提前 return" 会让同一实例
     的 hook 数量在页面切换时变化（0 ↔ N），违反规则。
   - lazy mount（activePage === 'x' && <Route/>）会改变 unmount 行为：
     useWorkbenchAgentsRoute 持有未保存的 agent 草稿（agentDrafts）、
     useWorkbenchTasksRoute 持有任务编辑草稿、useWorkbenchProjectsRoute 持有
     hub 项目缓存与分页游标 —— 切页即丢，属回归，不可用。

   方案：把 runs/projects/docs 三个 route 的 hook 移入独立、常驻挂载的
   gate 组件（React.memo + active 标志）：
   - hook 调用无条件（组件挂载期 hook 数量恒定），状态跨页面切换保留；
   - inactive 时只渲染 null（视图挂载语义与原来 switch 一致）；
   - WorkbenchRoutes 因无关原因重渲染时，gate props（数据引用 + 原始值 +
     useMemo 的 profiles）稳定 → memo 跳过 → hook 不再空转；
   - 各 route 内部状态变化也只触发自身 gate 重渲染，不再带动其余 hook。
   agents/contacts/settings 保留在 WorkbenchRoutes：agents+contacts 输出是
   profileSources 的输入（agentsRoute.agentConfigs / contactsData.members），
   settings 输出 realDataMode 供 3 个 hook 复用；三者热路径均已 useMemo，
   未 memo 化的残余仅为闭包工厂分配（µs 级）。
   ═══════════════════════════════════════════════════════════════════════ */

interface WorkbenchTasksRouteGateProps {
  /** 当前是否为该 route 的 active page（rail 上为 'runs'）。 */
  active: boolean;
  realDataMode: boolean;
  taskQueueSource: WorkbenchTaskQueueSource;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
  profiles: WorkbenchProfileSource[];
  platformSurface?: WorkbenchRoutesProps['platformSurface'];
}

const WorkbenchTasksRouteGate = React.memo(function WorkbenchTasksRouteGate({
  active,
  realDataMode,
  taskQueueSource,
  currentUserId,
  userDisplayName,
  profiles,
  platformSurface,
}: WorkbenchTasksRouteGateProps): React.ReactElement | null {
  const tasksRoute = useWorkbenchTasksRoute({
    realDataMode,
    taskQueueSource,
    currentUserId,
    userDisplayName,
  });
  if (!active) return null;
  return (
    <PageErrorBoundary>
      <WorkbenchTasksRouteView
        tasksRoute={tasksRoute}
        realDataMode={realDataMode}
        profiles={profiles}
        platformSurface={platformSurface}
      />
    </PageErrorBoundary>
  );
});

type WorkbenchProjectsRouteGateProps = Pick<
  WorkbenchRoutesProps,
  | 'projects'
  | 'activeProjectId'
  | 'projectsStatus'
  | 'onActiveProjectChange'
  | 'onProjectCreate'
  | 'onProjectUpdate'
  | 'projectsPort'
> & {
  active: boolean;
  realDataMode: boolean;
  profiles: WorkbenchProfileSource[];
};

const WorkbenchProjectsRouteGate = React.memo(function WorkbenchProjectsRouteGate({
  active,
  realDataMode,
  profiles,
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  projectsPort,
}: WorkbenchProjectsRouteGateProps): React.ReactElement | null {
  const projectsRoute = useWorkbenchProjectsRoute({
    projects,
    activeProjectId,
    projectsStatus,
    onActiveProjectChange,
    onProjectCreate,
    onProjectUpdate,
    projectsPort,
    realDataMode,
  });
  if (!active) return null;
  return (
    <PageErrorBoundary>
      <WorkbenchProjectsRouteView projectsRoute={projectsRoute} profiles={profiles} />
    </PageErrorBoundary>
  );
});

type WorkbenchDocsRouteGateProps = Pick<
  WorkbenchRoutesProps,
  'documents' | 'documentsError' | 'documentsActions'
> & {
  active: boolean;
  realDataMode: boolean;
  profiles: WorkbenchProfileSource[];
};

const WorkbenchDocsRouteGate = React.memo(function WorkbenchDocsRouteGate({
  active,
  profiles,
  documents,
  documentsError,
  documentsActions,
  realDataMode,
}: WorkbenchDocsRouteGateProps): React.ReactElement | null {
  const docsRoute = useWorkbenchDocsRoute({
    documents,
    documentsError,
    documentsActions,
    realDataMode,
  });
  if (!active) return null;
  return (
    <PageErrorBoundary onReset={docsRoute.closeDocPreview}>
      <WorkbenchDocsRouteView docsRoute={docsRoute} profiles={profiles} />
    </PageErrorBoundary>
  );
});

export function WorkbenchRoutes({
  activePage,
  agents,
  agentProfilesStatus,
  dataMode,
  contacts,
  contactsError,
  documents,
  documentsError,
  focusedAgentId,
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  projectsPort,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onAgentProfileOpen,
  onStartConversation,
  contactsActions,
  localCliDiscovery,
  sessionImportItems,
  sessionImportLoading,
  sessionImportError,
  sessionImportVisible,
  onRefreshSessionImport,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  settingsService,
  skillMarketItems,
  skillMarketLoading,
  skillMarketError,
  mcpMarketItems,
  mcpMarketLoading,
  mcpMarketError,
  onNavigatePage,
  currentUserId,
  userDisplayName,
  platformSurface,
  devicesTargets,
  devicesLoading,
  devicesError,
  onDevicesRetry,
  devicesPingingId,
  onDevicePing,
  usageTeams,
  usageLoading,
  usageError,
  onUsageRetry,
}: WorkbenchRoutesProps): React.ReactElement {
  const settingsRoute = useWorkbenchSettingsRoute({
    settingsService,
    dataMode,
  });
  const { realDataMode } = settingsRoute;
  const taskQueueSource = resolveTaskQueueDemoSource(dataMode);
  const tasksRealDataMode = taskQueueSource === null;

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

  const contactsRoute = useWorkbenchContactsRoute({
    contacts,
    contactsError,
    contactsActions,
    onStartConversation,
  });

  const profileSources = useMemo(
    () => buildWorkbenchProfileSources(
      agentsRoute.agentConfigs,
      contactsRoute.contactsData?.members ?? [],
    ),
    [agentsRoute.agentConfigs, contactsRoute.contactsData?.members],
  );

  const handleOpenAgentConfig = useCallback(() => {
    agentsRoute.setAgentsPane('installed');
    onNavigatePage?.('agents');
  }, [agentsRoute, onNavigatePage]);

  const isKnownPage =
    activePage === 'contacts' ||
    activePage === 'docs' ||
    activePage === 'agents' ||
    activePage === 'runs' ||
    activePage === 'projects' ||
    activePage === 'devices' ||
    activePage === 'usage' ||
    activePage === 'settings';

  return (
    <>
      {activePage === 'contacts' && (
        <WorkbenchContactsRouteView contactsRoute={contactsRoute} />
      )}
      {activePage === 'agents' && (
        <WorkbenchAgentsRouteView
          agents={agents}
          agentsRoute={agentsRoute}
          agentProfilesStatus={agentProfilesStatus}
          onAgentProfileOpen={onAgentProfileOpen}
          onAgentsRetry={onAgentsRetry}
          skillMarketItems={skillMarketItems}
          skillMarketLoading={skillMarketLoading}
          skillMarketError={skillMarketError}
          mcpMarketItems={mcpMarketItems}
          mcpMarketLoading={mcpMarketLoading}
          mcpMarketError={mcpMarketError}
          ccSwitchStatus={ccSwitchStatus}
          ccSwitchProviders={ccSwitchProviders}
        />
      )}
      {activePage === 'settings' && (
        <WorkbenchSettingsRouteView
          settingsRoute={settingsRoute}
          localCliDiscovery={localCliDiscovery}
          sessionImportItems={sessionImportItems}
          sessionImportLoading={sessionImportLoading}
          sessionImportError={sessionImportError}
          sessionImportVisible={sessionImportVisible}
          onRefreshSessionImport={onRefreshSessionImport}
          userDisplayName={userDisplayName}
          onOpenAgentConfig={handleOpenAgentConfig}
        />
      )}
      {activePage === 'devices' && (
        <PageErrorBoundary>
          <WorkbenchDevicesRouteView
            targets={devicesTargets}
            loading={devicesLoading}
            error={devicesError}
            onRetry={onDevicesRetry}
            pingingTargetId={devicesPingingId}
            onPingTarget={onDevicePing}
          />
        </PageErrorBoundary>
      )}
      {activePage === 'usage' && (
        <PageErrorBoundary>
          <WorkbenchUsageRouteView
            teams={usageTeams}
            loading={usageLoading}
            error={usageError}
            onRetry={onUsageRetry}
          />
        </PageErrorBoundary>
      )}
      <WorkbenchTasksRouteGate
        active={activePage === 'runs'}
        realDataMode={tasksRealDataMode}
        taskQueueSource={taskQueueSource}
        currentUserId={currentUserId}
        userDisplayName={userDisplayName}
        profiles={profileSources}
        platformSurface={platformSurface}
      />
      <WorkbenchProjectsRouteGate
        active={activePage === 'projects'}
        projects={projects}
        activeProjectId={activeProjectId}
        projectsStatus={projectsStatus}
        onActiveProjectChange={onActiveProjectChange}
        onProjectCreate={onProjectCreate}
        onProjectUpdate={onProjectUpdate}
        projectsPort={projectsPort}
        realDataMode={realDataMode}
        profiles={profileSources}
      />
      <WorkbenchDocsRouteGate
        active={activePage === 'docs'}
        documents={documents}
        documentsError={documentsError}
        documentsActions={documentsActions}
        realDataMode={realDataMode}
        profiles={profileSources}
      />
      {!isKnownPage && (
        <div className={styles.routeMissing} role="status">
          路由未配置：{activePage}
        </div>
      )}
    </>
  );
}
