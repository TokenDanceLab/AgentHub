import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AgentHubIcon, type AgentHubIconName } from '@/components/icons';
import { Badge, Button, MotionPressable } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useNativeCapabilities } from '@/integrations/useNativeCapabilities';
import { useAgentHubTheme } from '@/theme';
import type { MobileAccountState, MobileThemeMode } from '@/types';

interface AccountScreenProps {
  account: MobileAccountState;
  themeMode: MobileThemeMode;
  onChangeThemeMode: (mode: MobileThemeMode) => void;
  onClose?: () => void;
}

interface AccountMenuItem {
  icon: AgentHubIconName;
  label: string;
  status?: string;
  detail?: string;
  color: string;
  onPress?: () => void;
}

interface AccountMenuSection {
  title: string;
  items: AccountMenuItem[];
}

export function AccountScreen({
  account,
  themeMode,
  onChangeThemeMode,
  onClose,
}: AccountScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const { width } = useWindowDimensions();
  const t = useStrings();
  const nativeCapabilities = useNativeCapabilities();
  const compact = width <= 420;
  const railWidth = compact ? 76 : 96;
  const drawerWidth = Math.min(width - railWidth, compact ? 318 : 390);
  const tokenDanceBadge = formatTokenDanceStatus(account.tokenDanceId, t);
  const tokenDanceTone = getAccountTone(account.tokenDanceId);
  const accountReady = account.tokenDanceId === 'signed_in' && account.hubSession === 'active';
  const themeLabels: Record<MobileThemeMode, string> = {
    light: t.themeLight,
    system: t.themeSystem,
    dark: t.themeDark,
    oled: t.themeOled,
  };
  const menuSections: AccountMenuSection[] = [
    {
      title: t.identityAndSession,
      items: [
        { icon: 'shield', label: 'TokenDance ID', status: account.tokenDanceId, color: tokens.color.moss },
        { icon: 'runs', label: 'AgentHub', status: account.hubSession, color: tokens.color.accent },
        { icon: 'grid', label: t.workspaceSettings, color: tokens.color.accent },
      ],
    },
    {
      title: t.deviceAndSettings,
      items: [
        { icon: 'bell', label: t.notificationPermission, status: account.notification, color: tokens.color.danger },
        {
          icon: 'camera',
          label: t.cameraPermission,
          status: nativeCapabilities.status.camera,
          color: tokens.color.accent,
          onPress: nativeCapabilities.requestCamera,
        },
        {
          icon: 'image',
          label: t.photoLibraryPermission,
          status: nativeCapabilities.status.photos,
          color: tokens.color.accent,
          onPress: nativeCapabilities.requestPhotos,
        },
        {
          icon: 'hardDrive',
          label: t.storageManagement,
          status: nativeCapabilities.status.ready ? 'active' : 'unavailable',
          color: tokens.color.moss,
          onPress: nativeCapabilities.clearCache,
        },
        { icon: 'file', label: t.devices, detail: account.deviceLabel, color: tokens.color.accent },
        { icon: 'settings', label: t.settings, color: tokens.color.accent },
      ],
    },
    {
      title: t.agentProfilesTitle,
      items: [
        { icon: 'agent', label: t.agentProfilesTitle, color: tokens.color.accent },
        { icon: 'approval', label: t.approvalPolicy, color: tokens.color.warning },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.color.scrim }}>
      {onClose ? (
        <Pressable
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { '--scrim': '1' } as Record<string, string>]}
        />
      ) : null}
      <AccountRail width={railWidth} />
      <ScrollView
        style={{
          width: drawerWidth,
          backgroundColor: tokens.color.panel,
          zIndex: 1,
        }}
        contentContainerStyle={{
          gap: compact ? tokens.space.md : tokens.space.lg,
          paddingHorizontal: compact ? tokens.space.md : tokens.space.xl,
          paddingTop: compact ? tokens.space.md : tokens.space.xl,
          paddingBottom: tokens.space.xl,
        }}
      >
        <View style={{ gap: tokens.space.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: tokens.space.md }}>
            <AccountHeroAvatar />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
              <AccountStatusButton label={accountReady ? t.online : t.needsAction} tone={accountReady ? 'success' : 'warning'} />
              {onClose ? (
                <Pressable
                  accessibilityLabel={t.closeAccountDrawer}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onClose}
                  style={({ pressed }) => ({
                    width: tokens.touch.minimum,
                    height: tokens.touch.minimum,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 22,
                    backgroundColor: pressed ? tokens.color.tint : 'transparent',
                  })}
                >
                  <AgentHubIcon color={tokens.color.inkMuted} name="x" size={20} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={{ gap: tokens.space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: tokens.color.ink,
                  fontSize: 22,
                  fontWeight: tokens.type.weight.medium,
                  lineHeight: 28,
                  includeFontPadding: false,
                }}
              >
                Delicious233
              </Text>
              <AgentHubIcon color={tokens.color.inkSubtle} name="grid" size={22} />
              <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={20} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
              <Text style={{ color: tokens.color.inkMuted, fontSize: 13, lineHeight: 18 }}>TokenDance</Text>
              <Badge label={tokenDanceBadge} size="micro" tone={tokenDanceTone} />
            </View>
          </View>
          <View
            style={{
              minHeight: tokens.touch.minimum,
              justifyContent: 'center',
              borderRadius: tokens.radius.control,
              backgroundColor: tokens.color.canvas,
              paddingHorizontal: tokens.space.md,
            }}
          >
            <Text numberOfLines={1} style={{ color: tokens.color.inkSubtle, fontSize: 13, lineHeight: 18 }}>
              {t.accountSignature}
            </Text>
          </View>
        </View>

        {menuSections.map((section) => (
          <AccountMenuSectionView key={section.title} section={section} />
        ))}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs, paddingTop: tokens.space.xs }}>
          {(['light', 'system', 'dark', 'oled'] as const).map((mode) => (
            <Button
              key={mode}
              label={mode === themeMode ? `${themeLabels[mode]} ${t.selected}` : themeLabels[mode]}
              onPress={() => onChangeThemeMode(mode)}
              variant={mode === themeMode ? 'primary' : 'secondary'}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function AccountRail({ width }: { width: number }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View
      testID="account-rail"
      style={{
        width,
        zIndex: 1,
        alignItems: 'center',
        gap: tokens.space.md,
        backgroundColor: tokens.color.canvas,
        borderRightWidth: 1,
        borderRightColor: tokens.color.line,
        paddingTop: tokens.space.lg,
        paddingHorizontal: tokens.space.xs,
        // The rail has no interactive children; letting clicks fall through
        // keeps the backdrop scrim the "tap outside closes drawer" target
        // across the full viewport width.
        pointerEvents: 'none',
      }}
    >
      <RailAccount iconLabel="TD" label="TokenDance" selected />
      <RailAccount badge="+3" iconLabel="AH" label="AgentHub" />
      <RailAccount badge="!" iconLabel="AP" label={t.agentProfilesTitle} tone="warning" />
      <RailAddAccount label={t.switchWorkspace} />
    </View>
  );
}

function RailAccount({
  badge,
  iconLabel,
  label,
  selected = false,
  tone = 'accent',
}: {
  badge?: string;
  iconLabel: string;
  label: string;
  selected?: boolean;
  tone?: 'accent' | 'warning';
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const color = tone === 'warning' ? tokens.color.warning : tokens.color.accent;

  return (
    <View style={{ width: '100%', minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xs }}>
      <View>
        {selected ? (
          <View
            style={{
              position: 'absolute',
              left: -12,
              top: 11,
              width: 3,
              height: 34,
              borderRadius: 2,
              backgroundColor: color,
            }}
          />
        ) : null}
        <View
          style={{
            width: 54,
            height: 54,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            borderWidth: selected ? 2 : 1,
            borderColor: selected ? color : tokens.color.line,
            backgroundColor: selected ? tokens.color.surfaceStrong : tokens.color.panel,
          }}
        >
          <Text style={{ color, fontSize: iconLabel.length > 2 ? 14 : 17, fontWeight: tokens.type.weight.medium }}>
            {iconLabel}
          </Text>
        </View>
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 22,
              height: 22,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 11,
              borderWidth: 2,
              borderColor: tokens.color.canvas,
              backgroundColor: tone === 'warning' ? tokens.color.inkSubtle : tokens.color.danger,
              paddingHorizontal: 4,
            }}
          >
            <Text style={{ color: tokens.color.onDanger, fontSize: 11, fontWeight: tokens.type.weight.medium }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, textAlign: 'center', fontSize: 11, lineHeight: 15 }}>
        {label}
      </Text>
    </View>
  );
}

