import { Text, View } from 'react-native';

import { useAgentHubTheme } from '@/theme';

interface BadgeProps {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

export function Badge({ label, tone = 'neutral' }: BadgeProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const color = {
    neutral: tokens.color.inkMuted,
    accent: tokens.color.accent,
    success: tokens.color.moss,
    warning: tokens.color.warning,
    danger: tokens.color.danger,
  }[tone];
  const backgroundColor = {
    neutral: tokens.color.surfaceStrong,
    accent: tokens.color.accentSoft,
    success: tokens.color.mossSoft,
    warning: tokens.color.warningSoft,
    danger: tokens.color.dangerSoft,
  }[tone];

  return (
    <View
      style={{
        minHeight: 24,
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor,
        paddingHorizontal: tokens.space.sm,
      }}
    >
      <Text numberOfLines={1} style={{ color, fontSize: tokens.type.xs, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}
