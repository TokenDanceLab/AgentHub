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
