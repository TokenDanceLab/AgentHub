import type { AttachmentRef, ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
import type { EvidenceRef } from '../transcript';
import type { AgentActivitySnapshot } from '../transcript/agentActivity';

export type AgentHubSurface = 'desktop' | 'web' | 'mobile';

export interface SurfaceCapabilities {
  localEdge: boolean;
  localFiles: boolean;
  browserPreview: boolean;
  /**
   * Local interactive terminal host (Desktop / Local Edge).
   * When false or omitted, the Terminal panel must stay hidden.
   * Renderer never owns a PTY — only a typed TerminalPort may talk to the host.
   */
  localTerminal?: boolean | undefined;
}

export type ConversationKind = 'direct' | 'group';

export interface WorkbenchPinnedAnnouncement {
  title: string;
  content: string;
  author?: string | undefined;
  time?: string | undefined;
  sourceId?: string | undefined;
}

export interface WorkbenchConversation {
  id: string;
  title: string;
  kind: ConversationKind;
  subtitle?: string | undefined;
  runtimeLabel?: string | undefined;
  threadLabel?: string | undefined;
  updatedLabel?: string | undefined;
  unreadCount?: number | undefined;
  model?: string | undefined;
  avatarLabel?: string | undefined;
  avatarColor?: string | undefined;
  avatarTextColor?: string | undefined;
  avatarUrl?: string | undefined;
  /** Whether this conversation is pinned by the current user. */
  pinned?: boolean | undefined;
  /** Whether this conversation is archived by the current user. */
  archived?: boolean | undefined;
  /** 群聊成员名称列表，用于卡片展示。 */
  members?: string[] | undefined;
  pinnedAnnouncement?: WorkbenchPinnedAnnouncement | undefined;
}

export interface WorkbenchAgent {
  id: string;
  name: string;
  description?: string | undefined;
  icon?: string | undefined;
  status?: 'available' | 'unavailable' | 'configuring' | undefined;
  model?: string | undefined;
  runtimeId?: string | undefined;
  provider?: string | undefined;
  avatarRef?: string | undefined;
  avatarColor?: string | undefined;
  approvalPolicy?: string | undefined;
  permissionMode?: string | undefined;
  reasoningEffort?: string | undefined;
  skills?: string[] | undefined;
  capabilities?: string[] | undefined;
  mcpServers?: string[] | undefined;
  toolAllowlist?: string[] | undefined;
  memorySources?: string[] | undefined;
  memoryRetention?: string | undefined;
  memorySummary?: string | undefined;
  targetPreferences?: string[] | Record<string, unknown> | undefined;
}

export interface ConversationPort {
  list(): Promise<WorkbenchConversation[]>;
}

export interface RunPort {
  submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult>;
  /**
   * Re-dispatch an agent task for an already-sent Hub message (client
   * pending-intents queue, CF22). Never re-sends the message — the message
   * id is the retry trigger for the existing agent-tasks dispatch only.
   * Optional: surfaces whose submit path has no separable dispatch step
   * (Desktop local-edge submitRun) omit it and the queue degrades to the
   * toast-only 409 behavior.
   */
  redispatchTask?(intent: ComposerIntent, messageId: string): Promise<RedispatchTaskResult>;
}

/** Result of a dispatch-only retry (`RunPort.redispatchTask`). */
export interface RedispatchTaskResult {
  /** Dispatched agent task id; absent when there was nothing to dispatch. */
  taskId?: string;
  /**
   * Recoverable 409 turn_in_progress — the agent instance still has a
   * non-terminal task. The caller may retry again (bounded), then abandon.
   */
  turnInProgress?: boolean;
}

export interface AttachmentPort {
  pickFiles(): Promise<ComposerAttachment[]>;
  /** Upload a file to the Hub attachment store. Returns the server-side attachment ref. */
  uploadAttachment(file: File): Promise<AttachmentRef>;
}

/**
 * A single hunk accept/reject decision from the interactive diff reviewer.
 * Mirrors the Edge apply request body field-by-field (file_path / hunk_index /
 * accepted) so host adapters can forward it without re-mapping.
 */
export interface RunDiffHunkDecision {
  filePath: string;
  hunkIndex: number;
  accepted: boolean;
}

/** Input for `PreviewPort.applyRunDiff` — one hunk decision plus run/workdir context. */
export interface ApplyRunDiffInput {
  runId: string;
  /** Run working directory the hunk is written back into (Edge validates it). */
  workDir: string;
  decision: RunDiffHunkDecision;
}

/** Input for `PreviewPort.applyAllRunDiffs` — batch decisions plus run/workdir context. */
export interface ApplyAllRunDiffsInput {
  runId: string;
  workDir: string;
  decisions: RunDiffHunkDecision[];
}

export interface PreviewPort {
  canOpenEvidence?(evidence: EvidenceRef): boolean;
  openEvidence(evidence: EvidenceRef): Promise<void>;
  /**
   * Write one interactive-diff hunk decision back into the run workdir
   * (Edge POST /v1/runs/{runId}/apply). Only surfaces with a Local Edge
   * implement this (Desktop); Web omits it and the inspector degrades to an
   * explicit read-only review notice instead of silently dropping the click.
   */
  applyRunDiff?(input: ApplyRunDiffInput): Promise<void>;
  /**
   * Batch variant of `applyRunDiff` for accept-all / reject-all
   * (Edge POST /v1/runs/{runId}/apply-all). Same surface contract.
   */
  applyAllRunDiffs?(input: ApplyAllRunDiffsInput): Promise<void>;
  /**
   * Resolve an evidence content reference into a displayable URL.
   * Absolute http(s) URLs are typically returned unchanged; host-relative
   * API paths (e.g. `/v1/runs/…/content`) become absolute host URLs on
   * surfaces that own the host (Desktop → Local Edge). Return `undefined`
   * when the surface cannot serve the content so the UI can render an
   * honest capability notice instead of a broken frame.
   */
  resolveContentUrl?(contentRef: string): string | undefined;
}

export type LocalCliRuntimeId = 'codex' | 'claude-code' | 'opencode';

export interface LocalCliDiscoveryItem {
  id: LocalCliRuntimeId;
  name: string;
  installed: boolean;
  version: string | null;
  path: string;
  noSpend: boolean;
}

export interface LocalCliDiscoveryManifest {
  mode: 'no-spend-discovery';
  readinessManifest: string;
  readinessScript: string;
  generatedAt?: string | null;
  items: LocalCliDiscoveryItem[];
}

/** Local runtime session summary for Desktop settings import list (#1192). */
export type RuntimeSessionSummary = {
  runtime: string;
  id: string;
  title?: string | undefined;
  path?: string | undefined;
  updatedAt?: string | undefined;
  sourceMode?: string | undefined;
};

export interface HostDiagnosticsPort {
  localCliDiscovery?(): Promise<LocalCliDiscoveryManifest>;
  /**
   * Optional host-owned list of local runtime sessions (Edge GET /v1/runtime-sessions).
   * Desktop only; Web must omit. Renderer never opens foreign session stores.
   */
  listRuntimeSessions?(limit?: number): Promise<RuntimeSessionSummary[]>;
}

export interface SettingsPort {
  /** Read all settings from the backend. Returns empty object if none stored. */
  readSettings(): Promise<Record<string, string>>;
  /** Write a partial settings patch to the backend. */
  writeSettings(values: Record<string, string>): Promise<void>;
}

/**
 * Typed host port for per-message actions (right-click context menu wiring).
 * Maps 1:1 onto the existing Hub REST endpoints; surfaces that lack a Hub
 * backend (Desktop local-edge, demo shells) simply omit the whole port —
 * every member is therefore optional on `AgentHubPlatform.messageActions`.
 */
export interface MessageActionsPort {
  pinMessage(messageId: string, sessionId: string): Promise<void>;
  unpinMessage(messageId: string, sessionId: string): Promise<void>;
  forwardMessage(messageId: string, targetSessionIds: string[]): Promise<void>;
  recallMessage(messageId: string): Promise<void>;
  addMessageReaction(messageId: string, sessionId: string, reaction: { emoji: string }): Promise<void>;
}

/** Stable id for a host-owned terminal session (not a renderer process handle). */
export type TerminalSessionId = string;

export type TerminalSessionStatus = 'starting' | 'running' | 'exited' | 'error';

export interface TerminalSession {
  id: TerminalSessionId;
  title: string;
  cwd?: string | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
  status: TerminalSessionStatus;
  createdAt: string;
}

export interface TerminalSpawnOptions {
  cwd?: string | undefined;
  cols?: number | undefined;
  rows?: number | undefined;
  title?: string | undefined;
  /** Host allowlist key only — never a free-form shell command from the renderer. */
  profile?: string | undefined;
}

export interface TerminalWritePayload {
  sessionId: TerminalSessionId;
  data: string;
}

export interface TerminalResizePayload {
  sessionId: TerminalSessionId;
  cols: number;
  rows: number;
}

/**
 * Typed host port for local terminal sessions.
 * Implementations live in Desktop/Tauri or Local Edge — never raw process APIs in the renderer.
 */
export interface TerminalPort {
  list(): Promise<TerminalSession[]>;
  spawn(options?: TerminalSpawnOptions): Promise<TerminalSession>;
  write(payload: TerminalWritePayload): Promise<void>;
  resize(payload: TerminalResizePayload): Promise<void>;
  close(sessionId: TerminalSessionId): Promise<void>;
}

/** Workspace file-tree entry from a host port (never raw FS in the renderer). */
export type WorkspaceFileEntry = {
  path: string;
  kind: 'file' | 'dir';
  size?: number | undefined;
};

/** Workspace git status change (status codes like M/A/D/?). */
export type WorkspaceGitChange = {
  path: string;
  status: string;
};

/** Workspace git log commit summary from a host port. */
export type WorkspaceGitCommit = {
  hash: string;
  subject: string;
  author?: string | undefined;
  date?: string | undefined;
};

/**
 * Typed host port for workspace file listing.
 * Desktop/host fills this later; renderer must not call raw FS APIs.
 */
export interface WorkspaceFilesPort {
  list?(rootHint?: string): Promise<WorkspaceFileEntry[]>;
}

/**
 * Typed host port for workspace git changes + log.
 * Desktop/host fills this later; no git binary in the renderer.
 */
export interface WorkspaceGitPort {
  listChanges?(rootHint?: string): Promise<WorkspaceGitChange[]>;
  listLog?(rootHint?: string, limit?: number): Promise<WorkspaceGitCommit[]>;
}

export interface AgentHubPlatform {
  surface: AgentHubSurface;
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  runs: RunPort;
  settings?: SettingsPort;
  /**
   * Optional per-message action port (pin/unpin/forward/recall/react).
   * Present on surfaces with a Hub backend (Web); Desktop/demo omit it and
   * the workbench chrome degrades to the previous toast-only behavior.
   */
  messageActions?: MessageActionsPort | undefined;
  /**
   * Optional typed terminal host. Present only when the surface can host a local terminal
   * (typically Desktop with `capabilities.localTerminal === true`). No PTY ownership here.
   */
  terminal?: TerminalPort | undefined;
  /**
   * Optional workspace file-tree host. Present when Desktop/local host can list workspace files.
   * Web keeps this omitted; renderer never opens raw FS.
   */
  workspaceFiles?: WorkspaceFilesPort | undefined;
  /**
   * Optional workspace git host for changes + commit log.
   * Web keeps this omitted; renderer never shells out to git.
   */
  workspaceGit?: WorkspaceGitPort | undefined;
  /** Agent activity state for the streaming status bar. */
  agentActivity?: AgentActivitySnapshot;
}
