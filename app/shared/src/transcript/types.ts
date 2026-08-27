export type TranscriptAuthorRole = 'human' | 'agent' | 'system';

export interface TranscriptAuthor {
  id: string;
  name: string;
  role: TranscriptAuthorRole;
}

export type EvidenceRefKind = 'tool' | 'file' | 'artifact' | 'preview' | 'run' | 'approval';
export type EvidenceRefStatus = 'pending' | 'running' | 'completed' | 'failed';
export type BadgeVariant = 'thinking' | 'success' | 'warning' | 'danger' | 'primary';

export interface EvidenceRef {
  id: string;
  kind: EvidenceRefKind;
  label: string;
  status?: EvidenceRefStatus;
  path?: string;
  uri?: string;
  mimeType?: string;
  /**
   * Executor-reported working directory for `kind: 'run'` refs (#1967).
   * Only present when the Edge executor resolved a workspace for the run;
   * it is the sole trusted workDir evidence for run-level diff apply.
   * Absence means run review must stay read-only — never guess a workDir.
   */
  workDir?: string;
}

export interface ApprovalDecisionAction {
  approvalId: string;
  decision: 'allow' | 'deny';
  teamId?: string;
  teamRunId?: string;
  agentTaskId?: string;
  targetId?: string;
  edgeDeviceId?: string;
  correlationId?: string;
}

interface TranscriptBlockBase {
  id: string;
  author: TranscriptAuthor;
  createdAt?: string;
  evidenceRefs?: EvidenceRef[];
  /**
   * Whether the underlying hub message is pinned in its session. Written by
   * the adapter (normalizeHubMessagesToTranscript) from message-level pin
   * state; drives the pin/unpin toggle in the transcript context menu.
   */
  pinned?: boolean;
}

export interface TextTranscriptBlock extends TranscriptBlockBase {
  kind: 'text';
  text: string;
  displayTitle?: string;
  displayDetail?: string;
  badgeLabel?: string;
  badgeVariant?: BadgeVariant;
  /** ID of the message this is replying to. */
  replyToMessageId?: string;
  /** Short preview of the replied message content. */
  replyPreview?: string;
  /** Author name of the replied message. */
  replyAuthor?: string;
  /** Quoted text excerpt (rendered as blockquote in the message bubble). */
  quote?: string;
  /** Previous version content when this message was regenerated. */
  previousVersion?: string;
  /** Whether a newer version exists (old message shown grayed). */
  hasNewerVersion?: boolean;
}

export interface ToolCallTranscriptBlock extends TranscriptBlockBase {
  kind: 'tool_call';
  callId?: string;
  toolName: string;
  status: EvidenceRefStatus;
  target?: string;
  summary?: string;
  /**
   * Bounded scalar projection of the tool's invocation arguments
   * (`payload.input`, #1998 UX F8). Only flat string (<= 512 chars) /
   * number / boolean entries survive; rich payloads (patches, file
   * contents) are intentionally dropped so transcripts stay light.
   * Absent when the event carried no usable scalar arguments.
   */
  input?: Readonly<Record<string, string | number | boolean>>;
}

export interface ToolResultTranscriptBlock extends TranscriptBlockBase {
  kind: 'tool_result';
  callId?: string;
  toolName: string;
  status: EvidenceRefStatus;
  summary?: string;
}

export interface ArtifactTranscriptBlock extends TranscriptBlockBase {
  kind: 'artifact';
  title: string;
  artifactId?: string;
  artifactKind?: string;
  threadId?: string;
  path?: string;
  uri?: string;
  mimeType?: string;
  action?: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
}

export interface PreviewTranscriptBlock extends TranscriptBlockBase {
  kind: 'preview';
  previewId: string;
  threadId?: string;
  status: EvidenceRefStatus;
  url?: string;
}

export interface DiffTranscriptLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

export interface DiffTranscriptBlock extends TranscriptBlockBase {
  kind: 'diff';
  title: string;
  files: string[];
  additions?: number;
  deletions?: number;
  lines?: DiffTranscriptLine[];
  patch?: string;
}

