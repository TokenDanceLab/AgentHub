import { useMemo, useSyncExternalStore } from 'react';
import {
  demoWorkbenchAgents,
  getWorkbenchDataModeOverrideSnapshot,
  isWorkbenchRealDataMode,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
  workbenchDemoRuntimeStore,
  type WorkbenchDataMode,
} from '@shared/demo';
import { normalizeThreadItemsToTranscript } from '@shared/transcript';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo, ThreadPinInfo } from '@shared/types';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useDesktopEdgeEvents } from './useDesktopEdgeEvents';

export interface DesktopWorkbenchModel {
  activeConversationId: string;
  activeProjectId?: string;
  activeThreadId?: string;
  agents: WorkbenchAgent[];
  conversations: WorkbenchConversation[];
  dataMode: string;
  isDemo: boolean;
  transcript: ReturnType<typeof normalizeThreadItemsToTranscript>;
}

const EMPTY_TRANSCRIPT: ReturnType<typeof normalizeThreadItemsToTranscript> = [];
const DESKTOP_DEMO_DEFAULT_CONVERSATION_ID = 'agent-collab';

export function useDesktopWorkbenchModel(selectedConversationId?: string): DesktopWorkbenchModel {
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = getWorkbenchDataMode(dataModeOverride);
  const demoSnapshot = useSyncExternalStore(
    workbenchDemoRuntimeStore.subscribe,
    workbenchDemoRuntimeStore.getSnapshot,
    workbenchDemoRuntimeStore.getSnapshot,
  );
  const useDemo = !isWorkbenchRealDataMode(dataMode);
  const threadsQuery = useThreads(undefined, { enabled: !useDemo });
  const threads = useDemo ? [] : threadsQuery.data?.items ?? [];
  const activeThread = useDemo
    ? undefined
    : threads.find((thread) => thread.threadId === selectedConversationId) ?? threads[0];
  const activeConversationId = activeThread?.threadId ?? selectedConversationId ?? '';
  const threadItemsQuery = useThreadMessages(useDemo ? null : activeThread?.threadId ?? null);
  const threadPinsQuery = useThreadPins(useDemo ? null : activeThread?.threadId ?? null);
  const threadItems = threadItemsQuery.data?.items;
  const threadPins = threadPinsQuery.data?.items;
  const persistedUntilMs = useMemo(() => latestThreadItemTimestampMs(threadItems), [threadItems]);
  const liveTranscript = useDesktopEdgeEvents(useDemo ? undefined : activeThread?.threadId, persistedUntilMs);

  const demoModel = useMemo(() => {
    const selectedDemoConversation = demoSnapshot.conversations.some((conversation) => conversation.id === selectedConversationId)
      ? selectedConversationId!
      : DESKTOP_DEMO_DEFAULT_CONVERSATION_ID;

    return {
      activeConversationId: selectedDemoConversation,
      agents: demoWorkbenchAgents,
      conversations: demoSnapshot.conversations,
      dataMode: dataMode === 'auto' ? 'mock (auto fallback)' : dataMode,
      isDemo: true,
      transcript: workbenchDemoRuntimeStore.resolveTranscript(selectedDemoConversation),
    };
  }, [dataMode, demoSnapshot, selectedConversationId]);

  const conversations = useMemo(() => {
    if (threads.length === 0) return [];
    return threads.map((thread) =>
      threadToConversation(
        thread,
        thread.threadId === activeThread?.threadId ? threadPins : undefined,
      ),
    );
  }, [activeThread?.threadId, threadPins, threads]);

  const transcript = useMemo(() => {
    const items = threadItems ?? [];
    const persistedTranscript = normalizeThreadItemsToTranscript(items);
    if (persistedTranscript.length > 0 || liveTranscript.length > 0) {
      return [...persistedTranscript, ...liveTranscript];
    }
    if (threads.length === 0) return EMPTY_TRANSCRIPT;
    return [];
  }, [liveTranscript, threadItems, threads.length]);

  const liveModel = {
    activeConversationId,
    ...(activeThread?.projectId ? { activeProjectId: activeThread.projectId } : {}),
    ...(activeThread?.threadId ? { activeThreadId: activeThread.threadId } : {}),
    agents: [],
    conversations,
    dataMode,
    isDemo: false,
    transcript,
  };

  return useDemo ? demoModel : liveModel;
}

function getWorkbenchDataMode(override: WorkbenchDataMode | undefined): WorkbenchDataMode {
  return resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, override);
}

function threadToConversation(thread: ThreadInfo, pins?: ThreadPinInfo[]): WorkbenchConversation {
  const updatedLabel = thread.updatedAt ? formatTimestamp(thread.updatedAt) : undefined;

  const conversation: WorkbenchConversation = {
    id: thread.threadId,
    title: thread.title?.trim() || '未命名会话',
    kind: (thread.kind === 'direct' || thread.kind === 'group') ? thread.kind : 'group',
    subtitle: threadSubtitle(thread),
    updatedLabel,
    avatarColor: thread.avatarColor,
    avatarLabel: thread.avatarLabel,
  };
  const pin = pins?.[0];
  if (pin?.item?.content) {
    conversation.pinnedAnnouncement = {
      title: conversation.title,
      content: pin.item.content,
      author: pin.pinnedBy || pin.item.role || 'Edge',
      time: formatPinTime(pin.pinnedAt),
      sourceId: pin.itemId,
    };
  }
  return conversation;
}

function threadSubtitle(thread: ThreadInfo): string {
  return thread.status?.trim() || 'active';
}

function formatTimestamp(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
}

function latestThreadItemTimestampMs(items: ThreadItemInfo[] | undefined): number | undefined {
  if (!items?.length) return undefined;

  let latest = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const parsed = Date.parse(item.createdAt);
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }

  return Number.isFinite(latest) ? latest : undefined;
}

function formatPinTime(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
