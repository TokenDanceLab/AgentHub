// #2290 defect class, desktop half: `useHubAgentProfiles` called
// listAgentProfiles() with no parameters — so the server applied its default
// page size and the returned cursor was thrown away with the whole `page`
// object. Agent profiles past the first page never reached the desktop agent
// list, with no truncation signal anywhere.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubClient } from '@/api/hubClient';
import { useHubAgentProfiles } from './agentProfileQueries';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

const client = { listAgentProfiles: vi.fn() };

function profile(id: string, name: string) {
  return {
    id,
    name,
    description: 'paging probe',
    runtime_id: 'codex',
    provider: 'openai',
    model: 'gpt-5.5',
    version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createHubClient).mockReturnValue(client as never);
});

describe('desktop hub agent profiles', () => {
  it('walks cursor pages instead of keeping only the first one', async () => {
    client.listAgentProfiles
      .mockResolvedValueOnce({
        items: [profile('00000000-0000-0000-0000-00000000c301', 'Page 1 Agent')],
        page: { hasMore: true, nextCursor: 'cur-1' },
      })
      .mockResolvedValueOnce({
        items: [profile('00000000-0000-0000-0000-00000000c302', 'Page 2 Agent')],
        page: { hasMore: false },
      });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useHubAgentProfiles({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.listAgentProfiles).toHaveBeenCalledTimes(2);
    // The first call must state the page size: parameterless means the server
    // default, which is what hid the tail of the list.
    expect(client.listAgentProfiles).toHaveBeenNthCalledWith(1, { pageSize: 200 });
    expect(client.listAgentProfiles).toHaveBeenNthCalledWith(2, {
      pageSize: 200,
      pageCursor: 'cur-1',
    });
    expect(result.current.data?.map((agent) => agent.name))
      .toEqual(['Page 1 Agent', 'Page 2 Agent']);
  });
});
