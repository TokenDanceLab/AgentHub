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
  type HubMessage,
  type HubSearchResult,
  type HubFriendRequest,
  type HubContactInfo,
  type HubCustomAgent,
  type HubCustomAgentRequest,
  type HubExecutionTarget,
  type HubListResponse,
  type HubRegisterRequest,
  type HubLoginRequest,
  type HubUpdateProfileRequest,
  type HubChangePasswordRequest,
  type HubRegisterDeviceRequest,
  type HubDevice,
  type HubAddAgentToSessionRequest,
  type HubAgentTask,
  type HubTriggerAgentTaskOptions,
  type HubNotification,
  type HubCreatePrivateSessionRequest,
  type HubCreateGroupSessionRequest,
  type HubCreateSessionResponse,
  type HubUpdateSessionInfoRequest,
  type HubUpdateSessionSettingsRequest,
  type HubSession,
  type HubAuditEvent,
  type HubExecutionTargetRequest,
  type HubRelayCommand,
  type HubRelayCommandRequest,
  type HubSkill,
  type HubMCPServer,
} from '@agenthub/shared/hubClient';

import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';

// ── Local types for Hub methods not yet in shared hubClient ──

export interface HubAgentRunEvent {
  id: string;
  task_id: string;
  edge_run_id?: string;
  session_id: string;
  agent_instance_id: string;
  event_seq: number;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface HubAgentRunEventSummary {
  task_id: string;
  edge_run_id?: string;
  status: string;
  total_events: number;
  last_event_seq: number;
  event_type_counts: Record<string, number>;
  tool_call_count: number;
  step_count: number;
  artifact_count: number;
  approval_count: number;
  pending_approvals: number;
  decided_approvals: number;
  input_tokens: number;
  output_tokens: number;
  output_bytes: number;
  started_at?: string;
  finished_at?: string;
  elapsed_ms?: number;
}

export interface HubAgentTaskApproval {
  approval_id: string;
  task_id?: string;
  edge_run_id?: string;
  session_id?: string;
  source_event_id?: string;
  event_seq?: number;
  request_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  status?: string;
  reason?: string;
  decided_by?: string;
  created_at?: string;
  decided_at?: string;
  edge_control?: Record<string, unknown>;
}

export interface HubAgentTaskApprovalList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  approvals: HubAgentTaskApproval[];
  pending?: HubAgentTaskApproval[];
  decided?: HubAgentTaskApproval[];
  last_event_seq?: number;
}

export interface HubAgentTaskArtifactList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  artifacts: Record<string, unknown>[];
  last_event_seq?: number;
}

