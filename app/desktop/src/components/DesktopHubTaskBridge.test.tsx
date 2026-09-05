import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { queryClient } from '@/api/queryClient';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import DesktopHubTaskBridge from './DesktopHubTaskBridge';

const fixture = vi.hoisted(() => ({
  registration: { status: 'registered', deviceId: 'fixture-device' },
  listExecutionTargets: vi.fn(),
  auth: { isAuthenticated: true, token: 'fixture-token', tryAutoLogin: vi.fn() },
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => ({ listExecutionTargets: fixture.listExecutionTargets }),
}));
vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: () => fixture.auth.token,
  useAuth: () => fixture.auth,
}));
vi.mock('@/hooks/useDeviceRegistration', () => ({
  useDeviceRegistration: () => fixture.registration,
}));
vi.mock('@/hooks/useHubEventStream', () => ({
  useHubEventStream: () => ({ status: 'disconnected', hubWS: null }),
}));
vi.mock('@/hooks/useHubIntegration', () => ({ useHubIntegration: vi.fn() }));
vi.mock('@/hooks/useHealth', () => ({ useHealth: () => ({ online: false }) }));
vi.mock('@/api/agentQueries', () => ({ useAgentList: () => ({ data: undefined }) }));
vi.mock('@/api/modelCatalogQueries', () => ({ useModelCatalog: () => ({ data: undefined }) }));
vi.mock('@/config', () => ({ getEdgeBaseUrl: () => 'http://edge.test' }));

function Wrapper({ children }: React.PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function seedLiveTargets() {
  // The production hook supplies the cache key; do not prove a made-up key
  // invalidates itself. A fresh entry also prevents mount-refetch hiding a miss.
  const hook = renderHook(() => useHubExecutionTargets({ enabled: true }), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const entry = queryClient.getQueryCache().getAll()[0];
  if (!entry) throw new Error('The production target hook registered no cache entry');
  hook.unmount();
  expect(fixture.listExecutionTargets).toHaveBeenCalledTimes(1);
  return entry.queryKey;
}

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  vi.clearAllMocks();
  fixture.registration.status = 'registered';
  fixture.listExecutionTargets.mockResolvedValue({ items: [], page: { hasMore: false } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('DesktopHubTaskBridge target refresh', () => {
  it('refetches the live target cache after registration without invalidating unrelated Hub data', async () => {
    const targetKey = await seedLiveTargets();
    queryClient.setQueryData(hubQueryKeys.contacts.list, []);
    fixture.listExecutionTargets.mockResolvedValue({
      items: [{ id: 'new-target', name: 'New target', target_type: 'local_edge', health_state: 'offline' }],
      page: { hasMore: false },
    });

    render(<DesktopHubTaskBridge />, { wrapper: Wrapper });

    // This must happen before the hook's 10-second fallback poll.
    await waitFor(() => expect(queryClient.getQueryData(targetKey)).toMatchObject({
      items: [{ id: 'new-target' }],
    }));
    expect(fixture.listExecutionTargets).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(hubQueryKeys.contacts.list)?.isInvalidated).toBe(false);
  });

  it('does not invalidate or refetch targets while registration is pending', async () => {
    const targetKey = await seedLiveTargets();
    fixture.registration.status = 'registering';

    render(<DesktopHubTaskBridge />, { wrapper: Wrapper });

    expect(queryClient.getQueryState(targetKey)?.isInvalidated).toBe(false);
    expect(fixture.listExecutionTargets).toHaveBeenCalledTimes(1);
  });
});
