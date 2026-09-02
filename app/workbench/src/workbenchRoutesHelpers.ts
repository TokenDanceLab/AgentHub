import type { LocalCliDiscoveryManifest, RuntimeSessionSummary } from '@shared/platform';
import type { ContactsPageProps } from './pages/ContactsPage';
import type { DocsPageProps } from './pages/DocsPage';
import type { ProjectsPageProps } from './pages/ProjectsPage';
import type { SettingsPageProps } from './pages/SettingsPage';
import type { WorkbenchProfileSource } from './profileRegistry';
import { hubEmptyContacts } from './hubDataMapping';
import type { WorkbenchContactsRoute } from './useWorkbenchContactsRoute';
import type { WorkbenchDocsRoute } from './useWorkbenchDocsRoute';
import type { WorkbenchProjectsRoute } from './useWorkbenchProjectsRoute';
import type { WorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchRoutesHelpers — pure residual slices from WorkbenchRoutes (#660).

   Page-prop builders for contacts/docs/projects/settings route shells.
   No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_ORG_NAME = 'TokenDance';
const DEFAULT_ORG_INITIALS = 'TD';
const DEFAULT_SPACE_TITLE = 'AgentHub Desktop';
const DEFAULT_SPACE_META = '桌面设计 demo';

/** Assign optional prop only when value is defined (exactOptionalPropertyTypes). */
export function assignDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function buildContactsPageProps(
  contactsRoute: WorkbenchContactsRoute,
): ContactsPageProps {
  const data = contactsRoute.contactsData ?? hubEmptyContacts;
  const actions = contactsRoute.contactsActions;
  const props: ContactsPageProps = {
    error: contactsRoute.contactsError,
    activePane: contactsRoute.contactsPane,
    onPaneChange: contactsRoute.setContactsPane,
    orgName: data.orgName ?? DEFAULT_ORG_NAME,
    orgInitials: data.orgInitials ?? DEFAULT_ORG_INITIALS,
    members: data.members,
    externalContacts: data.externalContacts ?? [],
    groups: data.groups ?? [],
    pendingContacts: data.pendingContacts ?? [],
    recentShortcuts: data.recentShortcuts ?? [],
    serviceDesks: data.serviceDesks ?? [],
    starredContacts: data.starredContacts ?? [],
  };

  assignDefined(props, 'onMemberClick', contactsRoute.handleMemberClick);
  assignDefined(props, 'onSearchUser', actions?.onSearchUser);
  assignDefined(props, 'onSendFriendRequest', actions?.onSendFriendRequest);
  assignDefined(props, 'onAcceptRequest', actions?.onAcceptRequest);
  assignDefined(props, 'onRejectRequest', actions?.onRejectRequest);
  assignDefined(props, 'onRemoveContact', actions?.onRemoveContact);
  assignDefined(props, 'onBlockContact', actions?.onBlockContact);
  assignDefined(props, 'onUpdateRemark', actions?.onUpdateRemark);

  // ── Infinite-scroll pagination (mock data layer, #1510) ──
  assignDefined(props, 'hasMore', contactsRoute.hasMore);
  assignDefined(props, 'loadingMore', contactsRoute.loadingMore);
  assignDefined(props, 'onLoadMore', contactsRoute.onLoadMore);

  return props;
}

export function buildDocsPageProps(
  docsRoute: WorkbenchDocsRoute,
  profiles: WorkbenchProfileSource[],
): DocsPageProps {
  const props: DocsPageProps = {
    activeNav: docsRoute.docsNav,
    activeTab: docsRoute.docsTab,
    navItems: [],
    onNavChange: docsRoute.setDocsNav,
    onTabChange: docsRoute.setDocsTab,
    profiles,
    activePreview: docsRoute.docsPreview,
    onClosePreview: docsRoute.closeDocPreview,
    onDocClick: docsRoute.openDocPreview,
    rows: docsRoute.rows,
    documentsLoading: docsRoute.documentsLoading,
  };

  assignDefined(props, 'documentsError', docsRoute.documentsError);
  // #2154 P2-2(b): demo-only shortcut list; real data mode passes [] and the
  // nav renders no shortcut block.
  assignDefined(props, 'shortcuts', docsRoute.shortcuts);

  assignDefined(props, 'onCreateDoc', docsRoute.documentsActions?.onCreateDoc);
  assignDefined(props, 'onDeleteDoc', docsRoute.documentsActions?.onDeleteDoc);

  return props;
}

export function buildProjectsPageProps(
  projectsRoute: WorkbenchProjectsRoute,
  profiles: WorkbenchProfileSource[],
): ProjectsPageProps {
  const status = projectsRoute.effectiveProjectsStatus;
  const props: ProjectsPageProps = {
    activeFilter: projectsRoute.projectFilter,
    activeProjectId: projectsRoute.projectId,
    activeTab: projectsRoute.projectTab,
    activePreview: projectsRoute.projectPreview,
    onFilterChange: projectsRoute.setProjectFilter,
    profiles,
    onArtifactClick: projectsRoute.openArtifactPreview,
    onClosePreview: () => projectsRoute.setProjectPreview(null),
    onProjectSelect: projectsRoute.selectProject,
    onTabChange: projectsRoute.setProjectTab,
    projects: projectsRoute.sourceProjects,
  };

  if (projectsRoute.canMutateProject) {
    props.onProjectCreate = projectsRoute.handleProjectCreate;
    props.onProjectUpdate = projectsRoute.handleProjectUpdate;
  }

  assignDefined(props, 'projectActionError', status?.actionError);
  assignDefined(props, 'projectSaving', status?.saving);
  assignDefined(props, 'projectsError', status?.error);
  assignDefined(props, 'projectsLoading', status?.loading);

  // ── Infinite-scroll pagination ──
  assignDefined(props, 'hasMore', projectsRoute.hasMore);
  assignDefined(props, 'loadingMore', projectsRoute.loadingMore);
  assignDefined(props, 'onLoadMore', projectsRoute.loadMore);
  assignDefined(props, 'loadMoreError', projectsRoute.loadMoreError);

  return props;
}

export interface BuildSettingsPagePropsInput {
  settingsRoute: WorkbenchSettingsRoute;
  localCliDiscovery?: LocalCliDiscoveryManifest | null | undefined;
  sessionImportItems?: RuntimeSessionSummary[] | undefined;
  sessionImportLoading?: boolean | undefined;
  sessionImportError?: string | null | undefined;
  sessionImportVisible?: boolean | undefined;
  onRefreshSessionImport?: (() => void) | undefined;
  userDisplayName?: string | undefined;
  onOpenAgentConfig: () => void;
  spaceTitle?: string | undefined;
  spaceMeta?: string | undefined;
}

export function buildSettingsPageProps(
  input: BuildSettingsPagePropsInput,
): SettingsPageProps {
  const { settingsRoute, onOpenAgentConfig } = input;
  const props: SettingsPageProps = {
    ...settingsRoute.settings,
    activePane: settingsRoute.settingsPane,
    onChangeSetting: settingsRoute.handleSettingChange,
    onOpenAgentConfig,
    onSelectPane: settingsRoute.setSettingsPane,
    spaceMeta: input.spaceMeta ?? DEFAULT_SPACE_META,
    spaceTitle: input.spaceTitle ?? DEFAULT_SPACE_TITLE,
    settingsLoading: settingsRoute.settingsLoading,
    settingsError: settingsRoute.settingsError,
    settingsErrorKind: settingsRoute.settingsErrorKind,
  };

  assignDefined(props, 'localCliDiscovery', input.localCliDiscovery);
  assignDefined(props, 'currentUserDisplayName', input.userDisplayName);
  assignDefined(props, 'sessionImportItems', input.sessionImportItems);
  assignDefined(props, 'sessionImportLoading', input.sessionImportLoading);
  assignDefined(props, 'sessionImportError', input.sessionImportError ?? undefined);
  assignDefined(props, 'sessionImportVisible', input.sessionImportVisible);
  assignDefined(props, 'onRefreshSessionImport', input.onRefreshSessionImport);

  if (settingsRoute.hasSettingsService) {
    props.onRetrySettingsLoad = settingsRoute.handleRetrySettingsLoad;
    props.onDismissSettingsError = settingsRoute.handleDismissSettingsError;
  }

  return props;
}
