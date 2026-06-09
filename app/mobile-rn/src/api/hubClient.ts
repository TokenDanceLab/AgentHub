import {
  createHubClient as createSharedHubClient,
  type HubClientOptions,
  type HubClient as SharedHubClient,
  type HubOidcAuthorizeRequest,
  type HubOidcAuthorizeResponse,
  type HubOidcCallbackRequest,
  type HubOidcCallbackResponse,
  type HubUserProfile,
  type HubAuthResponse,
  type HubSession,
  type HubMessage,
  type HubSearchResult,
  type HubFriendRequest,
  type HubContactInfo,
  type HubCustomAgent,
  type HubCustomAgentRequest,
  type HubExecutionTarget,
  type HubListResponse,
} from '@agenthub/shared/hubClient';

import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';

// ── Mobile-specific error types (preserved for test compatibility) ──

export interface HubErrorDetails {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  cause?: unknown;
}

export class HubApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(details: Omit<HubErrorDetails, 'cause'> & { status: number }) {
    super(details.message);
    this.name = 'HubApiError';
    this.code = details.code;
    this.status = details.status;
    this.retryable = details.retryable;
  }
}

export class HubNetworkError extends Error {
  code = 'network_error';
  retryable = true;
  cause?: unknown;

  constructor(message = 'Network request to AgentHub failed', cause?: unknown) {
    super(message);
    this.name = 'HubNetworkError';
    this.cause = cause;
  }
}

// ── WebSocket event types (aligned with hub-server WS frames) ──
// Includes legacy mobile-only types for UI layer backward compatibility.

export type HubWsEventType =
  // Real Hub server events (from hub-server/internal/ws/frame.go)
  | 'auth'
  | 'auth.ok'
  | 'auth.fail'
  | 'message.new'
  | 'message.recall'
  | 'message.read'
  | 'session.created'
  | 'session.dissolved'
  | 'session.info_updated'
  | 'device.online'
  | 'device.offline'
  | 'device.kicked'
  | 'agent.dispatch'
  | 'agent.stream'
  | 'agent.done'
  | 'agent.failed'
  | 'agent.cancel'
  | 'notification.new'
  | 'friend.request'
  | 'friend.accepted'
  | 'error'
  // Legacy mobile-only event types (referenced by App.tsx UI layer)
  | 'snapshot.updated'
  | 'thread.updated'
  | 'run.updated'
  | 'approval.updated'
  | 'presence.updated';

export interface HubWsEvent<TPayload = unknown> {
  type: HubWsEventType;
  seq_id?: number;
  payload: TPayload;
}

export interface HubWsUrlOptions {
  since?: string;
  token?: string;
}

// ── Mobile Hub client ──

type AccessTokenProvider = () => Promise<string | null | undefined> | string | null | undefined;

export interface CreateHubClientOptions {
  baseUrl: string;
  getAccessToken?: AccessTokenProvider;
  fetchImpl?: typeof globalThis.fetch;
}

export interface HubClient {
  // Re-export the shared Hub client for direct access
  readonly shared: SharedHubClient;
  // Legacy mobile snapshot (for fixture/fallback mode)
  getMobileSnapshot: () => Promise<MobileAppFixture>;
  // Auth
  oidcAuthorize: (body: HubOidcAuthorizeRequest) => Promise<HubOidcAuthorizeResponse>;
  oidcCallback: (body: HubOidcCallbackRequest) => Promise<HubOidcCallbackResponse>;
  refresh: (refreshToken: string) => Promise<HubAuthResponse>;
  logout: () => Promise<void>;
  me: () => Promise<HubUserProfile>;
  // Sessions
  listSessions: () => Promise<HubSession[]>;
  searchSessions: (q: string) => Promise<HubSession[]>;
  // Messages
  sendMessage: (sessionId: string, body: { client_msg_id: string; content_type: string; content: string }) => Promise<{ message_id: string; seq_id: number; created_at: string }>;
  getMessages: (sessionId: string, params?: { before_seq?: number; limit?: number }) => Promise<HubMessage[]>;
  syncMessages: (sessionId: string, params?: { after_seq?: number; limit?: number }) => Promise<HubMessage[]>;
  markRead: (sessionId: string, lastReadSeq: number) => Promise<void>;
  // Contacts
  searchUser: (targetUserId: string) => Promise<HubSearchResult>;
  listContacts: () => Promise<HubContactInfo[]>;
  sendFriendRequest: (friendId: string, message?: string) => Promise<void>;
  listFriendRequests: () => Promise<HubFriendRequest[]>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;
  blockContact: (targetUserId: string) => Promise<void>;
  unblockContact: (targetUserId: string) => Promise<void>;
  updateContactRemark: (friendUserId: string, remark: string) => Promise<void>;
  // Custom Agents
  listCustomAgents: () => Promise<HubCustomAgent[]>;
  createCustomAgent: (body: HubCustomAgentRequest) => Promise<HubCustomAgent>;
  // Execution Targets
  listExecutionTargets: () => Promise<HubListResponse<HubExecutionTarget>>;
}

