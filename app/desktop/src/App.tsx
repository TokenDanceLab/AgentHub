import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealth } from '@/hooks/useHealth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { startRun, fetchAgents, fetchThreads } from '@/api/edgeClient';
import type { AgentInfo, StartRunRequest } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThreadStore } from '@/stores/threadStore';
import { useRunStore } from '@/stores/runStore';
import StatusBar from '@/components/StatusBar';
import ThreadPanel from '@/components/ThreadPanel';
import AgentList from '@/components/AgentList';
import ChatView from '@/components/ChatView';
import RunDetail from '@/components/RunDetail';
import ErrorBoundary from '@/components/ErrorBoundary';
import ResizeHandle from '@/components/ResizeHandle';
import PromptInput from '@/components/PromptInput';
import SearchDialog from '@/components/SearchDialog';
import styles from '@/App.module.css';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 420;
const MIN_RIGHT = 240;
const MAX_RIGHT = 600;

export default function App() {
  const { t } = useTranslation();
  const { online, health } = useHealth();
  const { messages, isConnected, currentRun, clearMessages } = useChatMessages(online);

  // Zustand stores
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const setOnline = useConnectionStore((s) => s.setOnline);
  const setConnected = useConnectionStore((s) => s.setConnected);
  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const setThreads = useThreadStore((s) => s.setThreads);
  const selectThread = useThreadStore((s) => s.selectThread);
  const runStoreSetCurrentRun = useRunStore((s) => s.setCurrentRun);
  const runStoreSetStreaming = useRunStore((s) => s.setIsStreaming);
  const runStoreClear = useRunStore((s) => s.clear);

  // Local state (lightweight, not worth a store yet)
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);

  // Sync health hook → connection store
  useEffect(() => {
    setOnline(online, health);
  }, [online, health, setOnline]);

  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  // Sync chat messages → run store (Kanna dual-Map pattern)
  useEffect(() => {
    if (currentRun) {
      runStoreSetCurrentRun(currentRun);
      runStoreSetStreaming(true);
    } else {
      runStoreClear();
    }
  }, [currentRun, runStoreSetCurrentRun, runStoreSetStreaming, runStoreClear]);

  // Poll agents
  useEffect(() => {
    if (!online) {
      setAgents([]);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchAgents();
        if (active) setAgents(res.items);
      } catch { /* Edge may not have /v1/agents yet */ }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { active = false; clearInterval(id); };
  }, [online]);

  // Poll threads
  useEffect(() => {
    if (!online) {
      setThreads([]);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchThreads();
        if (active) setThreads(res.items);
      } catch { /* Edge may not have threads yet */ }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { active = false; clearInterval(id); };
  }, [online, setThreads]);

  const selectedThread = threads.find((th) => th.threadId === selectedThreadId);

  const handleSend = useCallback(
    async (prompt: string, agentId?: string, opts?: { model?: string; reasoningEffort?: string }) => {
      try {
        const req: StartRunRequest = { prompt };
        if (agentId) req.agentId = agentId;
        if (opts?.model) req.model = opts.model;
        if (opts?.reasoningEffort) req.reasoningEffort = opts.reasoningEffort;
        if (selectedThread) req.threadId = selectedThread.threadId;
        setUserMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            timestamp: new Date().toISOString(),
            blocks: [{ kind: 'text', content: prompt }],
          },
        ]);
        await startRun(req);
      } catch (e) {
        console.error('Failed to start run:', e);
      }
    },
    [selectedThread],
  );

  const handleCreateThread = useCallback(async () => {
    try { const res = await fetchThreads(); setThreads(res.items); } catch { /* ignore */ }
  }, [setThreads]);

  const handleSidebarResize = useCallback(
    (delta: number) => setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, sidebarWidth + delta))),
    [sidebarWidth, setSidebarWidth],
  );

  const handleRightResize = useCallback(
    (delta: number) => setRightPanelWidth(Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, rightPanelWidth - delta))),
    [rightPanelWidth, setRightPanelWidth],
  );

  const allMessages = [...userMessages, ...messages];

  return (
    <div className={styles.root}>
      <StatusBar
        online={online}
        health={health}
        isConnected={isConnected}
        error={null}
      />

      <div className={styles.body}>
        <div style={{ width: sidebarWidth, flexShrink: 0 }}>
          <ThreadPanel
            threads={threads}
            online={online}
            selectedId={selectedThreadId ?? undefined}
            onSelect={(th) => selectThread(th.threadId)}
            onCreate={handleCreateThread}
          />
        </div>

        <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />

        <div className={styles.center}>
          <div className={styles.centerSidebar}>
            <AgentList
              agents={agents}
              online={online}
              selectedId={selectedAgentId}
              onSelect={(a) => setSelectedAgentId(a.id)}
            />
          </div>

          <ErrorBoundary>
            <ChatView messages={allMessages} isStreaming={useRunStore.getState().isStreaming} />
          </ErrorBoundary>
        </div>

        <ResizeHandle direction="horizontal" onResize={handleRightResize} />

        <div style={{ width: rightPanelWidth, flexShrink: 0 }}>
          <ErrorBoundary>
            <RunDetail
              run={
                currentRun
                  ? { runId: currentRun.runId, projectId: '', threadId: selectedThread?.threadId ?? '', status: currentRun.status }
                  : null
              }
              toolCalls={currentRun?.toolCalls ?? []}
              changedFiles={currentRun?.changedFiles ?? []}
              outputText={currentRun?.outputText ?? ''}
            />
          </ErrorBoundary>
        </div>
      </div>

      <PromptInput
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onSend={handleSend}
        disabled={!online}
      />
      <SearchDialog />
    </div>
  );
}
