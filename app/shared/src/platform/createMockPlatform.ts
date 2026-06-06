import type { ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '../composer/types';
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
}

export interface MockPlatform extends AgentHubPlatform {
  seed: {
    conversations: WorkbenchConversation[];
  };
  submittedIntents: ComposerIntent[];
}

const defaultCapabilities: SurfaceCapabilities = {
  localEdge: false,
  localFiles: false,
  browserPreview: false,
};

export function createMockPlatform(seed: MockPlatformSeed = {}): MockPlatform {
  const conversations = seed.conversations ?? [];
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
