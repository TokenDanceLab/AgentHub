// Shared legacy ChatMessage compatibility types used while Desktop/Web migrate
// from old ChatView.types to the v4 TranscriptBlock contract.
// Do not add new product UI behavior here; new rendering should use transcript/.

export type MessageRole = 'user' | 'agent' | 'system';

export interface ReplyTarget {
  messageId: string;
  author: string;
  preview: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  timestamp: string;
  blocks: MessageBlock[];
  parentId?: string | undefined;
  threadId?: string | undefined;
  /** Agent display name — shown with avatar in agent messages */
  agentName?: string | undefined;
}

// ── Message Block types (subset for shared UI) ────────

export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string | undefined }
  | { kind: 'thinking'; content: string; durationMs?: number | undefined }
  | {
      kind: 'tool_use';
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
      status: 'pending' | 'running' | 'draining' | 'completed' | 'failed';
      children?: ToolResultBlock[] | undefined;
    }
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string | undefined }
  | {
      kind: 'agent_task';
      taskId: string;
      title: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      summary?: string | undefined;
      worker?: string | undefined;
    }
  | {
      kind: 'child_agent';
      childId: string;
      title: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      agentName?: string | undefined;
      parentRunId?: string | undefined;
      childRunId?: string | undefined;
      result?: string | undefined;
      error?: string | undefined;
      durationMs?: number | undefined;
    }
  | {
      kind: 'route_decision';
      action: string;
      instructions?: string | undefined;
      summary?: string | undefined;
      reasoning?: string | undefined;
      nextWorker?: string | undefined;
      blockedReason?: string | undefined;
    }
  | { kind: 'session_init'; model?: string | undefined; tools?: string[] | undefined; permissionMode?: string | undefined }
  | {
      kind: 'result';
      success: boolean;
      error?: string | undefined;
      tokenUsage?: { input: number; output: number } | undefined;
    }
  | {
      kind: 'error';
      message?: string | undefined;
      error?: string | undefined;
      code?: string | undefined;
      statusCode?: number | undefined;
      category?: 'auth' | 'quota' | 'model' | 'network' | 'server' | 'context_length' | 'tool' | 'unknown' | undefined;
      retryable?: boolean | undefined;
      detail?: string | undefined;
    }
  | {
      kind: 'citation';
      url?: string | undefined;
      text?: string | undefined;
      title?: string | undefined;
    }
  | {
      kind: 'compact';
      summary?: string | undefined;
      items?: MessageBlock[] | undefined;
      expanded?: boolean | undefined;
    }
  | {
      kind: 'status';
      content: string;
    }
  | {
      kind: 'approval';
      approvalId: string;
      status: string;
      agentName?: string | undefined;
      toolName?: string | undefined;
      riskLevel?: 'low' | 'medium' | 'high' | 'critical' | undefined;
      reason?: string | undefined;
      timestamp?: string | undefined;
      decidedBy?: string | undefined;
      decidedAt?: string | undefined;
      teamId?: string | undefined;
      runId?: string | undefined;
      agentTaskId?: string | undefined;
    }
  | {
      kind: 'artifact';
      artifactId: string;
      artifactType: string;
      title: string;
      artifactUrl?: string | undefined;
      url?: string | undefined;
      previewUrl?: string | undefined;
      canApplyDiff?: boolean | undefined;
      diffApplied?: boolean | undefined;
      size?: number | undefined;
    }
  | {
      kind: 'deploy_card';
      deployId?: string | undefined;
      status?: string | undefined;
      statusMessage?: string | undefined;
      url?: string | undefined;
      timestamp?: string | undefined;
    }
  | {
      kind: 'link_card';
      url: string;
      title?: string | undefined;
      siteName?: string | undefined;
      description?: string | undefined;
      thumbnailUrl?: string | undefined;
    }
  | {
      kind: 'context_usage';
      runId?: string | undefined;
      input?: number | undefined;
      output?: number | undefined;
      total?: number | undefined;
      contextLimit?: number | undefined;
      usagePercent?: number | undefined;
      remaining?: number | undefined;
      threshold?: number | undefined;
      totalCost?: number | undefined;
      model?: string | undefined;
      provider?: string | undefined;
      variant?: 'usage' | 'warning' | 'compaction' | undefined;
    }
  | {
      kind: 'tool_group';
      blocks: Extract<MessageBlock, { kind: 'tool_use' }>[];
      totalCount: number;
    };

// Tool result subtypes (nested under tool_use)
export type ToolResultBlock =
  | { kind: 'read_result'; filePath: string; lineCount: number; content?: string | undefined }
  | { kind: 'write_result'; filePath: string; diff?: FileDiff | undefined }
  | { kind: 'edit_result'; filePath: string; diff?: FileDiff | undefined }
  | { kind: 'bash_result'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'generic_result'; output: string };

// ── Diff types ──────────────────────────────────

export interface FileDiff {
  filePath: string;
  status: 'added' | 'deleted' | 'modified' | 'untracked';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'added' | 'deleted' | 'context';
  oldLineNumber?: number | undefined;
  newLineNumber?: number | undefined;
  content: string;
}
