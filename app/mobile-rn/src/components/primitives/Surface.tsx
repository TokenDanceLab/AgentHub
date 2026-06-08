import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useAgentHubTheme } from '@/theme';

interface SurfaceProps {
  children: React.ReactNode;
  emphasis?: 'normal' | 'strong' | 'tint' | 'danger' | 'success' | 'warning';
  style?: StyleProp<ViewStyle>;
}

export function Surface({ children, emphasis = 'normal', style }: SurfaceProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const backgroundColor = {
    normal: tokens.color.surface,
    strong: tokens.color.surfaceStrong,
    tint: tokens.color.tint,
    danger: tokens.color.dangerSoft,
    success: tokens.color.mossSoft,
    warning: tokens.color.warningSoft,
  }[emphasis];

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: tokens.radius.panel,
          backgroundColor,
          padding: tokens.space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
