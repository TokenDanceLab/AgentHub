import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubClient } from '../hubClient';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectFilter,
  ProjectInfo,
  ProjectTab,
} from './pages';
import { WORKBENCH_MOCK_PROJECTS } from './mockData';
import { workspaceProjectToProjectInfo } from './hubDataMapping';
import type { WorkbenchDocumentPreview } from './documentPreview';
import { createProjectArtifactPreview } from './workbenchProjectPreview';

export interface WorkbenchProjectsStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  saving?: boolean | undefined;
}

export interface UseWorkbenchProjectsRouteOptions {
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: WorkbenchProjectsStatus | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  hubClient?: HubClient | undefined;
  realDataMode: boolean;
}

export interface WorkbenchProjectsRoute {
  sourceProjects: ProjectInfo[];
  effectiveProjectsStatus: WorkbenchProjectsStatus | undefined;
  canMutateProject: boolean;
  projectId: string | null;
  projectFilter: ProjectFilter;
  setProjectFilter: (filter: ProjectFilter) => void;
  projectTab: ProjectTab;
  setProjectTab: (tab: ProjectTab) => void;
  projectPreview: WorkbenchDocumentPreview | null;
  setProjectPreview: (preview: WorkbenchDocumentPreview | null) => void;
  selectProject: (nextProjectId: string) => void;
  handleProjectCreate: (draft: ProjectDraft) => Promise<ProjectInfo | void>;
  handleProjectUpdate: (projectId: string, draft: ProjectDraft) => Promise<ProjectInfo | void>;
  openArtifactPreview: (projectId: string, artifact: ProjectArtifact) => void;
  /** Triggered when the user scrolls near the bottom of the project list. */
  loadMore: (() => void) | undefined;
  /** Whether more pages of projects are available. */
  hasMore: boolean;
  /** Whether a load-more page fetch is in flight. */
  loadingMore: boolean;
}

