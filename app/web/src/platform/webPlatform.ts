import type { QueryClient } from '@tanstack/react-query';
import {
  allowsWorkbenchDemoRuntimeMutation,
  normalizeWorkbenchDataMode,
  workbenchDemoRuntimeStore,
  type WorkbenchDataMode,
  type WorkbenchDemoRuntimeStore,
} from '@shared/demo';
import { registerAttachmentImageUrlResolver, registerAttachmentMediaUrlResolver } from '@shared/platform';
import type { AgentHubPlatform, RedispatchTaskResult, WorkbenchConversation } from '@shared/platform';
import type { AttachmentRef, ComposerAttachment, ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import { computeFileHash } from '@shared/composer';
import { isTurnInProgressError } from '@shared/errors';
import { queryClient as defaultQueryClient } from '@/api/queryClient';
import {
  createHubClient,
  type AgentInstance,
  type ExecutionTarget,
  type HubClient,
  type PendingAgentTask,
  type SendMessageResponse,
} from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { canOpenWebEvidencePreview, openWebEvidencePreview, resolveWebAttachmentImageUrl, resolveWebAttachmentMediaUrl, resolveWebEvidenceContentUrl } from './webPreview';
import { createWebSettingsAdapter } from './webSettingsAdapter';
import { recordWebAgentTaskIndex } from './webPlatformAgentTask';
import {
  buildHubAgentTaskModelParams,
  isDispatchableLocalEdgeTarget,
  targetDispatchBlockerLabel,
} from './webPlatformDispatchHelpers';
import { webConversations } from './webPlatformFixtures';
import {
  confirmOptimisticHubMessage,
  optimisticHubMessageFromIntent,
  removeOptimisticHubMessage,
  resolveComposerMessageContent,
  upsertHubMessage,
} from './webPlatformMessageHelpers';

// Stable public surface re-exports (consumers keep importing from webPlatform).
export type { WebActiveAgentTask } from './webPlatformAgentTask';
export {
  compactActiveAgentTask,
  readStoredWebActiveAgentTask,
  recordWebAgentTaskIndex,
  webActiveAgentTaskQueryKey,
  webAgentTaskIndexQueryKey,
} from './webPlatformAgentTask';
export {
  webAgents,
  webConversations,
  webHubEmptyConversation,
  webHubEmptyTranscript,
  webTranscript,
} from './webPlatformFixtures';
export {
  agentInfoToWorkbenchAgent,
  hubSessionToWorkbenchConversation,
  resolveWebWorkbenchAgents,
  resolveWebWorkbenchConversations,
  webConversationWithPinnedMessages,
} from './webPlatformMapping';
export {
  confirmOptimisticHubMessage,
  optimisticHubMessageFromIntent,
  removeOptimisticHubMessage,
  upsertHubMessage,
} from './webPlatformMessageHelpers';

type WebRunHubClient =
  Pick<HubClient, 'addAgentToSession' | 'sendMessage' | 'triggerAgentTask'> &
  Partial<Pick<HubClient, 'listExecutionTargets' | 'pinMessage' | 'unpinMessage' | 'forwardMessage' | 'recallMessage' | 'addMessageReaction'>>;

interface WebComposerIntent extends ComposerIntent {
  executionTargetId?: string;
}

interface SessionAgentInstanceBinding {
  profileId: string;
  runtimeId: string;
  agentInstance: AgentInstance;
}

interface WebPlatformOptions {
  hubClient?: WebRunHubClient;
  queryClient?: QueryClient;
  createClientMessageId?: () => string;
  demoRuntimeStore?: WorkbenchDemoRuntimeStore;
  /**
   * Explicit product-shell opt-in for demo/fixture composer mutations (AH-SR-043).
   * Must be paired with a mock/fixture dataMode; auto/real never succeed via demo.
   */
  demoRuntimeFallback?: boolean;
  /** Resolved workbench data mode (env + browser override). Defaults to env-only. */
  dataMode?: WorkbenchDataMode | string;
  now?: () => string;
  ensureAuth?: () => boolean;
}

const defaultHubClient = createHubClient({ getToken: getAccessToken });

export function createWebPlatform(options: WebPlatformOptions = {}): AgentHubPlatform {
  const hubClient = options.hubClient ?? defaultHubClient;
  const hasInjectedHubClient = Boolean(options.hubClient);
  const queryClient = options.queryClient ?? defaultQueryClient;
  const createClientMessageId = options.createClientMessageId ?? newClientMessageId;
  const demoRuntimeStore = options.demoRuntimeStore ?? workbenchDemoRuntimeStore;
  const now = options.now ?? (() => new Date().toISOString());
  const ensureAuth = options.ensureAuth;

  // #1938: let the shared transcript reach the web attachment-image
  // resolver without prop threading through workbench glue.
  registerAttachmentImageUrlResolver(resolveWebAttachmentImageUrl);
  // #1939: same registration path for audio/video attachment media.
  registerAttachmentMediaUrlResolver(resolveWebAttachmentMediaUrl);

  return {
    surface: 'web',
    capabilities: {
      localEdge: false,
      localFiles: false,
      browserPreview: true,
      localTerminal: false,
      // Hub exposes approval endpoints; Web can drive accept/reject via Hub.
      // Runtime evidence content & sandbox are metadata-only / absent on the
      // Hub data plane — left un-declared so UI hides those affordances.
      approval: true,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return webConversations;
      },
    },
    preview: {
      canOpenEvidence: canOpenWebEvidencePreview,
      openEvidence: openWebEvidencePreview,
      resolveContentUrl: resolveWebEvidenceContentUrl,
      resolveAttachmentImageUrl: resolveWebAttachmentImageUrl,
      resolveAttachmentMediaUrl: resolveWebAttachmentMediaUrl,
      // applyRunDiff / applyAllRunDiffs are intentionally omitted (#1817):
      // Web is Hub-only and has no Local Edge write-back path. The omission
      // IS the unsupported contract — the inspector renders an explicit
      // read-only review notice and a warning toast on apply attempts.
      //
      // downloadArtifactContent is intentionally omitted too (#1945): Hub
      // exposes artifact metadata only (/web/agent-tasks/{id}/artifacts is a
      // metadata projection with no content route), and Web never reaches a
      // Local Edge. The omission degrades the artifact row to the consistent
      // "download unavailable" notice instead of a silent no-op.
    },
    attachments: {
      async pickFiles(): Promise<never[]> {
        // Web platform uses browser file input directly via the composer UI.
        throw new Error('Web platform does not support programmatic file picking. Use the composer file input instead.');
      },
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
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        const dataMode = normalizeWorkbenchDataMode(
          options.dataMode ?? import.meta.env.VITE_AGENTHUB_DATA_MODE,
        );
        const hasHubToken = Boolean(getAccessToken());
        // AH-SR-043: demo success only via shared fail-closed gate (explicit mock/fixture opt-in).
        // Never silent-fallback from auto/observed/approved-real, even when unsigned-out.
        // ensureAuth is for the real Hub path only; it must not block intentional fixture demos.
        const shouldUseDemoFallback = allowsWorkbenchDemoRuntimeMutation({
          demoRuntimeFallback: options.demoRuntimeFallback,
          dataMode,
          hasInjectedHubClient,
        });
        if (shouldUseDemoFallback) {
          return demoRuntimeStore.submitComposerIntent(intent);
        }
        if (!hasHubToken && ensureAuth && !ensureAuth()) {
          throw new Error('Hub authentication is required before Web can submit real Hub work.');
        }
        if (!hasHubToken && !ensureAuth && !hasInjectedHubClient) {
          throw new Error('Hub authentication is required before Web can submit real Hub work.');
        }
        return submitWebComposerIntent(hubClient, createClientMessageId, intent, { queryClient, now });
      },
      async redispatchTask(intent: ComposerIntent, messageId: string): Promise<RedispatchTaskResult> {
        // Same fail-closed gates as submitComposerIntent (AH-SR-043). The demo
        // sink never rejects a dispatch (no agent-tasks flow), so a no-op
        // result drains the client queue without simulating anything.
        const dataMode = normalizeWorkbenchDataMode(
          options.dataMode ?? import.meta.env.VITE_AGENTHUB_DATA_MODE,
        );
        const hasHubToken = Boolean(getAccessToken());
        const shouldUseDemoFallback = allowsWorkbenchDemoRuntimeMutation({
          demoRuntimeFallback: options.demoRuntimeFallback,
          dataMode,
          hasInjectedHubClient,
        });
        if (shouldUseDemoFallback) {
          return { taskId: undefined };
        }
        if (!hasHubToken && ensureAuth && !ensureAuth()) {
          throw new Error('Hub authentication is required before Web can submit real Hub work.');
        }
        if (!hasHubToken && !ensureAuth && !hasInjectedHubClient) {
          throw new Error('Hub authentication is required before Web can submit real Hub work.');
        }
        return redispatchWebTask(hubClient, messageId, intent, { queryClient });
      },
    },
    settings: createWebSettingsAdapter(),
    messageActions: {
      async pinMessage(messageId: string, sessionId: string): Promise<void> {
        if (!hubClient.pinMessage) {
          throw new Error('Hub pin endpoint is unavailable on this Web build.');
        }
        await hubClient.pinMessage(messageId, sessionId);
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-pins', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', sessionId] });
      },
      async unpinMessage(messageId: string, sessionId: string): Promise<void> {
        if (!hubClient.unpinMessage) {
          throw new Error('Hub unpin endpoint is unavailable on this Web build.');
        }
        await hubClient.unpinMessage(messageId, sessionId);
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-pins', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', sessionId] });
      },
      async forwardMessage(messageId: string, targetSessionIds: string[]): Promise<void> {
        if (!hubClient.forwardMessage) {
          throw new Error('Hub forward endpoint is unavailable on this Web build.');
        }
        await hubClient.forwardMessage(messageId, targetSessionIds);
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });
        for (const targetSessionId of targetSessionIds) {
          void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', targetSessionId] });
        }
      },
      async recallMessage(messageId: string): Promise<void> {
        if (!hubClient.recallMessage) {
          throw new Error('Hub recall endpoint is unavailable on this Web build.');
        }
        await hubClient.recallMessage(messageId);
        // recallMessage carries no session id, so invalidate every open
        // hub-messages query (prefix match) instead of one session.
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages'] });
      },
      async addMessageReaction(messageId: string, sessionId: string, reaction: { emoji: string }): Promise<void> {
        if (!hubClient.addMessageReaction) {
          throw new Error('Hub reaction endpoint is unavailable on this Web build.');
        }
        await hubClient.addMessageReaction(messageId, sessionId, reaction);
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', sessionId] });
      },
    },
  };
}

