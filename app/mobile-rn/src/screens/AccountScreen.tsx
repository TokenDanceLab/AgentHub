import { ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/layout';
import { Button, ErrorNotice, StatusPill, Surface } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileAccountState, MobileThemeMode } from '@/types';

interface AccountScreenProps {
  account: MobileAccountState;
  themeMode: MobileThemeMode;
  onChangeThemeMode: (mode: MobileThemeMode) => void;
}

export function AccountScreen({
  account,
  themeMode,
  onChangeThemeMode,
}: AccountScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        eyebrow="Identity boundary"
        title="Account"
        description="TokenDance ID authenticates identity; Hub session authorizes AgentHub actions."
      />
      <ScrollView contentContainerStyle={{ gap: tokens.space.md, padding: tokens.space.lg }}>
        {account.hubSession !== 'active' ? (
          <ErrorNotice
            title="Hub session expired"
            description="TokenDance ID login must refresh through Hub before approvals or run commands can be submitted."
            onRetry={() => undefined}
          />
        ) : null}
        <Surface>
          <View style={{ gap: tokens.space.md }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.lg, fontWeight: '900' }}>
              Session readiness
            </Text>
            <ReadinessRow label="TokenDance ID" value={account.tokenDanceId} />
            <ReadinessRow label="Hub session" value={account.hubSession} />
            <ReadinessRow label="Notifications" value={account.notification} />
            <ReadinessRow label="WebSocket" value={account.websocket} />
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm }}>{account.deviceLabel}</Text>
          </View>
        </Surface>
        <Surface>
          <View style={{ gap: tokens.space.md }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.lg, fontWeight: '900' }}>Theme</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>
              {(['system', 'light', 'dark', 'oled'] as const).map((mode) => (
                <Button
                  key={mode}
                  label={mode === themeMode ? `${mode} selected` : mode}
                  onPress={() => onChangeThemeMode(mode)}
                  variant={mode === themeMode ? 'primary' : 'secondary'}
                />
              ))}
            </View>
          </View>
        </Surface>
        <Surface emphasis="tint">
          <View style={{ gap: tokens.space.sm }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: '900' }}>
              Native capability backlog
            </Text>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 20 }}>
              SecureStore, AuthSession, notifications, Android/iOS dev builds, and deep-link routing are typed but still need device validation.
            </Text>
          </View>
        </Surface>
      </ScrollView>
    </View>
  );
}

function ReadinessRow({ label, value }: { label: string; value: string }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const status = value.includes('active') || value.includes('granted') || value.includes('connected')
    ? 'online'
    : value.includes('expired') || value.includes('blocked') || value.includes('offline')
      ? 'failed'
      : 'waiting';

  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.base }}>{label}</Text>
      <StatusPill status={status} />
    </View>
  );
}
