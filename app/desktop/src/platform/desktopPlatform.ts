import { invoke } from '@tauri-apps/api/core';
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
import { resolveDesktopTargetPreference, type DesktopTargetPreference } from './targetPreference';

export const DESKTOP_FALLBACK_CONVERSATION_ID = WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID;
export const desktopConversations: WorkbenchConversation[] = workbenchDemoRuntimeStore.getSnapshot().conversations;
export const desktopAgents: WorkbenchAgent[] = demoWorkbenchAgents;
export const desktopTranscript: TranscriptBlock[] = resolveDemoWorkbenchTranscript(DESKTOP_FALLBACK_CONVERSATION_ID);

export function resolveDesktopPreviewTranscript(conversationId: string): TranscriptBlock[] {
  return workbenchDemoRuntimeStore.resolveTranscript(conversationId);
}

export interface DesktopPlatformOptions {
  activeProjectId?: string;
  getEdgeHostReadiness?: () => Promise<DesktopEdgeHostReadiness>;
  activeThreadId?: string;
  openPreview?: (evidence: EvidenceRef) => Promise<void>;
  pickLocalAttachments?: NonNullable<AgentHubPlatform['attachments']>['pickFiles'];
  submitRun?: (request: StartRunRequest) => Promise<RunInfo>;
}

export interface DesktopEdgeHostReadiness {
  running: boolean;
  pid: number | null;
  port: number;
  sidecar_name: 'agenthub-edge';
  target_id: 'local-edge';
  route: 'local-edge-api';
  bind_addr: string;
  health_url: string;
  store_db_policy: '<app-data>/agenthub-edge.sqlite';
  log_paths: {
    directory: string;
    stdout: string;
    stderr: string;
  };
  sidecar_args: string[];
  preflight: {
    sidecar_available: boolean;
    fallback_executable_available: boolean;
    auth_token_ready: boolean;
    status: 'ready' | 'blocked';
    blocker: string | null;
  };
  direct_cli_spawn: false;
}

export interface DesktopHostPort {
  executionTargetPreference(): DesktopTargetPreference;
  edgeHostReadiness(): Promise<DesktopEdgeHostReadiness>;
}

export interface DesktopPlatform extends AgentHubPlatform {
  host: DesktopHostPort;
}

export function createDesktopPlatform(options: DesktopPlatformOptions = {}): DesktopPlatform {
  return {
    surface: 'desktop',
    capabilities: {
      localEdge: true,
      localFiles: true,
      browserPreview: true,
    },
    host: {
      edgeHostReadiness: options.getEdgeHostReadiness ?? readEdgeHostReadiness,
      executionTargetPreference: resolveDesktopTargetPreference,
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

function readEdgeHostReadiness(): Promise<DesktopEdgeHostReadiness> {
  return invoke<DesktopEdgeHostReadiness>('get_edge_host_readiness');
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
