import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubQueryKeys, isQueryKeyPrefix, webQueryKeys } from '@shared/stores/queryKeys';
import { useAcceptFriendRequest, useCreateGroupSession } from '@/api/contactQueries';
import { invalidateWebWorkbenchHubQueries } from './webHubRealtime';

/**
 * Effect-based regression proof for the Web query-key family (#2261, ADR-029).
 *
 * Every test here asserts what an invalidation DOES to a cache entry that a
 * real production query writes — never that `invalidateQueries` was called with
 * some array. That distinction is the whole bug: `webHubRealtime.test.ts`
 * happily asserted `toHaveBeenCalledWith({ queryKey: ['web-v4',
 * 'execution-targets'] })` for a key no query ever cached under, so the suite
 * stayed green while the invalidation matched nothing.
 *
 * Concrete consequences before the fix: accepting a friend request in one tab
 * left another tab's contact list stale indefinitely (that query has a
 * `staleTime` but no `refetchInterval`), `createGroupSession` left the new
 * session out of the list for up to one 10s poll, and `useWebAuth`'s
 * post-login "refetch threads" refetched nothing.
 */

/** Seed exactly the caches Web's real queries write, under their real keys. */
function seededClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(webQueryKeys.sessions.list(true), []);
  queryClient.setQueryData(webQueryKeys.messages.of('hub-session-1'), []);
  queryClient.setQueryData(webQueryKeys.contacts.list(true), []);
  queryClient.setQueryData(hubQueryKeys.contacts.friendRequests, []);
  queryClient.setQueryData(hubQueryKeys.executionTargets.list('hub'), []);
  queryClient.setQueryData(hubQueryKeys.agentTeams.usageBoard, []);
  return queryClient;
}

/** Every cache Web actually writes, so "nothing was invalidated" is assertable. */
const LIVE_WEB_CACHES: readonly (readonly unknown[])[] = [
  webQueryKeys.sessions.list(true),
  webQueryKeys.messages.of('hub-session-1'),
  webQueryKeys.contacts.list(true),
  hubQueryKeys.contacts.friendRequests,
  hubQueryKeys.executionTargets.list('hub'),
  hubQueryKeys.agentTeams.usageBoard,
];

function wasInvalidated(queryClient: QueryClient, key: readonly unknown[]): boolean {
  return queryClient.getQueryState([...key])?.isInvalidated === true;
}

function wrapperWith(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('web query-key family: invalidations hit caches that exist (#2261)', () => {
  it('the contact-list key is prefixed by the key its mutations invalidate', () => {
    // Whatever `hubReady` is, the family root matches the list key.
    expect(isQueryKeyPrefix(webQueryKeys.contacts.list(true), webQueryKeys.contacts.root)).toBe(true);
    expect(isQueryKeyPrefix(webQueryKeys.contacts.list(false), webQueryKeys.contacts.root)).toBe(true);
    // The pre-fix target did NOT prefix it. That single false is the bug.
    expect(isQueryKeyPrefix(webQueryKeys.contacts.list(true), hubQueryKeys.contacts.list)).toBe(false);
    // Same for the session list, which used to be invalidated via
    // `hubQueryKeys.threads.list` — a key no Web query writes.
    expect(isQueryKeyPrefix(webQueryKeys.sessions.list(true), webQueryKeys.sessions.root)).toBe(true);
    expect(isQueryKeyPrefix(webQueryKeys.sessions.list(true), hubQueryKeys.threads.list)).toBe(false);
  });

  it('marks the live contact list stale on a realtime contact frame', () => {
    const queryClient = seededClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.FRIEND_ACCEPTED, { user_id: 'user-1' });

    expect(wasInvalidated(queryClient, webQueryKeys.contacts.list(true))).toBe(true);
    // Friend requests live under the shared `hub` namespace and must keep working.
    expect(wasInvalidated(queryClient, hubQueryKeys.contacts.friendRequests)).toBe(true);
  });

  it('marks the live execution-target cache stale on a device frame', () => {
    const queryClient = seededClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.DEVICE_ONLINE, { device_id: 'desktop-1' });

    expect(wasInvalidated(queryClient, hubQueryKeys.executionTargets.list('hub'))).toBe(true);
  });

  it('marks the live team usage board stale on a team frame', () => {
    const queryClient = seededClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.TEAM_ASSIGNMENT_DONE, {
      team_id: 'team-1',
      team_run_id: 'run-1',
    });

    expect(wasInvalidated(queryClient, hubQueryKeys.agentTeams.usageBoard)).toBe(true);
  });

  it('still marks sessions and the active transcript stale on a message frame', () => {
    const queryClient = seededClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.MESSAGE_NEW, {
      session_id: 'hub-session-1',
    });

    expect(wasInvalidated(queryClient, webQueryKeys.sessions.list(true))).toBe(true);
    expect(wasInvalidated(queryClient, webQueryKeys.messages.of('hub-session-1'))).toBe(true);
    // A different session's transcript must not be touched by a scoped frame.
    expect(wasInvalidated(queryClient, webQueryKeys.messages.of('hub-session-2'))).toBe(false);
  });

  it('ignores notification frames instead of invalidating a cache Web never writes', () => {
    const queryClient = seededClient();

    expect(() =>
      invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.NOTIFICATION_NEW, { id: 'n-1' }),
    ).not.toThrow();

    // Web has no notification query at all, so the honest behaviour is that no
    // cache moves. The deleted branch used to invalidate two keys that matched
    // nothing, which read like coverage but was not.
    for (const key of LIVE_WEB_CACHES) {
      expect(wasInvalidated(queryClient, key)).toBe(false);
    }
  });

  it('accepting a friend request invalidates the contact list users actually see', async () => {
    const queryClient = seededClient();

    const { result } = renderHook(() => useAcceptFriendRequest(), {
      wrapper: wrapperWith(queryClient),
    });

    // No Hub token in this environment, so the mutation rejects — `onSettled`
    // fires either way, which is exactly the path under test.
    act(() => {
      result.current.mutate('request-1');
    });

    await waitFor(() =>
      expect(wasInvalidated(queryClient, webQueryKeys.contacts.list(true))).toBe(true),
    );
    expect(wasInvalidated(queryClient, hubQueryKeys.contacts.friendRequests)).toBe(true);
  });

  it('creating a group session invalidates the session list users actually see', async () => {
    const queryClient = seededClient();

    const { result } = renderHook(() => useCreateGroupSession(), {
      wrapper: wrapperWith(queryClient),
    });

    act(() => {
      result.current.mutate({ name: 'group', memberIds: ['user-1'] });
    });

    await waitFor(() =>
      expect(wasInvalidated(queryClient, webQueryKeys.sessions.list(true))).toBe(true),
    );
  });
});
