import type { AgentHubPlatform, SurfaceCapabilities, WorkbenchConversation } from '@agenthub/shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@agenthub/shared/composer';
import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';
import {
  createHubClient as createMobileHubClient,
  createMockHubClient,
  type HubClient,
} from '@/api/hubClient';

export type MobileDataMode = 'mock' | 'observed' | 'approved-real';

export interface MobilePlatformOptions {
  hubBaseUrl: string;
  getAccessToken?: () => Promise<string | null | undefined> | string | null | undefined;
  dataMode?: MobileDataMode;
}

const mobileCapabilities: SurfaceCapabilities = {
  localEdge: false,
  // Hub-only data plane: no local workspace file browse/open path (pickFiles
  // throws; attachments flow through the Hub client). Flag stays false (#1947).
  localFiles: false,
  browserPreview: false,
  localTerminal: false,
  // New capability domains intentionally un-declared on Mobile: Hub client
  // currently exposes no approval/runtimeEvidence/sandbox contract, and
  // remote execution is not wired. UI must hide related affordances until
  // a Mobile-specific Hub channel lands. Revisit when the Mobile Hub client
  // exposes approval/runtimeEvidence/sandbox contracts or remote execution.
};

function mapFixtureToConversations(fixture: MobileAppFixture): WorkbenchConversation[] {
  return fixture.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    kind: thread.participantKind === 'group' ? 'group' : 'direct',
    subtitle: thread.subtitle,
    ...(thread.unread > 0 ? { unreadCount: thread.unread } : {}),
  }));
}

function normalizeMobileDataMode(value: string | undefined): MobileDataMode {
  switch (value?.trim().toLowerCase()) {
    case 'mock':
      return 'mock';
    case 'observed':
    case 'observe':
      return 'observed';
    case 'real':
    case 'approved-real':
    case 'approved_real':
      return 'approved-real';
    default:
      return 'mock';
  }
}

function isMockDataMode(mode: MobileDataMode): boolean {
  return mode === 'mock';
}

function createMobileHubClientFromOptions(options: MobilePlatformOptions): HubClient {
  if (isMockDataMode(normalizeMobileDataMode(options.dataMode))) {
    return createMockHubClient();
  }

  return createMobileHubClient({
    baseUrl: options.hubBaseUrl,
    ...(options.getAccessToken ? { getAccessToken: options.getAccessToken } : {}),
  });
}

export function createMobilePlatform(options: MobilePlatformOptions): AgentHubPlatform {
  const dataMode = normalizeMobileDataMode(options.dataMode);
  const hubClient = createMobileHubClientFromOptions(options);

  return {
    surface: 'mobile',
    capabilities: mobileCapabilities,

    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        if (isMockDataMode(dataMode)) {
          return mapFixtureToConversations(mobileFixture);
        }

        try {
          const snapshot = await hubClient.getMobileSnapshot();
          return mapFixtureToConversations(snapshot);
        } catch {
          return mapFixtureToConversations(mobileFixture);
        }
      },
    },

    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        if (isMockDataMode(dataMode)) {
          return { intentId: `mock-intent-${Date.now()}` };
        }

        const clientMsgId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const result = await hubClient.sendMessage(intent.conversationId, {
          client_msg_id: clientMsgId,
          content_type: 'text',
          content: intent.text,
        });

        return { intentId: result.message_id };
      },
    },

    attachments: {
      async pickFiles(): Promise<never[]> {
        throw new Error('Mobile platform uses native document/image picker directly.');
      },
      async uploadAttachment(_file: File): Promise<never> {
        throw new Error('Mobile platform attachments should go through the Hub client shared.uploadAttachment.');
      },
    },
  };
}

export function resolveMobileDataMode(
  envValue: string | undefined,
  hasToken: boolean,
): MobileDataMode {
  const explicit = normalizeMobileDataMode(envValue);
  if (explicit !== 'mock') return explicit;

  // Auto-upgrade: if a token is present, prefer observed over mock
  if (hasToken) return 'observed';

  return 'mock';
}

export { normalizeMobileDataMode };
