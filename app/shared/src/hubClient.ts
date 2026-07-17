import { AppError, reportApiError } from './errors';
import type {
  HubAgentRunEventSummary,
  HubAgentRunEvent,
  HubCoordinatorRouteDecision,
  HubAgentTeam,
  HubAgentTeamDetail,
  HubAgentTeamRun,
  HubAgentTeamTask,
  HubAgentTeamEvent,
  HubTeamApprovalState,
  HubTeamConflictState,
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
  HubDocumentListResponse,
  HubCreateDocumentRequest,
  HubUpdateDocumentRequest,
  HubDocument,
  HubAgentTaskStreamEventOptions,
  HubAgentTaskApproval,
  HubAgentTaskApprovalList,
  HubAgentTaskArtifactList,
  HubTaskApprovalDecisionRequest,
  HubAgentInstance,
} from './hubClientTeamTypes';

import type {
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
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubCreateWorkspaceProjectRequest,
  HubUpdateWorkspaceProjectRequest,
  HubWorkspaceProjectThread,
  HubCreateWorkspaceProjectThreadRequest,
  HubSendWorkspaceProjectThreadMessageRequest,
  HubWorkspaceProjectThreadMessage,
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

import { parseHubSuccessResponse } from './hubClientEnvelope';
import * as hubPayload from './hubClientPayloadUtils';
import {
  isRouteFallbackError,
  normalizeRegisterDeviceRequest,
} from './hubClientRequestUtils';
import {
  applyBearerAuth,
  applyDefaultJsonContentType,
  buildHubUrl,
  createNetworkAppError,
  createTimeoutAppError,
  isAbortError,
  isNetworkFetchTypeError,
  normalizeHubBaseUrl,
  requestMethodOf,
  resolveHubTimeoutMs,
} from './hubClientTransportUtils';

// ── Public type / envelope re-exports (extracted #810) ──
export * from './hubClientPublicReexports';

export function createHubClient(opts: HubClientOptions = {}) {
  const baseUrl = normalizeHubBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetch;

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = opts.getToken?.();
    const headers = new Headers(options.headers);
    applyDefaultJsonContentType(headers);
    applyBearerAuth(headers, token);

    const timeoutMs = resolveHubTimeoutMs(opts.timeoutMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;
    const method = requestMethodOf(options);

    try {
      const response = await (fetchImpl ?? globalThis.fetch)(buildHubUrl(baseUrl, path), {
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
              const retryResponse = await (fetchImpl ?? globalThis.fetch)(buildHubUrl(baseUrl, path), {
                ...options,
                headers,
                signal: retryController.signal,
              });
              clearTimeout(retryTimeoutId);
              return await parseHubSuccessResponse<T>(retryResponse);
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

      return await parseHubSuccessResponse<T>(response);
    } catch (error) {
      clearTimeout(timeoutId);

      // Surface timeout as a distinct error
      if (isAbortError(error)) {
        const timeoutError = createTimeoutAppError({
          timeoutMs,
          method,
          path,
        });
        console.error(`[HubClient] ${timeoutError.message}`);
        reportApiError(timeoutError, { path, method, timeoutMs });
        throw timeoutError;
      }

      // Report all other errors
      if (error instanceof AppError) {
        reportApiError(error, { path, method });
      } else if (isNetworkFetchTypeError(error)) {
        const netError = createNetworkAppError((error as TypeError).message);
        console.error(`[HubClient] ${netError.message}`);
        reportApiError(netError, { path, method });
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
    applyBearerAuth(headers, token);
    const timeoutMs = resolveHubTimeoutMs(opts.timeoutMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(buildHubUrl(baseUrl, path), {
        ...hubPayload.buildPostInit(),
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return await parseHubSuccessResponse<T>(response);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  return {
    request,

    register: (body: HubRegisterRequest) =>
      request<{ user_id: string }>(hubPayload.buildRegisterPath(), hubPayload.buildJsonPostInit(body)),
    login: (body: HubLoginRequest) =>
      request<HubAuthResponse>(hubPayload.buildLoginPath(), hubPayload.buildJsonPostInit(body)),
    refresh: (refreshToken: string) =>
      request<HubAuthResponse>(
        hubPayload.buildRefreshPath(),
        hubPayload.buildJsonPostInit(hubPayload.buildRefreshBody(refreshToken)),
      ),
    logout: () => request<void>(hubPayload.buildLogoutPath(), hubPayload.buildPostInit()),
    me: () => request<HubUserProfile>(hubPayload.buildMePath()),
    updateProfile: (body: HubUpdateProfileRequest) =>
      request<HubUserProfile>(hubPayload.buildUpdateProfilePath(), hubPayload.buildJsonPutInit(body)),
    changePassword: async (body: HubChangePasswordRequest) => {
      try {
        return await request<void>(
          hubPayload.buildChangePasswordPath(),
          hubPayload.buildJsonPostInit(body),
        );
      } catch (error) {
        if (isRouteFallbackError(error)) {
          return request<void>(
            hubPayload.buildChangePasswordFallbackPath(),
            hubPayload.buildJsonPutInit(body),
          );
        }
        throw error;
      }
    },
    oidcAuthorize: (body: HubOidcAuthorizeRequest) =>
      request<HubOidcAuthorizeResponse>(
        hubPayload.buildOidcAuthorizePath(),
        hubPayload.buildJsonPostInit(hubPayload.buildOidcAuthorizeBody(body)),
      ),
    oidcCallback: (body: HubOidcCallbackRequest) =>
      request<HubOidcCallbackResponse>(
        hubPayload.buildOidcCallbackPath(),
        hubPayload.buildJsonPostInit(body),
      ),

    searchUser: (targetUserId: string) =>
      request<HubSearchResult>(hubPayload.buildSearchUserPath(targetUserId)),
    listContacts: () => request<HubContactInfo[]>(hubPayload.buildListContactsPath()),
    sendFriendRequest: (friendId: string, message?: string) =>
      request<void>(
        hubPayload.buildFriendRequestsPath(),
        hubPayload.buildJsonPostInit(hubPayload.buildFriendRequestBody(friendId, message)),
      ),
    listFriendRequests: () =>
      request<HubFriendRequest[]>(hubPayload.buildFriendRequestsPath()),
    acceptFriendRequest: (requestId: string) =>
      request<void>(
        hubPayload.buildAcceptFriendRequestPath(requestId),
        hubPayload.buildPostInit(),
      ),
    rejectFriendRequest: (requestId: string) =>
      request<void>(
        hubPayload.buildRejectFriendRequestPath(requestId),
        hubPayload.buildPostInit(),
      ),
    removeContact: (friendUserId: string) =>
      request<void>(
        hubPayload.buildRemoveContactPath(friendUserId),
        hubPayload.buildDeleteInit(),
      ),
    blockContact: (targetUserId: string) =>
      request<void>(hubPayload.buildBlockContactPath(targetUserId), hubPayload.buildPostInit()),
    unblockContact: (targetUserId: string) =>
      request<void>(hubPayload.buildUnblockContactPath(targetUserId), hubPayload.buildPostInit()),
    updateContactRemark: (friendUserId: string, remark: string) =>
      request<void>(
        hubPayload.buildContactRemarkPath(friendUserId),
        hubPayload.buildJsonPutInit(hubPayload.buildRemarkBody(remark)),
      ),

    listSessions: () => request<HubSession[]>(hubPayload.buildListSessionsPath()),
    searchSessions: (q: string) =>
      request<HubSession[]>(hubPayload.buildSearchSessionsPath(q)),
    createPrivateSession: (body: HubCreatePrivateSessionRequest) =>
      request<HubCreateSessionResponse>(
        hubPayload.buildCreatePrivateSessionPath(),
        hubPayload.buildJsonPostInit(body),
      ),
    createGroupSession: (body: HubCreateGroupSessionRequest) =>
      request<HubCreateSessionResponse>(
        hubPayload.buildCreateGroupSessionPath(),
        hubPayload.buildJsonPostInit(body),
      ),
    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      request<void>(
        hubPayload.buildSessionMembersPath(sessionId),
        hubPayload.buildJsonPostInit(hubPayload.buildMemberIdsBody(memberIds)),
      ),
    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(
        hubPayload.buildRemoveSessionMemberPath(sessionId, userId),
        hubPayload.buildDeleteInit(),
      ),
    leaveSession: (sessionId: string) =>
      request<void>(hubPayload.buildLeaveSessionPath(sessionId), hubPayload.buildPostInit()),
    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      request<void>(
        hubPayload.buildTransferSessionOwnerPath(sessionId),
        hubPayload.buildJsonPostInit(hubPayload.buildTransferOwnerBody(newOwnerId)),
      ),
    dissolveSession: (sessionId: string) =>
      request<void>(hubPayload.buildDissolveSessionPath(sessionId), hubPayload.buildPostInit()),
    updateSessionInfo: (
      sessionId: string,
      body: HubUpdateSessionInfoRequest,
    ) =>
      request<void>(
        hubPayload.buildSessionInfoPath(sessionId),
        hubPayload.buildJsonPutInit(body),
      ),
    updateSessionSettings: (
      sessionId: string,
      body: HubUpdateSessionSettingsRequest,
    ) =>
      request<void>(
        hubPayload.buildSessionSettingsPath(sessionId),
        hubPayload.buildJsonPutInit(body),
      ),
    deleteSession: (sessionId: string) =>
      request<void>(hubPayload.buildSessionPath(sessionId), hubPayload.buildDeleteInit()),

    sendMessage: (sessionId: string, body: HubSendMessageRequest) =>
      request<HubSendMessageResponse>(
        hubPayload.buildGetMessagesPath(sessionId),
        hubPayload.buildJsonPostInit(body),
      ),
    getMessages: (
      sessionId: string,
      params?: { before_seq?: number; limit?: number },
    ) => request<HubMessage[]>(hubPayload.buildGetMessagesPath(sessionId, params)),
    syncMessages: (
      sessionId: string,
      params?: { after_seq?: number; limit?: number },
    ) => request<HubMessage[]>(hubPayload.buildSyncMessagesPath(sessionId, params)),
    markRead: (sessionId: string, lastReadSeq: number) =>
      request<void>(
        hubPayload.buildMarkReadPath(sessionId),
        hubPayload.buildJsonPostInit(hubPayload.buildMarkReadBody(lastReadSeq)),
      ),
    recallMessage: (messageId: string) =>
      request<void>(hubPayload.buildRecallMessagePath(messageId), hubPayload.buildPostInit()),
    pinMessage: (messageId: string, sessionId: string) =>
      request<void>(
        hubPayload.buildPinMessagePath(messageId),
        hubPayload.buildJsonPostInit(hubPayload.buildSessionIdBody(sessionId)),
      ),
    unpinMessage: (messageId: string, sessionId: string) =>
      request<void>(
        hubPayload.buildPinMessagePath(messageId),
        hubPayload.buildJsonDeleteInit(hubPayload.buildSessionIdBody(sessionId)),
      ),
    forwardMessage: (messageId: string, targetSessionIds: string[]) =>
      request<void>(
        hubPayload.buildForwardMessagePath(messageId),
        hubPayload.buildJsonPostInit(hubPayload.buildForwardMessageBody(targetSessionIds)),
      ),
    listPinnedMessages: (sessionId: string) =>
      request<HubMessage[]>(hubPayload.buildSessionPinsPath(sessionId)),
    searchMessages: (params: {
      q: string;
      session_id?: string;
      content_type?: string;
      from?: string;
      to?: string;
    }) => request<HubMessage[]>(hubPayload.buildSearchMessagesPath(params)),
    searchSessionMessages: (
      sessionId: string,
      params: { q: string; content_type?: string; from?: string; to?: string },
    ) =>
      request<HubMessage[]>(hubPayload.buildSearchSessionMessagesPath(sessionId, params)),

    listNotifications: (params?: {
      unread_only?: boolean;
      limit?: number;
      offset?: number;
    }) => request<HubNotification[]>(hubPayload.buildListNotificationsPath(params)),
    markNotificationRead: (id: string) =>
      requestWithFallback<void>(
        hubPayload.buildMarkNotificationReadPaths(id),
        hubPayload.buildPostInit(),
      ),
    readAllNotifications: () =>
      requestWithFallback<void>(
        hubPayload.buildReadAllNotificationsPaths(),
        hubPayload.buildPostInit(),
      ),

    registerDevice: (body: HubRegisterDeviceRequest) =>
      requestWithFallback<HubDevice>(
        hubPayload.buildRegisterDevicePaths(),
        hubPayload.buildJsonPostInit(normalizeRegisterDeviceRequest(body)),
      ),
    ackTask: (taskId: string, runId?: string) =>
      request<void>(
        hubPayload.buildAckTaskPath(taskId),
        hubPayload.buildPostWithOptionalJsonBody(hubPayload.buildTaskAckBody(runId)),
      ),
    streamTask: (taskId: string, content: string, runId?: string) =>
      request<void>(
        hubPayload.buildStreamTaskPath(taskId),
        hubPayload.buildJsonPostInit(hubPayload.buildTaskStreamBody(content, runId)),
      ),
    doneTask: (taskId: string, finalContent?: string, runId?: string) =>
      request<void>(
        hubPayload.buildDoneTaskPath(taskId),
        hubPayload.buildJsonPostInit(hubPayload.buildTaskDoneBody(finalContent, runId)),
      ),
    failTask: (taskId: string, error: string, runId?: string) =>
      request<void>(
        hubPayload.buildFailTaskPath(taskId),
        hubPayload.buildJsonPostInit(hubPayload.buildTaskFailBody(error, runId)),
      ),

    addAgentToSession: (
      sessionId: string,
      body: HubAddAgentToSessionRequest,
    ) =>
      request<HubAgentInstance>(
        hubPayload.buildSessionAgentsPath(sessionId),
        hubPayload.buildJsonPostInit(body),
      ),
    triggerAgentTask: (triggerMessageId: string, options: HubTriggerAgentTaskOptions = {}) =>
      request<HubAgentTask>(
        hubPayload.buildAgentTasksPath(),
        hubPayload.buildJsonPostInit(
          hubPayload.buildTriggerAgentTaskBody(triggerMessageId, options),
        ),
      ),
    cancelAgentTask: (taskId: string) =>
      requestWithFallback<void>(
        hubPayload.buildCancelAgentTaskPaths(taskId),
        hubPayload.buildPostInit(),
      ),

    regenerateAgentTask: (taskId: string) =>
      request<HubAgentTask>(
        hubPayload.buildRegenerateAgentTaskPath(taskId),
        hubPayload.buildPostInit(),
      ),

    listExecutionTargets: async (params?: {
      pageSize?: number;
      pageCursor?: string;
      target_type?: string;
    }) => {
      const data = await request<HubExecutionTarget[] | HubExecutionTargetListResponse>(
        hubPayload.buildListExecutionTargetsPath(params),
      );
      return hubPayload.normalizeExecutionTargetsResponse(data);
    },
    createExecutionTarget: (body: HubExecutionTargetRequest) =>
      request<HubExecutionTarget>(
        hubPayload.buildExecutionTargetsPath(),
        hubPayload.buildJsonPostInit(body),
      ),
    getExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(hubPayload.buildExecutionTargetPath(id)),
    updateExecutionTarget: (
      id: string,
      body: Partial<HubExecutionTargetRequest>,
    ) =>
      request<HubExecutionTarget>(
        hubPayload.buildExecutionTargetPath(id),
        hubPayload.buildJsonPatchInit(body),
      ),
    deleteExecutionTarget: (id: string) =>
      request<void>(hubPayload.buildExecutionTargetPath(id), hubPayload.buildDeleteInit()),
    pingExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(
        hubPayload.buildPingExecutionTargetPath(id),
        hubPayload.buildPostInit(),
      ),
    listAuditEvents: (params?: { pageSize?: number; pageCursor?: string }) =>
      request<HubListResponse<HubAuditEvent>>(hubPayload.buildListAuditEventsPath(params)),
    createRelayCommand: (body: HubRelayCommandRequest) =>
      request<HubRelayCommand>(
        hubPayload.buildRelayCommandsPath(),
        hubPayload.buildJsonPostInit(body),
      ),
    getRelayCommand: (id: string) =>
      request<HubRelayCommand>(hubPayload.buildRelayCommandPath(id)),
    ackRelayCommand: (id: string) =>
      request<void>(hubPayload.buildAckRelayCommandPath(id), hubPayload.buildPostInit()),

    listCustomAgents: () => request<HubCustomAgent[]>(hubPayload.buildCustomAgentsPath()),
    createCustomAgent: (body: HubCustomAgentRequest) =>
      request<HubCustomAgent>(
        hubPayload.buildCustomAgentsPath(),
        hubPayload.buildJsonPostInit(body),
      ),
    updateCustomAgent: (id: string, body: HubCustomAgentRequest) =>
      request<void>(hubPayload.buildCustomAgentPath(id), hubPayload.buildJsonPutInit(body)),
    deleteCustomAgent: (id: string) =>
      request<void>(hubPayload.buildCustomAgentPath(id), hubPayload.buildDeleteInit()),

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

    // ── Workspace Projects ──────────────────────────────────────────
    listWorkspaceProjects: (params?: { pageSize?: number; pageCursor?: string; q?: string }) =>
      request<HubWorkspaceProjectListResponse>(hubPayload.buildListWorkspaceProjectsPath(params)),
    getWorkspaceProject: (id: string) =>
      request<HubWorkspaceProject>(hubPayload.buildWorkspaceProjectPath(id)),
    createWorkspaceProject: (data: HubCreateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>(
        hubPayload.buildWorkspaceProjectsPath(),
        hubPayload.buildJsonPostInit(data),
      ),
    updateWorkspaceProject: (id: string, data: HubUpdateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>(
        hubPayload.buildWorkspaceProjectPath(id),
        hubPayload.buildJsonPatchInit(data),
      ),
    listWorkspaceProjectThreads: (projectId: string) =>
      request<HubWorkspaceProjectThread[]>(hubPayload.buildWorkspaceProjectThreadsPath(projectId)),
    createWorkspaceProjectThread: (
      projectId: string,
      data: HubCreateWorkspaceProjectThreadRequest,
    ) =>
      request<HubWorkspaceProjectThread>(
        hubPayload.buildWorkspaceProjectThreadsPath(projectId),
        hubPayload.buildJsonPostInit(data),
      ),
    listWorkspaceProjectThreadMessages: (
      projectId: string,
      threadId: string,
      params?: { limit?: number },
    ) =>
      request<HubWorkspaceProjectThreadMessage[]>(
        hubPayload.buildListWorkspaceProjectThreadMessagesPath(projectId, threadId, params),
      ),
    sendWorkspaceProjectThreadMessage: (
      projectId: string,
      threadId: string,
      data: HubSendWorkspaceProjectThreadMessageRequest,
    ) =>
      request<HubWorkspaceProjectThreadMessage>(
        hubPayload.buildSendWorkspaceProjectThreadMessagePath(projectId, threadId),
        hubPayload.buildJsonPostInit(data),
      ),

    // ── T3.2 parity: team/settings/attachments/message extras (desktop∩web) ──
    editMessage: (messageId: string, body: { content: string }) =>
      request<HubMessage>(
        hubPayload.buildEditMessagePath(messageId),
        hubPayload.buildJsonPutInit(body),
      ),

    addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(
        hubPayload.buildMessageReactionsPath(messageId),
        hubPayload.buildJsonPostInit(hubPayload.buildReactionBody(sessionId, reaction)),
      ),

    removeMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(
        hubPayload.buildMessageReactionsPath(messageId),
        hubPayload.buildJsonDeleteInit(hubPayload.buildReactionBody(sessionId, reaction)),
      ),

    listMessageReactions: (messageId: string, sessionId: string) =>
      request<Record<string, unknown>[]>(
        hubPayload.buildListMessageReactionsPath(messageId, sessionId),
      ),

    getTaskRunEventSummary: (taskId: string) =>
      request<HubAgentRunEventSummary>(hubPayload.buildTaskRunEventSummaryPath(taskId)),

    /** List all run events for a task (used for initial load / full replay). */
    listTaskRunEvents: (taskId: string) =>
      request<HubAgentRunEvent[]>(hubPayload.buildListTaskRunEventsPath(taskId)),

    /** Fetch task run events with event_seq strictly after the given value (for replay gap fill). */
    listTaskRunEventsAfter: (taskId: string, afterSeq: number) =>
      request<HubAgentRunEvent[]>(hubPayload.buildListTaskRunEventsAfterPath(taskId, afterSeq)),

    createAgentTeam: (data: HubCreateAgentTeamRequest) =>
      request<HubAgentTeam>(hubPayload.buildAgentTeamsPath(), hubPayload.buildJsonPostInit(data)),

    listAgentTeams: () => request<HubAgentTeam[]>(hubPayload.buildAgentTeamsPath()),

    getAgentTeam: (teamId: string) =>
      request<HubAgentTeamDetail>(hubPayload.buildAgentTeamPath(teamId)),

    updateAgentTeam: (teamId: string, data: HubUpdateAgentTeamRequest) =>
      request<void>(hubPayload.buildAgentTeamPath(teamId), hubPayload.buildJsonPutInit(data)),

    deleteAgentTeam: (teamId: string) =>
      request<void>(hubPayload.buildAgentTeamPath(teamId), hubPayload.buildDeleteInit()),

    addAgentTeamMember: (teamId: string, data: HubAddAgentTeamMemberRequest) =>
      request<void>(
        hubPayload.buildAgentTeamMembersPath(teamId),
        hubPayload.buildJsonPostInit(data),
      ),

    startTeamRun: (teamId: string, data: HubStartAgentTeamRunRequest) =>
      request<HubAgentTeamRun>(
        hubPayload.buildAgentTeamRunsPath(teamId),
        hubPayload.buildJsonPostInit(data),
      ),

    listTeamRuns: (teamId: string) =>
      request<HubAgentTeamRun[]>(hubPayload.buildAgentTeamRunsPath(teamId)),

    getTeamRun: (teamId: string, runId: string) =>
      request<HubAgentTeamRun>(hubPayload.buildGetTeamRunPath(teamId, runId)),

    getTeamRunState: (teamId: string, runId: string) =>
      request<HubTeamRunState>(hubPayload.buildGetTeamRunStatePath(teamId, runId)),

    listTeamEvents: (teamId: string, runId: string) =>
      request<HubAgentTeamEvent[]>(hubPayload.buildListTeamEventsPath(teamId, runId)),

    listTeamTasks: (teamId: string, runId: string) =>
      request<HubAgentTeamTask[]>(hubPayload.buildListTeamTasksPath(teamId, runId)),

    decideTeamApproval: (
      teamId: string,
      runId: string,
      approvalId: string,
      decision: HubTeamApprovalDecisionRequest,
    ) =>
      request<HubTeamApprovalState>(
        hubPayload.buildDecideTeamApprovalPath(teamId, runId, approvalId),
        hubPayload.buildJsonPostInit(decision),
      ),

    resolveTeamConflict: (
      teamId: string,
      runId: string,
      conflictId: string,
      resolution: HubTeamConflictResolutionRequest,
    ) =>
      request<HubTeamConflictState>(
        hubPayload.buildResolveTeamConflictPath(teamId, runId, conflictId),
        hubPayload.buildJsonPostInit(resolution),
      ),

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubAgentProfileListResponse>(hubPayload.buildListAgentProfilesPath(params)),

    createAgentProfile: (data: HubCreateAgentProfileRequest) =>
      request<HubAgentProfile>(
        hubPayload.buildAgentProfilesPath(),
        hubPayload.buildJsonPostInit(data),
      ),

    updateAgentProfile: (id: string, data: HubUpdateAgentProfileRequest) =>
      request<HubAgentProfile>(
        hubPayload.buildAgentProfilePath(id),
        hubPayload.buildJsonPatchInit(data),
      ),

    deleteAgentProfile: (id: string) =>
      request<undefined>(hubPayload.buildAgentProfilePath(id), hubPayload.buildDeleteInit()),

    fetchSettings: () => request<Record<string, string>>(hubPayload.buildSettingsPath()),

    patchSettings: (values: Record<string, string>) =>
      request<Record<string, string>>(
        hubPayload.buildSettingsPath(),
        hubPayload.buildJsonPatchInit(hubPayload.buildPatchSettingsBody(values)),
      ),

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) =>
      request<HubProbeAttachmentResponse>(
        hubPayload.buildProbeAttachmentPath(),
        hubPayload.buildJsonPostInit(hubPayload.buildProbeAttachmentBody(hash)),
      ),

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) =>
      uploadMultipart<HubAttachmentRef>(
        hubPayload.buildAttachmentsPath(),
        hubPayload.buildAttachmentFormData(file, hash),
      ),

    /** Get the download URL for an attachment (relative to Hub base). */
    downloadAttachmentUrl: (attachmentId: string) =>
      hubPayload.buildAttachmentDownloadUrl(baseUrl, attachmentId),

    // ── T3.3 desktop remainder methods ──
    listDocuments: (params?: {
      status?: string;
      source?: string;
      tag?: string;
      pageCursor?: string;
      pageSize?: number;
    }) => request<HubDocumentListResponse>(hubPayload.buildListDocumentsPath(params)),

    getDocument: (id: string) => request<HubDocument>(hubPayload.buildDocumentPath(id)),

    createDocument: (data: HubCreateDocumentRequest) =>
      request<HubDocument>(hubPayload.buildDocumentsPath(), hubPayload.buildJsonPostInit(data)),

    updateDocument: (id: string, data: HubUpdateDocumentRequest) =>
      request<HubDocument>(hubPayload.buildDocumentPath(id), hubPayload.buildJsonPatchInit(data)),

    deleteDocument: (id: string) =>
      request<undefined>(hubPayload.buildDocumentPath(id), hubPayload.buildDeleteInit()),

    getAgentProfile: (id: string) =>
      request<HubAgentProfile>(hubPayload.buildAgentProfilePath(id)),

    removeAgentTeamMember: (teamId: string, memberId: string) =>
      request<undefined>(
        hubPayload.buildRemoveAgentTeamMemberPath(teamId, memberId),
        hubPayload.buildDeleteInit(),
      ),

    postTeamRouteDecision: (
      teamId: string,
      runId: string,
      decision: HubCoordinatorRouteDecision,
    ) =>
      request<Record<string, unknown>>(
        hubPayload.buildPostTeamRouteDecisionPath(teamId, runId),
        hubPayload.buildJsonPostInit(decision),
      ),

    streamTaskEvent: (
      taskId: string,
      eventType: string,
      payload: unknown,
      options: HubAgentTaskStreamEventOptions = {},
    ) =>
      request<undefined>(
        hubPayload.buildStreamTaskPath(taskId),
        hubPayload.buildJsonPostInit(
          hubPayload.buildStreamTaskEventBody(eventType, payload, options),
        ),
      ),

    // ── T3.4 web task approvals/artifacts ──
    listTaskApprovals: (taskId: string) =>
      request<HubAgentTaskApprovalList>(hubPayload.buildListTaskApprovalsPath(taskId)),

    decideTaskApproval: (
      taskId: string,
      approvalId: string,
      decision: HubTaskApprovalDecisionRequest,
    ) =>
      request<HubAgentTaskApproval>(
        hubPayload.buildDecideTaskApprovalPath(taskId, approvalId),
        hubPayload.buildJsonPostInit(decision),
      ),

    listTaskArtifacts: (taskId: string) =>
      request<HubAgentTaskArtifactList>(hubPayload.buildListTaskArtifactsPath(taskId)),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
