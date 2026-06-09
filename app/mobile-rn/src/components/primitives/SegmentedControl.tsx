import { Pressable, Text, View } from 'react-native';

import { useAgentHubTheme } from '@/theme';

interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: tokens.space.xs,
        borderWidth: 1,
        borderColor: tokens.color.line,
        borderRadius: tokens.radius.control,
        backgroundColor: tokens.color.surface,
        padding: tokens.space.xs,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: tokens.touch.minimum,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: tokens.radius.control,
              backgroundColor: selected ? tokens.color.tint : 'transparent',
              paddingHorizontal: tokens.space.sm,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: selected ? tokens.color.accent : tokens.color.inkMuted,
                fontSize: tokens.type.sm,
                fontWeight: selected ? tokens.type.weight.medium : tokens.type.weight.regular,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
