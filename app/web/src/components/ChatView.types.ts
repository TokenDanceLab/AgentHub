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
  parentId?: string | undefined;
  /** Agent display name — shown with avatar in agent messages */
  agentName?: string | undefined;
}

// ── Message Block types ───────────────────────

export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string | undefined }
  | { kind: 'thinking'; content: string; durationMs?: number | undefined }
  | {
      kind: 'tool_use';
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
      status: 'pending' | 'running' | 'completed' | 'failed';
      children?: ToolResultBlock[] | undefined;
    }
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string | undefined }
  | { kind: 'session_init'; model?: string | undefined; tools?: string[] | undefined; permissionMode?: string | undefined }
  | {
      kind: 'result';
      success: boolean;
      error?: string | undefined;
      tokenUsage?: { input: number; output: number } | undefined;
    }
  | {
      kind: 'error';
      error?: string | undefined;
      message?: string | undefined;
      detail?: string | undefined;
      retryable?: boolean | undefined;
    }
  | {
      kind: 'citation';
      text?: string | undefined;
      url?: string | undefined;
      title?: string | undefined;
    }
  | {
      kind: 'compact';
      summary: string;
      items?: MessageBlock[] | undefined;
      expanded?: boolean | undefined;
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
    };

// Tool result subtypes (nested under tool_use, 参考: Cline DiffEditRow 双格式)
export type ToolResultBlock =
  | { kind: 'read_result'; filePath: string; lineCount: number; content?: string | undefined }
  | { kind: 'write_result'; filePath: string; diff?: FileDiff | undefined }
  | { kind: 'edit_result'; filePath: string; diff?: FileDiff | undefined }
  | { kind: 'bash_result'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'generic_result'; output: string };

// ── Diff types (参考: CCViewer DiffViewer 530行 + Cline DiffEditRow) ──

export interface FileDiff {
  filePath: string;
  status: 'added' | 'deleted' | 'modified';
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
