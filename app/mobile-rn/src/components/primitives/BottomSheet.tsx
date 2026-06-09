import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';

import { Button } from './Button';

interface BottomSheetProps {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  primaryAction?: {
    label: string;
    onPress: () => void;
    danger?: boolean;
  } | undefined;
}

export function BottomSheet({
  title,
  visible,
  onClose,
  children,
  primaryAction,
}: BottomSheetProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel={t.closeSheet}
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: tokens.color.scrim }]}
        />
        <View
          style={{
            borderTopLeftRadius: tokens.radius.sheet,
            borderTopRightRadius: tokens.radius.sheet,
            borderWidth: 1,
            borderColor: tokens.color.line,
            backgroundColor: tokens.color.panel,
            padding: tokens.space.lg,
            gap: tokens.space.lg,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 42,
              height: 4,
              borderRadius: 999,
              backgroundColor: tokens.color.line,
            }}
          />
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.lg, fontWeight: tokens.type.weight.semibold }}>{title}</Text>
          {children}
          {primaryAction ? (
            <Button
              label={primaryAction.label}
              onPress={primaryAction.onPress}
              variant={primaryAction.danger ? 'danger' : 'primary'}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
