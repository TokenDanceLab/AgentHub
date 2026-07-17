import { AppError, reportApiError } from './errors';
import type {
  HubAgentRunEventSummary,
  HubAgentRunEvent,
  HubCoordinatorRouteDecision,
  HubAgentTeam,
  HubAgentTeamMember,
  HubAgentTeamDetail,
  HubAgentTeamRun,
  HubAgentTeamAssignment,
  HubAgentTeamTask,
  HubAgentTeamEvent,
  HubTeamMemberState,
  HubTeamTaskState,
  HubTeamAssignmentState,
  HubTeamApprovalState,
  HubTeamArtifactState,
  HubTeamConflictState,
  HubTeamRunEventState,
  HubTeamBudget,
  HubTeamRunState,
  HubTeamApprovalDecisionRequest,
  HubTeamConflictResolutionRequest,
  HubCreateAgentTeamRequest,
  HubUpdateAgentTeamRequest,
  HubAddAgentTeamMemberRequest,
  HubStartAgentTeamRunRequest,
  HubAttachmentRef,
  HubProbeAttachmentResponse,
  HubAgentProfile,
  HubAgentProfileListResponse,
  HubCreateAgentProfileRequest,
  HubUpdateAgentProfileRequest,
  AgentRunEventSummary,
  AgentRunEvent,
  CoordinatorRouteDecision,
  AgentTeam,
  AgentTeamMember,
  AgentTeamDetail,
  AgentTeamRun,
  AgentTeamAssignment,
  AgentTeamTask,
  AgentTeamEvent,
  TeamMemberState,
  TeamTaskState,
  TeamAssignmentState,
  TeamApprovalState,
  TeamArtifactState,
  TeamConflictState,
  TeamRunEventState,
  TeamBudget,
  TeamRunState,
  TeamApprovalDecisionRequest,
  TeamConflictResolutionRequest,
  CreateAgentTeamRequest,
  UpdateAgentTeamRequest,
  AddAgentTeamMemberRequest,
  StartAgentTeamRunRequest,
  AttachmentRef,
  ProbeAttachmentResponse,
  AgentProfile,
  AgentProfileListResponse,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
  HubDocumentListItem,
  HubDocumentListResponse,
  HubCreateDocumentRequest,
  HubUpdateDocumentRequest,
  HubDocument,
  HubAgentTaskStreamEventOptions,
  CreateHubDocumentRequest,
  UpdateHubDocumentRequest,
  AgentTaskStreamEventOptions,
  HubAgentTaskApproval,
  HubAgentTaskApprovalList,
  HubAgentTaskArtifact,
  HubAgentTaskArtifactList,
  HubTaskApprovalDecisionRequest,
  AgentTaskApproval,
  AgentTaskApprovalList,
  AgentTaskArtifact,
  AgentTaskArtifactList,
  TaskApprovalDecisionRequest,
  HubAgentInstance,
  HubPendingAgentTask,
  AgentInstance,
  PendingAgentTask,
} from './hubClientTeamTypes';

import type {
  HubResponseEnvelope,
  HubEnvelope,
  HubClientOptions,
  HubRegisterRequest,
  HubLoginRequest,
  HubAuthResponse,
  HubUserProfile,
  HubUpdateProfileRequest,
  HubChangePasswordRequest,
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubContactType,
  HubRelationship,
  HubSearchResult,
  HubFriendRequest,
  HubContactInfo,
  HubSessionType,
  HubSessionRole,
  HubSession,
  HubSessionMember,
  HubCreatePrivateSessionRequest,
  HubCreateGroupSessionRequest,
  HubCreateSessionResponse,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubSenderType,
  HubContentType,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubReplyToInfo,
  HubMessageAttachment,
  HubMessage,
  HubRegisterDeviceRequest,
  HubDevice,
  HubAddAgentToSessionRequest,
  HubCustomAgentRequest,
  HubCustomAgent,
  HubSkill,
  HubMCPServer,
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubCreateWorkspaceProjectRequest,
  HubUpdateWorkspaceProjectRequest,
  HubWorkspaceProjectThread,
  HubCreateWorkspaceProjectThreadRequest,
  HubSendWorkspaceProjectThreadMessageRequest,
  HubWorkspaceProjectThreadMessage,
  HubAgentTaskStatus,
  HubAgentTask,
  HubTriggerAgentTaskRequest,
  HubTriggerAgentTaskOptions,
  HubTaskRunRequest,
  HubTaskAckRequest,
  HubTaskStreamRequest,
  HubTaskDoneRequest,
  HubTaskFailRequest,
  HubNotification,
  HubPageInfo,
  HubListResponse,
  HubExecutionTargetType,
  HubExecutionTarget,
  HubExecutionTargetRequest,
  HubExecutionTargetListResponse,
  HubAuditEvent,
  HubRelayCommandRequest,
  HubRelayCommand,
} from './hubClientDomainTypes';

