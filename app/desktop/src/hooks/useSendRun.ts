import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  startRun,
  cancelRun,
  createThread,
  renameThread,
} from '@/api/edgeClient';
import { useThreadStore } from '@/stores/threadStore';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { StartRunRequest, ThreadInfo } from '@shared/types';
import type { ChatMessage } from '@shared/types/chat';
import type { AddToastInput } from '@/stores/toastStore';
import { readCustomInstructions } from '@/utils/customInstructions';
import { findRetryPrompt } from '@/utils/messageActions';
import { getActiveRunConflictId } from '@/utils/appUtils';
import {
  buildAutomaticThreadTitle,
  canAutoRenameThreadTitle,
  getAutomaticThreadTitle,
} from '@/utils/threadTitle';

interface OptimisticRun {
  runId: string;
  status: string;
  outputText: string;
  toolCalls: [];
  changedFiles: [];
}

export interface SendRunOptions {
  model?: string;
  provider?: string;
  modelAlias?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  workDir?: string;
  threadId?: string;
  threadInfo?: ThreadInfo;
  createdEmptyThread?: boolean;
}

export interface UseSendRunDeps {
  runStartPending: boolean;
  runIsActive: boolean;
  activeThreadId: string | null;
  threads: ThreadInfo[];
  agents: { id: string; name?: string }[];
  selectedAgentId: string | null;
  optimisticRun: OptimisticRun | null;
  currentRun: { runId: string } | null;
  allMessages: ChatMessage[];
  threadItemCount: number | undefined;

  setRunStartPending: (v: boolean) => void;
  setOptimisticRun: (run: OptimisticRun | null) => void;
  setUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;

  selectThread: (id: string) => void;

  addThreadToCache: (thread: ThreadInfo, opts?: { suppressCreatedToast?: boolean; empty?: boolean }) => void;
  updateThreadInCache: (thread: ThreadInfo) => void;
  setThreadTitleInCache: (threadId: string, title: string) => void;
  emptyCreatedThreadIdsRef: React.MutableRefObject<Set<string>>;
  manuallyNamedThreadIdsRef: React.MutableRefObject<Set<string>>;

  queryClient: ReturnType<typeof useQueryClient>;
  addToast: (input: AddToastInput) => void;
  t: TFunction;
}

export interface UseSendRunReturn {
  handleSend: (prompt: string, agentId?: string, opts?: SendRunOptions) => Promise<boolean>;
  handleCancel: () => Promise<void>;
  handleRetry: (messageId?: string) => Promise<void>;
}

