/**
 * Workbench demo runtime store factory and transcript resolvers.
 * Peel companion of workbenchDemo (#1131). Pure residual helpers; zero behavior change.
 */

import type { ComposerIntent, ComposerSubmitResult } from '../composer';
import type { WorkbenchConversation } from '../platform';
import type { TranscriptBlock } from '../transcript';
import { getI18n } from 'react-i18next';
import { appDateLocaleTag } from '../i18n/locale';
import { TEAMRUN_DEMO_CONVERSATION_ID, teamRunDemoTranscript } from './teamrunDemo';
import { demoConversationsBase, demoWorkbenchAgents } from './workbenchDemoAgents';
import { demoWorkbenchPins } from './workbenchDemoMessages';
import {
  BUILDER_PINNED_ANNOUNCEMENT,
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  type WorkbenchDemoMessagePin,
  type WorkbenchDemoRuntimeStore,
  type WorkbenchDemoStore,
} from './workbenchDemoTypes';

// ChatView fixtures (~62 KB hardcoded demo data) — lazily loaded only in DEV
// In production builds (import.meta.env.PROD), the dynamic import is
// dead-code-eliminated by Vite, saving ~62 KB from the main bundle.
let _demoWorkbenchTranscripts: Record<string, TranscriptBlock[]> | null = null;
let _chatviewTranscriptsLoading = false;

async function loadChatviewTranscripts(): Promise<void> {
  if (_chatviewTranscriptsLoading) return;
  if (import.meta.env.DEV) {
    _chatviewTranscriptsLoading = true;
    try {
      const fixtures = await import('./chatviewFixtures');
      _demoWorkbenchTranscripts = {
        'agent-collab': fixtures.chatviewAgentCollabTranscript,
        builder: fixtures.chatviewBuilderTranscript,
        deployer: fixtures.chatviewBuilderTranscript,
        reviewer: fixtures.chatviewBuilderTranscript,
        researcher: fixtures.chatviewBuilderTranscript,
        orchestrator: fixtures.chatviewBuilderTranscript,
        'pinned-announcements': fixtures.chatviewAnnouncementTranscript,
        [TEAMRUN_DEMO_CONVERSATION_ID]: teamRunDemoTranscript,
      };
    } catch {
      // Dynamic import failed — fallback remains.
    }
  }
}

function getChatviewTranscripts(): Record<string, TranscriptBlock[]> {
  if (!_demoWorkbenchTranscripts) {
    // Fallback for PROD or before lazy load completes
    _demoWorkbenchTranscripts = {
      [TEAMRUN_DEMO_CONVERSATION_ID]: teamRunDemoTranscript,
    };
  }
  return _demoWorkbenchTranscripts;
}

// Eager-load chatview transcripts in DEV so demo conversations render immediately.
// In PROD this is a no-op (dead-code eliminated).
const _chatviewTranscriptsReady: Promise<void> = (() => {
  if (import.meta.env.DEV) {
    return loadChatviewTranscripts();
  }
  return Promise.resolve();
})();

/**
 * Returns a Promise that resolves when the lazy-loaded ChatView fixture
 * transcripts are ready. Tests can await this before asserting fixture data.
 */
export function whenChatviewTranscriptsReady(): Promise<void> {
  return _chatviewTranscriptsReady;
}

export function createWorkbenchDemoStore(): WorkbenchDemoStore {
  return {
    conversations: demoConversationsBase.map((conversation) => conversationWithDemoPin(conversation)),
    agents: demoWorkbenchAgents,
    transcripts: getChatviewTranscripts(),
    pins: demoWorkbenchPins,
  };
}

export function createWorkbenchDemoRuntimeStore(initialStore: WorkbenchDemoStore = createWorkbenchDemoStore()): WorkbenchDemoRuntimeStore {
  let transcripts = cloneTranscripts(initialStore.transcripts);
  let pins = initialStore.pins.map((pin) => ({ ...pin }));
  let sequence = 0;
  const listeners = new Set<() => void>();
  let currentSnapshot = createSnapshot();

  function emit(): void {
    currentSnapshot = createSnapshot();
    for (const listener of listeners) listener();
  }

  function createSnapshot(): WorkbenchDemoStore {
    const liveTranscripts = { ...getChatviewTranscripts(), ...transcripts };
    return {
      conversations: demoConversationsBase.map((conversation) => conversationWithPins(conversation, liveTranscripts, pins)),
      agents: demoWorkbenchAgents.map((agent) => ({ ...agent })),
      transcripts: cloneTranscripts(liveTranscripts),
      pins: pins.map((pin) => ({ ...pin })),
    };
  }

  return {
    getSnapshot: () => currentSnapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveTranscript(conversationId: string): TranscriptBlock[] {
      return transcripts[conversationId] ?? getChatviewTranscripts()[conversationId] ?? createConversationPreviewTranscript(conversationId);
    },
    async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
      sequence += 1;
      const now = new Date().toISOString();
      const userMessageId = `demo-user-${sequence}`;
      const agentMessageId = `demo-agent-${sequence}`;
      const current = transcripts[intent.conversationId] ?? getChatviewTranscripts()[intent.conversationId] ?? createConversationPreviewTranscript(intent.conversationId);
      transcripts = {
        ...transcripts,
        [intent.conversationId]: [
          ...current,
          {
            id: userMessageId,
            kind: 'text',
            createdAt: now,
            author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
            text: intent.text,
          },
          {
            id: agentMessageId,
            kind: 'text',
            createdAt: now,
            author: { id: 'demo-agent', name: 'AgentHub Demo', role: 'agent' },
            text: `收到，我会继续跟进：${intent.text}`,
          },
        ],
      };
      emit();
      return { intentId: agentMessageId };
    },
    pinMessage(conversationId: string, messageId: string, pinnedBy = 'Demo'): void {
      // Search across ALL transcripts (live + internal + fallback preview) for the message,
      // not just the current conversation's transcript.
      const liveTranscripts = getChatviewTranscripts();
      const exists = Object.entries(liveTranscripts).some(([, blocks]) =>
        blocks.some((block) => block.id === messageId),
      ) || Object.entries(transcripts).some(([, blocks]) =>
        blocks.some((block) => block.id === messageId),
      ) || createConversationPreviewTranscript(conversationId).some((block) => block.id === messageId);
      if (!exists) return;
      const current = transcripts[conversationId] ?? liveTranscripts[conversationId] ?? createConversationPreviewTranscript(conversationId);
      if (!transcripts[conversationId]) {
        transcripts = {
          ...transcripts,
          [conversationId]: current,
        };
      }
      const nextPin = {
        conversationId,
        messageId,
        pinnedBy,
        pinnedAt: new Date().toISOString(),
      };
      pins = [
        nextPin,
        ...pins.filter((pin) => pin.conversationId !== conversationId || pin.messageId !== messageId),
      ];
      emit();
    },
    unpinMessage(conversationId: string, messageId: string): void {
      const nextPins = pins.filter((pin) => pin.conversationId !== conversationId || pin.messageId !== messageId);
      if (nextPins.length === pins.length) return;
      pins = nextPins;
      emit();
    },
    addConversation(conversation: WorkbenchConversation): void {
      const existing = demoConversationsBase.find((item) => item.id === conversation.id);
      if (existing) return;
      demoConversationsBase.push(conversation);
      transcripts = {
        ...transcripts,
        [conversation.id]: createConversationPreviewTranscript(conversation.id),
      };
      emit();
    },
  };
}

