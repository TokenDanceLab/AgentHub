import { ActivityIndicator, Text, type StyleProp, type ViewStyle } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

import { MotionPressable } from './MotionPressable';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: AgentHubIconName;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  loading = false,
  disabled = false,
  icon,
  style,
}: ButtonProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: tokens.color.accent, fg: tokens.color.onAccent, border: tokens.color.accent, pressedBg: tokens.color.accent },
    secondary: { bg: tokens.color.surfaceStrong, fg: tokens.color.ink, border: tokens.color.line, pressedBg: tokens.color.tint },
    danger: { bg: tokens.color.dangerSoft, fg: tokens.color.danger, border: tokens.color.dangerSoft, pressedBg: tokens.color.dangerSoft },
    ghost: { bg: 'transparent', fg: tokens.color.inkMuted, border: 'transparent', pressedBg: tokens.color.tint },
  }[variant];

  return (
    <MotionPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      feedback="control"
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: tokens.touch.primary,
          minWidth: tokens.touch.minimum,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space.sm,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: tokens.radius.control,
          backgroundColor: pressed && !isDisabled ? palette.pressedBg : palette.bg,
          paddingHorizontal: tokens.space.md,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : null}
      {!loading && icon ? <AgentHubIcon color={palette.fg} name={icon} /> : null}
      <Text
        numberOfLines={1}
        style={{
          color: palette.fg,
          fontSize: tokens.type.sm,
          fontWeight: tokens.type.weight.medium,
          lineHeight: tokens.type.lineHeight.sm,
          letterSpacing: 0,
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>
    </MotionPressable>
  );
}
