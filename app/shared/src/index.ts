export type {
  HealthResponse,
  Project,
  ProjectMemory,
  Conversation,
  Thread,
  ThreadItem,
  ThreadItemKind,
  Message,
  Runner,
  Run,
  RunInfo,
  RunStatus,
  StartRunRequest,
  AgentCapabilities,
  AgentInfo,
  ThreadInfo,
  ThreadItemInfo,
  RunLogs,
  RunDiff,
  Approval,
  Artifact,
  Preview,
  Workspace,
  WorkspaceFile,
  PageInfo,
  ListResponse,
} from './types';

export type {
  EventEnvelope,
  EventScope,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ThreadCreatedEvent,
  ThreadUpdatedEvent,
  MessageCreatedEvent,
  MessageDeltaEvent,
  ItemCreatedEvent,
  ItemUpdatedEvent,
  RunnerOnlineEvent,
  RunnerOfflineEvent,
  RunQueuedEvent,
  RunStartedEvent,
  RunStatusChangedEvent,
  RunOutputEvent,
  RunOutputBatchEvent,
  RunFinishedEvent,
  RunFailedEvent,
  ApprovalRequestedEvent,
  ApprovalDecidedEvent,
  ArtifactCreatedEvent,
  PreviewReadyEvent,
  ErrorEvent,
  AnyEvent,
} from './events';

export { parseError, isErrorResponse, AppError, globalErrorReporter, reportApiError } from './errors';
export type { ErrorBody, ErrorCategory, ErrorReport } from './errors';

export { setToastHandler } from './errorReporting';
export type { ErrorStats, ToastConfig, ToastSeverity } from './errorReporting';

export { buildTree, flattenTree } from './tree';
export type { TreeNode } from './tree';

export {
  SHARED_WORKBENCH_I18N_NAMESPACE,
  flattenSharedWorkbenchResource,
  sharedWorkbenchResources,
} from './i18n';
export type {
  SharedWorkbenchLanguage,
  SharedWorkbenchResourceTree,
} from './i18n';

export {
  AGENTHUB_THEME_STORAGE_KEY,
  applyAgentHubTheme,
  getAppliedAgentHubTheme,
  getStoredAgentHubThemeMode,
  getSystemAgentHubTheme,
  persistAgentHubThemeMode,
  resolveAgentHubTheme,
  toggleAppliedAgentHubTheme,
} from './theme';
export type {
  AgentHubTheme,
  AgentHubThemeMode,
} from './theme';

export {
  FOLDER_THEME_COLORS,
  FOLDER_THEME_COLOR_META,
  applyFolderThemeColor,
  getFolderThemeColorMeta,
  isFolderThemeColor,
} from './folderThemeColors';
export type {
  FolderThemeColor,
  FolderThemeColorMeta,
} from './folderThemeColors';

export { parseUnifiedDiff } from './diff';
export type { DiffFile, DiffHunk, DiffLine } from './diff';

export {
  normalize,
  text as diffText,
} from './diff';
export type {
  ViewDiff,
  LegacyDiff,
  ReviewDiff,
} from './diff';

// TS-side extraction / validation (no Go counterpart — edge-server/internal/diff removed in #2151)
export { isDiff, extractDiffs, isObj } from './diff';
export type { DiffInput } from './diff';

export {
  estimateTokens,
  breakdownContext,
  toSegments,
  formatTokens,
  formatCost,
} from './context/breakdown';
export type {
  ContextBreakdown,
  BreakdownSegment,
  SessionMetrics,
} from './context/breakdown';

export { HUB_EVENTS } from './hubEvents';
export type { HubEventType } from './hubEvents';

export { hubQueryKeys, edgeQueryKeys } from './stores/queryKeys';

export {
  createHubClient,
  HubError,
  isHubResponseEnvelope,
  parseHubError,
  unwrapHubResponse,
} from './hub/hubClient';
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
  HubAgentCancelFrame,
  HubAgentCancelPayload,
  HubAgentDoneFrame,
  HubAgentDonePayload,
  HubAgentFailedFrame,
  HubAgentFailedPayload,
  HubAgentStreamFrame,
  HubAgentStreamPayload,
  HubAgentTask,
  HubAgentTaskStatus,
  HubAuthResponse,
  HubChangePasswordRequest,
  HubClient,
  HubClientOptions,
  HubContactInfo,
  HubCreateGroupSessionRequest,
  HubCreatePrivateSessionRequest,
  HubCreateSessionResponse,
  HubCreateWorkspaceProjectRequest,
  HubCreateWorkspaceProjectThreadRequest,
  HubCustomAgent,
  HubCustomAgentRequest,
  HubDevice,
  HubDeviceKickedFrame,
  HubDeviceKickedPayload,
  HubDeviceOfflineFrame,
  HubDeviceOnlineFrame,
  HubDevicePresencePayload,
  HubAuditEvent,
  HubExecutionTarget,
  HubExecutionTargetRequest,
  HubExecutionTargetType,
  HubFrame,
  HubFriendAcceptedFrame,
  HubFriendEventPayload,
  HubFriendRequestFrame,
  HubFriendRequest,
  HubKnownFrame,
  HubLoginRequest,
  HubListResponse,
  HubMessage,
  HubNotification,
  HubNotificationNewFrame,
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubRegisterDeviceRequest,
  HubRegisterRequest,
  HubRelayCommand,
  HubRelayCommandRequest,
  HubResponseEnvelope,
  HubSearchResult,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubSendWorkspaceProjectThreadMessageRequest,
  HubSession,
  HubSessionMember,
  HubTaskAckRequest,
  HubTaskDoneRequest,
  HubTaskFailRequest,
  HubTaskRunRequest,
  HubTaskStreamRequest,
  HubTriggerAgentTaskRequest,
  HubUpdateProfileRequest,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubUpdateWorkspaceProjectRequest,
  HubUserProfile,
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubWorkspaceProjectThread,
  HubWorkspaceProjectThreadMessage,
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
} from './hub/hubClient';

