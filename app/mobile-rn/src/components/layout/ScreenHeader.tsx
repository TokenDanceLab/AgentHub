import { Text, View } from 'react-native';

import { IconButton } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';

interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  onSettingsPress?: () => void;
}

export function ScreenHeader({
  eyebrow,
  title,
  description,
  onSettingsPress,
}: ScreenHeaderProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.md,
        paddingHorizontal: tokens.space.lg,
        paddingVertical: tokens.space.md,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: tokens.color.accent, fontSize: tokens.type.xs, fontWeight: '900' }}>{eyebrow}</Text>
        <Text numberOfLines={1} style={{ color: tokens.color.ink, fontSize: tokens.type.xl, fontWeight: '900' }}>
          {title}
        </Text>
        {description ? (
          <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 19 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {onSettingsPress ? (
        <IconButton accessibilityLabel="Open account settings" icon="settings" onPress={onSettingsPress} />
      ) : null}
    </View>
  );
}