export interface HubTaskApprovalDecisionRequest {
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface HubAttachmentRef {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id?: string;
  metadata?: string;
  created_at?: string;
}

export interface HubProbeAttachmentResponse {
  exists: boolean;
  attachment?: HubAttachmentRef;
}

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
  // Aligned with app/shared/src/hubEvents.ts HUB_EVENTS constants.
  | 'auth'
  | 'auth.ok'
  | 'auth.fail'
  | 'message.new'
  | 'message.recall'
  | 'message.pin'
  | 'message.unpin'
  | 'message.read'
  | 'session.created'
  | 'session.dissolved'
  | 'session.member_joined'
  | 'session.member_left'
  | 'session.info_updated'
  | 'device.online'
  | 'device.offline'
  | 'device.kicked'
  | 'agent.dispatch'
  | 'agent.stream'
  | 'agent.done'
  | 'agent.failed'
  | 'agent.cancel'
  | 'agent.control'
  | 'agent.regenerate'
  | 'notification.new'
  | 'friend.request'
  | 'friend.accepted'
  | 'sync.request'
  | 'sync.events'
  | 'run.agent.plan_proposed'
  | 'run.agent.plan_approved'
  | 'run.agent.plan_rejected'
  | 'run.agent.plan_expired'
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
  register: (body: HubRegisterRequest) => Promise<{ user_id: string }>;
  login: (body: HubLoginRequest) => Promise<HubAuthResponse>;
  refresh: (refreshToken: string) => Promise<HubAuthResponse>;
  logout: () => Promise<void>;
  me: () => Promise<HubUserProfile>;
  updateProfile: (body: HubUpdateProfileRequest) => Promise<HubUserProfile>;
  changePassword: (body: HubChangePasswordRequest) => Promise<void>;
  // Sessions
  listSessions: () => Promise<HubSession[]>;
  searchSessions: (q: string) => Promise<HubSession[]>;
  createPrivateSession: (body: HubCreatePrivateSessionRequest) => Promise<HubSession>;
  createGroupSession: (body: HubCreateGroupSessionRequest) => Promise<HubSession>;
  addSessionMembers: (sessionId: string, memberIds: string[]) => Promise<void>;
  removeSessionMember: (sessionId: string, userId: string) => Promise<void>;
  leaveSession: (sessionId: string) => Promise<void>;
  dissolveSession: (sessionId: string) => Promise<void>;
  updateSessionInfo: (sessionId: string, body: HubUpdateSessionInfoRequest) => Promise<void>;
  updateSessionSettings: (sessionId: string, body: HubUpdateSessionSettingsRequest) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  // Messages
  sendMessage: (sessionId: string, body: { client_msg_id: string; content_type: string; content: string }) => Promise<{ message_id: string; seq_id: number; created_at: string }>;
  getMessages: (sessionId: string, params?: { before_seq?: number; limit?: number }) => Promise<HubMessage[]>;
  syncMessages: (sessionId: string, params?: { after_seq?: number; limit?: number }) => Promise<HubMessage[]>;
  markRead: (sessionId: string, lastReadSeq: number) => Promise<void>;
  recallMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, body: { content: string }) => Promise<HubMessage>;
  pinMessage: (messageId: string, sessionId: string) => Promise<void>;
  unpinMessage: (messageId: string, sessionId: string) => Promise<void>;
  forwardMessage: (messageId: string, targetSessionIds: string[]) => Promise<void>;
  listPinnedMessages: (sessionId: string) => Promise<HubMessage[]>;
  searchMessages: (params: { q: string; session_id?: string; content_type?: string; from?: string; to?: string }) => Promise<HubMessage[]>;
  searchSessionMessages: (sessionId: string, params: { q: string; content_type?: string; from?: string; to?: string }) => Promise<HubMessage[]>;
  // Message reactions
  addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) => Promise<void>;
  removeMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) => Promise<void>;
  listMessageReactions: (messageId: string, sessionId: string) => Promise<Record<string, unknown>[]>;
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
  removeContact: (friendUserId: string) => Promise<void>;
  // Notifications
  listNotifications: (params?: { unread_only?: boolean; limit?: number; offset?: number }) => Promise<HubNotification[]>;
  markNotificationRead: (id: string) => Promise<void>;
  readAllNotifications: () => Promise<void>;
  // Devices
  registerDevice: (body: HubRegisterDeviceRequest) => Promise<HubDevice>;
  // Custom Agents
  listCustomAgents: () => Promise<HubCustomAgent[]>;
  createCustomAgent: (body: HubCustomAgentRequest) => Promise<HubCustomAgent>;
  updateCustomAgent: (id: string, body: HubCustomAgentRequest) => Promise<void>;
  deleteCustomAgent: (id: string) => Promise<void>;
  // Agent tasks
  addAgentToSession: (sessionId: string, body: HubAddAgentToSessionRequest) => Promise<void>;
  triggerAgentTask: (triggerMessageId: string, options?: HubTriggerAgentTaskOptions) => Promise<HubAgentTask>;
  cancelAgentTask: (taskId: string) => Promise<void>;
  regenerateAgentTask: (taskId: string) => Promise<HubAgentTask>;
  listTaskRunEvents: (taskId: string) => Promise<HubAgentRunEvent[]>;
  listTaskRunEventsAfter: (taskId: string, afterSeq: number) => Promise<HubAgentRunEvent[]>;
  getTaskRunEventSummary: (taskId: string) => Promise<HubAgentRunEventSummary>;
  listTaskApprovals: (taskId: string) => Promise<HubAgentTaskApprovalList>;
  decideTaskApproval: (taskId: string, approvalId: string, decision: HubTaskApprovalDecisionRequest) => Promise<HubAgentTaskApproval>;
  listTaskArtifacts: (taskId: string) => Promise<HubAgentTaskArtifactList>;
  // Execution Targets
  listExecutionTargets: () => Promise<HubListResponse<HubExecutionTarget>>;
  // Skills & MCP
  listPublicSkills: (params?: { skill_type?: string; q?: string; is_public?: string; pageCursor?: string; pageSize?: number }) => Promise<HubListResponse<HubSkill>>;
  listPublicMCPServers: (params?: { transport?: string; q?: string; is_public?: string; pageCursor?: string; pageSize?: number }) => Promise<HubListResponse<HubMCPServer>>;
  // Edge task lifecycle
  ackTask: (taskId: string, runId?: string) => Promise<void>;
  streamTask: (taskId: string, content: string, runId?: string) => Promise<void>;
  doneTask: (taskId: string, finalContent?: string, runId?: string) => Promise<void>;
  failTask: (taskId: string, error: string, runId?: string) => Promise<void>;
  // Attachments
  probeAttachment: (hash: string) => Promise<HubProbeAttachmentResponse>;
  downloadAttachmentUrl: (attachmentId: string) => string;
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
    register: () => { throw new Error('Mock: register not available'); },
    login: () => { throw new Error('Mock: login not available'); },
    refresh: () => { throw new Error('Mock: refresh not available'); },
    logout: async () => {},
    me: () => { throw new Error('Mock: me not available'); },
    updateProfile: () => { throw new Error('Mock: updateProfile not available'); },
    changePassword: async () => {},
    listSessions: async () => [],
    searchSessions: async () => [],
    createPrivateSession: () => { throw new Error('Mock: createPrivateSession not available'); },
    createGroupSession: () => { throw new Error('Mock: createGroupSession not available'); },
    addSessionMembers: async () => {},
    removeSessionMember: async () => {},
    leaveSession: async () => {},
    dissolveSession: async () => {},
    updateSessionInfo: async () => {},
    updateSessionSettings: async () => {},
    deleteSession: async () => {},
    sendMessage: () => { throw new Error('Mock: sendMessage not available'); },
    getMessages: async () => [],
    syncMessages: async () => [],
    markRead: async () => {},
    recallMessage: async () => {},
    editMessage: () => { throw new Error('Mock: editMessage not available'); },
    pinMessage: async () => {},
    unpinMessage: async () => {},
    forwardMessage: async () => {},
    listPinnedMessages: async () => [],
    searchMessages: async () => [],
    searchSessionMessages: async () => [],
    addMessageReaction: async () => {},
    removeMessageReaction: async () => {},
    listMessageReactions: async () => [],
    searchUser: () => { throw new Error('Mock: searchUser not available'); },
    listContacts: async () => [],
    sendFriendRequest: async () => {},
    listFriendRequests: async () => [],
    acceptFriendRequest: async () => {},
    rejectFriendRequest: async () => {},
    blockContact: async () => {},
    unblockContact: async () => {},
    updateContactRemark: async () => {},
    removeContact: async () => {},
    listNotifications: async () => [],
    markNotificationRead: async () => {},
    readAllNotifications: async () => {},
    registerDevice: () => { throw new Error('Mock: registerDevice not available'); },
    listCustomAgents: async () => [],
    createCustomAgent: () => { throw new Error('Mock: createCustomAgent not available'); },
    updateCustomAgent: async () => {},
    deleteCustomAgent: async () => {},
    addAgentToSession: async () => {},
    triggerAgentTask: () => { throw new Error('Mock: triggerAgentTask not available'); },
    cancelAgentTask: async () => {},
    regenerateAgentTask: () => { throw new Error('Mock: regenerateAgentTask not available'); },
    listTaskRunEvents: async () => [],
    listTaskRunEventsAfter: async () => [],
    getTaskRunEventSummary: () => { throw new Error('Mock: getTaskRunEventSummary not available'); },
    listTaskApprovals: async () => ({ approvals: [], task_id: '' }),
    decideTaskApproval: () => { throw new Error('Mock: decideTaskApproval not available'); },
    listTaskArtifacts: async () => ({ artifacts: [], task_id: '' }),
    listExecutionTargets: async () => ({ items: [], page: { hasMore: false } }),
    ackTask: async () => {},
    streamTask: async () => {},
    doneTask: async () => {},
    failTask: async () => {},
    probeAttachment: async () => ({ exists: false }),
    downloadAttachmentUrl: (attachmentId: string) => `/mock/attachments/${attachmentId}`,
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

  // Helper for building query strings
  function qs(params: Record<string, string | number | boolean | undefined | null>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

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
    register: (body) => shared.register(body),
    login: (body) => shared.login(body),
    refresh: (refreshToken) => shared.refresh(refreshToken),
    logout: () => shared.logout(),
    me: () => shared.me(),
    updateProfile: (body) => shared.updateProfile(body),
    changePassword: (body) => shared.changePassword(body),
    listSessions: () => shared.listSessions(),
    searchSessions: (q) => shared.searchSessions(q),
    createPrivateSession: (body) => shared.createPrivateSession(body),
    createGroupSession: (body) => shared.createGroupSession(body),
    addSessionMembers: (sessionId, memberIds) => shared.addSessionMembers(sessionId, memberIds),
    removeSessionMember: (sessionId, userId) => shared.removeSessionMember(sessionId, userId),
    leaveSession: (sessionId) => shared.leaveSession(sessionId),
    dissolveSession: (sessionId) => shared.dissolveSession(sessionId),
    updateSessionInfo: (sessionId, body) => shared.updateSessionInfo(sessionId, body),
    updateSessionSettings: (sessionId, body) => shared.updateSessionSettings(sessionId, body),
    deleteSession: (sessionId) => shared.deleteSession(sessionId),
    sendMessage: (sessionId, body) => shared.sendMessage(sessionId, body),
    getMessages: (sessionId, params) => shared.getMessages(sessionId, params),
    syncMessages: (sessionId, params) => shared.syncMessages(sessionId, params),
    markRead: (sessionId, lastReadSeq) => shared.markRead(sessionId, lastReadSeq),
    recallMessage: (messageId) => shared.recallMessage(messageId),
    editMessage: (messageId, body) =>
      shared.request<HubMessage>(`/client/messages/${encodeURIComponent(messageId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    pinMessage: (messageId, sessionId) => shared.pinMessage(messageId, sessionId),
    unpinMessage: (messageId, sessionId) => shared.unpinMessage(messageId, sessionId),
    forwardMessage: (messageId, targetSessionIds) => shared.forwardMessage(messageId, targetSessionIds),
    listPinnedMessages: (sessionId) => shared.listPinnedMessages(sessionId),
    searchMessages: (params) => shared.searchMessages(params),
    searchSessionMessages: (sessionId, params) => shared.searchSessionMessages(sessionId, params),
    addMessageReaction: (messageId, sessionId, reaction) =>
      shared.request<void>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),
    removeMessageReaction: (messageId, sessionId, reaction) =>
      shared.request<void>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),
    listMessageReactions: (messageId, sessionId) =>
      shared.request<Record<string, unknown>[]>(`/client/messages/${encodeURIComponent(messageId)}/reactions?session_id=${encodeURIComponent(sessionId)}`),
    searchUser: (targetUserId) => shared.searchUser(targetUserId),
    listContacts: () => shared.listContacts(),
    sendFriendRequest: (friendId, message) => shared.sendFriendRequest(friendId, message),
    listFriendRequests: () => shared.listFriendRequests(),
    acceptFriendRequest: (requestId) => shared.acceptFriendRequest(requestId),
    rejectFriendRequest: (requestId) => shared.rejectFriendRequest(requestId),
    blockContact: (targetUserId) => shared.blockContact(targetUserId),
    unblockContact: (targetUserId) => shared.unblockContact(targetUserId),
    updateContactRemark: (friendUserId, remark) => shared.updateContactRemark(friendUserId, remark),
    removeContact: (friendUserId) => shared.removeContact(friendUserId),
    listNotifications: (params) => shared.listNotifications(params),
    markNotificationRead: (id) => shared.markNotificationRead(id),
    readAllNotifications: () => shared.readAllNotifications(),
    registerDevice: (body) => shared.registerDevice(body),
    listCustomAgents: () => shared.listCustomAgents(),
    createCustomAgent: (body) => shared.createCustomAgent(body),
    updateCustomAgent: (id, body) => shared.updateCustomAgent(id, body),
    deleteCustomAgent: (id) => shared.deleteCustomAgent(id),
    addAgentToSession: (sessionId, body) => shared.addAgentToSession(sessionId, body),
    triggerAgentTask: (triggerMessageId, options) => shared.triggerAgentTask(triggerMessageId, options),
    cancelAgentTask: (taskId) => shared.cancelAgentTask(taskId),
    regenerateAgentTask: (taskId) => shared.regenerateAgentTask(taskId),
    listTaskRunEvents: (taskId) =>
      shared.request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),
    listTaskRunEventsAfter: (taskId, afterSeq) =>
      shared.request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`),
    getTaskRunEventSummary: (taskId) =>
      shared.request<HubAgentRunEventSummary>(`/web/agent-tasks/${encodeURIComponent(taskId)}/summary`),
    listTaskApprovals: (taskId) =>
      shared.request<HubAgentTaskApprovalList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals`),
    decideTaskApproval: (taskId, approvalId, decision) =>
      shared.request<HubAgentTaskApproval>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}/decide`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),
    listTaskArtifacts: (taskId) =>
      shared.request<HubAgentTaskArtifactList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/artifacts`),
    listExecutionTargets: () => shared.listExecutionTargets(),
    ackTask: (taskId, runId) => shared.ackTask(taskId, runId),
    streamTask: (taskId, content, runId) => shared.streamTask(taskId, content, runId),
    doneTask: (taskId, finalContent, runId) => shared.doneTask(taskId, finalContent, runId),
    failTask: (taskId, error, runId) => shared.failTask(taskId, error, runId),
    probeAttachment: (hash) =>
      shared.request<HubProbeAttachmentResponse>('/client/attachments/probe', {
        method: 'POST',
        body: JSON.stringify({ hash }),
      }),
    downloadAttachmentUrl: (attachmentId) =>
      `${options.baseUrl.replace(/\/+$/, '')}/client/attachments/${encodeURIComponent(attachmentId)}`,
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