export { createEventStream } from './eventClient';
export type {
  EventHandler,
  EventStreamOptions,
  StatusHandler,
  StreamHandle,
} from './eventClient';

export {
  SURFACE_METADATA,
  SURFACE_STATUS_METADATA,
  getSurfaceByDesktopSectionId,
  getSurfaceMetadata,
  getSurfaceStatusMetadata,
  getSurfacesByCategory,
  getSurfacesByPlatform,
} from './surfaceMetadata';

export {
  buildAgentHubAgentSpecV1,
  formatAgentHubAgentSpecV1,
} from './agentSpec';
export type {
  AgentHubAgentSpecApprovalPolicyV1,
  AgentHubAgentSpecAvatarV1,
  AgentHubAgentSpecDraftV1,
  AgentHubAgentSpecFixturePolicyV1,
  AgentHubAgentSpecMCPServerV1,
  AgentHubAgentSpecMemoryPolicyV1,
  AgentHubAgentSpecRuntimeV1,
  AgentHubAgentSpecTargetPreferenceV1,
  AgentHubAgentSpecV1,
} from './agentSpec';
export type {
  SurfaceCategory,
  SurfaceId,
  SurfaceMetadata,
  SurfacePlatform,
  SurfaceStatus,
  SurfaceStatusMetadata,
} from './surfaceMetadata';

export {
  browserFilesToComposerAttachments,
  desktopPathsToComposerAttachments,
  buildComposerIntent,
  canSubmitComposer,
  composerReducer,
  createInitialComposerState,
  formatComposerAttachmentContext,
  formatComposerAttachmentSize,
  formatComposerMentionContext,
  formatComposerPromptWithContext,
  formatComposerPromptWithAttachments,
  shouldPreviewComposerFile,
  shouldPreviewComposerFileName,
} from './composer';
export type {
  ApprovalMode,
  ComposerAction,
  ComposerAttachment,
  ComposerIntent,
  ComposerMention,
  ComposerMode,
  ComposerState,
  ComposerSubmitResult,
  ComposerSubmitState,
} from './composer';

export {
  buildInspectorEvidenceModel,
  evidenceStatusLabel,
} from './inspector';
export type {
  InspectorEvidenceModel,
} from './inspector';

export {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  createWorkbenchDemoRuntimeStore,
  createWorkbenchDemoStore,
  demoWorkbenchAgents,
  demoWorkbenchPins,
  normalizeWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
  workbenchDemoRuntimeStore,
} from './demo';
export type {
  WorkbenchDemoMessagePin,
  WorkbenchDemoRuntimeStore,
  WorkbenchDemoStore,
  WorkbenchDemoSurface,
} from './demo';

export type {
  AgentHubPlatform,
  AgentHubSurface,
  AttachmentPort,
  ConversationKind,
  ConversationPort,
  RunPort,
  SurfaceCapabilities,
  WorkbenchAgent,
  WorkbenchConversation,
} from './platform';

export {
  collectTranscriptEvidence,
} from './transcript';
export type {
  ApprovalTranscriptBlock,
  AgentTimelineItem,
  AgentTimelineTranscriptBlock,
  ArtifactTranscriptBlock,
  AttachmentTranscriptBlock,
  ChildAgentTranscriptBlock,
  ContextUsageTranscriptBlock,
  DiffTranscriptBlock,
  ResultTranscriptBlock,
  RouteDecisionTranscriptBlock,
  RunStepGroupTranscriptBlock,
  EvidenceRef,
  EvidenceRefKind,
  EvidenceRefStatus,
  RunSessionTranscriptBlock,
  SubagentTranscriptBlock,
  TextTranscriptBlock,
  ThinkingTranscriptBlock,
  ToolCallTranscriptBlock,
  TranscriptAuthor,
  TranscriptAuthorRole,
  TranscriptBlock,
} from './transcript';