interface SubmitWebComposerIntentOptions {
  queryClient?: QueryClient;
  now?: () => string;
}

/**
 * Upload any attachments that have a browser File reference but have not
 * yet been uploaded to the Hub attachment store. Returns a new attachments
 * array with attachmentRef populated for each successfully uploaded file.
 */
async function uploadPendingAttachments(intent: ComposerIntent): Promise<ComposerAttachment[]> {
  const hubAttachments = createHubClient({ getToken: getAccessToken });
  return Promise.all(intent.attachments.map(async (attachment) => {
    // Already uploaded or no File to upload
    if (attachment.attachmentRef || !attachment.file) return attachment;

    try {
      const hash = await computeFileHash(attachment.file);
      const ref = await hubAttachments.uploadAttachment(attachment.file, hash);
      return {
        ...attachment,
        attachmentRef: {
          id: ref.id,
          name: ref.original_name || attachment.name,
          ...(ref.original_name ? { original_name: ref.original_name } : {}),
          size: ref.size,
          mime_type: ref.mime_type,
          ...(ref.hash ? { hash: ref.hash } : {}),
          url: hubAttachments.downloadAttachmentUrl(ref.id),
          ...(ref.metadata ? { metadata: ref.metadata } : {}),
          ...(ref.created_at ? { created_at: ref.created_at } : {}),
        },
      };
    } catch {
      // If upload fails, keep the attachment without a ref so the text
      // content is still included in the message.
      return attachment;
    }
  }));
}

