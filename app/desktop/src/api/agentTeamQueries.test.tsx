import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import {
  fetchAgentTeamOverview,
  useCreateAgentTeam,
  useDeleteAgentTeam,
  useStartTeamRun,
} from './agentTeamQueries';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ code, message }),
    {
      status,
      statusText:
        status === 401
          ? 'Unauthorized'
          : status === 403
            ? 'Forbidden'
            : status === 404
              ? 'Not Found'
              : status === 500
                ? 'Internal Server Error'
                : 'Error',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function jsonOk(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ code: 'OK', data }),
    {
      status,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function getAuthorization(init?: RequestInit): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('Authorization');
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === 'authorization');
    return hit?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record.Authorization ?? record.authorization ?? null;
}

const emptyOverview = {
  teams: [],
  bundles: [],
  customAgents: [],
  tasks: [],
  events: [],
};

describe('desktop agentTeamQueries fail-closed branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns empty overview without calling Hub when preferHub is false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(false, () => 'hub-token', 'http://test.local'),
    ).resolves.toEqual(emptyOverview);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty overview without calling Hub when there is no token (fail-closed)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => null, 'http://test.local'),
    ).resolves.toEqual(emptyOverview);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces 401 unauthorized from agent-team list as AppError (fail-closed)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://test.local/web/agent-teams');
      expect(getAuthorization(init)).toBe('Bearer stale-token');
      return jsonError(401, 'unauthorized', 'bad token');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => 'stale-token', 'http://test.local'),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
    await expect(
      fetchAgentTeamOverview(true, () => 'stale-token', 'http://test.local'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces 403 forbidden from agent-team list as AppError', async () => {
    const fetchMock = vi.fn(async () => jsonError(403, 'FORBIDDEN', 'not allowed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'not allowed',
      status: 403,
    });
    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces 404 from agent-team list as AppError', async () => {
    const fetchMock = vi.fn(async () => jsonError(404, 'NOT_FOUND', 'teams missing'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'teams missing',
      status: 404,
    });
    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces 500 from agent-team list as AppError', async () => {
    const fetchMock = vi.fn(async () => jsonError(500, 'INTERNAL_ERROR', 'hub down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'hub down',
      status: 500,
    });
    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('loads empty overview when Hub returns no agent teams', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/web/agent-teams')) {
        return jsonOk([]);
      }
      if (url.includes('/web/custom-agents') || url.includes('/web/agent-profiles')) {
        return jsonOk([]);
      }
      return jsonError(404, 'NOT_FOUND', `unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAgentTeamOverview(true, () => 'hub-access', 'http://test.local'),
    ).resolves.toEqual({
      ...emptyOverview,
      customAgents: [],
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects team mutations without a Hub session token (fail-closed)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const create = renderHook(
      () => useCreateAgentTeam({ getToken: () => null, baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );
    const start = renderHook(
      () => useStartTeamRun({ getToken: () => null, baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );
    const del = renderHook(
      () => useDeleteAgentTeam({ getToken: () => null, baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await expect(
      act(async () => create.result.current.mutateAsync({ name: 'Team A' })),
    ).rejects.toThrow('Hub session is required');
    await expect(
      act(async () => start.result.current.mutateAsync({
        teamId: 'team-1',
        run: { trigger_message: 'do work' },
      })),
    ).rejects.toThrow('Hub session is required');
    await expect(
      act(async () => del.result.current.mutateAsync('team-1')),
    ).rejects.toThrow('Hub session is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces 401 from createAgentTeam mutation as AppError', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://test.local/web/agent-teams');
      expect(init?.method).toBe('POST');
      expect(getAuthorization(init)).toBe('Bearer stale-token');
      return jsonError(401, 'unauthorized', 'bad token');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useCreateAgentTeam({ getToken: () => 'stale-token', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await expect(
      act(async () => result.current.mutateAsync({ name: 'Team A' })),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
  });

  it('surfaces 403 from deleteAgentTeam mutation as AppError', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://test.local/web/agent-teams/team-1');
      expect(init?.method).toBe('DELETE');
      return jsonError(403, 'FORBIDDEN', 'not allowed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useDeleteAgentTeam({ getToken: () => 'hub-access', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await expect(
      act(async () => result.current.mutateAsync('team-1')),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});
