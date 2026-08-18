import { Text, View } from 'react-native';

import { IconButton } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';

interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  onBackPress?: () => void;
  onMenuPress?: () => void;
  onSettingsPress?: () => void;
}

export function ScreenHeader({
  eyebrow,
  title,
  description,
  onBackPress,
  onMenuPress,
  onSettingsPress,
}: ScreenHeaderProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const hasLeadingAction = Boolean(onBackPress || onMenuPress);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: tokens.space.md,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.panel,
        paddingHorizontal: tokens.space.md,
        paddingTop: tokens.space.md,
        paddingBottom: 9,
      }}
    >
      {hasLeadingAction ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
          {onBackPress ? <IconButton accessibilityLabel={t.goBack} icon="back" onPress={onBackPress} /> : null}
          {onMenuPress ? <IconButton accessibilityLabel={t.openMenu} icon="menu" onPress={onMenuPress} /> : null}
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <Text
            numberOfLines={1}
            style={{
              color: tokens.color.accent,
              fontSize: 11,
              fontWeight: tokens.type.weight.medium,
              lineHeight: tokens.type.lineHeight.xs,
            }}
          >
            {eyebrow}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: 17,
            fontWeight: tokens.type.weight.medium,
            lineHeight: 23,
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
            {description}
          </Text>
        ) : null}
      </View>
      {onSettingsPress ? (
        <IconButton accessibilityLabel={t.openAccountSettings} icon="settings" onPress={onSettingsPress} />
      ) : null}
    </View>
  );
}
