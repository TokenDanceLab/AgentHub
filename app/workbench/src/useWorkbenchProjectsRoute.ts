import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectFilter,
  ProjectInfo,
  ProjectTab,
} from './pages';
import { WORKBENCH_MOCK_PROJECTS } from './mockData';
import { filterProjectsByStatus } from './pages/projects/shared';
import type { WorkbenchDocumentPreview } from './documentPreview';
import { createProjectArtifactPreview } from './workbenchProjectPreview';
import type { WorkbenchProjectsPort } from './workbenchProjectsPort';

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
  /**
   * Narrow domain port for workspace project data (#1546). Used only when the
   * parent does not manage `projects` itself. The shared Workbench never sees
   * a concrete hub transport client; each platform injects its own implementation.
   */
  projectsPort?: WorkbenchProjectsPort | undefined;
  realDataMode: boolean;
}

export interface WorkbenchProjectsRoute {
  sourceProjects: ProjectInfo[];
  /**
   * `sourceProjects` after the nav status filter (#2154 P2-3) — this is what
   * the projects page renders. Selection/pagination keep reading
   * `sourceProjects` so filtering the list cannot drop the active project or
   * re-write the paging cursor.
   */
  visibleProjects: ProjectInfo[];
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
  /**
   * Visible load-more failure (#1546). When set, pagination has stopped
   * (hasMore=false) and calling `loadMore` acts as the explicit retry.
   */
  loadMoreError?: string | undefined;
}

export function useWorkbenchProjectsRoute({
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  projectsPort,
  realDataMode,
}: UseWorkbenchProjectsRouteOptions): WorkbenchProjectsRoute {
  // ── Internal port-driven project state (used when a port is injected and the parent doesn't manage projects) ──
  const [portProjects, setPortProjects] = useState<ProjectInfo[]>([]);
  const [portProjectsStatus, setPortProjectsStatus] = useState<WorkbenchProjectsStatus>({});
  const portProjectsEnabled = Boolean(projectsPort) && !projects;

  // ── Pagination state (consumes the page cursor returned by the port) ──
  const [_pageCursor, setPageCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | undefined>(undefined);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Refs keep loadMore stable while avoiding stale-closure issues.
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const pageCursorRef = useRef<string | undefined>(undefined);
  const loadMoreFailedRef = useRef(false);
  // Drop state updates after unmount so a late response cannot write stale state.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadProjects = useCallback(async () => {
    if (!projectsPort) return;
    setPortProjectsStatus((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const page = await projectsPort.listProjects({ pageSize: 50 });
      if (!mountedRef.current) return;
      setPortProjects(page.items);
      pageCursorRef.current = page.nextCursor;
      setPageCursor(page.nextCursor);
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      loadMoreFailedRef.current = false;
      setLoadMoreFailed(false);
      setLoadMoreError(undefined);
      setPortProjectsStatus((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load projects';
      setPortProjectsStatus((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [projectsPort]);

  // ── Infinite-scroll load-more (consumes the page cursor from the port) ──
  // On failure the error becomes visible (loadMoreError), hasMore flips to
  // false so the scroll sentinel stops, and re-entering loadMore acts as the
  // explicit retry path that clears the failure before fetching again.
  const loadMore = useCallback(async () => {
    if (!projectsPort || loadingMoreRef.current) return;
    if (loadMoreFailedRef.current) {
      loadMoreFailedRef.current = false;
      setLoadMoreFailed(false);
      setLoadMoreError(undefined);
    }
    if (!hasMoreRef.current) return;
    const cursor = pageCursorRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await projectsPort.listProjects({
        pageSize: 50,
        ...(cursor !== undefined ? { pageCursor: cursor } : {}),
      });
      if (!mountedRef.current) return;
      setPortProjects((prev) => [...prev, ...page.items]);
      pageCursorRef.current = page.nextCursor;
      setPageCursor(page.nextCursor);
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load more projects';
      loadMoreFailedRef.current = true;
      setLoadMoreFailed(true);
      setHasMore(false);
      setLoadMoreError(message);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [projectsPort]);

  useEffect(() => {
    if (!portProjectsEnabled) return;
    void loadProjects();
  }, [portProjectsEnabled, loadProjects]);

  const handleProjectCreate = useCallback(async (draft: ProjectDraft): Promise<ProjectInfo | void> => {
    if (onProjectCreate) return onProjectCreate(draft);
    if (!projectsPort) return;
    setPortProjectsStatus((prev) => ({ ...prev, saving: true, actionError: undefined }));
    try {
      const info = await projectsPort.createProject(draft);
      await loadProjects();
      if (!mountedRef.current) return info;
      setPortProjectsStatus((prev) => ({ ...prev, saving: false }));
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project';
      setPortProjectsStatus((prev) => ({ ...prev, saving: false, actionError: message }));
      throw err;
    }
  }, [onProjectCreate, projectsPort, loadProjects]);

  const handleProjectUpdate = useCallback(async (
    projectId: string,
    draft: ProjectDraft,
  ): Promise<ProjectInfo | void> => {
    if (onProjectUpdate) return onProjectUpdate(projectId, draft);
    if (!projectsPort) return;
    setPortProjectsStatus((prev) => ({ ...prev, saving: true, actionError: undefined }));
    try {
      const info = await projectsPort.updateProject(projectId, draft);
      await loadProjects();
      if (!mountedRef.current) return info;
      setPortProjectsStatus((prev) => ({ ...prev, saving: false }));
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project';
      setPortProjectsStatus((prev) => ({ ...prev, saving: false, actionError: message }));
      throw err;
    }
  }, [onProjectUpdate, projectsPort, loadProjects]);

  const sourceProjects = projects
    ?? (portProjectsEnabled ? portProjects : (realDataMode ? [] : WORKBENCH_MOCK_PROJECTS));
  const effectiveProjectsStatus = projectsStatus
    ?? (portProjectsEnabled ? portProjectsStatus : undefined);
  const canMutateProject = Boolean(onProjectCreate ?? onProjectUpdate ?? projectsPort);
  const [localProjectId, setLocalProjectId] = useState(sourceProjects[0]?.id ?? null);
  const controlledProjectId = activeProjectId && sourceProjects.some((project) => project.id === activeProjectId)
    ? activeProjectId
    : null;
  const projectId = controlledProjectId ?? localProjectId;
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  // #2154 P2-3: the filter chips used to only move the highlight. `all` is a
  // pass-through (including projects whose status we cannot classify); the
  // other buckets match on the status label via workbenchProjectFilters.
  const visibleProjects = useMemo(
    () => filterProjectsByStatus(sourceProjects, projectFilter),
    [sourceProjects, projectFilter],
  );
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
    visibleProjects,
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
    loadMore: portProjectsEnabled ? loadMore : undefined,
    hasMore: hasMore && !loadMoreFailed,
    loadingMore,
    ...(loadMoreError !== undefined ? { loadMoreError } : {}),
  };
}