async function submitWebComposerIntent(
  hubClient: WebRunHubClient,
  createClientMessageId: () => string,
  intent: ComposerIntent,
  options: SubmitWebComposerIntentOptions = {},
): Promise<ComposerSubmitResult> {
  // Upload any attachments that have a File reference but no server-side ref yet
  const pendingUploads = intent.attachments.filter((a) => a.file && !a.attachmentRef);
  const enrichedAttachments = pendingUploads.length > 0
    ? await uploadPendingAttachments(intent)
    : intent.attachments;
  const enrichedIntent = { ...intent, attachments: enrichedAttachments };

  // #1406 @agent 派单：选取 dispatchRole !== 'context' 的第一个 mention 作为派单目标。
  // backward-compat：已有 mention（无 dispatchRole）视为可派单；显式 'context' 跳过。
  const dispatchMention = enrichedIntent.mentions.find(
    (m) => m.dispatchRole !== 'context',
  );
  if (dispatchMention && !dispatchMention.runtimeId) {
    throw new Error(`Mentioned Hub agent "${dispatchMention.label}" is missing a runtime id.`);
  }
  const dispatchTarget = dispatchMention
    ? await resolveWebDispatchTarget(hubClient, (enrichedIntent as WebComposerIntent).executionTargetId)
    : undefined;
  const agentInstance = dispatchMention
    ? await ensureMentionedAgentInstance(hubClient, enrichedIntent.conversationId, dispatchMention, options.queryClient)
    : undefined;

  const clientMessageId = createClientMessageId();
  const optimisticMessage = optimisticHubMessageFromIntent(enrichedIntent, clientMessageId, options.now?.() ?? new Date().toISOString());
  upsertHubMessage(options.queryClient, optimisticMessage);

  let message: SendMessageResponse;
  try {
    message = await sendComposerMessage(hubClient, clientMessageId, enrichedIntent);
    confirmOptimisticHubMessage(options.queryClient, enrichedIntent.conversationId, clientMessageId, message);
  } catch (error) {
    removeOptimisticHubMessage(options.queryClient, enrichedIntent.conversationId, clientMessageId);
    throw error;
  }

  if (!dispatchMention) {
    return { intentId: message.message_id };
  }

  // The Hub message is already sent & confirmed at this point. If task dispatch
  // hits a recoverable 409 turn_in_progress (agent instance has a non-terminal
  // task, #1430), don't surface as a hard error — the message is persisted
  // (SendMessage is independent). Return the message id with turnInProgress so
  // the shell can show an info toast and restore the composer to idle.
  let task: PendingAgentTask;
  try {
    task = await triggerMentionedAgent(hubClient, message.message_id, agentInstance?.id, dispatchTarget, enrichedIntent);
  } catch (error) {
    if (isTurnInProgressError(error)) {
      return { intentId: message.message_id, turnInProgress: true };
    }
    throw error;
  }
  if (task.id) {
    const targetId = task.target_id ?? dispatchTarget?.id;
    recordWebAgentTaskIndex(options.queryClient, {
      taskId: task.id,
      sessionId: intent.conversationId,
      agentInstanceId: task.agent_instance_id,
      triggerMessageId: task.trigger_message_id || message.message_id,
      ...(targetId ? { targetId } : {}),
      ...(task.edge_run_id ? { edgeRunId: task.edge_run_id } : {}),
      ...(task.edge_device_id ? { edgeDeviceId: task.edge_device_id } : {}),
      status: task.status || 'queued',
    });
  }
  return { intentId: task.id || message.message_id };
}