import {
  parseHubError,
  readJson,
  unwrapHubResponse,
} from './hubClientEnvelope';
import {
  isRouteFallbackError,
  normalizeRegisterDeviceRequest,
  qs,
} from './hubClientRequestUtils';

// ── Envelope / error runtime (extracted #799) ──
export {
  HubError,
  isHubResponseEnvelope,
  isHubSuccessCode,
  parseHubError,
  unwrapHubResponse,
} from './hubClientEnvelope';

// ── WS frame payload / typed frame DTOs (extracted #788) ──
export type {
  HubDevicePresencePayload,
  HubDeviceKickedPayload,
  HubAgentDispatchPayload,
  HubAgentStreamPayload,
  HubAgentDonePayload,
  HubAgentFailedPayload,
  HubAgentCancelPayload,
  HubAgentRegeneratePayload,
  HubFriendEventPayload,
  HubFrame,
  HubAuthFrame,
  HubAuthOkFrame,
  HubAuthFailFrame,
  HubMessageNewFrame,
  HubMessageRecallFrame,
  HubMessageReadFrame,
  HubSessionCreatedFrame,
  HubSessionInfoUpdatedFrame,
  HubSessionDissolvedFrame,
  HubAgentDispatchFrame,
  HubAgentStreamFrame,
  HubAgentDoneFrame,
  HubAgentFailedFrame,
  HubAgentCancelFrame,
  HubAgentRegenerateFrame,
  HubDeviceOnlineFrame,
  HubDeviceOfflineFrame,
  HubDeviceKickedFrame,
  HubNotificationNewFrame,
  HubFriendRequestFrame,
  HubFriendAcceptedFrame,
  HubMessageEditedPayload,
  HubMessageEditedFrame,
  HubMessagePinPayload,
  HubMessagePinFrame,
  HubMessageUnpinPayload,
  HubMessageUnpinFrame,
  HubMessageReactionPayload,
  HubMessageReactionAddedFrame,
  HubMessageReactionRemovedFrame,
  HubSessionMemberEventPayload,
  HubSessionMemberJoinedFrame,
  HubSessionMemberLeftFrame,
  HubKnownFrame,
} from './hubClientFrameTypes';

