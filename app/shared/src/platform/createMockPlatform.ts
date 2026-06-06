import type { ComposerIntent, ComposerSubmitResult } from '../composer/types';
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
