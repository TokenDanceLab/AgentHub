import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppShell } from '@/components/layout';
import { getPendingReviewCount, getUnreadThreadCount, mobileFixture } from '@/data/mobileFixtures';
import { AccountScreen, ChatScreen, RunsScreen, ThreadsScreen } from '@/screens';
import { AgentHubThemeProvider, useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

function MobileAppContent(): React.ReactElement {
  const { mode, setMode, tokens } = useAgentHubTheme();
  const [activeTab, setActiveTab] = useState<MobileTab>('threads');
  const [selectedThreadId, setSelectedThreadId] = useState(mobileFixture.threads[0]?.id ?? '');
  const [selectedRunId, setSelectedRunId] = useState(mobileFixture.runs[0]?.id ?? '');
  const counters = useMemo(
    () => ({
      pendingReviews: getPendingReviewCount(mobileFixture),
      unreadThreads: getUnreadThreadCount(mobileFixture),
    }),
    [],
  );

  const content = {
    threads: (
      <ThreadsScreen
        fixture={mobileFixture}
        selectedThreadId={selectedThreadId}
        onOpenAccount={() => setActiveTab('account')}
        onSelectThread={(threadId) => {
          setSelectedThreadId(threadId);
          setActiveTab('chat');
        }}
      />
    ),
    chat: (
      <ChatScreen
        fixture={mobileFixture}
        selectedThreadId={selectedThreadId}
        onOpenRuns={() => setActiveTab('runs')}
      />
    ),
    runs: (
      <RunsScreen fixture={mobileFixture} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
    ),
    account: (
      <AccountScreen account={mobileFixture.account} themeMode={mode} onChangeThemeMode={setMode} />
    ),
  } satisfies Record<MobileTab, React.ReactNode>;

  return (
    <>
      <StatusBar style={tokens.scheme === 'light' ? 'dark' : 'light'} />
      <AppShell
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        pendingReviews={counters.pendingReviews}
        unreadThreads={counters.unreadThreads}
      >
        {content[activeTab]}
      </AppShell>
    </>
  );
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <AgentHubThemeProvider>
        <MobileAppContent />
      </AgentHubThemeProvider>
    </SafeAreaProvider>
  );
}