// ── Team / profile / document / task-approval DTOs (extracted #767) ──
export type {
  HubAgentRunEventSummary,
  HubAgentRunEvent,
  HubCoordinatorRouteDecision,
  HubAgentTeam,
  HubAgentTeamMember,
  HubAgentTeamDetail,
  HubAgentTeamRun,
  HubAgentTeamAssignment,
  HubAgentTeamTask,
  HubAgentTeamEvent,
  HubTeamMemberState,
  HubTeamTaskState,
  HubTeamAssignmentState,
  HubTeamApprovalState,
  HubTeamArtifactState,
  HubTeamConflictState,
  HubTeamRunEventState,
  HubTeamBudget,
  HubTeamRunState,
  HubTeamApprovalDecisionRequest,
  HubTeamConflictResolutionRequest,
  HubCreateAgentTeamRequest,
  HubUpdateAgentTeamRequest,
  HubAddAgentTeamMemberRequest,
  HubStartAgentTeamRunRequest,
  HubAttachmentRef,
  HubProbeAttachmentResponse,
  HubAgentProfile,
  HubAgentProfileListResponse,
  HubCreateAgentProfileRequest,
  HubUpdateAgentProfileRequest,
  AgentRunEventSummary,
  AgentRunEvent,
  CoordinatorRouteDecision,
  AgentTeam,
  AgentTeamMember,
  AgentTeamDetail,
  AgentTeamRun,
  AgentTeamAssignment,
  AgentTeamTask,
  AgentTeamEvent,
  TeamMemberState,
  TeamTaskState,
  TeamAssignmentState,
  TeamApprovalState,
  TeamArtifactState,
  TeamConflictState,
  TeamRunEventState,
  TeamBudget,
  TeamRunState,
  TeamApprovalDecisionRequest,
  TeamConflictResolutionRequest,
  CreateAgentTeamRequest,
  UpdateAgentTeamRequest,
  AddAgentTeamMemberRequest,
  StartAgentTeamRunRequest,
  AttachmentRef,
  ProbeAttachmentResponse,
  AgentProfile,
  AgentProfileListResponse,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
  HubDocumentListItem,
  HubDocumentListResponse,
  HubCreateDocumentRequest,
  HubUpdateDocumentRequest,
  HubDocument,
  HubAgentTaskStreamEventOptions,
  CreateHubDocumentRequest,
  UpdateHubDocumentRequest,
  AgentTaskStreamEventOptions,
  HubAgentTaskApproval,
  HubAgentTaskApprovalList,
  HubAgentTaskArtifact,
  HubAgentTaskArtifactList,
  HubTaskApprovalDecisionRequest,
  AgentTaskApproval,
  AgentTaskApprovalList,
  AgentTaskArtifact,
  AgentTaskArtifactList,
  TaskApprovalDecisionRequest,
  HubAgentInstance,
  HubPendingAgentTask,
  AgentInstance,
  PendingAgentTask,
};

// ── Core domain DTOs (extracted #777) ──
export type {
  HubResponseEnvelope,
  HubEnvelope,
  HubClientOptions,
  HubRegisterRequest,
  HubLoginRequest,
  HubAuthResponse,
  HubUserProfile,
  HubUpdateProfileRequest,
  HubChangePasswordRequest,
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubContactType,
  HubRelationship,
  HubSearchResult,
  HubFriendRequest,
  HubContactInfo,
  HubSessionType,
  HubSessionRole,
  HubSession,
  HubSessionMember,
  HubCreatePrivateSessionRequest,
  HubCreateGroupSessionRequest,
  HubCreateSessionResponse,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubSenderType,
  HubContentType,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubReplyToInfo,
  HubMessageAttachment,
  HubMessage,
  HubRegisterDeviceRequest,
  HubDevice,
  HubAddAgentToSessionRequest,
  HubCustomAgentRequest,
  HubCustomAgent,
  HubSkill,
  HubMCPServer,
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubCreateWorkspaceProjectRequest,
  HubUpdateWorkspaceProjectRequest,
  HubWorkspaceProjectThread,
  HubCreateWorkspaceProjectThreadRequest,
  HubSendWorkspaceProjectThreadMessageRequest,
  HubWorkspaceProjectThreadMessage,
  HubAgentTaskStatus,
  HubAgentTask,
  HubTriggerAgentTaskRequest,
  HubTriggerAgentTaskOptions,
  HubTaskRunRequest,
  HubTaskAckRequest,
  HubTaskStreamRequest,
  HubTaskDoneRequest,
  HubTaskFailRequest,
  HubNotification,
  HubPageInfo,
  HubListResponse,
  HubExecutionTargetType,
  HubExecutionTarget,
  HubExecutionTargetRequest,
  HubExecutionTargetListResponse,
  HubAuditEvent,
  HubRelayCommandRequest,
  HubRelayCommand,
};