export interface ApprovalTranscriptBlock extends TranscriptBlockBase {
  kind: 'approval';
  title: string;
  status: EvidenceRefStatus;
  toolName?: string;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
}

export interface PermissionRequestTranscriptBlock extends TranscriptBlockBase {
  kind: 'permission_request';
  requestId: string;
  title: string;
  status: 'pending';
  teamId?: string;
  teamRunId?: string;
  agentTaskId?: string;
  targetId?: string;
  edgeDeviceId?: string;
  correlationId?: string;
  toolName?: string;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
}

export interface PermissionResultTranscriptBlock extends TranscriptBlockBase {
  kind: 'permission_result';
  requestId: string;
  title: string;
  status: EvidenceRefStatus;
  decision: string;
  teamId?: string;
  teamRunId?: string;
  agentTaskId?: string;
  targetId?: string;
  edgeDeviceId?: string;
  correlationId?: string;
  toolName?: string;
  reason?: string;
}

export interface FileChangeTranscriptBlock extends TranscriptBlockBase {
  kind: 'file_change';
  path: string;
  action: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
  patch?: string;
  lines?: DiffTranscriptLine[];
  editId?: string;
  reviewStatus?: string;
  canApply?: boolean;
  canRevert?: boolean;
}

export interface RunSessionTranscriptBlock extends TranscriptBlockBase {
  kind: 'run_session';
  title: string;
  status?: 'running' | 'completed' | 'failed';
  meta?: string;
  agentLabel?: string;
  runtimeLabel?: string;
  runId?: string;
  taskId?: string;
  edgeRunId?: string;
  adapterId?: string;
  deviceId?: string;
  sourceLabel?: string;
  modeLabel?: string;
  targetLabel?: string;
}

export interface AgentTimelineItem {
  label: string;
  detail?: string;
  status: EvidenceRefStatus | 'done' | 'todo';
}

export interface AgentTimelineTranscriptBlock extends TranscriptBlockBase {
  kind: 'agent_timeline';
  title?: string;
  items: AgentTimelineItem[];
}

export interface RunStepGroupTranscriptBlock extends TranscriptBlockBase {
  kind: 'run_step_group';
  icon: string;
  title: string;
  status: EvidenceRefStatus;
  meta?: string;
  open?: boolean;
  children: TranscriptBlock[];
}

export interface ThinkingTranscriptBlock extends TranscriptBlockBase {
  kind: 'thinking';
  content?: string;
  isThinking?: boolean;
}

export interface SubagentTranscriptBlock extends TranscriptBlockBase {
  kind: 'subagent';
  title: string;
  worker: string;
  status: EvidenceRefStatus;
  summary?: string;
  runId?: string;
}

export interface CheckpointTranscriptBlock extends TranscriptBlockBase {
  kind: 'checkpoint';
  /** Edge run id this checkpoint belongs to (timeline grouping key). */
  runId: string;
  /** Checkpoint id on the Edge (`cp-<runId>`); used by the preview port. */
  checkpointId: string;
  /** Pre-run file inventory size. */
  fileCount: number;
  /** Summed pre-run byte size across captured files. */
  totalBytes: number;
}

export interface SubtaskTranscriptBlock extends TranscriptBlockBase {
  kind: 'subtask';
  title: string;
  worker?: string;
  status: EvidenceRefStatus;
  summary?: string;
  runId?: string;
}

export interface ChildAgentTranscriptBlock extends TranscriptBlockBase {
  kind: 'child_agent';
  title: string;
  agent: string;
  status: EvidenceRefStatus;
  summary?: string;
  runId?: string;
  parentRunId?: string;
}

export interface RouteDecisionTranscriptBlock extends TranscriptBlockBase {
  kind: 'route_decision';
  action: string;
  summary?: string;
  targetAgent?: string;
}

export interface ContextUsageTranscriptBlock extends TranscriptBlockBase {
  kind: 'context_usage';
  inputTokens: number;
  outputTokens: number;
  usagePercent?: number;
  contextLimit?: number;
  cachePercent?: number;
  cost?: string;
  modelLabel?: string;
}

