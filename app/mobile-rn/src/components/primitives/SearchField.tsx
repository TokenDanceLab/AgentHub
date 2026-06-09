import { TextInput, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}

export function SearchField({ value, onChangeText, placeholder }: SearchFieldProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        minHeight: tokens.touch.minimum,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderWidth: 1,
        borderColor: tokens.color.line,
        borderRadius: tokens.radius.control,
        backgroundColor: tokens.color.surfaceStrong,
        paddingHorizontal: tokens.space.md,
      }}
    >
      <AgentHubIcon color={tokens.color.inkSubtle} name="search" />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={tokens.color.inkSubtle}
        value={value}
        onChangeText={onChangeText}
        style={{
          flex: 1,
          minHeight: tokens.touch.minimum,
          color: tokens.color.ink,
          fontSize: tokens.type.sm,
          fontWeight: tokens.type.weight.medium,
        }}
      />
    </View>
  );
}
