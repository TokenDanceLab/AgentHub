import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isHubAuthenticated } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { fetchAllPages } from '@shared/hub/paginate';
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

const workspaceProjectsQueryKey = hubQueryKeys.projects.root;
// Threads are keyed by the shared `hubQueryKeys.threads` factory; do not add a
// local threads-key alias here. The projects key above is the projects root and
// must not be reused for thread invalidation (#2274).

const emptyWorkspaceProjects: WorkspaceProjectListResponse = {
  items: [],
  page: { hasMore: false },
};

// Cursor pagination for the workspace projects list (#2290).
//
// GET /web/projects has always accepted pageSize (default 50, ceiling 200 =
// config.MaxListPageSize) and pageCursor, and has always answered with
// page.nextCursor / page.hasMore. This call site asked for a single page of 50
// and threw the cursor away, so from the 51st project onwards the workspace
// showed a silently truncated list: no "load more", no truncation hint, no
// error.
//
// The walk itself lives in @shared/hub/paginate so that this is not the fourth
// hand-rolled copy of the same cursor loop in the front end.
export async function fetchWorkspaceProjects(
  preferHub: boolean,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProjectListResponse> {
  const authenticated = isAuthenticated();
  if (!preferHub || !authenticated) return emptyWorkspaceProjects;

  const client = createHubClient();
  // Canonical Hub list contract (pageSize 200 x 5 pages, cap reported via
  // hasMore) — see @shared/hub/paginate for why a single page is a silent
  // truncation and not an error (#2290).
  return fetchAllPages(client.listWorkspaceProjects);
}

export async function fetchWorkspaceProject(
  projectId: string | undefined,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProject | undefined> {
  const authenticated = isAuthenticated();
  if (!projectId || !authenticated) return undefined;

  const client = createHubClient();
  return client.getWorkspaceProject(projectId);
}

export async function createWorkspaceProject(
  draft: CreateWorkspaceProjectRequest,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProject> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  return client.createWorkspaceProject(draft);
}

export async function updateWorkspaceProject(
  projectId: string,
  draft: UpdateWorkspaceProjectRequest,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProject> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  return client.updateWorkspaceProject(projectId, draft);
}

export async function fetchWorkspaceProjectThreads(
  projectId: string | undefined,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProjectThread[]> {
  const authenticated = isAuthenticated();
  if (!projectId || !authenticated) return [];

  const client = createHubClient();
  return client.listWorkspaceProjectThreads(projectId);
}

export async function createWorkspaceProjectThread(
  projectId: string,
  draft: CreateWorkspaceProjectThreadRequest,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProjectThread> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  return client.createWorkspaceProjectThread(projectId, draft);
}

export async function fetchWorkspaceProjectThreadMessages(
  projectId: string | undefined,
  threadId: string | undefined,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProjectThreadMessage[]> {
  const authenticated = isAuthenticated();
  if (!projectId || !threadId || !authenticated) return [];

  const client = createHubClient();
  return client.listWorkspaceProjectThreadMessages(projectId, threadId, { limit: 80 });
}

export async function sendWorkspaceProjectThreadMessage(
  projectId: string,
  threadId: string,
  draft: SendWorkspaceProjectThreadMessageRequest,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<WorkspaceProjectThreadMessage> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  return client.sendWorkspaceProjectThreadMessage(projectId, threadId, draft);
}

export function useHubWorkspaceProjects(options: {
  enabled: boolean;
  isAuthenticated?: () => boolean;
}) {
  return useQuery<WorkspaceProjectListResponse>({
    queryKey: hubQueryKeys.projects.list(options.enabled ? 'hub' : 'signed-out'),
    queryFn: () => fetchWorkspaceProjects(options.enabled, options.isAuthenticated ?? isHubAuthenticated),
    enabled: options.enabled,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useHubWorkspaceProject(options: {
  projectId?: string | undefined;
  enabled: boolean;
  isAuthenticated?: () => boolean;
}) {
  return useQuery<WorkspaceProject | undefined>({
    queryKey: hubQueryKeys.projects.detail(options.projectId ?? ''),
    queryFn: () => fetchWorkspaceProject(options.projectId, options.isAuthenticated ?? isHubAuthenticated),
    enabled: options.enabled && Boolean(options.projectId),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateHubWorkspaceProject(options: { isAuthenticated?: () => boolean } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (draft: CreateWorkspaceProjectRequest) =>
      createWorkspaceProject(draft, options.isAuthenticated ?? isHubAuthenticated),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceProjectsQueryKey });
    },
  });
}

export function useUpdateHubWorkspaceProject(options: { isAuthenticated?: () => boolean } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, draft }: { projectId: string; draft: UpdateWorkspaceProjectRequest }) =>
      updateWorkspaceProject(projectId, draft, options.isAuthenticated ?? isHubAuthenticated),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.root });
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.detail(variables.projectId) });
    },
  });
}

export function useHubWorkspaceProjectThreads(options: {
  projectId?: string | undefined;
  enabled: boolean;
  isAuthenticated?: () => boolean;
}) {
  return useQuery<WorkspaceProjectThread[]>({
    queryKey: [...hubQueryKeys.projects.threads(options.projectId ?? 'none')],
    queryFn: () => fetchWorkspaceProjectThreads(options.projectId, options.isAuthenticated ?? isHubAuthenticated),
    enabled: options.enabled && Boolean(options.projectId),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useHubWorkspaceProjectThreadMessages(options: {
  projectId?: string | undefined;
  threadId?: string | undefined;
  enabled: boolean;
  isAuthenticated?: () => boolean;
}) {
  return useQuery<WorkspaceProjectThreadMessage[]>({
    queryKey: [
      ...hubQueryKeys.projects.threadMessages(options.projectId ?? 'none', options.threadId ?? 'none'),
    ],
    queryFn: () => fetchWorkspaceProjectThreadMessages(
      options.projectId,
      options.threadId,
      options.isAuthenticated ?? isHubAuthenticated,
    ),
    enabled: options.enabled && Boolean(options.projectId) && Boolean(options.threadId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
}