/**
 * Dispatch-only retry for the client pending-intents queue (CF22). Unlike
 * `submitWebComposerIntent` this never sends a message — the given Hub
 * message id is the retry trigger for the existing agent-tasks dispatch.
 * A recoverable 409 turn_in_progress is surfaced as `{ turnInProgress: true }`
 * so the queue can requeue (bounded) instead of dropping the dispatch.
 */
async function redispatchWebTask(
  hubClient: WebRunHubClient,
  messageId: string,
  intent: ComposerIntent,
  options: { queryClient?: QueryClient } = {},
): Promise<RedispatchTaskResult> {
  const dispatchMention = intent.mentions.find((m) => m.dispatchRole !== 'context');
  if (!dispatchMention) {
    // Nothing to dispatch (e.g. only context mentions) — treat as success so
    // the queue drains instead of stalling on a non-dispatch entry.
    return { taskId: undefined };
  }
  const dispatchTarget = await resolveWebDispatchTarget(
    hubClient,
    (intent as WebComposerIntent).executionTargetId,
  );
  const agentInstance = await ensureMentionedAgentInstance(
    hubClient,
    intent.conversationId,
    dispatchMention,
    options.queryClient,
  );
  try {
    const task = await triggerMentionedAgent(hubClient, messageId, agentInstance?.id, dispatchTarget, intent);
    if (task.id) {
      const targetId = task.target_id ?? dispatchTarget?.id;
      recordWebAgentTaskIndex(options.queryClient, {
        taskId: task.id,
        sessionId: intent.conversationId,
        agentInstanceId: task.agent_instance_id,
        triggerMessageId: task.trigger_message_id || messageId,
        ...(targetId ? { targetId } : {}),
        ...(task.edge_run_id ? { edgeRunId: task.edge_run_id } : {}),
        ...(task.edge_device_id ? { edgeDeviceId: task.edge_device_id } : {}),
        status: task.status || 'queued',
      });
    }
    return { taskId: task.id };
  } catch (error) {
    if (isTurnInProgressError(error)) {
      return { turnInProgress: true };
    }
    throw error;
  }
}

