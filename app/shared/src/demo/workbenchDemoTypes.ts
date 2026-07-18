/**
 * Workbench demo store types + fallback conversation id.
 * Peel companion of workbenchDemo (#1131). Pure only; zero behavior change.
 */

import type { ComposerIntent, ComposerSubmitResult } from '../composer';
import type { WorkbenchAgent, WorkbenchConversation } from '../platform';
import type { TranscriptBlock } from '../transcript';

export type WorkbenchDemoSurface = 'desktop' | 'web';

export interface WorkbenchDemoMessagePin {
  conversationId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: string;
}

export interface WorkbenchDemoStore {
  conversations: WorkbenchConversation[];
  agents: WorkbenchAgent[];
  transcripts: Record<string, TranscriptBlock[]>;
  pins: WorkbenchDemoMessagePin[];
}

export interface WorkbenchDemoRuntimeStore {
  getSnapshot(): WorkbenchDemoStore;
  subscribe(listener: () => void): () => void;
  resolveTranscript(conversationId: string): TranscriptBlock[];
  submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult>;
  pinMessage(conversationId: string, messageId: string, pinnedBy?: string): void;
  unpinMessage(conversationId: string, messageId: string): void;
  addConversation(conversation: WorkbenchConversation): void;
}

export const WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID = 'builder';

export const BUILDER_PINNED_ANNOUNCEMENT =
  '前端重构任务已置顶，Builder 正在整理 B0 SQLite 迁移方案，Reviewer 和 Deployer 后续跟进验收。';
