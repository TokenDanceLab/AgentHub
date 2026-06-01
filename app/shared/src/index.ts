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
  RunStatus,
  StartRunRequest,
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

export { parseError, isErrorResponse, AppError } from './errors';

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
export type { EventListener, EventClientOptions } from './eventClient';

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

// Workbench state management (shared across Desktop and Web)
export {
  workbenchReducer,
  type WorkbenchState,
  type WorkbenchAction,
  type WorkbenchSnapshot,
} from './workbenchState';

// Workbench data mode classifier
export {
  getWorkbenchDataMode,
  getWorkbenchCatalogState,
  getWorkbenchSectionSource,
  type WorkbenchDataMode,
  type WorkbenchCatalogState,
  type WorkbenchSectionSource,
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
  type SurfaceCategory,
  type SurfaceId,
  type SurfaceMetadata,
  type SurfacePlatform,
  type SurfaceStatus,
  type SurfaceStatusMetadata,
} from './surfaceMetadata';

export {
  DESKTOP_GLASS_TOKEN_ALIASES,
  DESKTOP_GLASS_SURFACE_RULES,
  getGlassTokenAlias,
  getSurfaceRulesForPlatform,
  type DesignPlatform,
  type GlassTokenAlias,
  type DesignSurfaceRule,
} from './designTokens';

// Hub REST client (shared across Desktop and Web)
export {
  createHubClient,
  type HubClient,
  type HubEnvelope,
  type HubCustomAgent,
  type HubSession,
  type HubMessage,
  type HubContactInfo,
} from './hubClient';

// UI components (shared across Desktop and Web)
export {
  PermissionModePicker,
  ToolTimeline,
  DiffReviewPanel,
} from './ui';
export type {
  PermissionModeOption,
  PermissionModePickerProps,
  ToolTimelineBlock,
  ToolTimelineProps,
  ToolTimelineLabels,
  ToolTimelineToolUse,
  ToolTimelineFileChange,
  ToolTimelineAgentTask,
  ToolTimelineChildAgent,
  ToolTimelineRouteDecision,
  DiffReviewFile,
  DiffReviewLabels,
  DiffReviewPanelProps,
} from './ui';
