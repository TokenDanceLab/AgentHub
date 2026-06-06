import { QueryClientProvider } from '@tanstack/react-query';
import { AgentHubWorkbench } from '@shared/workbench';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { useAgentList } from '@/api/agentQueries';
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
} from '@/platform/webPlatform';
import { useWebWorkbenchModel } from '@/platform/useWebWorkbenchModel';

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
  const workbench = useWebWorkbenchModel();
  const agents = resolveWebWorkbenchAgents(agentList.data?.items);

  return (
    <AgentHubWorkbench
      activeConversationId={workbench.activeConversationId}
      agents={agents}
      conversations={workbench.conversations}
      platform={webPlatform}
      transcript={workbench.transcript}
    />
  );
}
