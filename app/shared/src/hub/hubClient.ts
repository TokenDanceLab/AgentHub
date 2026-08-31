import type { HubAgentInstance } from './hubClientTeamTypes';

import type {
  HubClientOptions,
  HubAuthResponse,
  HubUserProfile,
  HubUpdateProfileRequest,
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubSearchResult,
  HubFriendRequest,
  HubContactInfo,
  HubSession,
  HubCreatePrivateSessionRequest,
  HubCreateGroupSessionRequest,
  HubCreateSessionResponse,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubMessage,
  HubRegisterDeviceRequest,
  HubDevice,
  HubAddAgentToSessionRequest,
  HubCustomAgentRequest,
  HubCustomAgent,
  HubSkill,
  HubMCPServer,
  HubAgentTask,
  HubTriggerAgentTaskOptions,
  HubNotification,
  HubListResponse,
  HubExecutionTarget,
  HubExecutionTargetRequest,
  HubExecutionTargetListResponse,
  HubAuditEvent,
  HubRelayCommandRequest,
  HubRelayCommand,
} from './hubClientDomainTypes';

import * as hubPayload from './hubClientPayloadUtils';
import {
  invokeNormalizedRegisterDeviceRequest,
  invokePathInitRequest,
  invokePathsInitRequest,
  runNormalizedExecutionTargetsListRequest,
} from './hubClientRequestUtils';
import {
  createHubClientTransport,
  resolveHubClientRuntime,
  resolveHubClientTransportOptions,
} from './hubClientTransportUtils';
import { createHubClientExtendedApi } from './hubClientApiExtended';

// ── Public type / envelope re-exports (extracted #810) ──
export * from './hubClientPublicReexports';

