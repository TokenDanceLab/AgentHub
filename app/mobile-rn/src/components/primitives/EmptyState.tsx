import { Text, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

import { Button } from './Button';

interface EmptyStateProps {
  icon: AgentHubIconName;
  title: string;
  description: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        gap: tokens.space.md,
        borderWidth: 1,
        borderColor: tokens.color.line,
        borderRadius: tokens.radius.panel,
        backgroundColor: tokens.color.surface,
        padding: tokens.space.lg,
      }}
    >
      <AgentHubIcon color={tokens.color.accent} name={icon} size={24} />
      <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: tokens.type.weight.semibold, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 19, textAlign: 'center' }}>
        {description}
      </Text>
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" /> : null}
    </View>
  );
}
