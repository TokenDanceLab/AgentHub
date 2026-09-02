import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchContactsRoute } from './useWorkbenchContactsRoute';
import type { WorkbenchDocsRoute } from './useWorkbenchDocsRoute';
import type { WorkbenchProjectsRoute } from './useWorkbenchProjectsRoute';
import type { WorkbenchSettingsRoute } from './useWorkbenchSettingsRoute';
import {
  assignDefined,
  buildContactsPageProps,
  buildDocsPageProps,
  buildProjectsPageProps,
  buildSettingsPageProps,
} from './workbenchRoutesHelpers';

describe('assignDefined', () => {
  it('assigns only when value is defined', () => {
    const target: { a?: string; b?: number } = {};
    assignDefined(target, 'a', 'ok');
    assignDefined(target, 'b', undefined);
    expect(target).toEqual({ a: 'ok' });
    expect(Object.prototype.hasOwnProperty.call(target, 'b')).toBe(false);
  });
});

describe('buildContactsPageProps', () => {
  it('maps route data with defaults and optional actions', () => {
    const onSearchUser = vi.fn();
    const onMemberClick = vi.fn();
    const route = {
      contactsPane: 'internal',
      setContactsPane: vi.fn(),
      contactsData: {
        members: [{ id: 'm1', name: 'Alice', initials: 'A', org: 'TD', status: 'online' }],
      },
      handleMemberClick: onMemberClick,
      contactsActions: {
        onSearchUser,
      },
    } as unknown as WorkbenchContactsRoute;

    const props = buildContactsPageProps(route);

    expect(props.activePane).toBe('internal');
    expect(props.orgName).toBe('TokenDance');
    expect(props.orgInitials).toBe('TD');
    expect(props.externalContacts).toEqual([]);
    expect(props.groups).toEqual([]);
    expect(props.onMemberClick).toBe(onMemberClick);
    expect(props.onSearchUser).toBe(onSearchUser);
    expect(Object.prototype.hasOwnProperty.call(props, 'onAcceptRequest')).toBe(false);
  });

  it('preserves provided org fields and contact collections', () => {
    const route = {
      contactsPane: 'groups',
      setContactsPane: vi.fn(),
      contactsData: {
        members: [],
        orgName: 'Acme',
        orgInitials: 'AC',
        groups: [{ id: 'g1', name: 'Core', initials: 'C', count: '2', latestMessage: 'hi' }],
        starredContacts: [{ id: 's1', name: 'Bob', initials: 'B', org: 'AC', status: 'away' }],
      },
      handleMemberClick: undefined,
      contactsActions: undefined,
    } as unknown as WorkbenchContactsRoute;

    const props = buildContactsPageProps(route);
    expect(props.orgName).toBe('Acme');
    expect(props.orgInitials).toBe('AC');
    expect(props.groups).toHaveLength(1);
    expect(props.starredContacts).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(props, 'onMemberClick')).toBe(false);
  });

  it('wires infinite-scroll pagination from the route (#1510)', () => {
    const onLoadMore = vi.fn();
    const route = {
      contactsPane: 'internal',
      setContactsPane: vi.fn(),
      contactsData: { members: [] },
      handleMemberClick: undefined,
      contactsActions: undefined,
      hasMore: true,
      loadingMore: false,
      onLoadMore,
    } as unknown as WorkbenchContactsRoute;

    const props = buildContactsPageProps(route);
    expect(props.hasMore).toBe(true);
    expect(props.loadingMore).toBe(false);
    expect(props.onLoadMore).toBe(onLoadMore);

    // Inert pagination (parent-owned data) stays unassigned.
    const inertRoute = {
      contactsPane: 'internal',
      setContactsPane: vi.fn(),
      contactsData: { members: [] },
      handleMemberClick: undefined,
      contactsActions: undefined,
      hasMore: false,
      loadingMore: false,
      onLoadMore: undefined,
    } as unknown as WorkbenchContactsRoute;
    const inertProps = buildContactsPageProps(inertRoute);
    expect(inertProps.hasMore).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inertProps, 'onLoadMore')).toBe(false);
  });
});

