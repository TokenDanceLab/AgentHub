// Unified message model for ChatView rendering.
// 参考: Codex ThreadItem 19枚举 + Cline ChatRow 判别渲染

export type MessageRole = 'user' | 'agent' | 'system';

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
