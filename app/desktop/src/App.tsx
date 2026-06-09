import { useMemo, useState } from 'react';
import { WORKBENCH_DATA_MODE_STORAGE_KEY, writeWorkbenchDataModeOverride } from '@shared/demo';
import { toggleAppliedAgentHubTheme } from '@shared/theme';
import { AgentHubWorkbench } from '@shared/workbench';
import { resolveCurrentTranscriptRunId } from '@shared/transcript';
import { useAgentList } from '@/api/agentQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun } from '@/api/runQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import { DesktopEntryGate } from '@/components/DesktopEntryGate';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import { useHealth } from '@/hooks/useHealth';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { mapEdgeAgentsToWorkbenchAgents } from '@/platform/edgeCapabilityMapper';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import { getDemoRuntimeEvidence } from '@/demo/demoEvidence';

export default function App() {
  const [entryMode, setEntryMode] = useState<'entry' | 'demo'>('entry');
  const { online: edgeOnline } = useHealth();

  function continueDemo(): void {
    writeWorkbenchDataModeOverride('mock');
    setEntryMode('demo');
  }

  return (
    <DesktopChrome showNavigationControls={entryMode !== 'entry'}>
      {entryMode === 'entry' ? (
        <DesktopEntryGate
          onContinueDemo={continueDemo}
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
  const liveEdgeEnabled = edgeOnline && !workbench.isDemo;
  const { data: agentData } = useAgentList(liveEdgeEnabled);
  const { data: modelCatalog } = useModelCatalog(liveEdgeEnabled);
  const createRun = useCreateRun();
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

  return (
    <>
      {liveEdgeEnabled ? <DesktopHubTaskBridge /> : null}
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={workbench.isDemo ? workbench.agents : edgeAgents}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        onLogout={onLogout}
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
