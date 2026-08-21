import type {
  WorkbenchProjectsPage,
  WorkbenchProjectsPort,
} from '@agenthub/workbench';
import { workspaceProjectToProjectInfo } from '@agenthub/workbench/hubDataMapping';
import { getHubClient } from '@/api/hubQueries';

/**
 * Desktop composition-root implementation of the shared Workbench projects
 * port (#1546). Wraps the HubClient transport; the shared UI only ever sees
 * the narrow `WorkbenchProjectsPort` contract.
 */
export function createDesktopWorkbenchProjectsPort(): WorkbenchProjectsPort {
  const hubClient = getHubClient();

  return {
    async listProjects(params): Promise<WorkbenchProjectsPage> {
      const response = await hubClient.listWorkspaceProjects(params);
      return {
        items: (response.items ?? []).map(workspaceProjectToProjectInfo),
        nextCursor: response.page?.nextCursor,
        hasMore: response.page?.hasMore ?? false,
      };
    },
    async createProject(draft) {
      const created = await hubClient.createWorkspaceProject({
        name: draft.name.trim() || '未命名项目',
        description: draft.description.trim(),
      });
      return workspaceProjectToProjectInfo(created);
    },
    async updateProject(projectId, draft) {
      const updated = await hubClient.updateWorkspaceProject(projectId, {
        name: draft.name.trim() || '未命名项目',
        description: draft.description.trim(),
      });
      return workspaceProjectToProjectInfo(updated);
    },
  };
}
