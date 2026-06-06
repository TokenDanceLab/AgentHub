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

export { parseError, isErrorResponse, AppError, globalErrorReporter, ErrorReporter } from './errors';
export type { ErrorBody, ErrorCategory, ErrorReport } from './errors';

export { useErrorReporter, setToastHandler } from './errorReporting';
export type { ErrorStats, ToastConfig, ToastSeverity } from './errorReporting';

export { buildTree, flattenTree } from './tree';
export type { TreeNode } from './tree';

export { normalizeDiffs, parseUnifiedDiff } from './diff';
export type { DiffFile, DiffHunk, DiffLine } from './diff';

export {
  normalize,
  text as diffText,
  parseUnifiedPatch,
} from './diff';
export type {
  ViewDiff,
  LegacyDiff,
  ReviewDiff,
} from './diff';

// Go-ported extraction / validation (edge-server/internal/diff/diff.go)
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

export {
  createHubClient,
  HubError,
  isHubResponseEnvelope,
  parseHubError,
  unwrapHubResponse,
} from './hubClient';
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
} from './hubClient';

export {
  setBaseUrl,
  getBaseUrl,
  getHealth,
  listProjects,
  getProject,
  createProject,
  getProjectMemory,
  listThreads,
  getThread,
  createThread,
  updateThread,
  archiveThread,
  listThreadItems,
  createThreadMessage,
  listRunners,
  getRunner,
  pingRunner,
  listRuns,
  getRun,
  startRun,
  cancelRun,
  listRunItems,
  getRunLogs,
  getRunDiff,
  listApprovals,
  getApproval,
  decideApproval,
  listArtifacts,
  getArtifact,
  getArtifactContent,
  applyArtifact,
  discardArtifact,
  listPreviews,
  getPreview,
  createPreview,
  getWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
} from './apiClient';

export { EventClient } from './eventClient';
export type {
  EventClientOptions,
  EventConnectionListener,
  EventConnectionStatus,
  EventListener,
} from './eventClient';

export {
  createWorkbenchState,
  initialWorkbenchState,
  workbenchReducer,
} from './workbenchState';
export type {
  WorkbenchAction,
  WorkbenchConnectionStatus,
  WorkbenchSnapshot,
  WorkbenchState,
} from './workbenchState';
export {
  getWorkbenchCatalogState,
  getWorkbenchDataMode,
  getWorkbenchSectionSource,
  workbenchDataModeLabels,
  workbenchDataModeTones,
} from './workbenchDataMode';
export type {
  WorkbenchCatalogState,
  WorkbenchCatalogTone,
  WorkbenchDataMode,
  WorkbenchSectionSource,
  WorkbenchSectionSourceInput,
} from './workbenchDataMode';

export {
  SURFACE_METADATA,
  SURFACE_STATUS_METADATA,
  getSurfaceByDesktopSectionId,
  getSurfaceByWebRoute,
  getSurfaceMetadata,
  getSurfaceStatusMetadata,
  getSurfacesByCategory,
  getSurfacesByPlatform,
  surfaceMetadataById,
  surfaceStatusById,
} from './surfaceMetadata';
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
  createMockPlatform,
} from './platform';
export type {
  AgentHubPlatform,
  AgentHubSurface,
  ConversationKind,
  ConversationPort,
  MockPlatform,
  MockPlatformSeed,
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
  ArtifactTranscriptBlock,
  DiffTranscriptBlock,
  EvidenceRef,
  EvidenceRefKind,
  EvidenceRefStatus,
  TextTranscriptBlock,
  ToolCallTranscriptBlock,
  TranscriptAuthor,
  TranscriptAuthorRole,
  TranscriptBlock,
} from './transcript';

export {
  AgentHubWorkbench,
  ConversationSidebar,
  GlobalRail,
  RightInspector,
  TranscriptView,
  UnifiedComposer,
  WorkspaceHeader,
} from './workbench';
export type {
  AgentHubWorkbenchProps,
  ConversationSidebarProps,
  RightInspectorProps,
  TranscriptViewProps,
  UnifiedComposerProps,
  WorkspaceHeaderProps,
} from './workbench';

export {
  mockProject,
  mockProjects,
  mockThreads,
  mockMessages,
  mockThreadItems,
  mockRunners,
  mockRuns,
  mockApprovals,
  mockArtifacts,
  mockPreviews,
  mockWorkspaces,
  mockWorkspaceFiles,
  MockEventStream,
  playRunLifecycle,
  playMessageStream,
} from './mock';
