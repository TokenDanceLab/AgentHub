import { Text, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';

import { Button } from './Button';

interface ErrorNoticeProps {
  title: string;
  description: string;
  onRetry?: () => void;
}

export function ErrorNotice({ title, description, onRetry }: ErrorNoticeProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: tokens.space.sm,
        borderWidth: 1,
        borderColor: tokens.color.dangerSoft,
        borderRadius: tokens.radius.panel,
        backgroundColor: tokens.color.dangerSoft,
        padding: tokens.space.md,
      }}
    >
      <AgentHubIcon color={tokens.color.danger} name="danger" />
      <View style={{ flex: 1, gap: tokens.space.sm }}>
        <Text style={{ color: tokens.color.danger, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold }}>{title}</Text>
        <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: 18 }}>{description}</Text>
        {onRetry ? <Button label={t.retry} onPress={onRetry} variant="danger" /> : null}
      </View>
    </View>
  );
}
