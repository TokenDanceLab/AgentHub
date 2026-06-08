import { Text, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { useAgentHubTheme } from '@/theme';

import { Button } from './Button';

interface ErrorNoticeProps {
  title: string;
  description: string;
  onRetry?: () => void;
}

export function ErrorNotice({ title, description, onRetry }: ErrorNoticeProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: tokens.space.md,
        borderWidth: 1,
        borderColor: tokens.color.dangerSoft,
        borderRadius: tokens.radius.panel,
        backgroundColor: tokens.color.dangerSoft,
        padding: tokens.space.lg,
      }}
    >
      <AgentHubIcon color={tokens.color.danger} name="danger" />
      <View style={{ flex: 1, gap: tokens.space.sm }}>
        <Text style={{ color: tokens.color.danger, fontSize: tokens.type.base, fontWeight: '900' }}>{title}</Text>
        <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 20 }}>{description}</Text>
        {onRetry ? <Button label="Retry" onPress={onRetry} variant="danger" /> : null}
      </View>
    </View>
  );
}
