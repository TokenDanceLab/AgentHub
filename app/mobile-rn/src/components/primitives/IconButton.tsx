import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

interface IconButtonProps {
  accessibilityLabel: string;
  icon: AgentHubIconName;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  selected = false,
  style,
}: IconButtonProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: tokens.touch.primary,
          height: tokens.touch.primary,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens.radius.control,
          backgroundColor: selected || pressed ? tokens.color.tint : 'transparent',
        },
        style,
      ]}
    >
      <AgentHubIcon color={selected ? tokens.color.accent : tokens.color.inkMuted} name={icon} />
    </Pressable>
  );
}
