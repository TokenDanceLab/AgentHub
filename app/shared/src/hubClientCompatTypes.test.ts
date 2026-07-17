import { describe, expect, it } from 'vitest';
import {
  HUBCLIENT_SSOT_GAPS,
  type AuthResponse,
  type Contact,
  type EmptyHubResponse,
  type Session,
} from './hubClientCompatTypes';

describe('hubClientCompatTypes (#799)', () => {
  it('keeps HUBCLIENT_SSOT_GAPS arrays stable for surface parity tracking', () => {
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.desktopAndWebNotShared)).toBe(true);
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.desktopOnly)).toBe(true);
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.webOnly)).toBe(true);
  });

  it('preserves compatibility alias shapes', () => {
    const auth: AuthResponse = {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
    };
    const session: Session = { session_id: 's1', type: 'private' };
    const contact: Contact = {
      id: 'c1',
      user_id: 'u1',
      friend_id: 'u2',
      status: 'accepted',
    };
    const empty: EmptyHubResponse = undefined;

    expect(auth.access_token).toBe('at');
    expect(session.session_id).toBe('s1');
    expect(contact.friend_id).toBe('u2');
    expect(empty).toBeUndefined();
  });
});
