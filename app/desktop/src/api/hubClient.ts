import { HUB_URL } from '@/config';
import { createHubClient as createSharedHubClient } from '@shared/hubClient';
import type { HubClientOptions } from '@shared/hubClient';

export {
  HubError,
  isHubResponseEnvelope,
  parseHubError,
  unwrapHubResponse,
} from '@shared/hubClient';

export type {
  AddAgentToSessionRequest,
  AuthResponse,
  ChangePasswordRequest,
  Contact,
  ContactInfo,
  CreateGroupSessionRequest,
  CreatePrivateSessionRequest,
  CustomAgentRequest,
  Device,
  FriendRequestInfo,
  HubAddAgentToSessionRequest,
  HubAgentDispatchFrame,
  HubAgentDispatchPayload,
  HubAgentTask,
  HubAgentTaskStatus,
  HubAuthResponse,
  HubChangePasswordRequest,
  HubClientOptions,
  HubContactInfo,
  HubCreateGroupSessionRequest,
  HubCreatePrivateSessionRequest,
  HubCreateSessionResponse,
  HubCustomAgent,
  HubCustomAgentRequest,
  HubDevice,
  HubFrame,
  HubFriendRequest,
  HubKnownFrame,
  HubLoginRequest,
  HubMessage,
  HubNotification,
  HubRegisterDeviceRequest,
  HubRegisterRequest,
  HubResponseEnvelope,
  HubSearchResult,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubSession,
  HubSessionMember,
  HubTriggerAgentTaskRequest,
  HubUpdateProfileRequest,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubUserProfile,
  LoginRequest,
  MessageResponse,
  RegisterDeviceRequest,
  RegisterRequest,
  ReplyToInfo,
  SearchResult,
  SendMessageRequest,
  SendMessageResponse,
  Session,
  SessionMember,
  UpdateProfileRequest,
  UserProfile,
} from '@shared/hubClient';

export function createHubClient(opts: HubClientOptions = {}) {
  return createSharedHubClient({
    ...opts,
    baseUrl: opts.baseUrl || HUB_URL,
  });
}

export type HubClient = ReturnType<typeof createHubClient>;
