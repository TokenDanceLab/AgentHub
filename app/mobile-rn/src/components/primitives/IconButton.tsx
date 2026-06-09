import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

const MIN_ICON_BUTTON_SIZE = 44;

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
  const controlSize = Math.max(MIN_ICON_BUTTON_SIZE, tokens.touch.primary);
  const label = accessibilityLabel.trim();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minWidth: MIN_ICON_BUTTON_SIZE,
          minHeight: MIN_ICON_BUTTON_SIZE,
          width: controlSize,
          height: controlSize,
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
