import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { TranscriptBlock } from '@shared/transcript';

export const webConversations: WorkbenchConversation[] = [
  {
    id: 'agent-collab',
    title: 'Agent 协作群',
    kind: 'group',
    subtitle: '共享 v4 Web 工作台',
    unreadCount: 2,
  },
  {
    id: 'builder',
    title: 'Builder',
    kind: 'direct',
    subtitle: 'Claude Code',
  },
];

export const webTranscript: TranscriptBlock[] = [
  {
    id: 'web-msg-1',
    kind: 'text',
    author: { id: 'system', name: 'AgentHub', role: 'system' },
    text: 'Web 已接入 shared v4 workbench。',
  },
  {
    id: 'web-tool-1',
    kind: 'tool_call',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'AgentHubWorkbench',
    status: 'completed',
    evidenceRefs: [
      { id: 'web-shared-workbench', kind: 'artifact', label: 'shared v4 workbench', status: 'completed' },
    ],
  },
];

export function createWebPlatform(): AgentHubPlatform {
  const submittedIntents: ComposerIntent[] = [];

  return {
    surface: 'web',
    capabilities: {
      localEdge: false,
      localFiles: false,
      browserPreview: false,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return webConversations;
      },
    },
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        submittedIntents.push(intent);
        return {
          intentId: `web-intent-${submittedIntents.length}`,
        };
      },
    },
  };
}
