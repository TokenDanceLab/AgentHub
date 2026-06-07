import { useMemo } from 'react';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  createWorkbenchDemoStore,
  normalizeWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
} from '@shared/demo';
import { normalizeThreadItemsToTranscript } from '@shared/transcript';
import type { WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo, ThreadPinInfo } from '@shared/types';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useDesktopEdgeEvents } from './useDesktopEdgeEvents';

export interface DesktopWorkbenchModel {
  activeConversationId: string;
  activeProjectId?: string;
  activeThreadId?: string;
  conversations: WorkbenchConversation[];
  transcript: ReturnType<typeof normalizeThreadItemsToTranscript>;
}

const demoStore = createWorkbenchDemoStore();
const EMPTY_TRANSCRIPT: ReturnType<typeof normalizeThreadItemsToTranscript> = [];

export function useDesktopWorkbenchModel(selectedConversationId?: string): DesktopWorkbenchModel {
  const dataMode = getWorkbenchDataMode();
  const useDemo = dataMode === 'demo' || (dataMode === 'auto' && isBrowserPreview());

  if (useDemo) {
    return useMemo(() => ({
      activeConversationId: selectedConversationId ?? WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
      conversations: demoStore.conversations,
      transcript: resolveDemoWorkbenchTranscript(selectedConversationId ?? WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID),
    }), [selectedConversationId]);
  }

  const threadsQuery = useThreads();
  const threads = threadsQuery.data?.items ?? [];
  const activeThread = threads.find((thread) => thread.threadId === selectedConversationId) ?? threads[0];
  const activeConversationId = activeThread?.threadId ?? WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID;
  const threadItemsQuery = useThreadMessages(activeThread?.threadId ?? null);
  const threadPinsQuery = useThreadPins(activeThread?.threadId ?? null);
  const threadItems = threadItemsQuery.data?.items;
  const threadPins = threadPinsQuery.data?.items;
  const persistedUntilMs = useMemo(() => latestThreadItemTimestampMs(threadItems), [threadItems]);
  const liveTranscript = useDesktopEdgeEvents(activeThread?.threadId, persistedUntilMs);

  const conversations = useMemo(() => {
    if (threads.length === 0) return dataMode === 'auto' ? demoStore.conversations : [];
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
    if (threads.length === 0) {
      return dataMode === 'auto'
        ? resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID)
        : EMPTY_TRANSCRIPT;
    }
    return [];
  }, [dataMode, liveTranscript, threadItems, threads.length]);

  return {
    activeConversationId,
    activeProjectId: activeThread?.projectId,
    activeThreadId: activeThread?.threadId,
    conversations,
    transcript,
  };
}

/** Browser preview (no Tauri shell) uses mock data for demo fidelity. */
function isBrowserPreview(): boolean {
  return typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);
}

function getWorkbenchDataMode() {
  return normalizeWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE);
}

function threadToConversation(thread: ThreadInfo, pins?: ThreadPinInfo[]): WorkbenchConversation {
  const updatedLabel = thread.updatedAt ? formatTimestamp(thread.updatedAt) : undefined;

  const conversation: WorkbenchConversation = {
    id: thread.threadId,
    title: thread.title?.trim() || '未命名会话',
    kind: 'group',
    subtitle: threadSubtitle(thread),
    updatedLabel,
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
