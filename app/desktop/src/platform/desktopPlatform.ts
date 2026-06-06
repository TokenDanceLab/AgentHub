import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import type { RunInfo, StartRunRequest } from '@shared/types';

export const DESKTOP_FALLBACK_CONVERSATION_ID = 'local-agent-team';

export const desktopConversations: WorkbenchConversation[] = [
  {
    id: DESKTOP_FALLBACK_CONVERSATION_ID,
    title: '本地 Agent 协作群',
    kind: 'group',
    subtitle: 'Desktop v4 / Local Edge',
    unreadCount: 3,
  },
  {
    id: 'builder',
    title: 'Builder',
    kind: 'direct',
    subtitle: 'GLM-5.1 coding',
  },
  {
    id: 'reviewer',
    title: 'Reviewer',
    kind: 'direct',
    subtitle: 'DeepSeek-V4-Pro review',
  },
];

export const desktopTranscript: TranscriptBlock[] = [
  {
    id: 'desktop-msg-1',
    kind: 'text',
    author: { id: 'system', name: 'AgentHub', role: 'system' },
    text: 'Desktop 已切入 shared v4 workbench。旧 Desktop 主 UI 不再控制 active route。',
  },
  {
    id: 'desktop-tool-1',
    kind: 'tool_call',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'LocalEdgeAdapter',
    status: 'running',
    evidenceRefs: [
      {
        id: 'desktop-local-edge-capability',
        kind: 'tool',
        label: 'Desktop platform exposes Local Edge capability',
        status: 'running',
      },
    ],
  },
  {
    id: 'desktop-artifact-1',
    kind: 'artifact',
    author: { id: 'reviewer', name: 'Reviewer', role: 'agent' },
    title: 'v4 Desktop shell adapter',
    evidenceRefs: [
      {
        id: 'desktop-shared-workbench',
        kind: 'artifact',
        label: 'shared v4 workbench active route',
        status: 'completed',
      },
    ],
  },
];

export interface DesktopPlatformOptions {
  activeProjectId?: string;
  activeThreadId?: string;
  submitRun?: (request: StartRunRequest) => Promise<RunInfo>;
}

export function createDesktopPlatform(options: DesktopPlatformOptions = {}): AgentHubPlatform {
  const submittedIntents: ComposerIntent[] = [];

  return {
    surface: 'desktop',
    capabilities: {
      localEdge: true,
      localFiles: true,
      browserPreview: true,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return desktopConversations;
      },
    },
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        submittedIntents.push(intent);
        if (options.submitRun) {
          if (!options.activeProjectId || !options.activeThreadId) {
            throw new Error('Desktop v4 composer requires an active Edge thread');
          }
          const run = await options.submitRun({
            projectId: options.activeProjectId,
            threadId: options.activeThreadId,
            prompt: intent.text,
            ...edgePermissionMode(intent),
          });
          return {
            intentId: run.runId,
          };
        }

        return {
          intentId: `desktop-intent-${submittedIntents.length}`,
        };
      },
    },
  };
}

function edgePermissionMode(intent: ComposerIntent): Pick<StartRunRequest, 'permissionMode'> {
  switch (intent.approvalMode) {
    case 'workspace-write':
      return { permissionMode: 'acceptEdits' };
    case 'read-only':
      return { permissionMode: 'plan' };
    case 'suggest':
    default:
      return {};
  }
}
