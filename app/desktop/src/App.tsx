import { useMemo, useState } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import { useAgentList } from '@/api/agentQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useCreateRun } from '@/api/runQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
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
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={edgeAgents}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        platform={desktopPlatform}
        transcript={workbench.transcript}
      />
    </DesktopChrome>
  );
}
