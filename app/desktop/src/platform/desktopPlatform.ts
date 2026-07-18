import { invoke } from '@tauri-apps/api/core';
import { formatComposerPromptWithContext } from '@shared/composer';
import type { AttachmentRef, ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import { computeFileHash } from '@shared/composer';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  demoWorkbenchAgents,
  resolveDemoWorkbenchTranscript,
  workbenchDemoRuntimeStore,
} from '@shared/demo';
import type { AgentHubPlatform, LocalCliDiscoveryManifest, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';
import type { TranscriptBlock } from '@shared/transcript';
import type { RunInfo, StartRunRequest } from '@shared/types';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { pickDesktopComposerAttachments } from './desktopAttachments';
import { canOpenDesktopEvidencePreview, openDesktopEvidencePreview } from './desktopPreview';
import { resolveDesktopTargetPreference, type DesktopTargetPreference } from './targetPreference';
import { createDesktopSettingsAdapter } from './desktopSettingsAdapter';

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
  getLocalEdgeDiagnostics?: () => Promise<DesktopLocalEdgeDiagnostics>;
  getLocalCliDiscovery?: () => Promise<LocalCliDiscoveryManifest>;
  activeThreadId?: string;
  openPreview?: (evidence: EvidenceRef) => Promise<void>;
  pickLocalAttachments?: NonNullable<AgentHubPlatform['attachments']>['pickFiles'];
  submitRun?: (request: StartRunRequest) => Promise<RunInfo>;
  demoRuntimeFallback?: boolean;
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
  store_backend: 'sqlite';
  store_db_policy: '<app-data>/agenthub-edge.sqlite';
  store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1';
  expected_store_migration_version: 4;
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

export interface DesktopLocalEdgeDiagnostics {
  readiness: DesktopEdgeHostReadiness;
  status: {
    running: boolean;
    pid: number | null;
    port: number;
    health_url: string;
    last_error: string | null;
    log_paths: DesktopEdgeHostReadiness['log_paths'];
  };
  local_cli_discovery?: LocalCliDiscoveryManifest;
  packaged_login: {
    loopback: {
      available: boolean;
      bind_host: string;
      port: number | null;
      redirect_uri: string | null;
      error: string | null;
    };
    credential_store: {
      available: boolean;
      service: string;
      error: string | null;
    };
    real_e2e: {
      status: string;
      reason: string;
    };
  };
  log_tail: {
    stdout: string[];
    stderr: string[];
  };
}

export interface DesktopHostPort {
  executionTargetPreference(): DesktopTargetPreference;
  edgeHostReadiness(): Promise<DesktopEdgeHostReadiness>;
  localEdgeDiagnostics(): Promise<DesktopLocalEdgeDiagnostics>;
  localCliDiscovery(): Promise<LocalCliDiscoveryManifest>;
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
      // Foundation only (#1174): capability declared for Desktop host surface.
      // Real PTY / Tauri host adapter is out of scope; UI gates on this flag.
      localTerminal: true,
    },
    host: {
      edgeHostReadiness: options.getEdgeHostReadiness ?? readEdgeHostReadiness,
      localEdgeDiagnostics: options.getLocalEdgeDiagnostics ?? readLocalEdgeDiagnostics,
      localCliDiscovery: options.getLocalCliDiscovery ?? readLocalCliDiscovery,
      executionTargetPreference: resolveDesktopTargetPreference,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return workbenchDemoRuntimeStore.getSnapshot().conversations;
      },
    },
    attachments: {
      pickFiles: options.pickLocalAttachments ?? pickDesktopComposerAttachments,
      async uploadAttachment(file: File): Promise<AttachmentRef> {
        const client = createHubClient({ getToken: getAccessToken });
        const hash = await computeFileHash(file);
        const ref = await client.uploadAttachment(file, hash);
        return {
          id: ref.id,
          name: ref.original_name || file.name,
          ...(ref.original_name ? { original_name: ref.original_name } : {}),
          size: ref.size,
          mime_type: ref.mime_type,
          ...(ref.hash ? { hash: ref.hash } : {}),
          url: client.downloadAttachmentUrl(ref.id),
          ...(ref.metadata ? { metadata: ref.metadata } : {}),
          ...(ref.created_at ? { created_at: ref.created_at } : {}),
        };
      },
    },
    preview: {
      canOpenEvidence: canOpenDesktopEvidencePreview,
      openEvidence: options.openPreview ?? openDesktopEvidencePreview,
    },
    settings: createDesktopSettingsAdapter(),
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

        if (options.demoRuntimeFallback) {
          return workbenchDemoRuntimeStore.submitComposerIntent(intent);
        }

        throw new Error('Local Edge run submission is unavailable');
      },
    },
  };
}

function readEdgeHostReadiness(): Promise<DesktopEdgeHostReadiness> {
  return invoke<DesktopEdgeHostReadiness>('get_edge_host_readiness');
}

export function readLocalEdgeDiagnostics(): Promise<DesktopLocalEdgeDiagnostics> {
  return invoke<DesktopLocalEdgeDiagnostics>('get_local_edge_diagnostics');
}

export function readLocalCliDiscovery(): Promise<LocalCliDiscoveryManifest> {
  return invoke<LocalCliDiscoveryManifest>('get_local_cli_discovery');
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
