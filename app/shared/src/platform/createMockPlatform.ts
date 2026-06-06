import type { ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
import type { EvidenceRef } from '../transcript';
import type {
  AgentHubPlatform,
  AgentHubSurface,
  SurfaceCapabilities,
  WorkbenchConversation,
} from './types';

export interface MockPlatformSeed {
  surface?: AgentHubSurface;
  capabilities?: Partial<SurfaceCapabilities>;
  conversations?: WorkbenchConversation[];
  pickFiles?: () => Promise<ComposerAttachment[]>;
  openEvidence?: (evidence: EvidenceRef) => Promise<void>;
}

export interface MockPlatform extends AgentHubPlatform {
  seed: {
    conversations: WorkbenchConversation[];
  };
  openedEvidence: EvidenceRef[];
  submittedIntents: ComposerIntent[];
}

const defaultCapabilities: SurfaceCapabilities = {
  localEdge: false,
  localFiles: false,
  browserPreview: false,
};

export function createMockPlatform(seed: MockPlatformSeed = {}): MockPlatform {
  const conversations = seed.conversations ?? [];
  const openedEvidence: EvidenceRef[] = [];
  const submittedIntents: ComposerIntent[] = [];

  return {
    surface: seed.surface ?? 'web',
    capabilities: {
      ...defaultCapabilities,
      ...seed.capabilities,
    },
    seed: {
      conversations,
    },
    openedEvidence,
    submittedIntents,
    conversations: {
      async list() {
        return conversations;
      },
    },
    ...(seed.pickFiles
      ? {
          attachments: {
            pickFiles: seed.pickFiles,
          },
        }
      : {}),
    ...(seed.openEvidence
      ? {
          preview: {
            async openEvidence(evidence: EvidenceRef): Promise<void> {
              openedEvidence.push(evidence);
              await seed.openEvidence?.(evidence);
            },
          },
        }
      : {}),
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        submittedIntents.push(intent);
        return {
          intentId: `mock-intent-${submittedIntents.length}`,
        };
      },
    },
  };
}
