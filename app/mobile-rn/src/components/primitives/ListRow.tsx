import { Pressable, Text, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

import { Badge } from './Badge';

interface ListRowProps {
  title: string;
  subtitle: string;
  meta?: string | undefined;
  initials?: string;
  badge?: string | undefined;
  selected?: boolean;
  onPress?: () => void;
}

export function ListRow({
  title,
  subtitle,
  meta,
  initials,
  badge,
  selected = false,
  onPress,
}: ListRowProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 64,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.sm,
          borderWidth: 1,
          borderColor: selected ? tokens.color.accentSoft : tokens.color.line,
          borderRadius: tokens.radius.control,
          backgroundColor: selected || pressed ? tokens.color.tint : tokens.color.surface,
          paddingHorizontal: tokens.space.sm,
          paddingVertical: tokens.space.sm,
        },
      ]}
    >
      <View
        style={{
          width: tokens.touch.minimum,
          height: tokens.touch.minimum,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens.radius.control,
          borderWidth: 1,
          borderColor: selected ? tokens.color.focus : tokens.color.line,
          backgroundColor: selected ? tokens.color.accentSoft : tokens.color.surfaceStrong,
        }}
      >
        <Text style={{ color: tokens.color.accent, fontSize: tokens.type.base, fontWeight: tokens.type.weight.semibold }}>
          {initials ?? title.slice(0, 1)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: tokens.space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: tokens.type.weight.medium }}
          >
            {title}
          </Text>
          {meta ? <Text style={{ color: tokens.color.inkSubtle, fontSize: tokens.type.xs }}>{meta}</Text> : null}
        </View>
        <Text numberOfLines={1} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 18 }}>
          {subtitle}
        </Text>
        {badge ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Badge label={badge} tone="accent" />
          </View>
        ) : null}
      </View>
      <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={16} />
    </Pressable>
  );
}
