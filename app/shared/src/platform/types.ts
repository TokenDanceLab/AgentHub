import type { AttachmentRef, ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
import type { EvidenceRef } from '../transcript';
import type { AgentActivitySnapshot } from '../transcript/agentActivity';

export type AgentHubSurface = 'desktop' | 'web';

export interface SurfaceCapabilities {
  localEdge: boolean;
  localFiles: boolean;
  browserPreview: boolean;
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

export interface AgentHubPlatform {
  surface: AgentHubSurface;
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  runs: RunPort;
  settings?: SettingsPort;
  /** Agent activity state for the streaming status bar. */
  agentActivity?: AgentActivitySnapshot;
}
