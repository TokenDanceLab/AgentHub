/**
 * Hub client pure JSON RequestInit + path+init composite builders.
 * Peel companion of hubClientPayloadUtils (#1094). Pure only; zero behavior change.
 *
 * #1101 residual peel: implementations live in domain companions; this file is the
 * public barrel so hubClientPayloadUtils re-exports remain stable.
 */

export {
  buildJsonPostInit,
  buildJsonPutInit,
  buildJsonPatchInit,
  buildJsonDeleteInit,
  buildPostInit,
  buildDeleteInit,
  buildPutInit,
  buildPostWithOptionalJsonBody,
  buildChangePasswordPrimary,
  buildChangePasswordFallback,
  type HubJsonPathInit,
  type HubMethodPathInit,
} from './hubClientPayloadRequestInits';

export {
  buildRefreshRequest,
  buildOidcAuthorizeRequest,
  buildRegisterRequest,
  buildLoginRequest,
  buildUpdateProfileRequest,
  buildOidcCallbackPathInit,
  buildLogoutRequest,
} from './hubClientPayloadRequestsAuth';

export {
  buildSendFriendRequest,
  buildUpdateContactRemarkRequest,
  buildAddSessionMembersRequest,
  buildTransferSessionOwnershipRequest,
  buildMarkReadRequest,
  buildPinMessageRequest,
  buildUnpinMessageRequest,
  buildForwardMessageRequest,
  buildAddMessageReactionRequest,
  buildRemoveMessageReactionRequest,
  buildAcceptFriendRequest,
  buildRejectFriendRequest,
  buildRemoveContactRequest,
  buildCreatePrivateSessionRequest,
  buildCreateGroupSessionRequest,
  buildRemoveSessionMemberRequest,
  buildUpdateSessionInfoRequest,
  buildUpdateSessionSettingsRequest,
  buildSendMessageRequest,
  buildAddAgentToSessionRequest,
  buildEditMessageRequest,
  buildBlockContactRequest,
  buildUnblockContactRequest,
  buildLeaveSessionRequest,
  buildDissolveSessionRequest,
  buildDeleteSessionRequest,
  buildRecallMessageRequest,
} from './hubClientPayloadRequestsSocial';

export {
  buildAckTaskRequest,
  buildStreamTaskRequest,
  buildDoneTaskRequest,
  buildFailTaskRequest,
  buildTriggerAgentTaskRequest,
  buildStreamTaskEventRequest,
  buildRegenerateAgentTaskRequest,
  buildDecideTaskApprovalRequest,
} from './hubClientPayloadRequestsTasks';

export {
  buildPatchSettingsRequest,
  buildProbeAttachmentRequest,
  buildUploadAttachmentRequest,
  buildCreateExecutionTargetRequest,
  buildUpdateExecutionTargetRequest,
  buildPingExecutionTargetRequest,
  buildCreateRelayCommandRequest,
  buildCreateCustomAgentRequest,
  buildUpdateCustomAgentRequest,
  buildCreateWorkspaceProjectRequest,
  buildUpdateWorkspaceProjectRequest,
  buildCreateWorkspaceProjectThreadRequest,
  buildSendWorkspaceProjectThreadMessageRequest,
  buildDeleteExecutionTargetRequest,
  buildAckRelayCommandRequest,
  buildDeleteCustomAgentRequest,
} from './hubClientPayloadRequestsWorkspace';

export {
  buildCreateAgentTeamRequest,
  buildUpdateAgentTeamRequest,
  buildAddAgentTeamMemberRequest,
  buildStartTeamRunRequest,
  buildDecideTeamApprovalRequest,
  buildResolveTeamConflictRequest,
  buildCreateAgentProfileRequest,
  buildUpdateAgentProfileRequest,
  buildCreateDocumentRequest,
  buildUpdateDocumentRequest,
  buildRemoveAgentTeamMemberRequest,
  buildPostTeamRouteDecisionRequest,
  buildDeleteAgentTeamRequest,
  buildDeleteAgentProfileRequest,
  buildDeleteDocumentRequest,
} from './hubClientPayloadRequestsTeams';