export function createHubClient(opts: HubClientOptions = {}) {
  const runtime = resolveHubClientRuntime(opts);
  const { request, requestWithFallback, uploadMultipart } =
    createHubClientTransport(resolveHubClientTransportOptions(runtime, opts));
  const { baseUrl } = runtime;

  return {
    request,

    refresh: (refreshToken: string) =>
      invokePathInitRequest((path, init) => request<HubAuthResponse>(path, init), hubPayload.buildRefreshRequest(refreshToken)),
    logout: () =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildLogoutRequest()),
    me: () => request<HubUserProfile>(hubPayload.buildMePath()),
    updateProfile: (body: HubUpdateProfileRequest) =>
      invokePathInitRequest((path, init) => request<HubUserProfile>(path, init), hubPayload.buildUpdateProfileRequest(body)),
    oidcAuthorize: (body: HubOidcAuthorizeRequest) =>
      invokePathInitRequest((path, init) => request<HubOidcAuthorizeResponse>(path, init), hubPayload.buildOidcAuthorizeRequest(body)),
    oidcCallback: (body: HubOidcCallbackRequest) =>
      invokePathInitRequest((path, init) => request<HubOidcCallbackResponse>(path, init), hubPayload.buildOidcCallbackPathInit(body)),

    searchUser: (targetUserId: string) =>
      request<HubSearchResult>(hubPayload.buildSearchUserPath(targetUserId)),
    listContacts: () => request<HubContactInfo[]>(hubPayload.buildListContactsPath()),
    sendFriendRequest: (friendId: string, message?: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildSendFriendRequest(friendId, message)),
    listFriendRequests: () =>
      request<HubFriendRequest[]>(hubPayload.buildFriendRequestsPath()),
    acceptFriendRequest: (requestId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAcceptFriendRequest(requestId)),
    rejectFriendRequest: (requestId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildRejectFriendRequest(requestId)),
    removeContact: (friendUserId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildRemoveContactRequest(friendUserId)),
    blockContact: (targetUserId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildBlockContactRequest(targetUserId)),
    unblockContact: (targetUserId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUnblockContactRequest(targetUserId)),
    updateContactRemark: (friendUserId: string, remark: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUpdateContactRemarkRequest(friendUserId, remark)),

    listSessions: () => request<HubSession[]>(hubPayload.buildListSessionsPath()),
    searchSessions: (q: string, params?: { pageCursor?: string; pageSize?: number }) =>
      request<HubListResponse<HubSession>>(hubPayload.buildSearchSessionsPath(q, params)),
    createPrivateSession: (body: HubCreatePrivateSessionRequest) =>
      invokePathInitRequest((path, init) => request<HubCreateSessionResponse>(path, init), hubPayload.buildCreatePrivateSessionRequest(body)),
    createGroupSession: (body: HubCreateGroupSessionRequest) =>
      invokePathInitRequest((path, init) => request<HubCreateSessionResponse>(path, init), hubPayload.buildCreateGroupSessionRequest(body)),
    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAddSessionMembersRequest(sessionId, memberIds)),
    removeSessionMember: (sessionId: string, userId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildRemoveSessionMemberRequest(sessionId, userId)),
    leaveSession: (sessionId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildLeaveSessionRequest(sessionId)),
    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildTransferSessionOwnershipRequest(sessionId, newOwnerId)),
    dissolveSession: (sessionId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDissolveSessionRequest(sessionId)),
    updateSessionInfo: (sessionId: string, body: HubUpdateSessionInfoRequest) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUpdateSessionInfoRequest(sessionId, body)),
    updateSessionSettings: (sessionId: string, body: HubUpdateSessionSettingsRequest) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUpdateSessionSettingsRequest(sessionId, body)),
    deleteSession: (sessionId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDeleteSessionRequest(sessionId)),

    sendMessage: (sessionId: string, body: HubSendMessageRequest) =>
      invokePathInitRequest((path, init) => request<HubSendMessageResponse>(path, init), hubPayload.buildSendMessageRequest(sessionId, body)),
    getMessages: (
      sessionId: string,
      params?: { before_seq?: number; limit?: number },
    ) => request<HubMessage[]>(hubPayload.buildGetMessagesPath(sessionId, params)),
    syncMessages: (
      sessionId: string,
      params?: { after_seq?: number; limit?: number },
    ) => request<HubMessage[]>(hubPayload.buildSyncMessagesPath(sessionId, params)),
    markRead: (sessionId: string, lastReadSeq: number) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildMarkReadRequest(sessionId, lastReadSeq)),
    recallMessage: (messageId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildRecallMessageRequest(messageId)),
    pinMessage: (messageId: string, sessionId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildPinMessageRequest(messageId, sessionId)),
    unpinMessage: (messageId: string, sessionId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUnpinMessageRequest(messageId, sessionId)),
    forwardMessage: (messageId: string, targetSessionIds: string[]) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildForwardMessageRequest(messageId, targetSessionIds)),
    listPinnedMessages: (sessionId: string) =>
      request<HubMessage[]>(hubPayload.buildSessionPinsPath(sessionId)),
    searchMessages: (params: {
      q: string;
      session_id?: string;
      content_type?: string;
      from?: string;
      to?: string;
      pageCursor?: string;
      pageSize?: number;
    }) => request<HubListResponse<HubMessage>>(hubPayload.buildSearchMessagesPath(params)),
    searchSessionMessages: (
      sessionId: string,
      params: { q: string; content_type?: string; from?: string; to?: string; pageCursor?: string; pageSize?: number },
    ) =>
      request<HubListResponse<HubMessage>>(hubPayload.buildSearchSessionMessagesPath(sessionId, params)),

    listNotifications: (params?: {
      unread_only?: boolean;
      limit?: number;
      offset?: number;
    }) => request<HubNotification[]>(hubPayload.buildListNotificationsPath(params)),
    markNotificationRead: (id: string) =>
      invokePathsInitRequest(
        (paths, init) => requestWithFallback<void>(paths, init),
        hubPayload.buildMarkNotificationReadPaths(id),
        hubPayload.buildPostInit(),
      ),
    readAllNotifications: () =>
      invokePathsInitRequest(
        (paths, init) => requestWithFallback<void>(paths, init),
        hubPayload.buildReadAllNotificationsPaths(),
        hubPayload.buildPostInit(),
      ),

    registerDevice: (body: HubRegisterDeviceRequest) =>
      invokeNormalizedRegisterDeviceRequest(
        (paths, init) => requestWithFallback<HubDevice>(paths, init),
        body,
        hubPayload.buildRegisterDevicePaths,
        hubPayload.buildJsonPostInit,
      ),
    ackTask: (taskId: string, runId?: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAckTaskRequest(taskId, runId)),
    streamTask: (taskId: string, content: string, runId?: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildStreamTaskRequest(taskId, content, runId)),
    doneTask: (taskId: string, finalContent?: string, runId?: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDoneTaskRequest(taskId, finalContent, runId)),
    failTask: (taskId: string, error: string, runId?: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildFailTaskRequest(taskId, error, runId)),

    addAgentToSession: (sessionId: string, body: HubAddAgentToSessionRequest) =>
      invokePathInitRequest((path, init) => request<HubAgentInstance>(path, init), hubPayload.buildAddAgentToSessionRequest(sessionId, body)),
    triggerAgentTask: (triggerMessageId: string, options: HubTriggerAgentTaskOptions = {}) =>
      invokePathInitRequest((path, init) => request<HubAgentTask>(path, init), hubPayload.buildTriggerAgentTaskRequest(triggerMessageId, options)),
    cancelAgentTask: (taskId: string) =>
      invokePathsInitRequest(
        (paths, init) => requestWithFallback<void>(paths, init),
        hubPayload.buildCancelAgentTaskPaths(taskId),
        hubPayload.buildPostInit(),
      ),

    regenerateAgentTask: (taskId: string) =>
      invokePathInitRequest((path, init) => request<HubAgentTask>(path, init), hubPayload.buildRegenerateAgentTaskRequest(taskId)),

    listExecutionTargets: (params?: {
      pageSize?: number;
      pageCursor?: string;
      target_type?: string;
    }) =>
      runNormalizedExecutionTargetsListRequest(
        (path) =>
          request<HubExecutionTarget[] | HubExecutionTargetListResponse>(path),
        hubPayload.buildListExecutionTargetsPath(params),
        hubPayload.normalizeExecutionTargetsResponse,
      ),
    createExecutionTarget: (body: HubExecutionTargetRequest) =>
      invokePathInitRequest((path, init) => request<HubExecutionTarget>(path, init), hubPayload.buildCreateExecutionTargetRequest(body)),
    getExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(hubPayload.buildExecutionTargetPath(id)),
    updateExecutionTarget: (id: string, body: Partial<HubExecutionTargetRequest>) =>
      invokePathInitRequest((path, init) => request<HubExecutionTarget>(path, init), hubPayload.buildUpdateExecutionTargetRequest(id, body)),
    deleteExecutionTarget: (id: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDeleteExecutionTargetRequest(id)),
    pingExecutionTarget: (id: string) =>
      invokePathInitRequest((path, init) => request<HubExecutionTarget>(path, init), hubPayload.buildPingExecutionTargetRequest(id)),
    listAuditEvents: (params?: { pageSize?: number; pageCursor?: string }) =>
      request<HubListResponse<HubAuditEvent>>(hubPayload.buildListAuditEventsPath(params)),
    createRelayCommand: (body: HubRelayCommandRequest) =>
      invokePathInitRequest((path, init) => request<HubRelayCommand>(path, init), hubPayload.buildCreateRelayCommandRequest(body)),
    getRelayCommand: (id: string) =>
      request<HubRelayCommand>(hubPayload.buildRelayCommandPath(id)),
    ackRelayCommand: (id: string, deviceId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAckRelayCommandRequest(id, deviceId)),

    listCustomAgents: () => request<HubCustomAgent[]>(hubPayload.buildCustomAgentsPath()),
    createCustomAgent: (body: HubCustomAgentRequest) =>
      invokePathInitRequest((path, init) => request<HubCustomAgent>(path, init), hubPayload.buildCreateCustomAgentRequest(body)),
    updateCustomAgent: (id: string, body: HubCustomAgentRequest) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUpdateCustomAgentRequest(id, body)),
    deleteCustomAgent: (id: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDeleteCustomAgentRequest(id)),

    listPublicSkills: (params?: {
      skill_type?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubSkill>>(hubPayload.buildListPublicSkillsPath(params)),

    listPublicMCPServers: (params?: {
      transport?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubMCPServer>>(hubPayload.buildListPublicMCPServersPath(params)),


    // ── Extended API surfaces (extracted #1086) ──
    ...createHubClientExtendedApi({ request, uploadMultipart, baseUrl }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