describe('buildDocsPageProps', () => {
  it('wires docs route + profiles and optional document actions', () => {
    const onCreateDoc = vi.fn();
    const openDocPreview = vi.fn();
    const closeDocPreview = vi.fn();
    const route = {
      docsNav: 'home',
      setDocsNav: vi.fn(),
      docsTab: 'recent',
      setDocsTab: vi.fn(),
      docsPreview: null,
      rows: [{ id: 'd1', title: 'Spec', location: '/', owner: 'A', time: 'now' }],
      shortcuts: ['Spec shortcut'],
      openDocPreview,
      closeDocPreview,
      documentsActions: { onCreateDoc },
    } as unknown as WorkbenchDocsRoute;

    const profiles = [{ kind: 'user' as const, name: 'Alice' }];
    const props = buildDocsPageProps(route, profiles);

    expect(props.activeNav).toBe('home');
    expect(props.navItems).toEqual([]);
    expect(props.profiles).toBe(profiles);
    expect(props.rows).toHaveLength(1);
    // #2154 P2-2(b): shortcuts come from the route (demo-only), never from a
    // page-level default injection.
    expect(props.shortcuts).toEqual(['Spec shortcut']);
    expect(props.onDocClick).toBe(openDocPreview);
    expect(props.onClosePreview).toBe(closeDocPreview);
    expect(props.onCreateDoc).toBe(onCreateDoc);
    expect(Object.prototype.hasOwnProperty.call(props, 'onDeleteDoc')).toBe(false);
  });
});

