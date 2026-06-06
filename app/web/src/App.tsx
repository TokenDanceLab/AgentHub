import { QueryClientProvider } from '@tanstack/react-query';
import { AgentHubWorkbench } from '@shared/workbench';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import { createWebPlatform, webConversations, webTranscript } from '@/platform/webPlatform';

const webPlatform = createWebPlatform();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AgentHubWorkbench
          activeConversationId="agent-collab"
          conversations={webConversations}
          platform={webPlatform}
          transcript={webTranscript}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
