import type { ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
import type { EvidenceRef } from '../transcript';

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
  pinnedAnnouncement?: WorkbenchPinnedAnnouncement | undefined;
}

export interface WorkbenchAgent {
  id: string;
  name: string;
  description?: string | undefined;
  status?: 'available' | 'unavailable' | 'configuring' | undefined;
  model?: string | undefined;
  runtimeId?: string | undefined;
}

export interface ConversationPort {
  list(): Promise<WorkbenchConversation[]>;
}

export interface RunPort {
  submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult>;
}

export interface AttachmentPort {
  pickFiles(): Promise<ComposerAttachment[]>;
}

export interface PreviewPort {
  canOpenEvidence?(evidence: EvidenceRef): boolean;
  openEvidence(evidence: EvidenceRef): Promise<void>;
}

export interface AgentHubPlatform {
  surface: AgentHubSurface;
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  attachments?: AttachmentPort;
  preview?: PreviewPort;
  runs: RunPort;
}
