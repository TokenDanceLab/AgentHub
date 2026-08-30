// Mobile Hub client — thin surface over shared SSOT (#1338 / T80.2).
// - Method/DTO SSOT: @agenthub/shared/hub/hubClient
// - Mobile-only glue: async SecureStore token cache, fixture snapshot, legacy WS types,
//   HubApiError/HubNetworkError (test/UI compatibility)
// Do NOT add new Hub REST methods here; add them to app/shared/src/hub/hubClient.ts first.
//
// Inventory (T80.1 keep vs re-export):
// | Surface | Decision |
// |---|---|
// | REST methods (auth, sessions, messages, tasks, reactions, attachments, …) | re-export / Proxy → shared |
// | DTOs (HubAgentRunEvent, HubAgentTaskApproval, HubProbeAttachmentResponse, …) | re-export from shared |
// | createHubClient token cache + onRefreshToken | KEEP (async SecureStore) |
// | getMobileSnapshot + mapSessionsToMobileFixture | KEEP (mobile fixture shape) |
// | createMockHubClient | KEEP (fixture delay + mock snapshot) |
// | HubApiError / HubNetworkError | KEEP (test + historical UI imports) |
// | WS_BEARER_SUBPROTOCOL, buildWSAuthProtocols, createHubWsUrl, HubWs* | KEEP (RN WS layer) |
// | Legacy HubWsEventType mobile-only names | KEEP (App/UI compatibility) |

import {
  createHubClient as createSharedHubClient,
  type HubClient as SharedHubClient,
  type HubClientOptions,
  type HubSession,
} from '@agenthub/shared/hub/hubClient';
import type { HubEventType } from '@agenthub/shared/hubEvents';

import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';

// Re-export full shared SSOT for app imports (types + helpers).
export * from '@agenthub/shared/hub/hubClient';
// Re-export the shared Hub error classes so mobile test/UI `instanceof`
// checks resolve to one shared class identity (SSOT lives in shared errors.ts).
import { HubApiError, HubNetworkError, type HubErrorDetails } from '@agenthub/shared/errors';
export { HubApiError, HubNetworkError, type HubErrorDetails };

// ── WebSocket event types (aligned with hub-server WS frames) ──
// Includes legacy mobile-only types for UI layer backward compatibility.

/** Legacy mobile-only event types (referenced by App.tsx UI layer). */
export type HubWsLegacyEventType =
  | 'snapshot.updated'
  | 'thread.updated'
  | 'run.updated'
  | 'approval.updated'
  | 'presence.updated';

// Real Hub server event names derive from @agenthub/shared/hubEvents
// (SSOT mirroring hub-server/internal/ws/frame.go) — no parallel copy here.
export type HubWsEventType = HubEventType | HubWsLegacyEventType;

export interface HubWsEvent<TPayload = unknown> {
  type: HubWsEventType;
  seq_id?: number;
  payload: TPayload;
}

export interface HubWsUrlOptions {
  since?: string;
  token?: string;
  /**
   * When true, append JWT as query `access_token` (legacy fallback).
   * Default false — prefer Sec-WebSocket-Protocol via `buildWSAuthProtocols`.
   */
  useQueryTokenFallback?: boolean;
}

/**
 * Fixed Sec-WebSocket-Protocol marker negotiated with Hub WS upgrades.
 * Paired with the raw Hub JWT as a second subprotocol value.
 * Must match hub-server middleware.WSBearerSubprotocol.
 */
export const WS_BEARER_SUBPROTOCOL = 'agenthub.bearer.v1';

/**
 * Build WebSocket subprotocols that carry a Hub JWT without putting it in the URL.
 * Returns undefined when token is missing so the socket opens without auth protocols.
 */
export function buildWSAuthProtocols(token: string | null | undefined): string[] | undefined {
  if (!token) return undefined;
  return [WS_BEARER_SUBPROTOCOL, token];
}

// ── Mobile Hub client ──

type AccessTokenProvider = () => Promise<string | null | undefined> | string | null | undefined;

export interface CreateHubClientOptions {
  baseUrl: string;
  getAccessToken?: AccessTokenProvider;
  /**
   * Called on 401 from the shared client so the mobile session layer can
   * refresh + persist tokens (e.g. SecureStore) and return the new access token.
   */
  onRefreshToken?: () => Promise<string | null>;
  fetchImpl?: typeof globalThis.fetch;
}