export const workbenchDemoRuntimeStore = createWorkbenchDemoRuntimeStore();

export function resolveDemoWorkbenchTranscript(conversationId: string): TranscriptBlock[] {
  return getChatviewTranscripts()[conversationId] ?? createConversationPreviewTranscript(conversationId);
}

function conversationWithDemoPin(conversation: WorkbenchConversation): WorkbenchConversation {
  return conversationWithPins(conversation, getChatviewTranscripts(), demoWorkbenchPins);
}

function conversationWithPins(
  conversation: WorkbenchConversation,
  transcripts: Record<string, TranscriptBlock[]>,
  pins: WorkbenchDemoMessagePin[],
): WorkbenchConversation {
  const pin = pins.find((item) => item.conversationId === conversation.id);
  if (!pin) return { ...conversation };
  const conversationTranscript = transcripts[conversation.id] ?? createConversationPreviewTranscript(conversation.id);
  // Also search the fallback preview transcript — pinMessage may have pinned a message
  // that only exists in the fallback, not the stored transcript.
  const fallbackTranscript = createConversationPreviewTranscript(conversation.id);
  const message = conversationTranscript.find((block) => block.id === pin.messageId)
    ?? fallbackTranscript.find((block) => block.id === pin.messageId);
  if (!message || !('text' in message)) return { ...conversation };
  const content = conversation.id === WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID
    ? BUILDER_PINNED_ANNOUNCEMENT
    : message.text;
  return {
    ...conversation,
    pinnedAnnouncement: {
      title: conversation.title,
      content,
      author: pin.pinnedBy,
      time: formatDemoPinTime(pin.pinnedAt),
      sourceId: pin.messageId,
    },
  };
}

function cloneTranscripts(source: Record<string, TranscriptBlock[]>): Record<string, TranscriptBlock[]> {
  return Object.fromEntries(
    Object.entries(source).map(([conversationId, transcript]) => [
      conversationId,
      transcript.map((block) => ({ ...block })),
    ]),
  );
}

function createConversationPreviewTranscript(conversationId: string): TranscriptBlock[] {
  const conversation = demoConversationsBase.find((item) => item.id === conversationId);
  const agentName = conversation?.title ?? 'AgentHub';
  const subtitle = conversation?.subtitle ?? 'AgentHub v4 会话';
  const replyRole = conversation?.kind === 'group'
    ? 'system'
    : isDemoHumanContact(conversationId)
      ? 'human'
      : 'agent';
  return [
    {
      id: `${conversationId}-user-1`,
      kind: 'text',
      author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
      text: `打开 ${agentName} 会话，继续按 tokendance-design v4 工作台检查当前任务。`,
    },
    {
      id: `${conversationId}-reply-1`,
      kind: 'text',
      author: { id: conversationId, name: agentName, role: replyRole },
      text: `${subtitle}。当前预览会话已切换，消息区、右侧概览和输入目标都应跟随左侧选择更新。`,
    },
    {
      id: `${conversationId}-session-1`,
      kind: 'run_session',
      author: { id: conversationId, name: agentName, role: 'agent' },
      title: `${agentName} 工作流`,
      status: conversationId === 'project-docs' ? 'completed' : 'running',
      meta: `${agentName} · ${conversation?.model ?? 'v4 shared UI'}`,
      runId: `run_${conversationId.replace(/[^a-z0-9]+/gi, '_')}_preview`,
    },
  ];
}

function isDemoHumanContact(conversationId: string): boolean {
  return ['johnny', 'trump'].includes(conversationId);
}

function formatDemoPinTime(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString(appDateLocaleTag(getI18n()?.language), {
    hour: '2-digit',
    minute: '2-digit',
  });
}
