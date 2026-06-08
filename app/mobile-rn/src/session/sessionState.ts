export type HubSessionStatus = 'active' | 'expired' | 'missing';

export interface HubSessionSnapshot {
  status: HubSessionStatus;
  accessToken?: string;
  refreshToken?: string;
  userSub?: string;
}

export type HubSessionAction =
  | { type: 'session.received'; accessToken: string; refreshToken: string; userSub: string }
  | { type: 'session.expired' }
  | { type: 'session.cleared' };

export function reduceHubSession(
  state: HubSessionSnapshot,
  action: HubSessionAction,
): HubSessionSnapshot {
  switch (action.type) {
    case 'session.received':
      return {
        status: 'active',
        accessToken: action.accessToken,
        refreshToken: action.refreshToken,
        userSub: action.userSub,
      };
    case 'session.expired':
      return {
        ...state,
        status: 'expired',
      };
    case 'session.cleared':
      return { status: 'missing' };
    default:
      return state;
  }
}
