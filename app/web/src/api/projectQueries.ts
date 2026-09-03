import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient } from './hubClient';
import type {
  CreateWorkspaceProjectThreadRequest,
  CreateWorkspaceProjectRequest,
  SendWorkspaceProjectThreadMessageRequest,
  UpdateWorkspaceProjectRequest,
  WorkspaceProject,
  WorkspaceProjectListResponse,
  WorkspaceProjectThread,
  WorkspaceProjectThreadMessage,
} from './hubClient';

export const workspaceProjectsQueryKey = hubQueryKeys.projects.root;
// Deliberately no local threads-key alias next to the projects key above: the
// one that used to sit here had 0 consumers and pointed at
// `hubQueryKeys.projects.root` — the *projects* root — so any invalidation
// written against it would have refetched the project list and never the
// threads it claimed to address (#2274 A-15). Threads are keyed by the shared
// factory; do not reintroduce a literal alias for them.

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

export async function fetchWorkspaceProjectThreads(
  projectId: string | undefined,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProjectThread[]> {
  const token = getToken();
  if (!projectId || !token) return [];

  const client = createHubClient({ getToken: () => token });
  return client.listWorkspaceProjectThreads(projectId);
}

export async function createWorkspaceProjectThread(
  projectId: string,
  draft: CreateWorkspaceProjectThreadRequest,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProjectThread> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  return client.createWorkspaceProjectThread(projectId, draft);
}

export async function fetchWorkspaceProjectThreadMessages(
  projectId: string | undefined,
  threadId: string | undefined,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProjectThreadMessage[]> {
  const token = getToken();
  if (!projectId || !threadId || !token) return [];

  const client = createHubClient({ getToken: () => token });
  return client.listWorkspaceProjectThreadMessages(projectId, threadId, { limit: 80 });
}

export async function sendWorkspaceProjectThreadMessage(
  projectId: string,
  threadId: string,
  draft: SendWorkspaceProjectThreadMessageRequest,
  getToken: () => string | null = getAccessToken,
): Promise<WorkspaceProjectThreadMessage> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  return client.sendWorkspaceProjectThreadMessage(projectId, threadId, draft);
}

export function useHubWorkspaceProjects(options: {
  enabled: boolean;
  getToken?: () => string | null;
}) {
  return useQuery<WorkspaceProjectListResponse>({
    queryKey: hubQueryKeys.projects.list(options.enabled ? 'hub' : 'signed-out'),
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
    queryKey: hubQueryKeys.projects.detail(options.projectId ?? ''),
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
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.root });
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.detail(variables.projectId) });
    },
  });
}

export function useHubWorkspaceProjectThreads(options: {
  projectId?: string | undefined;
  enabled: boolean;
  getToken?: () => string | null;
}) {
  return useQuery<WorkspaceProjectThread[]>({
    queryKey: [...hubQueryKeys.projects.threads(options.projectId ?? 'none')],
    queryFn: () => fetchWorkspaceProjectThreads(options.projectId, options.getToken ?? getAccessToken),
    enabled: options.enabled && Boolean(options.projectId),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useHubWorkspaceProjectThreadMessages(options: {
  projectId?: string | undefined;
  threadId?: string | undefined;
  enabled: boolean;
  getToken?: () => string | null;
}) {
  return useQuery<WorkspaceProjectThreadMessage[]>({
    queryKey: [
      ...hubQueryKeys.projects.threadMessages(options.projectId ?? 'none', options.threadId ?? 'none'),
    ],
    queryFn: () => fetchWorkspaceProjectThreadMessages(
      options.projectId,
      options.threadId,
      options.getToken ?? getAccessToken,
    ),
    enabled: options.enabled && Boolean(options.projectId) && Boolean(options.threadId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateHubWorkspaceProjectThread(options: { getToken?: () => string | null } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, draft }: { projectId: string; draft: CreateWorkspaceProjectThreadRequest }) =>
      createWorkspaceProjectThread(projectId, draft, options.getToken ?? getAccessToken),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.threads(variables.projectId) });
    },
  });
}

export function useSendHubWorkspaceProjectThreadMessage(options: { getToken?: () => string | null } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      { projectId, threadId, draft }: {
        projectId: string;
        threadId: string;
        draft: SendWorkspaceProjectThreadMessageRequest;
      },
    ) => sendWorkspaceProjectThreadMessage(projectId, threadId, draft, options.getToken ?? getAccessToken),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: hubQueryKeys.projects.threadMessages(variables.projectId, variables.threadId),
      });
    },
  });
}
