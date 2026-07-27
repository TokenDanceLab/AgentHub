import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { getAccessToken } from '@/hooks/useAuth';
import {
  acceptFriendRequest,
  listFriendRequests,
  removeContact,
  searchHubUser,
  sendFriendRequest,
} from './contactQueries';
import { getAuthorization } from '@/__tests__/requestInitTestUtils';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ code, message }),
    { status, statusText: status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Error', headers: { 'Content-Type': 'application/json' } },
  );
}

describe('web contact queries fail-closed branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('returns empty friend requests without calling Hub when there is no token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listFriendRequests()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects contact mutations without a Hub session token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchHubUser('alice')).rejects.toThrow('Hub session is required');
    await expect(sendFriendRequest({ userId: 'user-1' })).rejects.toThrow('Hub session is required');
    await expect(acceptFriendRequest('req-1')).rejects.toThrow('Hub session is required');
    await expect(removeContact('user-1')).rejects.toThrow('Hub session is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces 401 unauthorized from friend-request list as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('stale-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/client/contacts/friend-requests');
      expect(getAuthorization(init)).toBe('Bearer stale-token');
      return jsonError(401, 'unauthorized', 'bad token');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listFriendRequests()).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
    await expect(listFriendRequests()).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces 404 from user search as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async () => jsonError(404, 'NOT_FOUND', 'user missing'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchHubUser('missing-user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'user missing',
      status: 404,
    });
    await expect(searchHubUser('missing-user')).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces 500 from friend-request accept as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async () => jsonError(500, 'INTERNAL_ERROR', 'hub down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(acceptFriendRequest('req-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'hub down',
      status: 500,
    });
    await expect(acceptFriendRequest('req-1')).rejects.toBeInstanceOf(AppError);
  });

  it('lists friend requests through Hub when a session token is available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: [
          {
            id: 'req-1',
            from_user_id: 'user-2',
            to_user_id: 'user-1',
            message: 'hi',
            status: 'pending',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await listFriendRequests();
    expect(res).toEqual([
      expect.objectContaining({ id: 'req-1', status: 'pending' }),
    ]);
  });
});
