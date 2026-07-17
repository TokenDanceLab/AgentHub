import { reportApiError } from './errors';
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
  normalizeRegisterDeviceRequest,
  resolveRouteFallbackStep,
  shouldUseChangePasswordFallback,
  unresolvedRouteFallbackError,
} from './hubClientRequestUtils';
import {
  applyRefreshedBearerAuth,
  buildHubFetchInit,
  buildMultipartFetchInit,
  buildTokenRefreshFailedLogPrefix,
  buildTokenRefreshReportContext,
  hasTokenRefreshHandler,
  normalizeHubBaseUrl,
  planHubRequestCatchEffects,
  prepareHubRequestContext,
  prepareMultipartUploadContext,
  resolveHubFetch,
  shouldAttemptTokenRefresh,
  shouldRetryWithRefreshedToken,
  toReportableError,
  withHubAbortTimeout,
} from './hubClientTransportUtils';

// ── Public type / envelope re-exports (extracted #810) ──
export * from './hubClientPublicReexports';

export function createHubClient(opts: HubClientOptions = {}) {
  const baseUrl = normalizeHubBaseUrl(opts.baseUrl);
  const fetchImpl = resolveHubFetch(opts.fetch);

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const requestCtx: {
      baseUrl: string;
      path: string;
      options: RequestInit;
      token?: string | null;
      timeoutMs?: number;
    } = {
      baseUrl,
      path,
      options,
    };
    const token = opts.getToken?.();
    if (token !== undefined) {
      requestCtx.token = token;
    }
    if (opts.timeoutMs !== undefined) {
      requestCtx.timeoutMs = opts.timeoutMs;
    }
    const { headers, timeoutMs, method, url } = prepareHubRequestContext(requestCtx);

    try {
      const response = await withHubAbortTimeout(timeoutMs, (signal) =>
        fetchImpl(url, buildHubFetchInit(options, headers, signal)),
      );

      // ── Token refresh recovery on 401 ──────────────────
      if (shouldAttemptTokenRefresh(response.status, hasTokenRefreshHandler(opts.onRefreshToken))) {
        try {
          const newToken = await opts.onRefreshToken!();
          if (shouldRetryWithRefreshedToken(newToken)) {
            // Retry once with fresh token
            applyRefreshedBearerAuth(headers, newToken);
            const retryResponse = await withHubAbortTimeout(timeoutMs, (signal) =>
              fetchImpl(url, buildHubFetchInit(options, headers, signal)),
            );
            return await parseHubSuccessResponse<T>(retryResponse);
          }
        } catch (refreshErr) {
          console.error(buildTokenRefreshFailedLogPrefix(), refreshErr);
          reportApiError(
            toReportableError(refreshErr),
            buildTokenRefreshReportContext(path),
          );
        }
      }

      return await parseHubSuccessResponse<T>(response);
    } catch (error) {
      const effects = planHubRequestCatchEffects(error, { timeoutMs, method, path });
      if ('logMessage' in effects) {
        console.error(effects.logMessage);
      }
      if ('report' in effects) {
        reportApiError(effects.report.error, effects.report.context);
      }
      throw effects.error;
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
        const step = resolveRouteFallbackStep(index, paths.length, error);
        if (step.action === 'continue') {
          fallbackError = step.fallbackError;
          continue;
        }
        throw step.error;
      }
    }

    throw unresolvedRouteFallbackError(fallbackError);
  }

  async function uploadMultipart<T>(path: string, formData: FormData): Promise<T> {
    // Let the runtime set multipart boundary; do not force JSON content-type.
    const multipartCtx: {
      baseUrl: string;
      path: string;
      token?: string | null;
      timeoutMs?: number;
    } = {
      baseUrl,
      path,
    };
    const multipartToken = opts.getToken?.();
    if (multipartToken !== undefined) {
      multipartCtx.token = multipartToken;
    }
    if (opts.timeoutMs !== undefined) {
      multipartCtx.timeoutMs = opts.timeoutMs;
    }
    const { headers, timeoutMs, url } = prepareMultipartUploadContext(multipartCtx);
    const response = await withHubAbortTimeout(timeoutMs, (signal) =>
      fetchImpl(url, buildMultipartFetchInit(headers, formData, signal)),
    );
    return parseHubSuccessResponse<T>(response);
  }

  return {
    request,

    register: (body: HubRegisterRequest) =>
      request<{ user_id: string }>(hubPayload.buildRegisterPath(), hubPayload.buildJsonPostInit(body)),
    login: (body: HubLoginRequest) =>
      request<HubAuthResponse>(hubPayload.buildLoginPath(), hubPayload.buildJsonPostInit(body)),
    refresh: (refreshToken: string) => {
      const req = hubPayload.buildRefreshRequest(refreshToken);
      return request<HubAuthResponse>(req.path, req.init);
    },
    logout: () => request<void>(hubPayload.buildLogoutPath(), hubPayload.buildPostInit()),
    me: () => request<HubUserProfile>(hubPayload.buildMePath()),
    updateProfile: (body: HubUpdateProfileRequest) =>
      request<HubUserProfile>(hubPayload.buildUpdateProfilePath(), hubPayload.buildJsonPutInit(body)),
    changePassword: async (body: HubChangePasswordRequest) => {
      const primary = hubPayload.buildChangePasswordPrimary(body);
      try {
        return await request<void>(primary.path, primary.init);
      } catch (error) {
        if (shouldUseChangePasswordFallback(error)) {
          const fallback = hubPayload.buildChangePasswordFallback(body);
          return request<void>(fallback.path, fallback.init);
        }
        throw error;
      }
    },
    oidcAuthorize: (body: HubOidcAuthorizeRequest) => {
      const req = hubPayload.buildOidcAuthorizeRequest(body);
      return request<HubOidcAuthorizeResponse>(req.path, req.init);
    },
    oidcCallback: (body: HubOidcCallbackRequest) =>
      request<HubOidcCallbackResponse>(
        hubPayload.buildOidcCallbackPath(),
        hubPayload.buildJsonPostInit(body),
      ),

    searchUser: (targetUserId: string) =>
      request<HubSearchResult>(hubPayload.buildSearchUserPath(targetUserId)),
    listContacts: () => request<HubContactInfo[]>(hubPayload.buildListContactsPath()),
    sendFriendRequest: (friendId: string, message?: string) => {
      const req = hubPayload.buildSendFriendRequest(friendId, message);
      return request<void>(req.path, req.init);
    },
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
    updateContactRemark: (friendUserId: string, remark: string) => {
      const req = hubPayload.buildUpdateContactRemarkRequest(friendUserId, remark);
      return request<void>(req.path, req.init);
    },

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
    addSessionMembers: (sessionId: string, memberIds: string[]) => {
      const req = hubPayload.buildAddSessionMembersRequest(sessionId, memberIds);
      return request<void>(req.path, req.init);
    },
    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(
        hubPayload.buildRemoveSessionMemberPath(sessionId, userId),
        hubPayload.buildDeleteInit(),
      ),
    leaveSession: (sessionId: string) =>
      request<void>(hubPayload.buildLeaveSessionPath(sessionId), hubPayload.buildPostInit()),
    transferSessionOwnership: (sessionId: string, newOwnerId: string) => {
      const req = hubPayload.buildTransferSessionOwnershipRequest(sessionId, newOwnerId);
      return request<void>(req.path, req.init);
    },
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
    markRead: (sessionId: string, lastReadSeq: number) => {
      const req = hubPayload.buildMarkReadRequest(sessionId, lastReadSeq);
      return request<void>(req.path, req.init);
    },
    recallMessage: (messageId: string) =>
      request<void>(hubPayload.buildRecallMessagePath(messageId), hubPayload.buildPostInit()),
    pinMessage: (messageId: string, sessionId: string) => {
      const req = hubPayload.buildPinMessageRequest(messageId, sessionId);
      return request<void>(req.path, req.init);
    },
    unpinMessage: (messageId: string, sessionId: string) => {
      const req = hubPayload.buildUnpinMessageRequest(messageId, sessionId);
      return request<void>(req.path, req.init);
    },
    forwardMessage: (messageId: string, targetSessionIds: string[]) => {
      const req = hubPayload.buildForwardMessageRequest(messageId, targetSessionIds);
      return request<void>(req.path, req.init);
    },
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
    ackTask: (taskId: string, runId?: string) => {
      const req = hubPayload.buildAckTaskRequest(taskId, runId);
      return request<void>(req.path, req.init);
    },
    streamTask: (taskId: string, content: string, runId?: string) => {
      const req = hubPayload.buildStreamTaskRequest(taskId, content, runId);
      return request<void>(req.path, req.init);
    },
    doneTask: (taskId: string, finalContent?: string, runId?: string) => {
      const req = hubPayload.buildDoneTaskRequest(taskId, finalContent, runId);
      return request<void>(req.path, req.init);
    },
    failTask: (taskId: string, error: string, runId?: string) => {
      const req = hubPayload.buildFailTaskRequest(taskId, error, runId);
      return request<void>(req.path, req.init);
    },

    addAgentToSession: (
      sessionId: string,
      body: HubAddAgentToSessionRequest,
    ) =>
      request<HubAgentInstance>(
        hubPayload.buildSessionAgentsPath(sessionId),
        hubPayload.buildJsonPostInit(body),
      ),
    triggerAgentTask: (triggerMessageId: string, options: HubTriggerAgentTaskOptions = {}) => {
      const req = hubPayload.buildTriggerAgentTaskRequest(triggerMessageId, options);
      return request<HubAgentTask>(req.path, req.init);
    },
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

    addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) => {
      const req = hubPayload.buildAddMessageReactionRequest(messageId, sessionId, reaction);
      return request<undefined>(req.path, req.init);
    },

    removeMessageReaction: (
      messageId: string,
      sessionId: string,
      reaction: { emoji: string },
    ) => {
      const req = hubPayload.buildRemoveMessageReactionRequest(messageId, sessionId, reaction);
      return request<undefined>(req.path, req.init);
    },

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

    patchSettings: (values: Record<string, string>) => {
      const req = hubPayload.buildPatchSettingsRequest(values);
      return request<Record<string, string>>(req.path, req.init);
    },

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) => {
      const req = hubPayload.buildProbeAttachmentRequest(hash);
      return request<HubProbeAttachmentResponse>(req.path, req.init);
    },

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) => {
      const req = hubPayload.buildUploadAttachmentRequest(file, hash);
      return uploadMultipart<HubAttachmentRef>(req.path, req.formData);
    },

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
    ) => {
      const req = hubPayload.buildStreamTaskEventRequest(taskId, eventType, payload, options);
      return request<undefined>(req.path, req.init);
    },

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
