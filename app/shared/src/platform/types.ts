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
}

export interface AttachmentPort {
  pickFiles(): Promise<ComposerAttachment[]>;
  /** Upload a file to the Hub attachment store. Returns the server-side attachment ref. */
  uploadAttachment(file: File): Promise<AttachmentRef>;
}

export interface PreviewPort {
  canOpenEvidence?(evidence: EvidenceRef): boolean;
  openEvidence(evidence: EvidenceRef): Promise<void>;
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

export interface HostDiagnosticsPort {
  localCliDiscovery?(): Promise<LocalCliDiscoveryManifest>;
}

export interface SettingsPort {
  /** Read all settings from the backend. Returns empty object if none stored. */
  readSettings(): Promise<Record<string, string>>;
  /** Write a partial settings patch to the backend. */
  writeSettings(values: Record<string, string>): Promise<void>;
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
   * Optional typed terminal host. Present only when the surface can host a local terminal
   * (typically Desktop with `capabilities.localTerminal === true`). No PTY ownership here.
   */
  terminal?: TerminalPort | undefined;
  /** Agent activity state for the streaming status bar. */
  agentActivity?: AgentActivitySnapshot;
}
