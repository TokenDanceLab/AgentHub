import { AgentHubWorkbench } from '@shared/workbench';
import {
  createDesktopPlatform,
  desktopConversations,
  desktopTranscript,
} from '@/platform/desktopPlatform';

const desktopPlatform = createDesktopPlatform();

export default function App() {
  return (
    <AgentHubWorkbench
      activeConversationId="local-agent-team"
      conversations={desktopConversations}
      platform={desktopPlatform}
      transcript={desktopTranscript}
    />
  );
}