export function useWorkbenchProjectsRoute({
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  realDataMode,
}: UseWorkbenchProjectsRouteOptions): WorkbenchProjectsRoute {
  // ── Internal Hub project state (used when hubClient is provided and parent doesn't manage projects) ──
  const [hubProjects, setHubProjects] = useState<ProjectInfo[]>([]);
  const [hubProjectsStatus, setHubProjectsStatus] = useState<WorkbenchProjectsStatus>({});
  const hubProjectsEnabled = Boolean(hubClient) && !projects;

  // ── Pagination state (consumes pageCursor returned by the API) ──
  const [pageCursor, setPageCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Refs keep loadMore stable while avoiding stale-closure issues.
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const pageCursorRef = useRef<string | undefined>(undefined);

  const loadHubProjects = useCallback(async () => {
    if (!hubClient) return;
    setHubProjectsStatus((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const response = await hubClient.listWorkspaceProjects({ pageSize: 50 });
      setHubProjects((response.items ?? []).map(workspaceProjectToProjectInfo));
      const nextCursor = response.page?.nextCursor;
      const more = response.page?.hasMore ?? false;
      setPageCursor(nextCursor);
      pageCursorRef.current = nextCursor;
      setHasMore(more);
      hasMoreRef.current = more;
      setHubProjectsStatus((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load projects';
      setHubProjectsStatus((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [hubClient]);

  // ── Infinite-scroll load-more (consumes pageCursor from the API) ──
  const loadMore = useCallback(async () => {
    if (!hubClient || !hasMoreRef.current || loadingMoreRef.current) return;
    const cursor = pageCursorRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const response = await hubClient.listWorkspaceProjects({ pageSize: 50, pageCursor: cursor });
      setHubProjects((prev) => [
        ...prev,
        ...(response.items ?? []).map(workspaceProjectToProjectInfo),
      ]);
      const nextCursor = response.page?.nextCursor;
      const more = response.page?.hasMore ?? false;
      pageCursorRef.current = nextCursor;
      setPageCursor(nextCursor);
      hasMoreRef.current = more;
      setHasMore(more);
    } catch {
      // Silently ignore load-more errors; the sentinel retries on next scroll.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hubClient]);

  useEffect(() => {
    if (!hubProjectsEnabled) return;
    loadHubProjects();
  }, [hubProjectsEnabled, loadHubProjects]);

  const handleProjectCreate = useCallback(async (draft: ProjectDraft): Promise<ProjectInfo | void> => {
    if (onProjectCreate) return onProjectCreate(draft);
    if (!hubClient) return;
    setHubProjectsStatus((prev) => ({ ...prev, saving: true, actionError: undefined }));
    try {
      const created = await hubClient.createWorkspaceProject({
        name: draft.name.trim() || 'Untitled Project',
        description: draft.description.trim(),
      });
      const info = workspaceProjectToProjectInfo(created);
      await loadHubProjects();
      setHubProjectsStatus((prev) => ({ ...prev, saving: false }));
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project';
      setHubProjectsStatus((prev) => ({ ...prev, saving: false, actionError: message }));
      throw err;
    }
  }, [onProjectCreate, hubClient, loadHubProjects]);

  const handleProjectUpdate = useCallback(async (
    projectId: string,
    draft: ProjectDraft,
  ): Promise<ProjectInfo | void> => {
    if (onProjectUpdate) return onProjectUpdate(projectId, draft);
    if (!hubClient) return;
    setHubProjectsStatus((prev) => ({ ...prev, saving: true, actionError: undefined }));
    try {
      const updated = await hubClient.updateWorkspaceProject(projectId, {
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      });
      const info = workspaceProjectToProjectInfo(updated);
      await loadHubProjects();
      setHubProjectsStatus((prev) => ({ ...prev, saving: false }));
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project';
      setHubProjectsStatus((prev) => ({ ...prev, saving: false, actionError: message }));
      throw err;
    }
  }, [onProjectUpdate, hubClient, loadHubProjects]);

  const sourceProjects = projects
    ?? (hubProjectsEnabled ? hubProjects : (realDataMode ? [] : WORKBENCH_MOCK_PROJECTS));
  const effectiveProjectsStatus = projectsStatus
    ?? (hubProjectsEnabled ? hubProjectsStatus : undefined);
  const canMutateProject = Boolean(onProjectCreate ?? onProjectUpdate ?? hubClient);
  const [localProjectId, setLocalProjectId] = useState(sourceProjects[0]?.id ?? null);
  const controlledProjectId = activeProjectId && sourceProjects.some((project) => project.id === activeProjectId)
    ? activeProjectId
    : null;
  const projectId = controlledProjectId ?? localProjectId;
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [projectTab, setProjectTab] = useState<ProjectTab>('overview');
  const [projectPreview, setProjectPreview] = useState<WorkbenchDocumentPreview | null>(null);

  useEffect(() => {
    if (sourceProjects.length === 0) {
      setLocalProjectId(null);
      return;
    }
    if (!projectId || !sourceProjects.some((project) => project.id === projectId)) {
      setLocalProjectId(sourceProjects[0]?.id ?? null);
    }
  }, [projectId, sourceProjects]);

  function selectProject(nextProjectId: string): void {
    setLocalProjectId(nextProjectId);
    onActiveProjectChange?.(nextProjectId);
  }

  function openArtifactPreview(nextProjectId: string, artifact: ProjectArtifact): void {
    selectProject(nextProjectId);
    setProjectPreview(createProjectArtifactPreview(nextProjectId, artifact));
  }

  return {
    sourceProjects,
    effectiveProjectsStatus,
    canMutateProject,
    projectId,
    projectFilter,
    setProjectFilter,
    projectTab,
    setProjectTab,
    projectPreview,
    setProjectPreview,
    selectProject,
    handleProjectCreate,
    handleProjectUpdate,
    openArtifactPreview,
    loadMore: hubProjectsEnabled ? loadMore : undefined,
    hasMore,
    loadingMore,
  };
}