export function createHubClient(opts: HubClientOptions = {}) {
  const baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl = opts.fetch;

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = opts.getToken?.();
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const timeoutMs = opts.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    try {
      const response = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal,
      });
      clearTimeout(timeoutId);

      // ── Token refresh recovery on 401 ──────────────────
      if (response.status === 401 && opts.onRefreshToken) {
        try {
          const newToken = await opts.onRefreshToken();
          if (newToken) {
            // Retry once with fresh token
            headers.set('Authorization', `Bearer ${newToken}`);
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
            try {
              const retryResponse = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
                ...options,
                headers,
                signal: retryController.signal,
              });
              clearTimeout(retryTimeoutId);
              if (!retryResponse.ok) {
                throw await parseHubError(retryResponse);
              }
              if (retryResponse.status === 204) {
                return undefined as T;
              }
              return unwrapHubResponse<T>(await readJson(retryResponse), retryResponse.status);
            } catch (retryErr) {
              clearTimeout(retryTimeoutId);
              throw retryErr;
            }
          }
        } catch (refreshErr) {
          console.error('[HubClient] Token refresh failed', refreshErr);
          reportApiError(refreshErr instanceof Error ? refreshErr : new Error(String(refreshErr)), {
            path,
            context: 'token_refresh',
          });
        }
      }

      if (!response.ok) {
        throw await parseHubError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }

      return unwrapHubResponse<T>(await readJson(response), response.status);
    } catch (error) {
      clearTimeout(timeoutId);

      // Surface timeout as a distinct error
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new AppError(
          {
            error: {
              code: 'TIMEOUT',
              message: `Request timed out after ${timeoutMs}ms: ${options.method ?? 'GET'} ${path}`,
            },
          },
          0,
        );
        console.error(`[HubClient] ${timeoutError.message}`);
        reportApiError(timeoutError, { path, method: options.method ?? 'GET', timeoutMs });
        throw timeoutError;
      }

      // Report all other errors
      if (error instanceof AppError) {
        reportApiError(error, { path, method: options.method ?? 'GET' });
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        const netError = new AppError(
          {
            error: {
              code: 'NETWORK_ERROR',
              message: `Network request failed: ${error.message}`,
            },
          },
          0,
        );
        console.error(`[HubClient] ${netError.message}`);
        reportApiError(netError, { path, method: options.method ?? 'GET' });
        throw netError;
      }
      throw error;
    }
  }

  async function requestWithFallback<T>(
    paths: readonly string[],
    options: RequestInit = {},
  ): Promise<T> {
    let fallbackError: unknown;

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index]!;
      try {
        return await request<T>(path, options);
      } catch (error) {
        if (index < paths.length - 1 && isRouteFallbackError(error)) {
          fallbackError = error;
          continue;
        }
        throw error;
      }
    }

    throw fallbackError;
  }


  async function uploadMultipart<T>(path: string, formData: FormData): Promise<T> {
    const token = opts.getToken?.();
    const headers = new Headers();
    // Let the runtime set multipart boundary; do not force JSON content-type.
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw await parseHubError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return unwrapHubResponse<T>(await readJson(response), response.status);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }


  return {
    request,

    register: (body: HubRegisterRequest) =>
      request<{ user_id: string }>('/client/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    login: (body: HubLoginRequest) =>
      request<HubAuthResponse>('/client/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refresh: (refreshToken: string) =>
      request<HubAuthResponse>('/client/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }),
    logout: () => request<void>('/client/auth/logout', { method: 'POST' }),
    me: () => request<HubUserProfile>('/client/auth/me'),
    updateProfile: (body: HubUpdateProfileRequest) =>
      request<HubUserProfile>('/client/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    changePassword: async (body: HubChangePasswordRequest) => {
      const payload = JSON.stringify(body);
      try {
        return await request<void>('/client/auth/change-password', {
          method: 'POST',
          body: payload,
        });
      } catch (error) {
        if (isRouteFallbackError(error)) {
          return request<void>('/client/auth/password', {
            method: 'PUT',
            body: payload,
          });
        }
        throw error;
      }
    },
    oidcAuthorize: (body: HubOidcAuthorizeRequest) =>
      request<HubOidcAuthorizeResponse>('/client/auth/oidc/authorize', {
        method: 'POST',
        body: JSON.stringify({
          code_challenge_method: 'S256',
          ...body,
        }),
      }),
    oidcCallback: (body: HubOidcCallbackRequest) =>
      request<HubOidcCallbackResponse>('/client/auth/oidc/callback', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    searchUser: (targetUserId: string) =>
      request<HubSearchResult>(
        `/client/contacts/search?id=${encodeURIComponent(targetUserId)}`,
      ),
    listContacts: () => request<HubContactInfo[]>('/client/contacts'),
    sendFriendRequest: (friendId: string, message?: string) =>
      request<void>('/client/contacts/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId, message }),
      }),
    listFriendRequests: () =>
      request<HubFriendRequest[]>('/client/contacts/friend-requests'),
    acceptFriendRequest: (requestId: string) =>
      request<void>(
        `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/accept`,
        { method: 'POST' },
      ),
    rejectFriendRequest: (requestId: string) =>
      request<void>(
        `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/reject`,
        { method: 'POST' },
      ),
    removeContact: (friendUserId: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(friendUserId)}`, {
        method: 'DELETE',
      }),
    blockContact: (targetUserId: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(targetUserId)}/block`,
        { method: 'POST' },
      ),
    unblockContact: (targetUserId: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(targetUserId)}/unblock`,
        { method: 'POST' },
      ),
    updateContactRemark: (friendUserId: string, remark: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(friendUserId)}/remark`,
        {
          method: 'PUT',
          body: JSON.stringify({ remark }),
        },
      ),

    listSessions: () => request<HubSession[]>('/client/sessions'),
    searchSessions: (q: string) =>
      request<HubSession[]>(
        `/client/sessions/search?q=${encodeURIComponent(q)}`,
      ),
    createPrivateSession: (body: HubCreatePrivateSessionRequest) =>
      request<HubCreateSessionResponse>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createGroupSession: (body: HubCreateGroupSessionRequest) =>
      request<HubCreateSessionResponse>('/client/sessions/group', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: memberIds }),
      }),
    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      ),
    leaveSession: (sessionId: string) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/leave`, {
        method: 'POST',
      }),
    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/transfer-owner`,
        {
          method: 'POST',
          body: JSON.stringify({ new_owner_id: newOwnerId }),
        },
      ),
    dissolveSession: (sessionId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/dissolve`,
        { method: 'POST' },
      ),
    updateSessionInfo: (
      sessionId: string,
      body: HubUpdateSessionInfoRequest,
    ) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/info`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    updateSessionSettings: (
      sessionId: string,
      body: HubUpdateSessionSettingsRequest,
    ) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/settings`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      ),
    deleteSession: (sessionId: string) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      }),

    sendMessage: (sessionId: string, body: HubSendMessageRequest) =>
      request<HubSendMessageResponse>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    getMessages: (
      sessionId: string,
      params?: { before_seq?: number; limit?: number },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages${qs(params ?? {})}`,
      ),
    syncMessages: (
      sessionId: string,
      params?: { after_seq?: number; limit?: number },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages/sync${qs(params ?? {})}`,
      ),
    markRead: (sessionId: string, lastReadSeq: number) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/read`, {
        method: 'POST',
        body: JSON.stringify({ last_read_seq: lastReadSeq }),
      }),
    recallMessage: (messageId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/recall`, {
        method: 'POST',
      }),
    pinMessage: (messageId: string, sessionId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      }),
    unpinMessage: (messageId: string, sessionId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId }),
      }),
    forwardMessage: (messageId: string, targetSessionIds: string[]) =>
      request<void>(
        `/client/messages/${encodeURIComponent(messageId)}/forward`,
        {
          method: 'POST',
          body: JSON.stringify({ target_session_ids: targetSessionIds }),
        },
      ),
    listPinnedMessages: (sessionId: string) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/pins`,
      ),
    searchMessages: (params: {
      q: string;
      session_id?: string;
      content_type?: string;
      from?: string;
      to?: string;
    }) => request<HubMessage[]>(`/client/messages/search${qs(params)}`),
    searchSessionMessages: (
      sessionId: string,
      params: { q: string; content_type?: string; from?: string; to?: string },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages/search${qs(params)}`,
      ),

    listNotifications: (params?: {
      unread_only?: boolean;
      limit?: number;
      offset?: number;
    }) =>
      request<HubNotification[]>(
        `/client/notifications${qs(params ?? {})}`,
      ),
    markNotificationRead: (id: string) =>
      requestWithFallback<void>(
        [
          `/client/notifications/${encodeURIComponent(id)}:read`,
          `/client/notifications/${encodeURIComponent(id)}/read`,
        ],
        { method: 'POST' },
      ),
    readAllNotifications: () =>
      requestWithFallback<void>(
        ['/client/notifications:read-all', '/client/notifications/read-all'],
        { method: 'POST' },
      ),

    registerDevice: (body: HubRegisterDeviceRequest) =>
      requestWithFallback<HubDevice>(['/edge/devices:register', '/edge/devices/register'], {
        method: 'POST',
        body: JSON.stringify(normalizeRegisterDeviceRequest(body)),
      }),
    ackTask: (taskId: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/ack`, {
        method: 'POST',
        ...(runId ? { body: JSON.stringify({ run_id: runId }) } : {}),
      }),
    streamTask: (taskId: string, content: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({ content, ...(runId ? { run_id: runId } : {}) }),
      }),
    doneTask: (taskId: string, finalContent?: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
        body: JSON.stringify({
          final_content: finalContent ?? '',
          ...(runId ? { run_id: runId } : {}),
        }),
      }),
    failTask: (taskId: string, error: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error, ...(runId ? { run_id: runId } : {}) }),
      }),

    addAgentToSession: (
      sessionId: string,
      body: HubAddAgentToSessionRequest,
    ) =>
      request<HubAgentInstance>(
        `/client/sessions/${encodeURIComponent(sessionId)}/agents`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    triggerAgentTask: (triggerMessageId: string, options: HubTriggerAgentTaskOptions = {}) =>
      request<HubAgentTask>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId, ...options }),
      }),
    cancelAgentTask: (taskId: string) =>
      requestWithFallback<void>(
        [
          `/web/agent-tasks/${encodeURIComponent(taskId)}:cancel`,
          `/web/agent-tasks/${encodeURIComponent(taskId)}/cancel`,
        ],
        { method: 'POST' },
      ),

    regenerateAgentTask: (taskId: string) =>
      request<HubAgentTask>(`/web/agent-tasks/${encodeURIComponent(taskId)}/regenerate`, {
        method: 'POST',
      }),

    listExecutionTargets: async (params?: {
      pageSize?: number;
      pageCursor?: string;
      target_type?: string;
    }) => {
      const data = await request<HubExecutionTarget[] | HubExecutionTargetListResponse>(
        `/web/execution-targets${qs(params ?? {})}`,
      );
      if (Array.isArray(data)) {
        return { items: data, page: { hasMore: false } };
      }
      return {
        items: Array.isArray(data.items) ? data.items : [],
        page: data.page ?? { hasMore: false },
      };
    },
    createExecutionTarget: (body: HubExecutionTargetRequest) =>
      request<HubExecutionTarget>('/web/execution-targets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}`,
      ),
    updateExecutionTarget: (
      id: string,
      body: Partial<HubExecutionTargetRequest>,
    ) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ),
    deleteExecutionTarget: (id: string) =>
      request<void>(`/web/execution-targets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    pingExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}:ping`,
        { method: 'POST' },
      ),
    listAuditEvents: (params?: { pageSize?: number; pageCursor?: string }) =>
      request<HubListResponse<HubAuditEvent>>(
        `/web/audit-events${qs(params ?? {})}`,
      ),
    createRelayCommand: (body: HubRelayCommandRequest) =>
      request<HubRelayCommand>('/web/relay/commands', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getRelayCommand: (id: string) =>
      request<HubRelayCommand>(`/web/relay/commands/${encodeURIComponent(id)}`),
    ackRelayCommand: (id: string) =>
      request<void>(`/web/relay/commands/${encodeURIComponent(id)}:ack`, {
        method: 'POST',
      }),

    listCustomAgents: () =>
      request<HubCustomAgent[]>('/web/custom-agents'),
    createCustomAgent: (body: HubCustomAgentRequest) =>
      request<HubCustomAgent>('/web/custom-agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateCustomAgent: (id: string, body: HubCustomAgentRequest) =>
      request<void>(`/web/custom-agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteCustomAgent: (id: string) =>
      request<void>(`/web/custom-agents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    listPublicSkills: (params?: {
      skill_type?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubSkill>>(
        `/web/skills${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    listPublicMCPServers: (params?: {
      transport?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubMCPServer>>(
        `/web/mcp-servers${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    // ── Workspace Projects ──────────────────────────────────────────
    listWorkspaceProjects: (params?: { pageSize?: number; pageCursor?: string; q?: string }) =>
      request<HubWorkspaceProjectListResponse>(`/web/projects${qs(params ?? {})}`),
    getWorkspaceProject: (id: string) =>
      request<HubWorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`),
    createWorkspaceProject: (data: HubCreateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>('/web/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateWorkspaceProject: (id: string, data: HubUpdateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    listWorkspaceProjectThreads: (projectId: string) =>
      request<HubWorkspaceProjectThread[]>(`/web/projects/${encodeURIComponent(projectId)}/threads`),
    createWorkspaceProjectThread: (projectId: string, data: HubCreateWorkspaceProjectThreadRequest) =>
      request<HubWorkspaceProjectThread>(`/web/projects/${encodeURIComponent(projectId)}/threads`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listWorkspaceProjectThreadMessages: (
      projectId: string,
      threadId: string,
      params?: { limit?: number },
    ) =>
      request<HubWorkspaceProjectThreadMessage[]>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages${qs(params ?? {})}`,
      ),
    sendWorkspaceProjectThreadMessage: (
      projectId: string,
      threadId: string,
      data: HubSendWorkspaceProjectThreadMessageRequest,
    ) =>
      request<HubWorkspaceProjectThreadMessage>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      ),

    // ── T3.2 parity: team/settings/attachments/message extras (desktop∩web) ──
    editMessage: (messageId: string, body: { content: string }) =>
      request<HubMessage>(`/client/messages/${encodeURIComponent(messageId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),

    removeMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),

    listMessageReactions: (messageId: string, sessionId: string) =>
      request<Record<string, unknown>[]>(`/client/messages/${encodeURIComponent(messageId)}/reactions?session_id=${encodeURIComponent(sessionId)}`),

    getTaskRunEventSummary: (taskId: string) =>
      request<HubAgentRunEventSummary>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events/summary`),

    /** List all run events for a task (used for initial load / full replay). */
    listTaskRunEvents: (taskId: string) =>
      request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),

    /** Fetch task run events with event_seq strictly after the given value (for replay gap fill). */
    listTaskRunEventsAfter: (taskId: string, afterSeq: number) =>
      request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`),

    createAgentTeam: (data: HubCreateAgentTeamRequest) =>
      request<HubAgentTeam>('/web/agent-teams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listAgentTeams: () =>
      request<HubAgentTeam[]>('/web/agent-teams'),

    getAgentTeam: (teamId: string) =>
      request<HubAgentTeamDetail>(`/web/agent-teams/${encodeURIComponent(teamId)}`),

    updateAgentTeam: (teamId: string, data: HubUpdateAgentTeamRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteAgentTeam: (teamId: string) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),

    addAgentTeamMember: (teamId: string, data: HubAddAgentTeamMemberRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    startTeamRun: (teamId: string, data: HubStartAgentTeamRunRequest) =>
      request<HubAgentTeamRun>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listTeamRuns: (teamId: string) =>
      request<HubAgentTeamRun[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`),

    getTeamRun: (teamId: string, runId: string) =>
      request<HubAgentTeamRun>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`,
      ),

    getTeamRunState: (teamId: string, runId: string) =>
      request<HubTeamRunState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/state`,
      ),

    listTeamEvents: (teamId: string, runId: string) =>
      request<HubAgentTeamEvent[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/events`,
      ),

    listTeamTasks: (teamId: string, runId: string) =>
      request<HubAgentTeamTask[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/tasks`,
      ),

    decideTeamApproval: (
      teamId: string,
      runId: string,
      approvalId: string,
      decision: HubTeamApprovalDecisionRequest,
    ) =>
      request<HubTeamApprovalState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    resolveTeamConflict: (
      teamId: string,
      runId: string,
      conflictId: string,
      resolution: HubTeamConflictResolutionRequest,
    ) =>
      request<HubTeamConflictState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(resolution),
        },
      ),

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubAgentProfileListResponse>(`/web/agent-profiles${qs(params ?? {})}`),

    createAgentProfile: (data: HubCreateAgentProfileRequest) =>
      request<HubAgentProfile>('/web/agent-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateAgentProfile: (id: string, data: HubUpdateAgentProfileRequest) =>
      request<HubAgentProfile>(`/web/agent-profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteAgentProfile: (id: string) =>
      request<undefined>(`/web/agent-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    fetchSettings: () =>
      request<Record<string, string>>('/client/settings'),

    patchSettings: (values: Record<string, string>) =>
      request<Record<string, string>>('/client/settings', {
        method: 'PATCH',
        body: JSON.stringify({ values }),
      }),

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) =>
      request<HubProbeAttachmentResponse>('/client/attachments/probe', {
        method: 'POST',
        body: JSON.stringify({ hash }),
      }),

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hash', hash);
      formData.append('original_name', file.name);
      return uploadMultipart<HubAttachmentRef>('/client/attachments', formData);
    },

    /** Get the download URL for an attachment (relative to Hub base). */
    downloadAttachmentUrl: (attachmentId: string) =>
      `${baseUrl}/client/attachments/${encodeURIComponent(attachmentId)}`,



    // ── T3.3 desktop remainder methods ──
    listDocuments: (params?: {
      status?: string;
      source?: string;
      tag?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubDocumentListResponse>(`/web/documents${qs(params ?? {})}`),

    getDocument: (id: string) =>
      request<HubDocument>(`/web/documents/${encodeURIComponent(id)}`),

    createDocument: (data: HubCreateDocumentRequest) =>
      request<HubDocument>('/web/documents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateDocument: (id: string, data: HubUpdateDocumentRequest) =>
      request<HubDocument>(`/web/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteDocument: (id: string) =>
      request<undefined>(`/web/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    getAgentProfile: (id: string) =>
      request<HubAgentProfile>(`/web/agent-profiles/${encodeURIComponent(id)}`),

    removeAgentTeamMember: (teamId: string, memberId: string) =>
      request<undefined>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE' },
      ),

    postTeamRouteDecision: (teamId: string, runId: string, decision: HubCoordinatorRouteDecision) =>
      request<Record<string, unknown>>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/route-decisions`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    streamTaskEvent: (
      taskId: string,
      eventType: string,
      payload: unknown,
      options: HubAgentTaskStreamEventOptions = {},
    ) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          payload,
          ...(options.runId ? { run_id: options.runId } : {}),
          ...(options.clientMsgId ? { client_msg_id: options.clientMsgId } : {}),
        }),
      }),


    // ── T3.4 web task approvals/artifacts ──
    listTaskApprovals: (taskId: string) =>
      request<HubAgentTaskApprovalList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals`),

    decideTaskApproval: (taskId: string, approvalId: string, decision: HubTaskApprovalDecisionRequest) =>
      request<HubAgentTaskApproval>(
        `/web/agent-tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    listTaskArtifacts: (taskId: string) =>
      request<HubAgentTaskArtifactList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/artifacts`),

  };
}

