export type HubSessionStatus = 'active' | 'expired' | 'missing';

export interface HubSessionSnapshot {
  status: HubSessionStatus;
  // Hub-issued tokens returned after TokenDance ID code exchange.
  accessToken?: string;
  refreshToken?: string;
  // TokenDance ID subject. This is identity context, not an ID token.
  userSub?: string;
  expiresAt?: string;
}

export type HubSessionAction =
  | {
      type: 'session.received';
      accessToken: string;
      refreshToken: string;
      userSub: string;
      expiresAt?: string;
    }
  | { type: 'session.expired' }
  | { type: 'session.cleared' };

export interface HubSessionStorage {
  load(): Promise<HubSessionSnapshot>;
  save(session: HubSessionSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export interface HubSessionStorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface HubSessionStorageOptions {
  key?: string;
}

export interface HubSessionBoundary {
  hubSessionStatus: HubSessionStatus;
  tokenDanceIdSubject?: string;
  hasHubAccessToken: boolean;
  hasHubRefreshToken: boolean;
  storesTokenDanceIdToken: false;
  storesThirdPartyProviderToken: false;
}

const DEFAULT_HUB_SESSION_STORAGE_KEY = 'agenthub.mobile.hubSession.v1';

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
        ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}),
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

export function createHubSessionStorage(
  adapter: HubSessionStorageAdapter,
  options: HubSessionStorageOptions = {},
): HubSessionStorage {
  const key = options.key ?? DEFAULT_HUB_SESSION_STORAGE_KEY;

  return {
    async load() {
      const raw = await adapter.getItemAsync(key);

      if (!raw) {
        return { status: 'missing' };
      }

      return parseStoredHubSession(raw);
    },
    async save(session) {
      await adapter.setItemAsync(key, JSON.stringify(toStoredHubSession(session)));
    },
    async clear() {
      await adapter.deleteItemAsync(key);
    },
  };
}

export function isHubSessionExpired(
  session: HubSessionSnapshot,
  now: Date = new Date(),
): boolean {
  if (session.status === 'expired') {
    return true;
  }

  if (session.status !== 'active' || !session.expiresAt) {
    return false;
  }

  const expiryTime = Date.parse(session.expiresAt);

  if (Number.isNaN(expiryTime)) {
    return true;
  }

  return expiryTime <= now.getTime();
}

export function getHubSessionBoundary(session: HubSessionSnapshot): HubSessionBoundary {
  const boundary = {
    hubSessionStatus: session.status,
    hasHubAccessToken: Boolean(session.accessToken),
    hasHubRefreshToken: Boolean(session.refreshToken),
    storesTokenDanceIdToken: false,
    storesThirdPartyProviderToken: false,
  } satisfies Omit<HubSessionBoundary, 'tokenDanceIdSubject'>;

  return session.userSub
    ? {
        ...boundary,
        tokenDanceIdSubject: session.userSub,
      }
    : boundary;
}

function parseStoredHubSession(raw: string): HubSessionSnapshot {
  try {
    return toStoredHubSession(JSON.parse(raw) as Partial<HubSessionSnapshot>);
  } catch {
    return { status: 'missing' };
  }
}

function toStoredHubSession(session: Partial<HubSessionSnapshot>): HubSessionSnapshot {
  if (
    session.status !== 'active' &&
    session.status !== 'expired' &&
    session.status !== 'missing'
  ) {
    return { status: 'missing' };
  }

  if (session.status === 'missing') {
    return { status: 'missing' };
  }

  return {
    status: session.status,
    ...(typeof session.accessToken === 'string' ? { accessToken: session.accessToken } : {}),
    ...(typeof session.refreshToken === 'string' ? { refreshToken: session.refreshToken } : {}),
    ...(typeof session.userSub === 'string' ? { userSub: session.userSub } : {}),
    ...(typeof session.expiresAt === 'string' ? { expiresAt: session.expiresAt } : {}),
  };
}
