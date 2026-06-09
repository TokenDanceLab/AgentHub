import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/hooks/useAuth';
import { createHubClient } from './hubClient';
import type {
  CreateWorkspaceProjectRequest,
  UpdateWorkspaceProjectRequest,
  WorkspaceProject,
  WorkspaceProjectListResponse,
} from './hubClient';

export const workspaceProjectsQueryKey = ['web-v4', 'hub-projects'] as const;

const emptyWorkspaceProjects: WorkspaceProjectListResponse = {
  items: [],
  page: { hasMore: false },
};

export async function fetchWorkspaceProjects(
  preferHub: boolean,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProjectListResponse> {
  const token = getToken();
  if (!preferHub || !token) return emptyWorkspaceProjects;

  const client = createHubClient({ getToken: () => token });
  return client.listWorkspaceProjects({ pageSize: 50 });
}

export async function fetchWorkspaceProject(
  projectId: string | undefined,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProject | undefined> {
  const token = getToken();
  if (!projectId || !token) return undefined;

  const client = createHubClient({ getToken: () => token });
  return client.getWorkspaceProject(projectId);
}

export async function createWorkspaceProject(
  draft: CreateWorkspaceProjectRequest,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProject> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  return client.createWorkspaceProject(draft);
}

export async function updateWorkspaceProject(
  projectId: string,
  draft: UpdateWorkspaceProjectRequest,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProject> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  return client.updateWorkspaceProject(projectId, draft);
}

export function useHubWorkspaceProjects(options: {
  enabled: boolean;
  getToken?: () => string | null;
}) {
  return useQuery<WorkspaceProjectListResponse>({
    queryKey: [...workspaceProjectsQueryKey, options.enabled ? 'hub' : 'signed-out'],
    queryFn: () => fetchWorkspaceProjects(options.enabled, options.getToken ?? getAccessToken),
    enabled: options.enabled,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useHubWorkspaceProject(options: {
  projectId?: string | undefined;
  enabled: boolean;
  getToken?: () => string | null;
}) {
  return useQuery<WorkspaceProject | undefined>({
    queryKey: ['web-v4', 'hub-project', options.projectId],
    queryFn: () => fetchWorkspaceProject(options.projectId, options.getToken ?? getAccessToken),
    enabled: options.enabled && Boolean(options.projectId),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateHubWorkspaceProject(options: { getToken?: () => string | null } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (draft: CreateWorkspaceProjectRequest) =>
      createWorkspaceProject(draft, options.getToken ?? getAccessToken),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceProjectsQueryKey });
    },
  });
}

export function useUpdateHubWorkspaceProject(options: { getToken?: () => string | null } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, draft }: { projectId: string; draft: UpdateWorkspaceProjectRequest }) =>
      updateWorkspaceProject(projectId, draft, options.getToken ?? getAccessToken),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: workspaceProjectsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-project', variables.projectId] });
    },
  });
}
