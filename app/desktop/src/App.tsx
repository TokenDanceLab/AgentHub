import { useMemo, useState } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import { resolveCurrentTranscriptRunId } from '@shared/transcript';
import { useAgentList } from '@/api/agentQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun } from '@/api/runQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import { useHealth } from '@/hooks/useHealth';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { mapEdgeAgentsToWorkbenchAgents } from '@/platform/edgeCapabilityMapper';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';

export default function App() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const workbench = useDesktopWorkbenchModel(selectedConversationId);
  const { online: edgeOnline } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const { data: modelCatalog } = useModelCatalog(edgeOnline);
  const createRun = useCreateRun();
  const activeRunId = useMemo(() => {
    if (!workbench.activeThreadId) return undefined;
    return resolveCurrentTranscriptRunId(workbench.transcript);
  }, [workbench.activeThreadId, workbench.transcript]);
  const runtimeEvidence = useRunEvidence(activeRunId);
  const desktopPlatform = useMemo(() => createDesktopPlatform({
    ...(workbench.activeProjectId ? { activeProjectId: workbench.activeProjectId } : {}),
    ...(workbench.activeThreadId ? { activeThreadId: workbench.activeThreadId } : {}),
    submitRun: createRun.mutateAsync,
  }), [createRun.mutateAsync, workbench.activeProjectId, workbench.activeThreadId]);
  const edgeAgents = useMemo(
    () => mapEdgeAgentsToWorkbenchAgents(agentData?.items ?? [], modelCatalog),
    [agentData?.items, modelCatalog],
  );

  return (
    <DesktopChrome>
      {edgeOnline ? <DesktopHubTaskBridge /> : null}
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={edgeAgents}
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
        transcript={workbench.transcript}
      />
    </DesktopChrome>
  );
}
