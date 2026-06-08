import { ActivityIndicator, Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

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
    primary: { bg: tokens.color.accent, fg: '#ffffff', border: tokens.color.accent },
    secondary: { bg: tokens.color.surfaceStrong, fg: tokens.color.ink, border: tokens.color.line },
    danger: { bg: tokens.color.dangerSoft, fg: tokens.color.danger, border: tokens.color.dangerSoft },
    ghost: { bg: 'transparent', fg: tokens.color.inkMuted, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: tokens.touch.minimum,
          minWidth: tokens.touch.minimum,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space.sm,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: tokens.radius.control,
          backgroundColor: pressed && !isDisabled ? tokens.color.tint : palette.bg,
          paddingHorizontal: tokens.space.lg,
          opacity: isDisabled ? 0.58 : 1,
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
          fontSize: tokens.type.base,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
