import { useMemo, useState } from 'react';
import { writeWorkbenchDataModeOverride } from '@shared/demo';
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

export default function App() {
  const [entryMode, setEntryMode] = useState<'entry' | 'demo'>('entry');
  const { online: edgeOnline } = useHealth();

  function continueDemo(): void {
    if (edgeOnline) {
      writeWorkbenchDataModeOverride('approved-real');
    } else {
      writeWorkbenchDataModeOverride('mock');
    }
    setEntryMode('demo');
  }

  return (
    <DesktopChrome>
      {entryMode === 'entry' ? (
        <DesktopEntryGate onContinueDemo={continueDemo} edgeOnline={edgeOnline} />
      ) : (
        <DesktopWorkbenchApp />
      )}
    </DesktopChrome>
  );
}

export function DesktopWorkbenchApp() {
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
  const runtimeEvidence = useRunEvidence(activeRunId);
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
        platform={desktopPlatform}
        runtimeEvidence={activeRunId ? {
          runId: activeRunId,
          diffs: runtimeEvidence.diffs,
          artifacts: runtimeEvidence.artifacts,
          previews: runtimeEvidence.previews,
          loading: {
            diff: runtimeEvidence.diffLoading,
            artifacts: runtimeEvidence.artifactLoading,
            previews: runtimeEvidence.previewLoading,
          },
          errors: {
            diff: runtimeEvidence.diffError,
            artifacts: runtimeEvidence.artifactError,
            previews: runtimeEvidence.previewError,
          },
          sources: {
            diff: runtimeEvidence.diffSource,
            artifacts: runtimeEvidence.artifactSource,
            previews: runtimeEvidence.previewSource,
          },
        } : undefined}
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