describe('buildProjectsPageProps', () => {
  it('omits mutate handlers when canMutateProject is false', () => {
    const route = {
      sourceProjects: [],
      effectiveProjectsStatus: { loading: true, error: 'boom' },
      canMutateProject: false,
      projectId: null,
      projectFilter: 'all',
      setProjectFilter: vi.fn(),
      projectTab: 'overview',
      setProjectTab: vi.fn(),
      projectPreview: null,
      setProjectPreview: vi.fn(),
      selectProject: vi.fn(),
      handleProjectCreate: vi.fn(),
      handleProjectUpdate: vi.fn(),
      openArtifactPreview: vi.fn(),
      loadMore: undefined,
      hasMore: false,
      loadingMore: false,
    } as unknown as WorkbenchProjectsRoute;

    const props = buildProjectsPageProps(route, []);
    expect(props.projectsLoading).toBe(true);
    expect(props.projectsError).toBe('boom');
    expect(Object.prototype.hasOwnProperty.call(props, 'onProjectCreate')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props, 'onProjectUpdate')).toBe(false);
    // hasMore/loadingMore are always present (default false from the route hook).
    expect(props.hasMore).toBe(false);
    expect(props.loadingMore).toBe(false);
    // loadMore is undefined when hubClient is not active, so onLoadMore is not assigned.
    expect(Object.prototype.hasOwnProperty.call(props, 'onLoadMore')).toBe(false);
  });

  it('renders the status-filtered list instead of the raw source list (#2154 P2-3)', () => {
    const source = [{ id: 'p1', status: 'Active' }, { id: 'p2', status: '已归档' }];
    const route = {
      sourceProjects: source,
      visibleProjects: [source[1]],
      effectiveProjectsStatus: undefined,
      canMutateProject: false,
      projectId: 'p2',
      projectFilter: 'archived',
      setProjectFilter: vi.fn(),
      projectTab: 'overview',
      setProjectTab: vi.fn(),
      projectPreview: null,
      setProjectPreview: vi.fn(),
      selectProject: vi.fn(),
      handleProjectCreate: vi.fn(),
      handleProjectUpdate: vi.fn(),
      openArtifactPreview: vi.fn(),
      loadMore: undefined,
      hasMore: false,
      loadingMore: false,
    } as unknown as WorkbenchProjectsRoute;

    const props = buildProjectsPageProps(route, []);
    expect(props.activeFilter).toBe('archived');
    expect(props.projects).toEqual([source[1]]);
  });

  it('forwards the available filters so unsatisfiable chips render disabled (#2154 P2-3)', () => {
    const route = {
      sourceProjects: [{ id: 'p1', status: 'Active' }],
      visibleProjects: [{ id: 'p1', status: 'Active' }],
      availableProjectFilters: ['all', 'running'],
      effectiveProjectsStatus: undefined,
      canMutateProject: false,
      projectId: 'p1',
      projectFilter: 'all',
      setProjectFilter: vi.fn(),
      projectTab: 'overview',
      setProjectTab: vi.fn(),
      projectPreview: null,
      setProjectPreview: vi.fn(),
      selectProject: vi.fn(),
      handleProjectCreate: vi.fn(),
      handleProjectUpdate: vi.fn(),
      openArtifactPreview: vi.fn(),
      loadMore: undefined,
      hasMore: false,
      loadingMore: false,
    } as unknown as WorkbenchProjectsRoute;

    const props = buildProjectsPageProps(route, []);
    expect(props.availableFilters).toEqual(['all', 'running']);
  });

  it('omits availableFilters for partial route fixtures that predate it', () => {
    const route = {
      sourceProjects: [{ id: 'p1' }],
      effectiveProjectsStatus: undefined,
      canMutateProject: false,
      projectId: 'p1',
      projectFilter: 'all',
      setProjectFilter: vi.fn(),
      projectTab: 'overview',
      setProjectTab: vi.fn(),
      projectPreview: null,
      setProjectPreview: vi.fn(),
      selectProject: vi.fn(),
      handleProjectCreate: vi.fn(),
      handleProjectUpdate: vi.fn(),
      openArtifactPreview: vi.fn(),
      loadMore: undefined,
      hasMore: false,
      loadingMore: false,
    } as unknown as WorkbenchProjectsRoute;

    const props = buildProjectsPageProps(route, []);
    expect(Object.prototype.hasOwnProperty.call(props, 'availableFilters')).toBe(false);
  });

  it('includes mutate handlers and clears preview via onClosePreview', () => {
    const setProjectPreview = vi.fn();
    const handleProjectCreate = vi.fn();
    const handleProjectUpdate = vi.fn();
    const loadMore = vi.fn();
    const route = {
      sourceProjects: [{ id: 'p1' }],
      effectiveProjectsStatus: { saving: true, actionError: 'nope' },
      canMutateProject: true,
      projectId: 'p1',
      projectFilter: 'running',
      setProjectFilter: vi.fn(),
      projectTab: 'runs',
      setProjectTab: vi.fn(),
      projectPreview: { id: 'prev' },
      setProjectPreview,
      selectProject: vi.fn(),
      handleProjectCreate,
      handleProjectUpdate,
      openArtifactPreview: vi.fn(),
      loadMore,
      hasMore: true,
      loadingMore: false,
    } as unknown as WorkbenchProjectsRoute;

    const props = buildProjectsPageProps(route, [{ kind: 'agent', name: 'Bot' }]);
    expect(props.onProjectCreate).toBe(handleProjectCreate);
    expect(props.onProjectUpdate).toBe(handleProjectUpdate);
    expect(props.projectSaving).toBe(true);
    expect(props.projectActionError).toBe('nope');
    expect(props.hasMore).toBe(true);
    expect(props.onLoadMore).toBe(loadMore);
    props.onClosePreview?.();
    expect(setProjectPreview).toHaveBeenCalledWith(null);
  });
});

