import { describe, expect, it } from 'vitest';

import { reduceHubSession, type HubSessionSnapshot } from './sessionState';

describe('Hub session reducer', () => {
  it('stores only Hub-issued session state after TokenDance ID exchange', () => {
    const next = reduceHubSession(
      { status: 'missing' },
      {
        type: 'session.received',
        accessToken: 'hub-access',
        refreshToken: 'hub-refresh',
        userSub: 'td-sub-1',
      },
    );

    expect(next).toEqual({
      status: 'active',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
      userSub: 'td-sub-1',
    });
  });

  it('marks stale sessions expired without dropping refresh context', () => {
    const state: HubSessionSnapshot = {
      status: 'active',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
    };

    expect(reduceHubSession(state, { type: 'session.expired' })).toEqual({
      status: 'expired',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
    });
  });

  it('clears all local session fields on logout', () => {
    expect(
      reduceHubSession(
        {
          status: 'active',
          accessToken: 'hub-access',
          refreshToken: 'hub-refresh',
          userSub: 'td-sub-1',
        },
        { type: 'session.cleared' },
      ),
    ).toEqual({ status: 'missing' });
  });
});
