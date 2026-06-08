import { Pressable, Text, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { Badge } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

interface TabItem {
  icon: AgentHubIconName;
  label: string;
  value: MobileTab;
  badge?: string;
}

interface BottomTabsProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
  pendingReviews: number;
  unreadThreads: number;
}

const tabs: TabItem[] = [
  { icon: 'chat', label: 'Threads', value: 'threads' },
  { icon: 'send', label: 'Chat', value: 'chat' },
  { icon: 'runs', label: 'Runs', value: 'runs' },
  { icon: 'account', label: 'Account', value: 'account' },
];

export function BottomTabs({
  activeTab,
  onChange,
  pendingReviews,
  unreadThreads,
}: BottomTabsProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: tokens.space.xs,
        borderTopWidth: 1,
        borderTopColor: tokens.color.line,
        backgroundColor: tokens.color.panel,
        paddingHorizontal: tokens.space.sm,
        paddingTop: tokens.space.sm,
        paddingBottom: tokens.space.md,
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === activeTab;
        const badge = tab.value === 'threads' && unreadThreads > 0
          ? String(unreadThreads)
          : tab.value === 'runs' && pendingReviews > 0
            ? String(pendingReviews)
            : undefined;

        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={({ pressed }) => ({
              minHeight: 54,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              borderRadius: tokens.radius.control,
              backgroundColor: selected || pressed ? tokens.color.tint : 'transparent',
            })}
          >
            <View>
              <AgentHubIcon color={selected ? tokens.color.accent : tokens.color.inkMuted} name={tab.icon} />
              {badge ? (
                <View style={{ position: 'absolute', top: -10, right: -18 }}>
                  <Badge label={badge} tone="danger" />
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: selected ? tokens.color.accent : tokens.color.inkMuted,
                fontSize: tokens.type.xs,
                fontWeight: '800',
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