/** Mobile Hub client = shared SSOT + mobile glue (snapshot / shared handle). */
export type HubClient = SharedHubClient & {
  readonly shared: SharedHubClient;
  getMobileSnapshot: () => Promise<MobileAppFixture>;
  /**
   * Preview-lane snapshot over the mock Hub's mobile snapshot producer
   * (GET /v1/mobile/snapshot). Used by the Expo Web preview data plane
   * (src/App.tsx). Fails loudly (HubNetworkError / HubApiError) instead of
   * silently degrading, so the preview can surface an explicit offline state.
   */
  getPreviewSnapshot: () => Promise<MobileAppFixture>;
};

/** Methods that must not wait on SecureStore token resolution. */
const NO_AUTH_METHOD_KEYS = new Set<string>([
  'oidcAuthorize',
  'oidcCallback',
  'register',
  'login',
  'refresh',
  // Sync URL builder — no network; shared already prefixes baseUrl.
  'downloadAttachmentUrl',
]);

function wrapSharedAsMobileClient(
  shared: SharedHubClient,
  glue: {
    ensureToken: () => Promise<string | null | undefined>;
    withAuth: <T>(fn: () => Promise<T>) => Promise<T>;
    clearToken: () => void;
    getMobileSnapshot: () => Promise<MobileAppFixture>;
    getPreviewSnapshot: () => Promise<MobileAppFixture>;
  },
): HubClient {
  return new Proxy(shared as object, {
    get(target, prop, receiver) {
      if (prop === 'shared') return shared;
      if (prop === 'getMobileSnapshot') return glue.getMobileSnapshot;
      if (prop === 'getPreviewSnapshot') return glue.getPreviewSnapshot;

      if (prop === 'logout') {
        return async () => {
          try {
            await glue.ensureToken();
            await shared.logout();
          } finally {
            glue.clearToken();
          }
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') {
        return value;
      }

      const key = String(prop);
      if (NO_AUTH_METHOD_KEYS.has(key)) {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }

      return (...args: unknown[]) =>
        glue.withAuth(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  }) as HubClient;
}

export function createMockHubClient(delayMs = 80): HubClient {
  const shared = createSharedHubClient();

  return wrapSharedAsMobileClient(shared, {
    ensureToken: async () => null,
    withAuth: async (fn) => fn(),
    clearToken: () => {},
    getMobileSnapshot: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
      return mobileFixture;
    },
    getPreviewSnapshot: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
      return mobileFixture;
    },
  });
}

export function createHubClient(options: CreateHubClientOptions): HubClient {
  // Shared Hub client expects a synchronous getToken(). Mobile providers are
  // often async (SecureStore), so we re-resolve into a cache before each
  // authenticated call and single-flight concurrent resolvers.
  let cachedToken: string | null | undefined = null;
  let tokenPromise: Promise<string | null | undefined> | undefined;

  const resolveToken = async (): Promise<string | null | undefined> => {
    if (!options.getAccessToken) return null;
    try {
      const result = options.getAccessToken();
      if (result instanceof Promise) {
        return await result;
      }
      return result ?? null;
    } catch {
      return null;
    }
  };

  const ensureToken = async (): Promise<string | null | undefined> => {
    if (tokenPromise) {
      return tokenPromise;
    }

    tokenPromise = resolveToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => {
        tokenPromise = undefined;
      });

    return tokenPromise;
  };

  const withAuth = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureToken();
    return fn();
  };

  const handleRefreshToken = async (): Promise<string | null> => {
    if (!options.onRefreshToken) {
      const token = await resolveToken();
      cachedToken = token ?? null;
      return token ?? null;
    }

    try {
      const newToken = await options.onRefreshToken();
      cachedToken = newToken;
      return newToken;
    } catch {
      cachedToken = null;
      return null;
    }
  };

  const sharedOpts: HubClientOptions = {
    baseUrl: options.baseUrl,
    getToken: () => cachedToken,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    // Always wire refresh so 401 can re-resolve provider tokens; callers may
    // also supply onRefreshToken to refresh + persist via session/SecureStore.
    ...((options.getAccessToken || options.onRefreshToken)
      ? { onRefreshToken: handleRefreshToken }
      : {}),
  };

  const shared = createSharedHubClient(sharedOpts);

  return wrapSharedAsMobileClient(shared, {
    ensureToken,
    withAuth,
    clearToken: () => {
      cachedToken = null;
    },
    getMobileSnapshot: async () => {
      await ensureToken();

      // Contacts were previously fetched and discarded — sessions are the only
      // input the mobile fixture needs, so a single RTT is enough.
      let sessions: HubSession[] = [];
      let sessionsOk = true;
      try {
        sessions = await shared.listSessions();
      } catch (listSessionsError) {
        sessionsOk = false;
        // eslint-disable-next-line no-console -- session list failure is surfaced via offline account state
        console.warn("[mobile] listSessions failed:", listSessionsError);
      }

      return mapSessionsToMobileFixture(sessions, sessionsOk);
    },
    getPreviewSnapshot: async () => {
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const snapshotUrl = `${options.baseUrl.replace(/\/+$/, '')}/v1/mobile/snapshot`;

      let response: Response;
      try {
        response = await fetchImpl(snapshotUrl);
      } catch (error) {
        throw new HubNetworkError(
          'Mobile preview snapshot request failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      if (!response.ok) {
        throw new HubApiError({
          code: 'snapshot_unavailable',
          message: `Mobile preview snapshot endpoint returned HTTP ${response.status}`,
          status: response.status,
          retryable: true,
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new HubApiError({
          code: 'invalid_snapshot',
          message: 'Mobile preview snapshot endpoint returned non-JSON content',
          status: response.status,
          retryable: true,
        });
      }

      return parseMobileSnapshotBody(body);
    },
  });
}

/**
 * Shape-guards the mock Hub snapshot payload before it reaches the UI. The
 * preview must never render unvalidated or partially valid data-plane output.
 */
function parseMobileSnapshotBody(body: unknown): MobileAppFixture {
  if (typeof body !== 'object' || body === null) {
    throw new HubApiError({
      code: 'invalid_snapshot',
      message: 'Mobile preview snapshot payload is not an object',
      status: 200,
      retryable: true,
    });
  }

  const candidate = body as Record<string, unknown>;
  if (
    !Array.isArray(candidate.threads)
    || !Array.isArray(candidate.runs)
    || typeof candidate.transcript !== 'object'
    || candidate.transcript === null
    || Array.isArray(candidate.transcript)
    || typeof candidate.account !== 'object'
    || candidate.account === null
    || typeof (candidate.account as Record<string, unknown>).deviceLabel !== 'string'
  ) {
    throw new HubApiError({
      code: 'invalid_snapshot',
      message: 'Mobile preview snapshot payload has an unexpected shape',
      status: 200,
      retryable: true,
    });
  }

  return candidate as unknown as MobileAppFixture;
}

// ── WebSocket URL builder (aligned with hub-server /client/ws) ──
//
// Preferred auth carriage (matching hub-server middleware.WSBearerSubprotocol):
//   Sec-WebSocket-Protocol: agenthub.bearer.v1, <hub-jwt>
// Query ?access_token= is a legacy fallback only (useQueryTokenFallback).

export function createHubWsUrl(baseUrl: string, options: HubWsUrlOptions = {}): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/client/ws';
  url.search = '';

  if (options.since) {
    url.searchParams.set('since', options.since);
  }

  // Default path does not put JWT in the URL. Prefer buildWSAuthProtocols +
  // Sec-WebSocket-Protocol. Query access_token remains available only when
  // useQueryTokenFallback is explicitly enabled (legacy mobile / older hubs).
  if (options.token && options.useQueryTokenFallback === true) {
    url.searchParams.set('access_token', options.token);
  }

  return url.toString();
}

// ── Session → Mobile fixture mapping ──

function mapSessionsToMobileFixture(
  sessions: HubSession[],
  sessionsOk: boolean,
): MobileAppFixture {
  return {
    threads: sessions
      // Sessions without any id would produce unusable `id: ''` threads.
      .filter((session) => Boolean(session.session_id ?? session.id))
      .map((session) => ({
        id: session.session_id ?? session.id ?? '',
        title: session.name ?? '',
        subtitle: session.last_message?.content ?? '',
        initials: extractInitials(session.name ?? ''),
        unread: session.unread_count ?? 0,
        muted: session.muted ?? false,
        participantKind: (session.type === 'group' ? 'group' : 'agent') as 'agent' | 'group',
        status: 'online' as const,
        lastActivity: session.last_message_at ?? session.updated_at ?? new Date().toISOString(),
      })),
    runs: [],
    transcript: {},
    // Account state mirrors the real listSessions outcome instead of always
    // claiming an active signed-in Hub session. Degraded literals follow the
    // offline fixture scenario (data/mobileFixtures.ts).
    account: sessionsOk
      ? {
          tokenDanceId: 'signed_in',
          hubSession: 'active',
          notification: 'granted',
          hubSync: 'active',
          deviceLabel: 'AgentHub Mobile',
        }
      : {
          tokenDanceId: 'recovering',
          hubSession: 'missing',
          notification: 'prompt',
          hubSync: 'offline',
          deviceLabel: 'AgentHub Mobile',
        },
  };
}

function extractInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  }
  return name.slice(0, 2).toUpperCase();
}
