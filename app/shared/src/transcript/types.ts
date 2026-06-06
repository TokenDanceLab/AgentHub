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
}

export interface ArtifactTranscriptBlock extends TranscriptBlockBase {
  kind: 'artifact';
  title: string;
}

export interface DiffTranscriptBlock extends TranscriptBlockBase {
  kind: 'diff';
  title: string;
  files: string[];
}

export interface ApprovalTranscriptBlock extends TranscriptBlockBase {
  kind: 'approval';
  title: string;
  status: EvidenceRefStatus;
}

export type TranscriptBlock =
  | TextTranscriptBlock
  | ToolCallTranscriptBlock
  | ArtifactTranscriptBlock
  | DiffTranscriptBlock
  | ApprovalTranscriptBlock;