export interface ResultTranscriptBlock extends TranscriptBlockBase {
  kind: 'result';
  success: boolean;
  duration?: string;
  turns?: number;
  summary?: string;
}

export interface FailureTranscriptBlock extends TranscriptBlockBase {
  kind: 'failure';
  title: string;
  reason?: string;
  runId?: string;
}

export interface FinishedTranscriptBlock extends TranscriptBlockBase {
  kind: 'finished';
  title: string;
  runId?: string;
  duration?: string;
}

export interface ReplayGapTranscriptBlock extends TranscriptBlockBase {
  kind: 'replay_gap';
  /** Number of events that were replayed to fill the gap. */
  replayedCount: number;
  /** Task ID the replayed events belong to. */
  taskId?: string;
  /** Whether the gap is still being filled (recovery in progress). */
  recovering?: boolean;
}

export interface AttachmentTranscriptBlock extends TranscriptBlockBase {
  kind: 'attachment';
  /**
   * The attachment reference stored on the Hub server. A degraded entry
   * (attachment data missing on an image/file message, #1972) uses an empty
   * `id`, which the renderer resolves to the #1938 honest fallback: file
   * chip plus explicit status notice instead of a silently dropped message.
   */
  attachmentRef: import('../composer').AttachmentRef;
  /** Whether this is an image or a generic file attachment. */
  contentType: 'image' | 'file';
}

export interface DeployTranscriptBlock extends TranscriptBlockBase {
  kind: 'deploy';
  /** The run ID that produced the deploy artifact. */
  runId: string;
  /** The artifact ID being deployed. */
  artifactId?: string;
  /** The file path being deployed. */
  path?: string;
  /** Type of deployment. */
  deployType?: string;
  /** Deployment status. */
  status?: 'pending' | 'ready' | 'deploying' | 'deployed' | 'failed';
  /** The deployed URL (set after successful deployment). */
  url?: string;
}

export interface CompactBoundaryTranscriptBlock extends TranscriptBlockBase {
  kind: 'compact_boundary';
  /** Compaction trigger (e.g. "auto", "manual"). */
  trigger?: string;
  /** Token count before compaction. */
  preTokens?: number;
}

export type TranscriptBlock =
  | TextTranscriptBlock
  | ToolCallTranscriptBlock
  | ToolResultTranscriptBlock
  | ArtifactTranscriptBlock
  | PreviewTranscriptBlock
  | DiffTranscriptBlock
  | ApprovalTranscriptBlock
  | PermissionRequestTranscriptBlock
  | PermissionResultTranscriptBlock
  | FileChangeTranscriptBlock
  | RunSessionTranscriptBlock
  | AgentTimelineTranscriptBlock
  | RunStepGroupTranscriptBlock
  | ThinkingTranscriptBlock
  | SubagentTranscriptBlock
  | SubtaskTranscriptBlock
  | ChildAgentTranscriptBlock
  | RouteDecisionTranscriptBlock
  | ContextUsageTranscriptBlock
  | ResultTranscriptBlock
  | FailureTranscriptBlock
  | FinishedTranscriptBlock
  | ReplayGapTranscriptBlock
  | AttachmentTranscriptBlock
  | CheckpointTranscriptBlock
  | DeployTranscriptBlock
  | CompactBoundaryTranscriptBlock;

/**
 * Returns `true` for transcript blocks that carry orchestration metadata
 * (routing decisions, agent timelines, subagent / child-agent spans,
 * context usage, etc.) and should be rendered in side panels rather than
 * the main chat transcript.
 */
export function isSidebarOnlyTranscriptBlock(block: TranscriptBlock): boolean {
  switch (block.kind) {
    case 'run_step_group':
    case 'run_session':
    case 'agent_timeline':
    case 'route_decision':
    case 'subagent':
    case 'subtask':
    case 'child_agent':
    case 'context_usage':
      return true;
    default:
      return false;
  }
}
