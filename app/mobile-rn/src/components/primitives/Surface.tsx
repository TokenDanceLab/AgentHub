import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useAgentHubTheme } from '@/theme';

interface SurfaceProps {
  children: React.ReactNode;
  emphasis?: 'normal' | 'strong' | 'tint' | 'danger' | 'success' | 'warning';
  elevation?: 'none' | 'sm' | 'md' | 'lg' | 'panel';
  style?: StyleProp<ViewStyle>;
}

export function Surface({ children, emphasis = 'normal', elevation = 'none', style }: SurfaceProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const backgroundColor = {
    normal: tokens.color.surface,
    strong: tokens.color.surfaceStrong,
    tint: tokens.color.tint,
    danger: tokens.color.dangerSoft,
    success: tokens.color.mossSoft,
    warning: tokens.color.warningSoft,
  }[emphasis];
  const shadow = elevation === 'none' ? undefined : tokens.shadow[elevation];

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: tokens.radius.panel,
          backgroundColor,
          padding: tokens.space.md,
        },
        shadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}
