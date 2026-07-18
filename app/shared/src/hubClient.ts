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

import * as hubPayload from './hubClientPayloadUtils';
import {
  invokeNormalizedRegisterDeviceRequest,
  invokePathFormDataUpload,
  invokePathInitRequest,
  invokePathsInitRequest,
  runChangePasswordWithFallback,
  runNormalizedExecutionTargetsListRequest,
} from './hubClientRequestUtils';
import {
  createHubClientTransport,
  resolveHubClientRuntime,
  resolveHubClientTransportOptions,
} from './hubClientTransportUtils';

// ── Public type / envelope re-exports (extracted #810) ──
export * from './hubClientPublicReexports';

export function createHubClient(opts: HubClientOptions = {}) {
  const runtime = resolveHubClientRuntime(opts);
  const { request, requestWithFallback, uploadMultipart } =
    createHubClientTransport(resolveHubClientTransportOptions(runtime, opts));
  const { baseUrl } = runtime;

  return {
    request,

    register: (body: HubRegisterRequest) =>
      invokePathInitRequest((path, init) => request<{ user_id: string }>(path, init), hubPayload.buildRegisterRequest(body)),
    login: (body: HubLoginRequest) =>
      invokePathInitRequest((path, init) => request<HubAuthResponse>(path, init), hubPayload.buildLoginRequest(body)),
    refresh: (refreshToken: string) =>
      invokePathInitRequest((path, init) => request<HubAuthResponse>(path, init), hubPayload.buildRefreshRequest(refreshToken)),
    logout: () =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildLogoutRequest()),
    me: () => request<HubUserProfile>(hubPayload.buildMePath()),
    updateProfile: (body: HubUpdateProfileRequest) =>
      invokePathInitRequest((path, init) => request<HubUserProfile>(path, init), hubPayload.buildUpdateProfileRequest(body)),
    changePassword: (body: HubChangePasswordRequest) =>
      runChangePasswordWithFallback(
        (path, init) => request<void>(path, init),
        hubPayload.buildChangePasswordPrimary(body),
        hubPayload.buildChangePasswordFallback(body),
      ),
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
    searchSessions: (q: string) =>
      request<HubSession[]>(hubPayload.buildSearchSessionsPath(q)),
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
    ackRelayCommand: (id: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAckRelayCommandRequest(id)),

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

    // ── Workspace Projects ──────────────────────────────────────────
    listWorkspaceProjects: (params?: { pageSize?: number; pageCursor?: string; q?: string }) =>
      request<HubWorkspaceProjectListResponse>(hubPayload.buildListWorkspaceProjectsPath(params)),
    getWorkspaceProject: (id: string) =>
      request<HubWorkspaceProject>(hubPayload.buildWorkspaceProjectPath(id)),
    createWorkspaceProject: (data: HubCreateWorkspaceProjectRequest) =>
      invokePathInitRequest((path, init) => request<HubWorkspaceProject>(path, init), hubPayload.buildCreateWorkspaceProjectRequest(data)),
    updateWorkspaceProject: (id: string, data: HubUpdateWorkspaceProjectRequest) =>
      invokePathInitRequest((path, init) => request<HubWorkspaceProject>(path, init), hubPayload.buildUpdateWorkspaceProjectRequest(id, data)),
    listWorkspaceProjectThreads: (projectId: string) =>
      request<HubWorkspaceProjectThread[]>(hubPayload.buildWorkspaceProjectThreadsPath(projectId)),
    createWorkspaceProjectThread: (
      projectId: string,
      data: HubCreateWorkspaceProjectThreadRequest,
    ) =>
      invokePathInitRequest((path, init) => request<HubWorkspaceProjectThread>(path, init), hubPayload.buildCreateWorkspaceProjectThreadRequest(projectId, data)),
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
      invokePathInitRequest((path, init) => request<HubWorkspaceProjectThreadMessage>(path, init), hubPayload.buildSendWorkspaceProjectThreadMessageRequest(projectId, threadId, data)),

    // ── T3.2 parity: team/settings/attachments/message extras (desktop∩web) ──
    editMessage: (messageId: string, body: { content: string }) =>
      invokePathInitRequest((path, init) => request<HubMessage>(path, init), hubPayload.buildEditMessageRequest(messageId, body)),

    addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildAddMessageReactionRequest(messageId, sessionId, reaction)),

    removeMessageReaction: (
      messageId: string,
      sessionId: string,
      reaction: { emoji: string },
    ) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildRemoveMessageReactionRequest(messageId, sessionId, reaction)),

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
      invokePathInitRequest((path, init) => request<HubAgentTeam>(path, init), hubPayload.buildCreateAgentTeamRequest(data)),

    listAgentTeams: () => request<HubAgentTeam[]>(hubPayload.buildAgentTeamsPath()),

    getAgentTeam: (teamId: string) =>
      request<HubAgentTeamDetail>(hubPayload.buildAgentTeamPath(teamId)),

    updateAgentTeam: (teamId: string, data: HubUpdateAgentTeamRequest) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildUpdateAgentTeamRequest(teamId, data)),

    deleteAgentTeam: (teamId: string) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildDeleteAgentTeamRequest(teamId)),

    addAgentTeamMember: (teamId: string, data: HubAddAgentTeamMemberRequest) =>
      invokePathInitRequest((path, init) => request<void>(path, init), hubPayload.buildAddAgentTeamMemberRequest(teamId, data)),

    startTeamRun: (teamId: string, data: HubStartAgentTeamRunRequest) =>
      invokePathInitRequest((path, init) => request<HubAgentTeamRun>(path, init), hubPayload.buildStartTeamRunRequest(teamId, data)),

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
      invokePathInitRequest((path, init) => request<HubTeamApprovalState>(path, init), hubPayload.buildDecideTeamApprovalRequest(teamId, runId, approvalId, decision)),

    resolveTeamConflict: (
      teamId: string,
      runId: string,
      conflictId: string,
      resolution: HubTeamConflictResolutionRequest,
    ) =>
      invokePathInitRequest((path, init) => request<HubTeamConflictState>(path, init), hubPayload.buildResolveTeamConflictRequest(teamId, runId, conflictId, resolution)),

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubAgentProfileListResponse>(hubPayload.buildListAgentProfilesPath(params)),

    createAgentProfile: (data: HubCreateAgentProfileRequest) =>
      invokePathInitRequest((path, init) => request<HubAgentProfile>(path, init), hubPayload.buildCreateAgentProfileRequest(data)),

    updateAgentProfile: (id: string, data: HubUpdateAgentProfileRequest) =>
      invokePathInitRequest((path, init) => request<HubAgentProfile>(path, init), hubPayload.buildUpdateAgentProfileRequest(id, data)),

    deleteAgentProfile: (id: string) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildDeleteAgentProfileRequest(id)),

    fetchSettings: () => request<Record<string, string>>(hubPayload.buildSettingsPath()),

    patchSettings: (values: Record<string, string>) =>
      invokePathInitRequest(
        (path, init) => request<Record<string, string>>(path, init),
        hubPayload.buildPatchSettingsRequest(values),
      ),

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) =>
      invokePathInitRequest((path, init) => request<HubProbeAttachmentResponse>(path, init), hubPayload.buildProbeAttachmentRequest(hash)),

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) =>
      invokePathFormDataUpload((path, formData) => uploadMultipart<HubAttachmentRef>(path, formData), hubPayload.buildUploadAttachmentRequest(file, hash)),

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
      invokePathInitRequest((path, init) => request<HubDocument>(path, init), hubPayload.buildCreateDocumentRequest(data)),

    updateDocument: (id: string, data: HubUpdateDocumentRequest) =>
      invokePathInitRequest((path, init) => request<HubDocument>(path, init), hubPayload.buildUpdateDocumentRequest(id, data)),

    deleteDocument: (id: string) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildDeleteDocumentRequest(id)),

    getAgentProfile: (id: string) =>
      request<HubAgentProfile>(hubPayload.buildAgentProfilePath(id)),

    removeAgentTeamMember: (teamId: string, memberId: string) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildRemoveAgentTeamMemberRequest(teamId, memberId)),

    postTeamRouteDecision: (
      teamId: string,
      runId: string,
      decision: HubCoordinatorRouteDecision,
    ) =>
      invokePathInitRequest((path, init) => request<Record<string, unknown>>(path, init), hubPayload.buildPostTeamRouteDecisionRequest(teamId, runId, decision)),

    streamTaskEvent: (
      taskId: string,
      eventType: string,
      payload: unknown,
      options: HubAgentTaskStreamEventOptions = {},
    ) =>
      invokePathInitRequest((path, init) => request<undefined>(path, init), hubPayload.buildStreamTaskEventRequest(taskId, eventType, payload, options)),

    // ── T3.4 web task approvals/artifacts ──
    listTaskApprovals: (taskId: string) =>
      request<HubAgentTaskApprovalList>(hubPayload.buildListTaskApprovalsPath(taskId)),

    decideTaskApproval: (
      taskId: string,
      approvalId: string,
      decision: HubTaskApprovalDecisionRequest,
    ) =>
      invokePathInitRequest((path, init) => request<HubAgentTaskApproval>(path, init), hubPayload.buildDecideTaskApprovalRequest(taskId, approvalId, decision)),

    listTaskArtifacts: (taskId: string) =>
      request<HubAgentTaskArtifactList>(hubPayload.buildListTaskArtifactsPath(taskId)),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
