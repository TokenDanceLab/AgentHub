import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient } from '@/api/hubClient';
import { useHubContacts } from './hubQueries';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

const client = {
  listContacts: vi.fn(),
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listContacts.mockResolvedValue([]);
  vi.mocked(createHubClient).mockReturnValue(client as never);
});

describe('desktop Hub contacts query', () => {
  it('registers the accepted contacts collection on contacts.list, not the family root', async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useHubContacts({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const registered = queryClient
      .getQueryCache()
      .findAll()
      .map((query) => [...query.queryKey] as unknown[]);
    expect(registered).toContainEqual([...hubQueryKeys.contacts.list]);
    expect(registered).not.toContainEqual([...hubQueryKeys.contacts.root]);
    expect(client.listContacts).toHaveBeenCalledTimes(1);
  });
});
