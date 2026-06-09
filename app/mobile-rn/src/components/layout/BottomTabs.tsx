import { Text, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { MotionPressable } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileTab } from '@/types';

import {
  buildTabAccessibilityLabel,
  formatTabBadgeCount,
  getTabBadgeCount,
  isTabSelected,
} from './navigationLayout';

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
    { icon: 'file', label: t.cloudDocs, value: 'docs' },
    { icon: 'runs', label: t.tasks, value: 'tasks' },
    { icon: 'grid', label: t.projects, value: 'projects' },
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
        paddingTop: 5,
        paddingBottom: 6,
      }}
    >
      {tabs.map((tab) => {
        const selected = isTabSelected(activeTab, tab.value, tab.activeValues);
        const badgeCount = getTabBadgeCount(tab.value, { pendingReviews, unreadThreads });

        return (
          <MotionPressable
            accessibilityLabel={buildTabAccessibilityLabel({
              badgeCount,
              label: tab.label,
              selected,
              value: tab.value,
            })}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            feedback="icon"
            hitSlop={{ top: 6, right: 3, bottom: 6, left: 3 }}
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={({ pressed }) => ({
              minHeight: 56,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              borderRadius: tokens.radius.control,
              borderWidth: 1,
              borderColor: selected ? tokens.color.focus : 'transparent',
              backgroundColor: selected
                ? tokens.color.surfaceStrong
                : pressed
                  ? tokens.color.tint
                  : 'transparent',
              paddingHorizontal: 2,
            })}
          >
            <View
              style={{
                width: 42,
                height: 26,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 13,
                backgroundColor: selected ? tokens.color.accentSoft : 'transparent',
              }}
            >
              <AgentHubIcon
                color={selected ? tokens.color.accent : tokens.color.inkMuted}
                name={tab.icon}
                size={21}
              />
              {badgeCount > 0 ? (
                <TabUnreadBadge count={badgeCount} />
              ) : null}
            </View>
            <View
              style={{
                width: selected ? 18 : 4,
                height: 2,
                borderRadius: 1,
                backgroundColor: selected ? tokens.color.accent : 'transparent',
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                color: selected ? tokens.color.accent : tokens.color.inkMuted,
                ...tokens.type.role.tabLabel,
                fontWeight: selected ? tokens.type.weight.medium : tokens.type.weight.regular,
              }}
            >
              {tab.label}
            </Text>
          </MotionPressable>
        );
      })}
    </View>
  );
}

function TabUnreadBadge({ count }: { count: number }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const label = formatTabBadgeCount(count);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        position: 'absolute',
        top: -4,
        right: -7,
        minWidth: 17,
        height: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8.5,
        borderWidth: 2,
        borderColor: tokens.color.panel,
        backgroundColor: tokens.color.danger,
        paddingHorizontal: 3,
      }}
    >
      <Text style={{ color: tokens.color.onDanger, ...tokens.type.role.badge }}>
        {label}
      </Text>
    </View>
  );
}