function RailAddAccount({ label }: { label: string }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ width: '100%', minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: tokens.space.xs }}>
      <View
        style={{
          width: 54,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 14,
          backgroundColor: tokens.color.panel,
        }}
      >
        <AgentHubIcon color={tokens.color.ink} name="plus" size={24} />
      </View>
      <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, textAlign: 'center', fontSize: 11, lineHeight: 15 }}>
        {label}
      </Text>
    </View>
  );
}

function AccountHeroAvatar(): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View>
      <View
        style={{
          width: 76,
          height: 76,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 38,
          borderWidth: 1,
          borderColor: tokens.color.line,
          backgroundColor: tokens.color.accentSoft,
        }}
      >
        <Text
          style={{
            color: tokens.color.accent,
            fontSize: 24,
            fontWeight: tokens.type.weight.medium,
            lineHeight: 30,
            includeFontPadding: false,
          }}
        >
          D
        </Text>
      </View>
      <View
        style={{
          position: 'absolute',
          right: 1,
          top: 2,
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: tokens.color.panel,
          backgroundColor: tokens.color.danger,
        }}
      />
    </View>
  );
}

function AccountMenuSectionView({ section }: { section: AccountMenuSection }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ gap: 2 }}>
      <Text
        style={{
          color: tokens.color.inkSubtle,
          fontSize: 11,
          fontWeight: tokens.type.weight.medium,
          lineHeight: 15,
        }}
      >
        {section.title}
      </Text>
      <View>
        {section.items.map((item) => (
          <MotionPressable
            accessibilityLabel={item.label}
            accessibilityRole="button"
            feedback="row"
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.space.sm,
              borderRadius: tokens.radius.control,
              backgroundColor: pressed ? tokens.color.tint : 'transparent',
              paddingVertical: 2,
              paddingHorizontal: tokens.space.xs,
            })}
          >
            <View
              style={{
                width: 30,
                height: 30,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
              }}
            >
              <AgentHubIcon color={item.color} name={item.icon} size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: tokens.color.ink,
                  fontSize: 16,
                  fontWeight: tokens.type.weight.medium,
                  lineHeight: 22,
                  includeFontPadding: false,
                }}
              >
                {item.label}
              </Text>
              {item.detail ? (
                <Text
                  numberOfLines={1}
                  style={{ color: tokens.color.inkSubtle, fontSize: 12, lineHeight: 16 }}
                >
                  {item.detail}
                </Text>
              ) : null}
            </View>
            {item.status ? <AccountStatusBadge value={item.status} /> : null}
            <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={18} />
          </MotionPressable>
        ))}
      </View>
    </View>
  );
}

