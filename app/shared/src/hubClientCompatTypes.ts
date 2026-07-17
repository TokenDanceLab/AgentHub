/**
 * Hub client compatibility aliases (desktop/web historical names → Hub* types).
 * Extracted from hubClient.ts (#799) — pure types/const only; re-exported by hubClient.
 * Keep public names stable for web/desktop imports via @shared/hubClient.
 */

import type {
  HubRegisterRequest,
  HubLoginRequest,
  HubAuthResponse,
  HubUserProfile,
  HubUpdateProfileRequest,
  HubChangePasswordRequest,
  HubSearchResult,
  HubFriendRequest,
  HubContactInfo,
  HubSession,
  HubSessionMember,
  HubCreatePrivateSessionRequest,
  HubCreateGroupSessionRequest,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubReplyToInfo,
  HubMessage,
  HubMessageAttachment,
  HubRegisterDeviceRequest,
  HubDevice,
  HubAddAgentToSessionRequest,
  HubCustomAgentRequest,
  HubCustomAgent,
  HubNotification,
  HubExecutionTarget,
  HubExecutionTargetType,
  HubExecutionTargetRequest,
  HubExecutionTargetListResponse,
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
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubSkill,
  HubMCPServer,
} from './hubClientDomainTypes';

export type EmptyHubResponse = undefined;

// ---------------------------------------------------------------------------
// Compatibility aliases (desktop/web historical names → shared Hub* types)
// Slice1 (#430): align names without moving method implementations yet.
// Prefer Hub* names in new shared code; aliases exist so surface forks can
// re-export shared types without a big-bang rename.
// ---------------------------------------------------------------------------
export type RegisterRequest = HubRegisterRequest;
export type LoginRequest = HubLoginRequest;
export type AuthResponse = HubAuthResponse;
export type UserProfile = HubUserProfile;
export type UpdateProfileRequest = HubUpdateProfileRequest;
export type ChangePasswordRequest = HubChangePasswordRequest;
export type SearchResult = HubSearchResult;
export type FriendRequestInfo = HubFriendRequest;
export type ContactInfo = HubContactInfo;
/** @deprecated Prefer HubContactInfo / relationship fields; kept for desktop/web parity. */
export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  remark?: string;
  friend?: UserProfile;
  created_at?: string;
}
/** Alias: desktop/web historically used Session; shared canonical type is HubSession. */
export type Session = HubSession;
export type HubSessionAlias = HubSession;
export type SessionMember = HubSessionMember;
export type CreatePrivateSessionRequest = HubCreatePrivateSessionRequest;
export type CreateGroupSessionRequest = HubCreateGroupSessionRequest;
export type SendMessageRequest = HubSendMessageRequest;
export type SendMessageResponse = HubSendMessageResponse;
export type ReplyToInfo = HubReplyToInfo;
export type MessageResponse = HubMessage;
export type MessageAttachment = HubMessageAttachment;
export type RegisterDeviceRequest = HubRegisterDeviceRequest;
export type Device = HubDevice;
export type AddAgentToSessionRequest = HubAddAgentToSessionRequest;
export type CustomAgentRequest = HubCustomAgentRequest;
export type CustomAgent = HubCustomAgent;
export type Notification = HubNotification;
export type ExecutionTarget = HubExecutionTarget;
export type ExecutionTargetType = HubExecutionTargetType;
export type ExecutionTargetRequest = HubExecutionTargetRequest;
export type ExecutionTargetListResponse = HubExecutionTargetListResponse;
export type WorkspaceProject = HubWorkspaceProject;
export type WorkspaceProjectListResponse = HubWorkspaceProjectListResponse;
export type CreateWorkspaceProjectRequest = HubCreateWorkspaceProjectRequest;
export type UpdateWorkspaceProjectRequest = HubUpdateWorkspaceProjectRequest;
export type WorkspaceProjectThread = HubWorkspaceProjectThread;
export type CreateWorkspaceProjectThreadRequest = HubCreateWorkspaceProjectThreadRequest;
export type SendWorkspaceProjectThreadMessageRequest = HubSendWorkspaceProjectThreadMessageRequest;
export type WorkspaceProjectThreadMessage = HubWorkspaceProjectThreadMessage;
export type AgentTask = HubAgentTask;
export type TriggerAgentTaskOptions = HubTriggerAgentTaskOptions;
export type OIDCAuthorizeRequest = HubOidcAuthorizeRequest;
export type OIDCAuthorizeResponse = HubOidcAuthorizeResponse;
export type OIDCCallbackRequest = HubOidcCallbackRequest;
export type OIDCCallbackResponse = HubOidcCallbackResponse;
export type Skill = HubSkill;
export type MCPServer = HubMCPServer;

/**
 * Method groups still owned by desktop/web forks (not yet on shared createHubClient).
 * Tracked for T3.2 method parity — do not implement ad-hoc only on one surface.
 * @see docs/analysis/hubclient-ssot-slice1.md
 */
export const HUBCLIENT_SSOT_GAPS = {
  /** Present on both desktop and web, missing from shared createHubClient return. */
  desktopAndWebNotShared: [
    // T3.2 landed these on shared createHubClient
  ],
  /** Desktop-only relative to web (keep desktop-local until product decision). */
  desktopOnly: [
    // create/updateExecutionTarget request-shape differences may remain surface-local
  ],
  /** Web-only relative to desktop. */
  webOnly: [
    // T3.4 landed task approvals/artifacts on shared
  ],
} as const;
