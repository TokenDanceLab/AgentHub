import { useMemo, useState, useCallback, useEffect } from 'react';
import { WORKBENCH_DATA_MODE_STORAGE_KEY, writeWorkbenchDataModeOverride, workbenchDemoRuntimeStore, readWorkbenchDataModeOverride, isWorkbenchRealDataMode } from '@shared/demo';
import { toggleAppliedAgentHubTheme } from '@shared/theme';
import { AgentHubWorkbench } from '@shared/workbench';
import { resolveCurrentTranscriptRunId } from '@shared/transcript';
import type { WorkbenchConversation } from '@shared/platform';
import { useAgentList } from '@/api/agentQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun } from '@/api/runQueries';
import { useCreateThread } from '@/api/threadQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import { DesktopEntryGate } from '@/components/DesktopEntryGate';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { mapEdgeAgentsToWorkbenchAgents } from '@/platform/edgeCapabilityMapper';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import { getDemoRuntimeEvidence } from '@/demo/demoEvidence';

export default function App() {
  const [entryMode, setEntryMode] = useState<'entry' | 'demo' | 'workbench'>('entry');
  const { online: edgeOnline } = useHealth();
  const { user } = useAuth();

  // If already authenticated (e.g. returning from OIDC callback with stored session),
  // skip the entry gate and go straight to workbench.
  if (entryMode === 'entry' && user) {
    setEntryMode('workbench');
  }

  function continueDemo(): void {
    writeWorkbenchDataModeOverride('mock');
    setEntryMode('demo');
  }

  function connectEdge(): void {
    writeWorkbenchDataModeOverride('observed');
    setEntryMode('workbench');
  }

  function handleLoginSuccess(): void {
    writeWorkbenchDataModeOverride('approved-real');
    setEntryMode('workbench');
  }

  return (
    <DesktopChrome showNavigationControls={entryMode !== 'entry'}>
      {entryMode === 'entry' ? (
        <DesktopEntryGate
          onLoginSuccess={handleLoginSuccess}
          onContinueDemo={continueDemo}
          onConnectEdge={connectEdge}
          onToggleTheme={toggleAppliedAgentHubTheme}
          edgeOnline={edgeOnline}
        />
      ) : (
        <DesktopWorkbenchApp
          onLogout={() => {
            window.localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);
            setEntryMode('entry');
          }}
        />
      )}
    </DesktopChrome>
  );
}

export interface DesktopWorkbenchAppProps {
  onLogout?: (() => void) | undefined;
}

export function DesktopWorkbenchApp({ onLogout }: DesktopWorkbenchAppProps = {}) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const workbench = useDesktopWorkbenchModel(selectedConversationId);
  const { online: edgeOnline } = useHealth();

  // Auto-upgrade: when Edge is online but dataMode is stuck on mock/fixture
  // (e.g. from a previous session's localStorage), switch to approved-real so
  // the user sees live Edge data instead of stale demo content.
  useEffect(() => {
    if (!edgeOnline) return;
    const currentMode = readWorkbenchDataModeOverride();
    if (currentMode && !isWorkbenchRealDataMode(currentMode)) {
      writeWorkbenchDataModeOverride('approved-real');
    }
  }, [edgeOnline]);

  const liveEdgeEnabled = edgeOnline && !workbench.isDemo;
  const { data: agentData } = useAgentList(liveEdgeEnabled);
  const { data: modelCatalog } = useModelCatalog(liveEdgeEnabled);
  const createRun = useCreateRun();
  const createThread = useCreateThread();
  const activeRunId = useMemo(() => {
    if (!workbench.activeThreadId) return undefined;
    return resolveCurrentTranscriptRunId(workbench.transcript);
  }, [workbench.activeThreadId, workbench.transcript]);
  const edgeRunEvidence = useRunEvidence(liveEdgeEnabled ? activeRunId : undefined);

  // Demo mode: use per-conversation JS evidence; Real mode: use Edge API evidence.
  const runtimeEvidence = workbench.isDemo
    ? getDemoRuntimeEvidence(workbench.activeConversationId)
    : (activeRunId ? {
        runId: activeRunId,
        diffs: edgeRunEvidence.diffs,
        artifacts: edgeRunEvidence.artifacts,
        previews: edgeRunEvidence.previews,
        loading: {
          diff: edgeRunEvidence.diffLoading,
          artifacts: edgeRunEvidence.artifactLoading,
          previews: edgeRunEvidence.previewLoading,
        },
        errors: {
          diff: edgeRunEvidence.diffError,
          artifacts: edgeRunEvidence.artifactError,
          previews: edgeRunEvidence.previewError,
        },
        sources: {
          diff: edgeRunEvidence.diffSource,
          artifacts: edgeRunEvidence.artifactSource,
          previews: edgeRunEvidence.previewSource,
        },
      } : undefined);
  const desktopPlatform = useMemo(() => createDesktopPlatform({
    ...(workbench.activeProjectId ? { activeProjectId: workbench.activeProjectId } : {}),
    ...(workbench.activeThreadId ? { activeThreadId: workbench.activeThreadId } : {}),
    ...(!workbench.isDemo ? { submitRun: createRun.mutateAsync } : {}),
  }), [createRun.mutateAsync, workbench.activeProjectId, workbench.activeThreadId, workbench.isDemo]);
  const edgeAgents = useMemo(
    () => mapEdgeAgentsToWorkbenchAgents(agentData?.items ?? [], modelCatalog),
    [agentData?.items, modelCatalog],
  );

  const handleNavigateToConversation = useCallback((target: { name: string; id: string; kind: 'dm' | 'group' }) => {
    if (workbench.isDemo) {
      const existing = workbench.conversations.find((c) => c.id === target.id || c.title === target.name);
      if (existing) {
        setSelectedConversationId(existing.id);
        return;
      }
      const newConversation: WorkbenchConversation = {
        id: target.id,
        title: target.name,
        kind: target.kind === 'group' ? 'group' : 'direct',
        avatarLabel: target.name.slice(0, 1).toUpperCase(),
        avatarColor: 'var(--primary)',
      };
      workbenchDemoRuntimeStore.addConversation(newConversation);
      setSelectedConversationId(target.id);
    } else {
      void createThread.mutateAsync({ title: target.name }).then((thread) => {
        setSelectedConversationId(thread.threadId);
      });
    }
  }, [createThread, workbench.conversations, workbench.isDemo]);

  return (
    <>
      {liveEdgeEnabled ? <DesktopHubTaskBridge /> : null}
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={workbench.isDemo ? workbench.agents : edgeAgents}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        onLogout={onLogout}
        onNavigateToConversation={handleNavigateToConversation}
        platform={desktopPlatform}
        runtimeEvidence={runtimeEvidence}
        showComposerAgentPicker={false}
        showComposerStatus={false}
        showHeaderDataModeControl={false}
        showMainchainStatus={false}
        transcript={workbench.transcript}
        workbenchStatus={{
          dataMode: workbench.dataMode,
          targetState: workbench.isDemo ? 'mock' : edgeOnline ? 'online' : 'offline',
          targetLabel: workbench.isDemo ? 'Demo runtime' : 'Local Edge',
        }}
      />
    </>
  );
}
