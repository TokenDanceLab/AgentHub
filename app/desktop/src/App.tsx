import { useMemo } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import { useCreateRun } from '@/api/runQueries';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';

export default function App() {
  const workbench = useDesktopWorkbenchModel();
  const createRun = useCreateRun();
  const desktopPlatform = useMemo(() => createDesktopPlatform({
    activeProjectId: workbench.activeProjectId,
    activeThreadId: workbench.activeThreadId,
    submitRun: createRun.mutateAsync,
  }), [createRun.mutateAsync, workbench.activeProjectId, workbench.activeThreadId]);

  return (
    <AgentHubWorkbench
      activeConversationId={workbench.activeConversationId}
      conversations={workbench.conversations}
      platform={desktopPlatform}
      transcript={workbench.transcript}
    />
  );
}
