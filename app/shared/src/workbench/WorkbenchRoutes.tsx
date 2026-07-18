import React, { useCallback, useMemo } from 'react';
import { WorkbenchAgentsRouteView } from './WorkbenchAgentsRouteView';
import { WorkbenchContactsRouteView } from './WorkbenchContactsRouteView';
import { WorkbenchDocsRouteView } from './WorkbenchDocsRouteView';
import { WorkbenchProjectsRouteView } from './WorkbenchProjectsRouteView';
import { WorkbenchSettingsRouteView } from './WorkbenchSettingsRouteView';
import { WorkbenchTasksRouteView } from './WorkbenchTasksRouteView';
import { useWorkbenchAgentsRoute } from './useWorkbenchAgentsRoute';
import { useWorkbenchContactsRoute } from './useWorkbenchContactsRoute';
import { useWorkbenchDocsRoute } from './useWorkbenchDocsRoute';
import { useWorkbenchProjectsRoute } from './useWorkbenchProjectsRoute';
import { useWorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import { useWorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { buildWorkbenchProfileSources } from './workbenchProfileSources';
import type { WorkbenchRoutesProps } from './workbenchRoutesTypes';
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

  const handleOpenAgentConfig = useCallback(() => {
    agentsRoute.setAgentsPane('installed');
    onNavigatePage?.('agents');
  }, [agentsRoute, onNavigatePage]);

  switch (activePage) {
    case 'contacts':
      return <WorkbenchContactsRouteView contactsRoute={contactsRoute} />;
    case 'docs':
      return <WorkbenchDocsRouteView docsRoute={docsRoute} profiles={profileSources} />;
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
        <WorkbenchProjectsRouteView
          projectsRoute={projectsRoute}
          profiles={profileSources}
        />
      );
    case 'settings':
      return (
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
      );
    default:
      return (
        <div className={styles.routeMissing} role="status">
          路由未配置：{activePage}
        </div>
      );
  }
}
