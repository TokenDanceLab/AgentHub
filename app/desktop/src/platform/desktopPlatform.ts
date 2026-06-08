import { formatComposerPromptWithContext } from '@shared/composer';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  demoWorkbenchAgents,
  resolveDemoWorkbenchTranscript,
  workbenchDemoRuntimeStore,
} from '@shared/demo';
import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';
import type { TranscriptBlock } from '@shared/transcript';
import type { RunInfo, StartRunRequest } from '@shared/types';
import { pickDesktopComposerAttachments } from './desktopAttachments';
import { canOpenDesktopEvidencePreview, openDesktopEvidencePreview } from './desktopPreview';

export const DESKTOP_FALLBACK_CONVERSATION_ID = WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID;
export const desktopConversations: WorkbenchConversation[] = workbenchDemoRuntimeStore.getSnapshot().conversations;
export const desktopAgents: WorkbenchAgent[] = demoWorkbenchAgents;
export const desktopTranscript: TranscriptBlock[] = resolveDemoWorkbenchTranscript(DESKTOP_FALLBACK_CONVERSATION_ID);

export function resolveDesktopPreviewTranscript(conversationId: string): TranscriptBlock[] {
  return workbenchDemoRuntimeStore.resolveTranscript(conversationId);
}

export interface DesktopPlatformOptions {
  activeProjectId?: string;
  activeThreadId?: string;
  openPreview?: (evidence: EvidenceRef) => Promise<void>;
  pickLocalAttachments?: NonNullable<AgentHubPlatform['attachments']>['pickFiles'];
  submitRun?: (request: StartRunRequest) => Promise<RunInfo>;
}

export function createDesktopPlatform(options: DesktopPlatformOptions = {}): AgentHubPlatform {
  return {
    surface: 'desktop',
    capabilities: {
      localEdge: true,
      localFiles: true,
      browserPreview: true,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return workbenchDemoRuntimeStore.getSnapshot().conversations;
      },
    },
    attachments: {
      pickFiles: options.pickLocalAttachments ?? pickDesktopComposerAttachments,
    },
    preview: {
      canOpenEvidence: canOpenDesktopEvidencePreview,
      openEvidence: options.openPreview ?? openDesktopEvidencePreview,
    },
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        if (options.submitRun && (!options.activeProjectId || !options.activeThreadId)) {
          throw new Error('Local Edge thread is required before starting a Desktop run');
        }

        if (options.submitRun && options.activeProjectId && options.activeThreadId) {
          const run = await options.submitRun({
            projectId: options.activeProjectId,
            threadId: options.activeThreadId,
            prompt: formatComposerPromptWithContext(intent.text, intent.attachments, intent.mentions),
            ...edgeSelectedAgent(intent),
            ...edgePermissionMode(intent),
            ...edgeWorkDir(intent),
          });
          return {
            intentId: run.runId,
          };
        }

        return workbenchDemoRuntimeStore.submitComposerIntent(intent);
      },
    },
  };
}

function edgeSelectedAgent(intent: ComposerIntent): Pick<StartRunRequest, 'agentId' | 'model'> {
  const mention = intent.mentions.find((item) => item.status !== 'unavailable') ?? intent.mentions[0];
  if (!mention) return {};
  return {
    agentId: mention.runtimeId?.trim() || mention.id,
    ...(mention.model ? { model: mention.model } : {}),
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

function edgeWorkDir(intent: ComposerIntent): Pick<StartRunRequest, 'workDir'> {
  const workDir = intent.workDir?.trim();
  return workDir ? { workDir } : {};
}
