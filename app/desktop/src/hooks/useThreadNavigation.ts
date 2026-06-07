import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { createThread } from '@/api/edgeClient';
import type { ThreadInfo } from '@shared/types';
import type { ChatMessage } from '@shared/types/chat';
import type { AddToastInput } from '@/stores/toastStore';
import { useSearchStore } from '@/stores/searchStore';
import { buildForkDraft } from '@/utils/messageActions';
import { focusComposer } from '@/utils/appUtils';
import { resolveThreadSelectionId, type ThreadSelectionInput } from '@/utils/threadSelection';

export interface UseThreadNavigationDeps {
  allMessages: ChatMessage[];
  selectedAgentName: string | undefined;
  selectedAgentId: string | null;
  selectedThreadId: string | undefined;
  selectedThreadTitle: string | undefined;
  selectThread: (id: string) => void;
  selectAgentThread: (agentId: string, threadId: string) => void;
  setLeftSidebarView: (v: 'home' | 'thread') => void;
  setViewMode: (mode: 'agent' | 'im') => void;
  setPendingComposerDraft: (draft: string) => void;
  addThreadToCache: (thread: ThreadInfo, opts?: { suppressCreatedToast?: boolean; empty?: boolean }) => void;
  emptyCreatedThreadIdsRef: React.MutableRefObject<Set<string>>;
  manuallyNamedThreadIdsRef: React.MutableRefObject<Set<string>>;
  queryClient: ReturnType<typeof useQueryClient>;
  addToast: (input: AddToastInput) => void;
  t: TFunction;
  agents: { id: string; name?: string }[];
}

export interface UseThreadNavigationReturn {
  handleSelectThread: (selection: ThreadSelectionInput) => void;
  handleThreadTitleEdited: (threadId: string) => void;
  handleSelectAgent: (agentId: string) => Promise<void>;
  handleCreateThread: () => Promise<void>;
  handleQuickChat: () => Promise<void>;
  handleForkThread: (messageId?: string) => Promise<void>;
  handleStartLocalOrchestration: (agentId: string, draft: string) => Promise<void>;
  handleSearchThreadSelect: (thread: ThreadInfo) => void;
  handleSearchMessageSelect: (messageId: string) => void;
  openGlobalSearch: (initialQuery?: string) => void;
}

export function useThreadNavigation(deps: UseThreadNavigationDeps): UseThreadNavigationReturn {
  const {
    allMessages,
    selectedAgentName,
    selectedAgentId,
    selectedThreadId,
    selectedThreadTitle,
    selectThread,
    selectAgentThread,
    setLeftSidebarView,
    setViewMode,
    setPendingComposerDraft,
    addThreadToCache,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,
    queryClient,
    addToast,
    t,
    agents,
  } = deps;

  const handleSelectThread = useCallback((selection: ThreadSelectionInput) => {
    const id = resolveThreadSelectionId(selection);
    if (!id) return;
    selectThread(id);
    setLeftSidebarView('thread');
  }, [selectThread, setLeftSidebarView]);

  const handleThreadTitleEdited = useCallback((threadId: string) => {
    emptyCreatedThreadIdsRef.current.delete(threadId);
    manuallyNamedThreadIdsRef.current.add(threadId);
  }, [emptyCreatedThreadIdsRef, manuallyNamedThreadIdsRef]);

  const handleSelectAgent = useCallback(async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    try {
      const thread = await createThread(agent?.name ? `${agent.name}` : undefined);
      addThreadToCache(thread, { empty: true });
      selectAgentThread(agentId, thread.threadId);
      setLeftSidebarView('thread');
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    } catch {
      selectAgentThread(agentId, '');
    }
  }, [addThreadToCache, agents, queryClient, selectAgentThread, setLeftSidebarView]);

  const handleCreateThread = useCallback(async () => {
    try {
      const thread = await createThread(selectedAgentName ? `${selectedAgentName}` : undefined);
      addThreadToCache(thread, { empty: true });
      if (selectedAgentId) {
        selectAgentThread(selectedAgentId, thread.threadId);
        setLeftSidebarView('thread');
      } else {
        handleSelectThread(thread.threadId);
      }
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      focusComposer();
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addThreadToCache, addToast, handleSelectThread, queryClient, selectAgentThread, selectedAgentId, selectedAgentName, setLeftSidebarView, t]);

  const handleQuickChat = useCallback(async () => {
    await handleCreateThread();
    focusComposer();
  }, [handleCreateThread]);

  const handleForkThread = useCallback(async (messageId?: string) => {
    try {
      const sourceTitle = selectedThreadTitle ?? selectedAgentName ?? 'AgentHub';
      const forkTitle = `Fork: ${sourceTitle}`.slice(0, 96);
      const thread = await createThread(forkTitle);
      addThreadToCache(thread, { suppressCreatedToast: true });
      if (selectedAgentId) {
        selectAgentThread(selectedAgentId, thread.threadId);
        setLeftSidebarView('thread');
      } else {
        handleSelectThread(thread.threadId);
      }
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      const draft = buildForkDraft({
        sourceTitle,
        sourceThreadId: selectedThreadId,
        messages: allMessages,
        messageId,
      });
      setPendingComposerDraft(draft);
      addToast({ type: 'success', message: t('toast.forkCreated') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [
    addThreadToCache,
    addToast,
    allMessages,
    handleSelectThread,
    queryClient,
    selectAgentThread,
    selectedAgentId,
    selectedAgentName,
    selectedThreadId,
    selectedThreadTitle,
    setLeftSidebarView,
    setPendingComposerDraft,
    t,
  ]);

  const handleStartLocalOrchestration = useCallback(async (agentId: string, draft: string) => {
    await handleSelectAgent(agentId);
    setViewMode('agent');
    setPendingComposerDraft(draft);
  }, [handleSelectAgent, setPendingComposerDraft, setViewMode]);

  const handleSearchThreadSelect = useCallback((thread: ThreadInfo) => {
    handleSelectThread(thread.threadId);
  }, [handleSelectThread]);

  const handleSearchMessageSelect = useCallback((messageId: string) => {
    setLeftSidebarView('thread');
    window.requestAnimationFrame(() => {
      const selector = `[data-message-id="${CSS.escape(messageId)}"]`;
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [setLeftSidebarView]);

  const openGlobalSearch = useCallback((initialQuery = '') => {
    useSearchStore.getState().openDialog(initialQuery);
  }, []);

  return {
    handleSelectThread,
    handleThreadTitleEdited,
    handleSelectAgent,
    handleCreateThread,
    handleQuickChat,
    handleForkThread,
    handleStartLocalOrchestration,
    handleSearchThreadSelect,
    handleSearchMessageSelect,
    openGlobalSearch,
  };
}
