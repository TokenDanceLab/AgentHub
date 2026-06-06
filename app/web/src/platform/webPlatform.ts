import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { TranscriptBlock } from '@shared/transcript';
import { canOpenWebEvidencePreview, openWebEvidencePreview } from './webPreview';

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

export const webAgents: WorkbenchAgent[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: 'Web v4 代码实现',
    status: 'available',
    model: 'glm-5.1',
    runtimeId: 'claude-code',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: '架构和文档复核',
    status: 'available',
    model: 'deepseek-v4-pro',
    runtimeId: 'claude-code',
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
    preview: {
      canOpenEvidence: canOpenWebEvidencePreview,
      openEvidence: openWebEvidencePreview,
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
