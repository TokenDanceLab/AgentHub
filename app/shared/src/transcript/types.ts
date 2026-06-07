export type TranscriptAuthorRole = 'human' | 'agent' | 'system';

export interface TranscriptAuthor {
  id: string;
  name: string;
  role: TranscriptAuthorRole;
}

export type EvidenceRefKind = 'tool' | 'file' | 'artifact' | 'run';
export type EvidenceRefStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EvidenceRef {
  id: string;
  kind: EvidenceRefKind;
  label: string;
  status?: EvidenceRefStatus;
  path?: string;
  uri?: string;
  mimeType?: string;
}

interface TranscriptBlockBase {
  id: string;
  author: TranscriptAuthor;
  createdAt?: string;
  evidenceRefs?: EvidenceRef[];
}

export interface TextTranscriptBlock extends TranscriptBlockBase {
  kind: 'text';
  text: string;
}

export interface ToolCallTranscriptBlock extends TranscriptBlockBase {
  kind: 'tool_call';
  toolName: string;
  status: EvidenceRefStatus;
  target?: string;
  summary?: string;
}

export interface ArtifactTranscriptBlock extends TranscriptBlockBase {
  kind: 'artifact';
  title: string;
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

export interface RunSessionTranscriptBlock extends TranscriptBlockBase {
  kind: 'run_session';
  title: string;
  status?: 'running' | 'completed' | 'failed';
  meta?: string;
  runId?: string;
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

export type TranscriptBlock =
  | TextTranscriptBlock
  | ToolCallTranscriptBlock
  | ArtifactTranscriptBlock
  | DiffTranscriptBlock
  | ApprovalTranscriptBlock
  | RunSessionTranscriptBlock
  | AgentTimelineTranscriptBlock
  | RunStepGroupTranscriptBlock
  | ThinkingTranscriptBlock
  | SubagentTranscriptBlock
  | ChildAgentTranscriptBlock
  | RouteDecisionTranscriptBlock
  | ContextUsageTranscriptBlock
  | ResultTranscriptBlock;
