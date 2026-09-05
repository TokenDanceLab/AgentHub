import { useCallback, useEffect, useState } from 'react';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectInfo,
  ProjectTab,
} from './pages';
import { WORKBENCH_MOCK_PROJECTS } from './mockData';
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
  effectiveProjectsStatus: WorkbenchProjectsStatus | undefined;
  canMutateProject: boolean;
  projectId: string | null;
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
