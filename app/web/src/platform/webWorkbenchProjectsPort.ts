import type {
  WorkbenchProjectsPage,
  WorkbenchProjectsPort,
} from '@agenthub/workbench';
import { workspaceProjectToProjectInfo } from '@agenthub/workbench/hubDataMapping';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { projectDraftToHubRequest } from './webWorkbenchProjects';

/**
 * Web composition-root implementation of the shared Workbench projects port
 * (#1546). Wraps the HubClient transport; the shared UI only ever sees the
 * narrow `WorkbenchProjectsPort` contract.
 */
export function createWebWorkbenchProjectsPort(): WorkbenchProjectsPort {
  const hubClient = createHubClient({ getToken: getAccessToken });

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
      const created = await hubClient.createWorkspaceProject(projectDraftToHubRequest(draft));
      return workspaceProjectToProjectInfo(created);
    },
    async updateProject(projectId, draft) {
      const updated = await hubClient.updateWorkspaceProject(projectId, projectDraftToHubRequest(draft));
      return workspaceProjectToProjectInfo(updated);
    },
  };
}
