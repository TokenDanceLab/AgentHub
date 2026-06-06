import { AgentHubWorkbench } from '@shared/workbench';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';

const desktopPlatform = createDesktopPlatform();

export default function App() {
  const workbench = useDesktopWorkbenchModel();

  return (
    <AgentHubWorkbench
      activeConversationId={workbench.activeConversationId}
      conversations={workbench.conversations}
      platform={desktopPlatform}
      transcript={workbench.transcript}
    />
  );
}
