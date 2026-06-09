import { Pressable, Text, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

interface TabItem {
  activeValues?: MobileTab[];
  icon: AgentHubIconName;
  label: string;
  value: MobileTab;
}

interface BottomTabsProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
  pendingReviews: number;
  unreadThreads: number;
}

export function BottomTabs({
  activeTab,
  onChange,
  pendingReviews,
  unreadThreads,
}: BottomTabsProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const tabs: TabItem[] = [
    { activeValues: ['thread'], icon: 'chat', label: t.chatNav, value: 'chat' },
    { icon: 'runs', label: t.tasks, value: 'tasks' },
    { icon: 'grid', label: t.projects, value: 'projects' },
    { icon: 'file', label: t.cloudDocs, value: 'docs' },
    { activeValues: ['contacts', 'agents', 'settings', 'account', 'more'], icon: 'more', label: t.more, value: 'more' },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.line,
        backgroundColor: tokens.color.panel,
        paddingHorizontal: tokens.space.sm,
        paddingTop: 3,
        paddingBottom: 4,
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === activeTab || tab.activeValues?.includes(activeTab) === true;
        const badgeCount =
          tab.value === 'chat' ? unreadThreads : tab.value === 'tasks' ? pendingReviews : 0;

        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            hitSlop={4}
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={({ pressed }) => ({
              minHeight: 49,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              borderRadius: tokens.radius.control,
              backgroundColor: pressed ? tokens.color.surfaceStrong : 'transparent',
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <View
              style={{
                width: 34,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AgentHubIcon
                color={selected ? tokens.color.accent : tokens.color.inkMuted}
                name={tab.icon}
                size={selected ? 22 : 21}
              />
              {badgeCount > 0 ? (
                <TabUnreadBadge count={badgeCount} />
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: selected ? tokens.color.accent : tokens.color.inkMuted,
                fontSize: 11,
                fontWeight: selected ? tokens.type.weight.medium : tokens.type.weight.regular,
                lineHeight: 13,
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

function TabUnreadBadge({ count }: { count: number }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const label = count > 99 ? '99+' : String(count);

  return (
    <View
      style={{
        position: 'absolute',
        top: -4,
        right: -7,
        minWidth: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9,
        borderWidth: 2,
        borderColor: tokens.color.panel,
        backgroundColor: tokens.color.danger,
        paddingHorizontal: 3,
      }}
    >
      <Text style={{ color: tokens.color.onDanger, fontSize: 11, fontWeight: '500', lineHeight: 12 }}>
        {label}
      </Text>
    </View>
  );
}