export function useSendRun(deps: UseSendRunDeps): UseSendRunReturn {
  const {
    runStartPending,
    runIsActive,
    activeThreadId,
    threads,
    agents,
    selectedAgentId,
    optimisticRun,
    currentRun,
    allMessages,
    threadItemCount,

    setRunStartPending,
    setOptimisticRun,
    setUserMessages,

    selectThread,

    addThreadToCache,
    updateThreadInCache,
    setThreadTitleInCache,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,

    queryClient,
    addToast,
    t,
  } = deps;

  const handleSend = useCallback(async (prompt: string, agentId?: string, opts?: SendRunOptions) => {
    if (runStartPending || runIsActive) {
      addToast({ type: 'info', message: t('error.activeRunExists') });
      return false;
    }
    const tempRunId = `starting-${Date.now()}`;
    const tempUserMessageId = `user-${tempRunId}`;
    const initialThreadId = opts?.threadId ?? activeThreadId ?? undefined;
    setRunStartPending(true);
    setUserMessages((prev) => [
      ...prev,
      {
        id: tempUserMessageId,
        role: 'user',
        timestamp: new Date().toISOString(),
        ...(initialThreadId ? { threadId: initialThreadId } : {}),
        blocks: [{ kind: 'text', content: prompt }],
      },
    ]);
    try {
      let requestThreadId = opts?.threadId ?? activeThreadId;
      let requestThread = opts?.threadInfo ?? (requestThreadId ? threads.find((thread) => thread.threadId === requestThreadId) : undefined);
      let createdThreadForPrompt = Boolean(opts?.createdEmptyThread);
      if (!requestThreadId) {
        const agent = agentId ? agents.find((item) => item.id === agentId) : undefined;
        const initialTitle = buildAutomaticThreadTitle(prompt) ?? (agent?.name ? `${agent.name}` : undefined);
        const thread = await createThread(initialTitle);
        addThreadToCache(thread);
        requestThread = thread;
        requestThreadId = thread.threadId;
        createdThreadForPrompt = true;
        if (agentId) {
          useThreadStore.getState().selectAgentThread(agentId, thread.threadId);
        } else {
          selectThread(thread.threadId);
        }
        queryClient.invalidateQueries({ queryKey: ['threads'] });
      }
      const req: StartRunRequest = {
        prompt,
        ...useModelSettingsStore.getState().resolveRunRequestOptions({
          model: opts?.model,
          provider: opts?.provider,
          modelAlias: opts?.modelAlias,
          reasoningEffort: opts?.reasoningEffort,
        }),
      };
      const customInstructions = readCustomInstructions();
      if (customInstructions) req.appendSystemPrompt = customInstructions;
      if (opts?.permissionMode) req.permissionMode = opts.permissionMode;
      if (opts?.workDir) req.workDir = opts.workDir;
      if (agentId) req.agentId = agentId;
      if (requestThreadId) {
        setUserMessages((prev) => prev.map((msg) => (
          msg.id === tempUserMessageId ? { ...msg, threadId: requestThreadId } : msg
        )));
        req.threadId = requestThreadId;
      }
      setOptimisticRun({ runId: tempRunId, status: 'queued', outputText: '', toolCalls: [], changedFiles: [] });
      const started = await startRun(req);
      setOptimisticRun({ ...started, outputText: '', toolCalls: [], changedFiles: [] });
      if (started.threadId) {
        setUserMessages((prev) => prev.map((msg) => (
          msg.id === tempUserMessageId ? { ...msg, threadId: started.threadId } : msg
        )));
      }
      if (started.threadId && started.threadId !== requestThreadId) {
        selectThread(started.threadId);
      }
      const renameThreadId = started.threadId || requestThreadId;
      const runtimeNames = agents
        .map((item) => item.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
      const currentThreadItemCount = threadItemCount;
      const wasLocallyCreatedEmptyThread = Boolean(renameThreadId && emptyCreatedThreadIdsRef.current.has(renameThreadId));
      const wasManuallyNamedThread = Boolean(renameThreadId && manuallyNamedThreadIdsRef.current.has(renameThreadId));
      const canAutoRenameThread = canAutoRenameThreadTitle({
        createdThreadForPrompt,
        currentThreadItemCount,
        manuallyNamedThread: wasManuallyNamedThread,
        locallyCreatedEmptyThread: wasLocallyCreatedEmptyThread,
      });
      const autoTitle = canAutoRenameThread
        ? getAutomaticThreadTitle({
          currentTitle: requestThread?.title,
          prompt,
          runtimeNames,
        })
        : null;
      if (renameThreadId && autoTitle) {
        setThreadTitleInCache(renameThreadId, autoTitle);
        try {
          const renamedThread = await renameThread(renameThreadId, autoTitle);
          updateThreadInCache(renamedThread);
        } catch (renameError) {
          queryClient.invalidateQueries({ queryKey: ['threads'] });
        }
      }
      if (renameThreadId) emptyCreatedThreadIdsRef.current.delete(renameThreadId);
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['threadItems', started.threadId] });
      return true;
    } catch (e) {
      setUserMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessageId));
      const activeRunId = getActiveRunConflictId(e);
      if (activeRunId) {
        setOptimisticRun({ runId: activeRunId, status: 'running', outputText: '', toolCalls: [], changedFiles: [] });
        addToast({ type: 'info', message: t('error.activeRunExists') });
        return false;
      }
      setOptimisticRun(null);
      addToast({ type: 'error', message: t('error.startRunFailed') });
      return false;
    } finally {
      setRunStartPending(false);
    }
  }, [activeThreadId, addThreadToCache, addToast, agents, emptyCreatedThreadIdsRef, manuallyNamedThreadIdsRef, queryClient, runIsActive, runStartPending, selectThread, setOptimisticRun, setRunStartPending, setThreadTitleInCache, setUserMessages, t, threadItemCount, threads, updateThreadInCache]);

  const handleCancel = useCallback(async () => {
    const runId = currentRun?.runId ?? (optimisticRun?.runId.startsWith('starting-') ? undefined : optimisticRun?.runId);
    if (runId) {
      try { await cancelRun(runId); } catch {}
    }
  }, [currentRun?.runId, optimisticRun?.runId]);

  const handleRetry = useCallback(async (messageId?: string) => {
    const retry = findRetryPrompt(allMessages, messageId);
    if (!retry) {
      addToast({ type: 'info', message: t('toast.retryNoPrompt') });
      return;
    }
    await handleSend(retry.prompt, selectedAgentId ?? undefined);
  }, [addToast, allMessages, handleSend, selectedAgentId, t]);

  return {
    handleSend,
    handleCancel,
    handleRetry,
  };
}
