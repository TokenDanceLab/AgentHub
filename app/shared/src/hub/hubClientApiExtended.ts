/**
 * Hub Client Extended API surfaces: Workspace, Teams, Profiles, Documents,
 * Attachments, Settings, Task approvals/artifacts, T3.2–T3.4 parity.
 * Extracted from hubClient.ts (#1086). Zero behavior change.
 */

import type {
  HubAgentRunEventSummary,
  HubAgentRunEvent,
  HubCoordinatorRouteDecision,
  HubAgentTeam,
  HubAgentTeamDetail,
  HubAgentTeamRun,
  HubAgentTeamTask,
  HubTeamApprovalState,
  HubTeamConflictState,
  HubTeamRunState,
  HubTeamEventsPage,
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
} from './hubClientTeamTypes';

import type {
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubCreateWorkspaceProjectRequest,
  HubUpdateWorkspaceProjectRequest,
  HubWorkspaceProjectThread,
  HubCreateWorkspaceProjectThreadRequest,
  HubSendWorkspaceProjectThreadMessageRequest,
  HubWorkspaceProjectThreadMessage,
  HubMessage,
} from './hubClientDomainTypes';

import * as hubPayload from './hubClientPayloadUtils';
import {
  invokePathFormDataUpload,
  invokePathInitRequest,
} from './hubClientRequestUtils';

export interface HubClientExtendedApiDeps {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  uploadMultipart: <T>(path: string, formData: FormData) => Promise<T>;
  baseUrl: string;
}

export function createHubClientExtendedApi(deps: HubClientExtendedApiDeps) {
  const { request, uploadMultipart, baseUrl } = deps;
  return {
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

    listTeamEvents: (teamId: string, runId: string, params?: { afterSeq?: number; pageSize?: number }) =>
      request<HubTeamEventsPage>(hubPayload.buildListTeamEventsPath(teamId, runId, params)),

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
