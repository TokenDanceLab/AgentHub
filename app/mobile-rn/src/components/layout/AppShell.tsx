import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

import { BottomTabs } from './BottomTabs';
import { shouldRenderBottomTabRail, type BottomTabRailPlacement } from './navigationLayout';

interface AppShellProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  hideTabs?: boolean;
  tabRailPlacement?: BottomTabRailPlacement;
  pendingReviews: number;
  unreadThreads: number;
  children: React.ReactNode;
}

export function AppShell({
  activeTab,
  hideTabs = false,
  onChangeTab,
  pendingReviews,
  tabRailPlacement = 'bottom',
  unreadThreads,
  children,
}: AppShellProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const showBottomTabs = shouldRenderBottomTabRail({
    activeTab,
    hidden: hideTabs,
    placement: tabRailPlacement,
  });

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
        {showBottomTabs ? (
          <BottomTabs
            activeTab={activeTab}
            onChange={onChangeTab}
            pendingReviews={pendingReviews}
            unreadThreads={unreadThreads}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
