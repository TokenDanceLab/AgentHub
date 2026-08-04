import { describe, expect, it, vi } from 'vitest';
import type {
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
} from '@shared/hubClient';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { createWebWorkbenchProjectsPort } from './webWorkbenchProjectsPort';

vi.mock('@/api/hubClient', () => ({
  createHubClient: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));

const mockCreateHubClient = vi.mocked(createHubClient);
const mockGetAccessToken = vi.mocked(getAccessToken);

function mockHubClient() {
  const listWorkspaceProjects = vi.fn();
  const createWorkspaceProject = vi.fn();
  const updateWorkspaceProject = vi.fn();
  mockCreateHubClient.mockReturnValue({
    listWorkspaceProjects,
    createWorkspaceProject,
    updateWorkspaceProject,
  } as unknown as ReturnType<typeof createHubClient>);
  return { listWorkspaceProjects, createWorkspaceProject, updateWorkspaceProject };
}

function project(id: string, name: string): HubWorkspaceProject {
  return { id, name, description: `${name} description` };
}

/* ═══════════════════════════════════════════════════════════════════════
   Web adapter for the shared WorkbenchProjectsPort contract (#1546).
   Same contract suite as the desktop adapter — the shared UI sees the same
   domain port on both platforms.
   ═══════════════════════════════════════════════════════════════════════ */

describe('webWorkbenchProjectsPort — shared WorkbenchProjectsPort contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockReturnValue('access-token');
  });

  it('wires the token provider into the transport client at construction', () => {
    mockHubClient();
    createWebWorkbenchProjectsPort();
    expect(mockCreateHubClient).toHaveBeenCalledWith({ getToken: getAccessToken });
  });

  it('maps the list response to workbench domain pages and passes pagination params through', async () => {
    const { listWorkspaceProjects } = mockHubClient();
    listWorkspaceProjects.mockResolvedValue({
      items: [project('p1', 'Alpha'), project('p2', 'Beta')],
      page: { nextCursor: 'cursor-2', hasMore: true },
    } satisfies HubWorkspaceProjectListResponse);

    const page = await createWebWorkbenchProjectsPort().listProjects({
      pageSize: 50,
      pageCursor: 'cursor-1',
    });

    expect(listWorkspaceProjects).toHaveBeenCalledWith({ pageSize: 50, pageCursor: 'cursor-1' });
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.hasMore).toBe(true);
    expect(page.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(page.items[0]).toMatchObject({ name: 'Alpha', status: 'Active' });
  });

  it('defaults hasMore to false when the response carries no pagination info', async () => {
    const { listWorkspaceProjects } = mockHubClient();
    listWorkspaceProjects.mockResolvedValue({
      items: [],
      page: { hasMore: false },
    } satisfies HubWorkspaceProjectListResponse);

    const page = await createWebWorkbenchProjectsPort().listProjects();

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('trims create payload fields and falls back to the default project name', async () => {
    const { createWorkspaceProject } = mockHubClient();
    createWorkspaceProject.mockResolvedValue(project('created', 'New Project'));

    const info = await createWebWorkbenchProjectsPort().createProject({
      name: '  New Project  ',
      description: '  Desc  ',
    });

    expect(createWorkspaceProject).toHaveBeenCalledWith({ name: 'New Project', description: 'Desc' });
    expect(info).toMatchObject({ id: 'created', name: 'New Project' });
  });

  it('normalizes a blank project name to the default before create', async () => {
    const { createWorkspaceProject } = mockHubClient();
    createWorkspaceProject.mockResolvedValue(project('created', '  '));

    const info = await createWebWorkbenchProjectsPort().createProject({
      name: '   ',
      description: '  ',
    });

    expect(createWorkspaceProject).toHaveBeenCalledWith({ name: '未命名项目', description: '' });
    expect(info.name).toBe('未命名项目');
  });

  it('maps the updated project on update', async () => {
    const { updateWorkspaceProject } = mockHubClient();
    updateWorkspaceProject.mockResolvedValue(project('p1', 'Renamed'));

    const info = await createWebWorkbenchProjectsPort().updateProject('p1', {
      name: '  Renamed  ',
      description: 'd',
    });

    expect(updateWorkspaceProject).toHaveBeenCalledWith('p1', { name: 'Renamed', description: 'd' });
    expect(info).toMatchObject({ id: 'p1', name: 'Renamed' });
  });
});
