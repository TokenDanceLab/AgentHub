// Unified message model for ChatView rendering.
// 参考: Codex ThreadItem 19枚举 + Cline ChatRow 判别渲染

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
  parentId?: string;
  /** Agent display name — shown with avatar in agent messages */
  agentName?: string;
}

// ── Message Block types ───────────────────────

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
<<<<<<< HEAD
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string; structuredDiff?: FileDiff }
=======
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string }
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
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
<<<<<<< HEAD
    }
  | {
      kind: 'error';
      error?: string;
      message?: string;
      detail?: string;
      retryable?: boolean;
      /** Error classification for rendering category-specific icon, suggestion, and action buttons. */
      category?: 'network' | 'auth' | 'rate_limit' | 'tool' | 'model' | 'unknown';
      /** Override default suggestion text for this category. */
      suggestion?: string;
    }
  | {
      kind: 'citation';
      text?: string;
      url?: string;
      title?: string;
    }
  | {
      kind: 'compact';
      summary: string;
      items?: MessageBlock[];
      expanded?: boolean;
    }
  | {
      kind: 'tool_group';
      /** Original tool_use blocks that are grouped together */
      items: Extract<MessageBlock, { kind: 'tool_use' }>[];
      /** Initial collapsed state */
      collapsed: boolean;
      /** Count per tool name (e.g. { Read: 3, Write: 2, Edit: 1 }) */
      toolCounts: Record<string, number>;
      /** Total number of tools in this group */
      totalCount: number;
    }
  | {
      kind: 'approval';
      approvalId: string;
      agentName: string;
      toolName: string;
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      status: 'pending' | 'approved' | 'denied' | 'timeout';
      timestamp: string;
      reason?: string | undefined;
      decidedBy?: string | undefined;
      decidedAt?: string | undefined;
      /** Context for team approval API calls */
      teamId?: string | undefined;
      runId?: string | undefined;
      agentTaskId?: string | undefined;
    }
  | {
      kind: 'artifact';
      artifactId: string;
      artifactType: 'iframe' | 'file' | 'page' | 'image';
      title: string;
      artifactUrl?: string | undefined;
      url?: string | undefined;
      previewUrl?: string | undefined;
      size?: number | undefined;
      /** If true, an "Apply Diff" action button is rendered on the artifact preview. */
      canApplyDiff?: boolean | undefined;
      /** True after the diff has been successfully applied. */
      diffApplied?: boolean | undefined;
    }
  | {
      kind: 'deploy_card';
      deployId?: string | undefined;
      url?: string | undefined;
      status: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed';
      statusMessage?: string | undefined;
      timestamp?: string | undefined;
    }
  | {
      kind: 'link_card';
      url: string;
      title?: string | undefined;
      description?: string | undefined;
      thumbnailUrl?: string | undefined;
      siteName?: string | undefined;
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    };

// Tool result subtypes (nested under tool_use, 参考: Cline DiffEditRow 双格式)
export type ToolResultBlock =
  | { kind: 'read_result'; filePath: string; lineCount: number; content?: string }
  | { kind: 'write_result'; filePath: string; diff?: FileDiff }
  | { kind: 'edit_result'; filePath: string; diff?: FileDiff }
  | { kind: 'bash_result'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'generic_result'; output: string };

// ── Diff types (参考: CCViewer DiffViewer 530行 + Cline DiffEditRow) ──

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