function AccountStatusButton({ label, tone }: { label: string; tone: 'success' | 'warning' }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const color = tone === 'success' ? tokens.color.moss : tokens.color.warning;

  return (
    <MotionPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      feedback="control"
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: tokens.touch.minimum,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.xs,
        borderWidth: 1,
        borderColor: tokens.color.line,
        borderRadius: tokens.radius.control,
        backgroundColor: pressed ? tokens.color.tint : tokens.color.panel,
        paddingHorizontal: tokens.space.sm,
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text
        numberOfLines={1}
        style={{
          color: tokens.color.inkMuted,
          fontSize: 13,
          fontWeight: tokens.type.weight.medium,
          lineHeight: 18,
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>
    </MotionPressable>
  );
}

function AccountStatusBadge({ value }: { value: string }): React.ReactElement {
  const t = useStrings();
  const labelMap: Record<string, string> = {
    active: t.online,
    granted: t.online,
    signed_in: t.signedIn,
    expired: t.failed,
    blocked: t.blocked,
    missing: t.failed,
    offline: t.offline,
    recovering: t.recovering,
    prompt: t.needsAction,
    signed_out: t.signedOut,
    unavailable: t.unavailable,
  };
  const toneMap: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
    active: 'success',
    granted: 'success',
    signed_in: 'success',
    expired: 'danger',
    blocked: 'danger',
    missing: 'danger',
    offline: 'neutral',
    recovering: 'warning',
    prompt: 'warning',
    signed_out: 'danger',
    unavailable: 'neutral',
  };

  return <Badge label={labelMap[value] ?? t.needsAction} size="micro" tone={toneMap[value] ?? 'warning'} />;
}

function formatTokenDanceStatus(status: MobileAccountState['tokenDanceId'], t: ReturnType<typeof useStrings>): string {
  if (status === 'signed_in') {
    return t.signedIn;
  }
  if (status === 'recovering') {
    return t.recovering;
  }

  return t.signedOut;
}

function getAccountTone(status: MobileAccountState['tokenDanceId']): 'success' | 'warning' | 'danger' {
  if (status === 'signed_in') {
    return 'success';
  }
  if (status === 'recovering') {
    return 'warning';
  }

  return 'danger';
}
