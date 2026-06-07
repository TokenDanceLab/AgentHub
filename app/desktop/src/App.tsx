import { useMemo, useState } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import { useCreateRun } from '@/api/runQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import { createDesktopPlatform, desktopAgents } from '@/platform/desktopPlatform';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';

export default function App() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const workbench = useDesktopWorkbenchModel(selectedConversationId);
  const createRun = useCreateRun();
  const desktopPlatform = useMemo(() => createDesktopPlatform({
    ...(workbench.activeProjectId ? { activeProjectId: workbench.activeProjectId } : {}),
    ...(workbench.activeThreadId ? { activeThreadId: workbench.activeThreadId } : {}),
    submitRun: createRun.mutateAsync,
  }), [createRun.mutateAsync, workbench.activeProjectId, workbench.activeThreadId]);

  return (
    <DesktopChrome>
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={desktopAgents}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        platform={desktopPlatform}
        transcript={workbench.transcript}
      />
    </DesktopChrome>
  );
}
