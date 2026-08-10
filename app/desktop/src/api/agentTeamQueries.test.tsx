import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

describe('desktop agentTeamQueries fail-closed branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
