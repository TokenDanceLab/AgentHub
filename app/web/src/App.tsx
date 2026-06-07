import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
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
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const agentList = useAgentList(true);
  const workbench = useWebWorkbenchModel(selectedConversationId);
  const agents = resolveWebWorkbenchAgents(agentList.data?.items);

  return (
    <AgentHubWorkbench
      activeConversationId={workbench.activeConversationId}
      agents={agents}
      conversations={workbench.conversations}
      onActiveConversationChange={setSelectedConversationId}
      platform={webPlatform}
      transcript={workbench.transcript}
    />
  );
}
