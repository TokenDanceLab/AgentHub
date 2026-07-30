/* ═══════════════════════════════════════════════════════════════════════
   Project create/update editor state for ProjectsPage residual thin #595.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { projectSubmitErrorMessage } from './shared';
import type { ProjectDraft, ProjectInfo } from './types';

export function useProjectEditor({
  activeProject,
  onNewProject,
  onProjectCreate,
  onProjectUpdate,
  onProjectSelect,
}: {
  activeProject: ProjectInfo | null;
  onNewProject?: (() => void) | undefined;
  onProjectCreate?:
    | ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void)
    | undefined;
  onProjectUpdate?:
    | ((
        projectId: string,
        draft: ProjectDraft,
      ) => Promise<ProjectInfo | void> | ProjectInfo | void)
    | undefined;
  onProjectSelect: (projectId: string) => void;
}): {
  editorMode: 'create' | 'update' | null;
  draft: ProjectDraft;
  localActionError: string | undefined;
  canCreateProject: boolean;
  canUpdateProject: boolean;
  startProjectCreate: () => void;
  startProjectUpdate: (project: ProjectInfo) => void;
  cancelProjectEdit: () => void;
  updateProjectDraft: (nextDraft: ProjectDraft) => void;
  submitProjectEdit: () => Promise<void>;
} {
  const [editorMode, setEditorMode] = useState<'create' | 'update' | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>({ name: '', description: '' });
  const [localActionError, setLocalActionError] = useState<string | undefined>();
  const canCreateProject = Boolean(onProjectCreate);
  const canUpdateProject = Boolean(onProjectUpdate);

  useEffect(() => {
    if (editorMode !== 'update' || !activeProject) return;
    setDraft({
      name: activeProject.name,
      description: activeProject.description,
      ...(activeProject.themeColor
        ? { themeColor: activeProject.themeColor }
        : {}),
    });
  }, [activeProject, editorMode]);

  function startProjectCreate(): void {
    if (!onProjectCreate) return;
    onNewProject?.();
    setDraft({ name: '', description: '' });
    setLocalActionError(undefined);
    setEditorMode('create');
  }

  function startProjectUpdate(project: ProjectInfo): void {
    if (!onProjectUpdate) return;
    setDraft({
      name: project.name,
      description: project.description,
      ...(project.themeColor ? { themeColor: project.themeColor } : {}),
    });
    setLocalActionError(undefined);
    setEditorMode('update');
  }

  function cancelProjectEdit(): void {
    setLocalActionError(undefined);
    setEditorMode(null);
  }

  function updateProjectDraft(nextDraft: ProjectDraft): void {
    setDraft(nextDraft);
    setLocalActionError(undefined);
  }

  async function submitProjectEdit(): Promise<void> {
    const nextDraft: ProjectDraft = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      ...(draft.themeColor ? { themeColor: draft.themeColor } : {}),
    };
    if (!nextDraft.name) return;

    setLocalActionError(undefined);

    try {
      if (editorMode === 'create') {
        if (!onProjectCreate) return;
        const created = await onProjectCreate(nextDraft);
        if (created?.id) onProjectSelect(created.id);
        setEditorMode(null);
        return;
      }

      if (editorMode === 'update' && activeProject) {
        if (!onProjectUpdate) return;
        const updated = await onProjectUpdate(activeProject.id, nextDraft);
        if (updated?.id) onProjectSelect(updated.id);
        setEditorMode(null);
      }
    } catch (error) {
      setLocalActionError(projectSubmitErrorMessage(error));
    }
  }

  return {
    editorMode,
    draft,
    localActionError,
    canCreateProject,
    canUpdateProject,
    startProjectCreate,
    startProjectUpdate,
    cancelProjectEdit,
    updateProjectDraft,
    submitProjectEdit,
  };
}
