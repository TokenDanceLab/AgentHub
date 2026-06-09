import { Text, View } from 'react-native';

import { useAgentHubTheme } from '@/theme';

interface BadgeProps {
  label: string;
  size?: 'default' | 'micro';
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

export function Badge({ label, size = 'default', tone = 'neutral' }: BadgeProps): React.ReactElement {
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
  const borderColor = {
    neutral: tokens.color.line,
    accent: tokens.color.accentSoft,
    success: tokens.color.mossSoft,
    warning: tokens.color.warningSoft,
    danger: tokens.color.dangerSoft,
  }[tone];
  const compact = size === 'micro';

  return (
    <View
      style={{
        minHeight: compact ? 18 : 22,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor,
        borderRadius: compact ? 5 : 6,
        backgroundColor,
        paddingVertical: compact ? 1 : 3,
        paddingHorizontal: compact ? 6 : tokens.space.sm,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color,
          fontSize: compact ? 11 : tokens.type.xs,
          fontWeight: tokens.type.weight.medium,
          lineHeight: compact ? 14 : tokens.type.lineHeight.xs,
          letterSpacing: 0,
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
