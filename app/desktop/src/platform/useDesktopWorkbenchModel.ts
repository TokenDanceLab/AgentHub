import { useMemo } from 'react';
import { normalizeThreadItemsToTranscript } from '@shared/transcript';
import type { WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo } from '@shared/types';
import { useThreadMessages, useThreads } from '@/api/threadQueries';
import {
  DESKTOP_FALLBACK_CONVERSATION_ID,
  desktopConversations,
  desktopTranscript,
} from './desktopPlatform';

export interface DesktopWorkbenchModel {
  activeConversationId: string;
  conversations: WorkbenchConversation[];
  transcript: ReturnType<typeof normalizeThreadItemsToTranscript>;
}

export function useDesktopWorkbenchModel(): DesktopWorkbenchModel {
  const threadsQuery = useThreads();
  const threads = threadsQuery.data?.items ?? [];
  const activeThread = threads[0];
  const activeConversationId = activeThread?.threadId ?? DESKTOP_FALLBACK_CONVERSATION_ID;
  const threadItemsQuery = useThreadMessages(activeThread?.threadId ?? null);

  const conversations = useMemo(() => {
    if (threads.length === 0) return desktopConversations;
    return threads.map(threadToConversation);
  }, [threads]);

  const transcript = useMemo(() => {
    const items = threadItemsQuery.data?.items ?? [];
    if (items.length === 0) return threads.length === 0 ? desktopTranscript : [];
    return normalizeThreadItemsToTranscript(items);
  }, [threadItemsQuery.data?.items, threads.length]);

  return {
    activeConversationId,
    conversations,
    transcript,
  };
}

function threadToConversation(thread: ThreadInfo): WorkbenchConversation {
  return {
    id: thread.threadId,
    title: thread.title?.trim() || '未命名会话',
    kind: 'group',
    subtitle: threadSubtitle(thread),
  };
}

function threadSubtitle(thread: ThreadInfo): string {
  const status = thread.status?.trim() || 'active';
  const updated = thread.updatedAt ? formatTimestamp(thread.updatedAt) : undefined;
  return updated ? `${status} · ${updated}` : status;
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
