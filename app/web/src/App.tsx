import { QueryClientProvider } from '@tanstack/react-query';
import { AgentHubWorkbench } from '@shared/workbench';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useAgentList } from '@/api/agentQueries';
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
  webConversations,
  webTranscript,
} from '@/platform/webPlatform';

const webPlatform = createWebPlatform();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WebWorkbenchRoot />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function WebWorkbenchRoot() {
  const agentList = useAgentList(true);
  const agents = resolveWebWorkbenchAgents(agentList.data?.items);

  return (
    <AgentHubWorkbench
      activeConversationId="agent-collab"
      agents={agents}
      conversations={webConversations}
      platform={webPlatform}
      transcript={webTranscript}
    />
  );
}
