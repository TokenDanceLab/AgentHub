import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

import { BottomTabs } from './BottomTabs';

interface AppShellProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  pendingReviews: number;
  unreadThreads: number;
  children: React.ReactNode;
}

export function AppShell({
  activeTab,
  onChangeTab,
  pendingReviews,
  unreadThreads,
  children,
}: AppShellProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <View style={{ flex: 1, minHeight: 0, backgroundColor: tokens.color.canvas }}>
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
        <BottomTabs
          activeTab={activeTab}
          onChange={onChangeTab}
          pendingReviews={pendingReviews}
          unreadThreads={unreadThreads}
        />
      </View>
    </SafeAreaView>
  );
}
