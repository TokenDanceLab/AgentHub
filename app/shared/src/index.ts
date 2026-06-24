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

export { parseError, isErrorResponse, AppError, globalErrorReporter, ErrorReporter, reportApiError } from './errors';
export type { ErrorBody, ErrorCategory, ErrorReport } from './errors';

export { useErrorReporter, setToastHandler } from './errorReporting';
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

export { hubQueryKeys, edgeQueryKeys, isQueryKeyPrefix, rootPrefix } from './stores/queryKeys';

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

export {
  AGENTHUB_AGENT_SPEC_V1,
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

export {
  createMockPlatform,
} from './platform';
export type {
  AgentHubPlatform,
  AgentHubSurface,
  AttachmentPort,
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

export {
  AgentHubWorkbench,
  ConversationSidebar,
  GlobalRail,
  RightInspector,
  UnifiedComposer,
  WorkspaceHeader,
  agentConfigToAgentSpecFixture,
} from './workbench';
export type {
  AgentHubWorkbenchProps,
  ConversationSidebarProps,
  RightInspectorProps,
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