async function sendComposerMessage(
  hubClient: WebRunHubClient,
  clientMessageId: string,
  intent: ComposerIntent,
): Promise<SendMessageResponse> {
  const { contentType, content } = resolveComposerMessageContent(intent);

  return hubClient.sendMessage(intent.conversationId, {
    client_msg_id: clientMessageId,
    content_type: contentType,
    content,
    ...(intent.replyTo ? { reply_to_message_id: intent.replyTo.messageId } : {}),
  });
}

function sessionAgentBindingsQueryKey(sessionId: string): [string, string, string] {
  return ['web-v4', 'session-agent-instances', sessionId];
}

async function ensureMentionedAgentInstance(
  hubClient: WebRunHubClient,
  sessionId: string,
  mention: ComposerIntent['mentions'][number],
  queryClient: QueryClient | undefined,
): Promise<AgentInstance> {
  const runtimeId = mention.runtimeId?.trim();
  if (!runtimeId) {
    throw new Error(`Mentioned Hub agent "${mention.label}" is missing a runtime id.`);
  }

  const cached = queryClient
    ?.getQueryData<SessionAgentInstanceBinding[]>(sessionAgentBindingsQueryKey(sessionId))
    ?.find((binding) => binding.profileId === mention.id && binding.runtimeId === runtimeId);
  if (cached?.agentInstance.id) {
    return cached.agentInstance;
  }

  const agentInstance = await hubClient.addAgentToSession(sessionId, {
    agent_type: runtimeId,
    display_name: mention.label,
  });
  if (!agentInstance?.id) {
    throw new Error(`Hub did not return an agent instance id for "${mention.label}".`);
  }

  upsertSessionAgentBinding(queryClient, sessionId, {
    profileId: mention.id,
    runtimeId,
    agentInstance,
  });
  return agentInstance;
}

function upsertSessionAgentBinding(
  queryClient: QueryClient | undefined,
  sessionId: string,
  binding: SessionAgentInstanceBinding,
): void {
  queryClient?.setQueryData<SessionAgentInstanceBinding[]>(
    sessionAgentBindingsQueryKey(sessionId),
    (current = []) => [
      ...current.filter((item) => item.profileId !== binding.profileId || item.runtimeId !== binding.runtimeId),
      binding,
    ],
  );
}

async function triggerMentionedAgent(
  hubClient: WebRunHubClient,
  triggerMessageId: string,
  agentInstanceId: string | undefined,
  target: Pick<ExecutionTarget, 'id'> | undefined,
  intent: ComposerIntent,
): Promise<PendingAgentTask> {
  if (!agentInstanceId) {
    throw new Error('Hub did not return an exact agent instance id for dispatch.');
  }
  if (!target?.id) {
    throw new Error('Selected Desktop/Edge target is not available for Web Hub dispatch.');
  }
  return hubClient.triggerAgentTask(triggerMessageId, {
    agent_instance_id: agentInstanceId,
    target_id: target.id,
    model_params: JSON.stringify(buildHubAgentTaskModelParams(intent)),
  });
}

async function resolveWebDispatchTarget(
  hubClient: WebRunHubClient,
  executionTargetId: string | undefined,
): Promise<Pick<ExecutionTarget, 'id'>> {
  const requestedTargetId = executionTargetId?.trim();
  if (!requestedTargetId) {
    throw new Error('Select a Desktop/Edge target before Web can dispatch real Hub work.');
  }
  if (!hubClient.listExecutionTargets) {
    throw new Error('Hub execution target inventory is required for Web Hub dispatch.');
  }
  const inventory = await hubClient.listExecutionTargets({
    target_type: 'local_edge',
    pageSize: 50,
  });
  const onlineLocalEdgeTargets = inventory.items.filter(isDispatchableLocalEdgeTarget);
  const target = onlineLocalEdgeTargets.find((item) => item.id === requestedTargetId);
  if (!target) {
    const requested = inventory.items.find((item) => item.id === requestedTargetId);
    if (requested) {
      throw new Error(
        `Selected Desktop/Edge target is not dispatchable: ${targetDispatchBlockerLabel(requested)}.`,
      );
    }
    throw new Error('Selected Desktop/Edge target is missing from Hub inventory.');
  }
  return target;
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-v4-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
