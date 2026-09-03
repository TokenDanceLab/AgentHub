import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectFilter,
  ProjectInfo,
  ProjectTab,
} from './pages';
import { WORKBENCH_MOCK_PROJECTS } from './mockData';
import { filterProjectsByStatus, resolveAvailableProjectFilters } from './pages/projects/shared';
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
  realDataMode: boolean;
}

export interface WorkbenchProjectsRoute {
  sourceProjects: ProjectInfo[];
  /**
   * `sourceProjects` after the nav status filter (#2154 P2-3) — this is what
   * the projects page renders. Selection keeps reading `sourceProjects` so
   * filtering the list cannot drop the active project.
   */
  visibleProjects: ProjectInfo[];
  /**
   * Filter chips the loaded projects can actually satisfy (#2154 P2-3). Always
   * contains 'all'; a lifecycle bucket appears only when at least one loaded
   * project classifies into it, so the nav never offers a click whose only
   * possible outcome is an empty list.
   */
  availableProjectFilters: ProjectFilter[];
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
}

export function useWorkbenchProjectsRoute({
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  realDataMode,
}: UseWorkbenchProjectsRouteOptions): WorkbenchProjectsRoute {
  const handleProjectCreate = useCallback(async (draft: ProjectDraft): Promise<ProjectInfo | void> => {
    if (onProjectCreate) return onProjectCreate(draft);
  }, [onProjectCreate]);

  const handleProjectUpdate = useCallback(async (
    projectId: string,
    draft: ProjectDraft,
  ): Promise<ProjectInfo | void> => {
    if (onProjectUpdate) return onProjectUpdate(projectId, draft);
  }, [onProjectUpdate]);

  const sourceProjects = projects ?? (realDataMode ? [] : WORKBENCH_MOCK_PROJECTS);
  const effectiveProjectsStatus = projectsStatus;
  const canMutateProject = Boolean(onProjectCreate ?? onProjectUpdate);
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
  const availableProjectFilters = useMemo(
    () => resolveAvailableProjectFilters(sourceProjects),
    [sourceProjects],
  );

  // The selected bucket can disappear when the data refreshes (page reload, the
  // last archived project deleted). Fall back to `all` instead of parking the
  // user on a list that is empty by construction (#2154 P2-3).
  useEffect(() => {
    if (projectFilter !== 'all' && !availableProjectFilters.includes(projectFilter)) {
      setProjectFilter('all');
    }
  }, [availableProjectFilters, projectFilter]);
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
    availableProjectFilters,
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
  };
}
