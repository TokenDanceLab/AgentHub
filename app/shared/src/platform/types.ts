import type { ComposerIntent, ComposerSubmitResult } from '../composer/types';

export type AgentHubSurface = 'desktop' | 'web';

export interface SurfaceCapabilities {
  localEdge: boolean;
  localFiles: boolean;
  browserPreview: boolean;
}

export type ConversationKind = 'direct' | 'group';

export interface WorkbenchConversation {
  id: string;
  title: string;
  kind: ConversationKind;
  subtitle?: string;
  unreadCount?: number;
}

export interface WorkbenchAgent {
  id: string;
  name: string;
  description?: string;
  status?: 'available' | 'unavailable' | 'configuring';
  model?: string;
  runtimeId?: string;
}

export interface ConversationPort {
  list(): Promise<WorkbenchConversation[]>;
}

export interface RunPort {
  submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult>;
}

export interface AgentHubPlatform {
  surface: AgentHubSurface;
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  runs: RunPort;
}
