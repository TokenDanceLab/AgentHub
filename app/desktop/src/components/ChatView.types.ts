// Unified message model for ChatView rendering.

export type MessageRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  timestamp: string;
  /** Rendered content blocks in display order */
  blocks: MessageBlock[];
}

export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_call'; callId: string; toolName: string; input: Record<string, unknown>; status: string }
  | { kind: 'tool_result'; callId: string; toolName: string; output: string }
  | { kind: 'file_change'; path: string; action: 'created' | 'modified' | 'deleted'; diff?: string }
  | { kind: 'session_init'; model?: string; tools?: string[]; permissionMode?: string }
  | { kind: 'result'; success: boolean; error?: string; tokenUsage?: { input: number; output: number } };