describe('buildSettingsPageProps', () => {
  it('spreads settings values and gates service retry handlers', () => {
    const onOpenAgentConfig = vi.fn();
    const handleRetry = vi.fn();
    const handleDismiss = vi.fn();
    const settingsRoute = {
      realDataMode: false,
      settingsPane: 'appearance',
      setSettingsPane: vi.fn(),
      settings: {
        theme: 'dark',
        density: 'compact',
        runStepDefault: 'collapsed',
        animationIntensity: 'medium',
        inspectorVisible: true,
        stackedAvatars: false,
        taskCompleteNotify: true,
        approvalNotifyLevel: 'all',
        failureNotify: true,
        projectGroupNotifyLevel: 'mentions',
        docUpdateNotifyLevel: 'off',
        dndWindow: '22:00-08:00',
        defaultModel: 'gpt',
        defaultExecutor: 'codex',
        toolCallDisplay: 'full',
        deepThinkingDisplay: 'summary',
        permissions: {},
        vitePreviewUrl: 'http://localhost:5173',
        dataMode: 'demo',
        composerSubmitBehavior: 'enter',
        workspacePath: '/ws',
        targetProjectPath: '/proj',
        hrmOverlayEnabled: false,
        visualQaMode: 'off',
        logLevel: 'info',
        designSystemValidation: 'warn',
        stateStrategies: { empty: true, invalid: true, missing: true },
      },
      settingsLoading: false,
      settingsError: null,
      settingsErrorKind: null,
      handleSettingChange: vi.fn(),
      handleRetrySettingsLoad: handleRetry,
      handleDismissSettingsError: handleDismiss,
      hasSettingsService: false,
    } as unknown as WorkbenchSettingsRoute;

    const props = buildSettingsPageProps({
      settingsRoute,
      onOpenAgentConfig,
      userDisplayName: 'Ding',
    });

    expect(props.theme).toBe('dark');
    expect(props.spaceTitle).toBe('AgentHub Desktop');
    expect(props.spaceMeta).toBe('桌面设计 demo');
    expect(props.currentUserDisplayName).toBe('Ding');
    expect(props.onOpenAgentConfig).toBe(onOpenAgentConfig);
    expect(Object.prototype.hasOwnProperty.call(props, 'onRetrySettingsLoad')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(props, 'onDismissSettingsError')).toBe(false);
  });

  it('exposes retry handlers when settings service is present', () => {
    const handleRetry = vi.fn();
    const handleDismiss = vi.fn();
    const settingsRoute = {
      settingsPane: 'local',
      setSettingsPane: vi.fn(),
      settings: {
        theme: 'light',
        density: 'comfortable',
        runStepDefault: 'expanded',
        animationIntensity: 'low',
        inspectorVisible: false,
        stackedAvatars: true,
        taskCompleteNotify: false,
        approvalNotifyLevel: 'off',
        failureNotify: false,
        projectGroupNotifyLevel: 'off',
        docUpdateNotifyLevel: 'all',
        dndWindow: 'none',
        defaultModel: 'claude',
        defaultExecutor: 'claude',
        toolCallDisplay: 'compact',
        deepThinkingDisplay: 'hidden',
        permissions: { Shell: 'ask' },
        vitePreviewUrl: '',
        dataMode: 'real',
        composerSubmitBehavior: 'mod-enter',
        workspacePath: '',
        targetProjectPath: '',
        hrmOverlayEnabled: true,
        visualQaMode: 'on',
        logLevel: 'debug',
        designSystemValidation: 'error',
        stateStrategies: { empty: false, invalid: false, missing: false },
      },
      settingsLoading: true,
      settingsError: 'fail',
      settingsErrorKind: 'init',
      handleSettingChange: vi.fn(),
      handleRetrySettingsLoad: handleRetry,
      handleDismissSettingsError: handleDismiss,
      hasSettingsService: true,
    } as unknown as WorkbenchSettingsRoute;

    const props = buildSettingsPageProps({
      settingsRoute,
      onOpenAgentConfig: vi.fn(),
      spaceTitle: 'Custom',
      spaceMeta: 'meta',
    });

    expect(props.onRetrySettingsLoad).toBe(handleRetry);
    expect(props.onDismissSettingsError).toBe(handleDismiss);
    expect(props.spaceTitle).toBe('Custom');
    expect(props.spaceMeta).toBe('meta');
    expect(props.settingsLoading).toBe(true);
    expect(props.settingsError).toBe('fail');
    expect(props.settingsErrorKind).toBe('init');
  });
});
