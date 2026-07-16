import { useCallback, useEffect, useState } from 'react';
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

  const loadHubProjects = useCallback(async () => {
    if (!hubClient) return;
    setHubProjectsStatus((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const response = await hubClient.listWorkspaceProjects({ pageSize: 50 });
      setHubProjects((response.items ?? []).map(workspaceProjectToProjectInfo));
      setHubProjectsStatus((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load projects';
      setHubProjectsStatus((prev) => ({ ...prev, loading: false, error: message }));
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
  };
}