export function createMockHubClient(delayMs = 80): HubClient {
  const shared = createSharedHubClient();

  return {
    shared,
    async getMobileSnapshot() {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
      return mobileFixture;
    },
    oidcAuthorize: () => { throw new Error('Mock: OIDC not available'); },
    oidcCallback: () => { throw new Error('Mock: OIDC not available'); },
    refresh: () => { throw new Error('Mock: refresh not available'); },
    logout: async () => {},
    me: () => { throw new Error('Mock: me not available'); },
    listSessions: async () => [],
    searchSessions: async () => [],
    sendMessage: () => { throw new Error('Mock: sendMessage not available'); },
    getMessages: async () => [],
    syncMessages: async () => [],
    markRead: async () => {},
    searchUser: () => { throw new Error('Mock: searchUser not available'); },
    listContacts: async () => [],
    sendFriendRequest: async () => {},
    listFriendRequests: async () => [],
    acceptFriendRequest: async () => {},
    rejectFriendRequest: async () => {},
    blockContact: async () => {},
    unblockContact: async () => {},
    updateContactRemark: async () => {},
    listCustomAgents: async () => [],
    createCustomAgent: () => { throw new Error('Mock: createCustomAgent not available'); },
    listExecutionTargets: async () => ({ items: [], page: { hasMore: false } }),
  };
}

export function createHubClient(options: CreateHubClientOptions): HubClient {
  // The shared Hub client expects a synchronous getToken().
  // We eagerly resolve the async token and cache it for sync access.
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

  const syncGetToken = (): string | null | undefined => {
    return cachedToken;
  };

  // Kick off token resolution
  tokenPromise = resolveToken().then((t) => {
    cachedToken = t;
    return t;
  });

  const sharedOpts: HubClientOptions = {
    baseUrl: options.baseUrl,
    getToken: syncGetToken,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  };

  const shared = createSharedHubClient(sharedOpts);

  return {
    shared,

    async getMobileSnapshot() {
      // Ensure token is resolved before making API calls
      if (tokenPromise) {
        await tokenPromise;
        tokenPromise = undefined;
      }

      // Build a mobile snapshot from real Hub API data
      const [sessions, contacts] = await Promise.all([
        shared.listSessions().catch(() => [] as HubSession[]),
        shared.listContacts().catch(() => [] as HubContactInfo[]),
      ]);

      return mapSessionsToMobileFixture(sessions, contacts);
    },

    oidcAuthorize: (body) => shared.oidcAuthorize(body),
    oidcCallback: (body) => shared.oidcCallback(body),
    refresh: (refreshToken) => shared.refresh(refreshToken),
    logout: () => shared.logout(),
    me: () => shared.me(),
    listSessions: () => shared.listSessions(),
    searchSessions: (q) => shared.searchSessions(q),
    sendMessage: (sessionId, body) => shared.sendMessage(sessionId, body),
    getMessages: (sessionId, params) => shared.getMessages(sessionId, params),
    syncMessages: (sessionId, params) => shared.syncMessages(sessionId, params),
    markRead: (sessionId, lastReadSeq) => shared.markRead(sessionId, lastReadSeq),
    searchUser: (targetUserId) => shared.searchUser(targetUserId),
    listContacts: () => shared.listContacts(),
    sendFriendRequest: (friendId, message) => shared.sendFriendRequest(friendId, message),
    listFriendRequests: () => shared.listFriendRequests(),
    acceptFriendRequest: (requestId) => shared.acceptFriendRequest(requestId),
    rejectFriendRequest: (requestId) => shared.rejectFriendRequest(requestId),
    blockContact: (targetUserId) => shared.blockContact(targetUserId),
    unblockContact: (targetUserId) => shared.unblockContact(targetUserId),
    updateContactRemark: (friendUserId, remark) => shared.updateContactRemark(friendUserId, remark),
    listCustomAgents: () => shared.listCustomAgents(),
    createCustomAgent: (body) => shared.createCustomAgent(body),
    listExecutionTargets: () => shared.listExecutionTargets(),
  };
}

// ── WebSocket URL builder (aligned with hub-server /client/ws) ──

export function createHubWsUrl(baseUrl: string, options: HubWsUrlOptions = {}): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/client/ws';
  url.search = '';

  if (options.since) {
    url.searchParams.set('since', options.since);
  }

  // Token goes in query for WS auth (server reads from query on upgrade)
  if (options.token) {
    url.searchParams.set('token', options.token);
  }

  return url.toString();
}

// ── Session → Mobile fixture mapping ──

function mapSessionsToMobileFixture(
  sessions: HubSession[],
  _contacts: HubContactInfo[],
): MobileAppFixture {
  return {
    threads: sessions.map((session) => ({
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
    account: {
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'granted',
      hubSync: 'active',
      deviceLabel: 'AgentHub Mobile',
    },
  };
}

function extractInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] ?? '') + (parts[1]![0] ?? '');
  }
  return name.slice(0, 2).toUpperCase();
}
