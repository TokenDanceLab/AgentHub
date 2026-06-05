// Shared ChatMessage types used by cross-surface components (e.g. MessageSearchPanel).
// Desktop and web each maintain their own richer ChatView.types.ts; this file
// only contains the subset that shared UI code needs.

export type MessageRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  timestamp: string;
  blocks: MessageBlock[];
  parentId?: string;
  threadId?: string;
  /** Agent display name — shown with avatar in agent messages */
  agentName?: string;
}

// ── Message Block types (subset for shared UI) ────────

export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string }
  | { kind: 'thinking'; content: string; durationMs?: number }
  | {
      kind: 'tool_use';
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
      status: 'pending' | 'running' | 'draining' | 'completed' | 'failed';
      children?: ToolResultBlock[];
    }
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string }
  | {
      kind: 'agent_task';
      taskId: string;
      title: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      summary?: string;
      worker?: string;
    }
  | {
      kind: 'child_agent';
      childId: string;
      title: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      agentName?: string;
      parentRunId?: string;
      childRunId?: string;
      result?: string;
      error?: string;
      durationMs?: number;
    }
  | {
      kind: 'route_decision';
      action: string;
      instructions?: string;
      summary?: string;
      reasoning?: string;
      nextWorker?: string;
      blockedReason?: string;
    }
  | { kind: 'session_init'; model?: string; tools?: string[]; permissionMode?: string }
  | {
      kind: 'result';
      success: boolean;
      error?: string;
      tokenUsage?: { input: number; output: number };
    }
  | {
      kind: 'error';
      message?: string;
      error?: string;
      code?: string;
      statusCode?: number;
      category?: 'auth' | 'quota' | 'model' | 'network' | 'server' | 'context_length' | 'tool' | 'unknown';
      retryable?: boolean;
      detail?: string;
    }
  | {
      kind: 'citation';
      url?: string;
      text?: string;
      title?: string;
    }
  | {
      kind: 'compact';
      summary?: string;
      items?: MessageBlock[];
      expanded?: boolean;
    }
  | {
      kind: 'status';
      content: string;
    }
  | {
      kind: 'approval';
      approvalId: string;
      status: string;
      agentName?: string;
      toolName?: string;
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
      reason?: string;
      timestamp?: string;
      decidedBy?: string;
      decidedAt?: string;
      teamId?: string;
      runId?: string;
      agentTaskId?: string;
    }
  | {
      kind: 'artifact';
      artifactId: string;
      artifactType: string;
      title: string;
      artifactUrl?: string;
      url?: string;
      previewUrl?: string;
      canApplyDiff?: boolean;
      diffApplied?: boolean;
      size?: number;
    }
  | {
      kind: 'deploy_card';
      deployId?: string;
      status?: string;
      statusMessage?: string;
      url?: string;
      timestamp?: string;
    }
  | {
      kind: 'link_card';
      url: string;
      title?: string;
      siteName?: string;
      description?: string;
      thumbnailUrl?: string;
    }
  | {
      kind: 'context_usage';
      runId?: string;
      input?: number;
      output?: number;
      total?: number;
      contextLimit?: number;
      usagePercent?: number;
      remaining?: number;
      threshold?: number;
      totalCost?: number;
      model?: string;
      provider?: string;
      variant?: 'usage' | 'warning' | 'compaction';
    }
  | {
      kind: 'tool_group';
      blocks: Extract<MessageBlock, { kind: 'tool_use' }>[];
      totalCount: number;
    };

// Tool result subtypes (nested under tool_use)
export type ToolResultBlock =
  | { kind: 'read_result'; filePath: string; lineCount: number; content?: string }
  | { kind: 'write_result'; filePath: string; diff?: FileDiff }
  | { kind: 'edit_result'; filePath: string; diff?: FileDiff }
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
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}
