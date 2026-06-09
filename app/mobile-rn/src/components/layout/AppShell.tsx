import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

import { BottomTabs } from './BottomTabs';

interface AppShellProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  hideTabs?: boolean;
  pendingReviews: number;
  unreadThreads: number;
  children: React.ReactNode;
}

export function AppShell({
  activeTab,
  hideTabs = false,
  onChangeTab,
  pendingReviews,
  unreadThreads,
  children,
}: AppShellProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const shouldHideTabs = hideTabs || activeTab === 'thread' || activeTab === 'account';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          backgroundColor: tokens.color.canvas,
        }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
        {shouldHideTabs ? null : (
          <BottomTabs
            activeTab={activeTab}
            onChange={onChangeTab}
            pendingReviews={pendingReviews}
            unreadThreads={unreadThreads}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