export type HubClient = ReturnType<typeof createHubClient>;

// ── Compat aliases + SSOT gaps (extracted #799) ──
export type {
  EmptyHubResponse,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  UserProfile,
  UpdateProfileRequest,
  ChangePasswordRequest,
  SearchResult,
  FriendRequestInfo,
  ContactInfo,
  Contact,
  Session,
  HubSessionAlias,
  SessionMember,
  CreatePrivateSessionRequest,
  CreateGroupSessionRequest,
  SendMessageRequest,
  SendMessageResponse,
  ReplyToInfo,
  MessageResponse,
  MessageAttachment,
  RegisterDeviceRequest,
  Device,
  AddAgentToSessionRequest,
  CustomAgentRequest,
  CustomAgent,
  Notification,
  ExecutionTarget,
  ExecutionTargetType,
  ExecutionTargetRequest,
  ExecutionTargetListResponse,
  WorkspaceProject,
  WorkspaceProjectListResponse,
  CreateWorkspaceProjectRequest,
  UpdateWorkspaceProjectRequest,
  WorkspaceProjectThread,
  CreateWorkspaceProjectThreadRequest,
  SendWorkspaceProjectThreadMessageRequest,
  WorkspaceProjectThreadMessage,
  AgentTask,
  TriggerAgentTaskOptions,
  OIDCAuthorizeRequest,
  OIDCAuthorizeResponse,
  OIDCCallbackRequest,
  OIDCCallbackResponse,
  Skill,
  MCPServer,
} from './hubClientCompatTypes';
export { HUBCLIENT_SSOT_GAPS } from './hubClientCompatTypes';
