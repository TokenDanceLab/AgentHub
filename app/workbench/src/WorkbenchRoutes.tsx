import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { PageErrorBoundary } from './PageErrorBoundary';
import { useWorkbenchAgentsRoute } from './routes/useWorkbenchAgentsRoute';
import { useWorkbenchContactsRoute } from './routes/useWorkbenchContactsRoute';
import { useWorkbenchDocsRoute } from './routes/useWorkbenchDocsRoute';
import { useWorkbenchProjectsRoute } from './routes/useWorkbenchProjectsRoute';
import { useWorkbenchSettingsRoute } from './routes/useWorkbenchSettingsRoute';
import { useWorkbenchTasksRoute } from './routes/useWorkbenchTasksRoute';
import { resolveTaskQueueDemoSource } from './useWorkbenchTaskDeepLinks';
import type { WorkbenchTaskQueueSource } from './routes/workbenchTaskDeepLinks';
import { buildWorkbenchProfileSources } from './workbenchProfileSources';
import type { WorkbenchRoutesProps } from './routes/workbenchRoutesTypes';
import type { WorkbenchProfileSource } from './profileRegistry';
import styles from './AgentHubWorkbench.module.css';

const WorkbenchAgentsRouteView = React.lazy(() =>
  import('./routes/WorkbenchAgentsRouteView').then((mod) => ({
    default: mod.WorkbenchAgentsRouteView,
  })),
);
const WorkbenchContactsRouteView = React.lazy(() =>
  import('./routes/WorkbenchContactsRouteView').then((mod) => ({
    default: mod.WorkbenchContactsRouteView,
  })),
);
const WorkbenchDevicesRouteView = React.lazy(() =>
  import('./routes/WorkbenchDevicesRouteView').then((mod) => ({
    default: mod.WorkbenchDevicesRouteView,
  })),
);
const WorkbenchDocsRouteView = React.lazy(() =>
  import('./routes/WorkbenchDocsRouteView').then((mod) => ({
    default: mod.WorkbenchDocsRouteView,
  })),
);
const WorkbenchProjectsRouteView = React.lazy(() =>
  import('./routes/WorkbenchProjectsRouteView').then((mod) => ({
    default: mod.WorkbenchProjectsRouteView,
  })),
);
const WorkbenchSettingsRouteView = React.lazy(() =>
  import('./routes/WorkbenchSettingsRouteView').then((mod) => ({
    default: mod.WorkbenchSettingsRouteView,
  })),
);
const WorkbenchTasksRouteView = React.lazy(() =>
  import('./routes/WorkbenchTasksRouteView').then((mod) => ({
    default: mod.WorkbenchTasksRouteView,
  })),
);
const WorkbenchUsageRouteView = React.lazy(() =>
  import('./routes/WorkbenchUsageRouteView').then((mod) => ({
    default: mod.WorkbenchUsageRouteView,
  })),
);

export type {
  WorkbenchAgentProfilesStatus,
  WorkbenchPage,
  WorkbenchRoutesProps,
} from './routes/workbenchRoutesTypes';
export type { WorkbenchContactsActions, WorkbenchContactsData } from './routes/useWorkbenchContactsRoute';
export type { WorkbenchDocumentsActions } from './routes/useWorkbenchDocsRoute';
export type { WorkbenchProjectsStatus } from './routes/useWorkbenchProjectsRoute';

// Route hooks stay mounted across page switches so in-progress drafts and cached
// data survive navigation; the gates only skip rendering when inactive.

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
}: WorkbenchProjectsRouteGateProps): React.ReactElement | null {
  const projectsRoute = useWorkbenchProjectsRoute({
    projects,
    activeProjectId,
    projectsStatus,
    onActiveProjectChange,
    onProjectCreate,
    onProjectUpdate,
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
  devicesPairing,
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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
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
    <React.Suspense fallback={null}>
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
            pairing={devicesPairing}
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
          {t('routes.unconfigured', { page: activePage })}
        </div>
      )}
    </React.Suspense>
  );
}
