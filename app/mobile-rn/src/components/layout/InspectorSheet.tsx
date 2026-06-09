import { Text, View } from 'react-native';

import { BottomSheet, Button, StatusPill } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileInspectorSheetMode, MobileRun } from '@/types';

interface InspectorSheetProps {
  mode?: MobileInspectorSheetMode;
  run: MobileRun | undefined;
  visible: boolean;
  onClose: () => void;
}

export function InspectorSheet({
  mode = 'review',
  run,
  visible,
  onClose,
}: InspectorSheetProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const title = getSheetTitle(mode, run?.title ?? t.runInspector, t);
  const primaryAction = getPrimaryAction(mode, t, onClose);

  return (
    <BottomSheet
      title={title}
      visible={visible}
      onClose={onClose}
      primaryAction={primaryAction}
    >
      {run ? (
        <View style={{ gap: tokens.space.md }}>
          {mode === 'approvalError' ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: tokens.color.dangerSoft,
                borderRadius: tokens.radius.panel,
                backgroundColor: tokens.color.dangerSoft,
                padding: tokens.space.md,
                gap: tokens.space.xs,
              }}
            >
              <Text style={{ color: tokens.color.danger, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold }}>
                {t.approvalSubmitErrorTitle}
              </Text>
              <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
                {t.approvalSubmitErrorDescription}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <StatusPill status={run.status === 'approval_required' ? 'waiting' : run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'running'} />
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm }}>{run.updatedAt}</Text>
          </View>
          {mode === 'approveConfirm' || mode === 'rejectConfirm' ? (
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
              {mode === 'approveConfirm' ? t.approvalConfirmDescription : t.rejectionConfirmDescription}
            </Text>
          ) : null}
          <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>{run.summary}</Text>
          {run.statusDetail ? (
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
              {run.statusDetail}
            </Text>
          ) : null}
          <View style={{ gap: tokens.space.sm }}>
            {run.changedFiles.map((file) => (
              <Text key={file} style={{ color: tokens.color.ink, fontSize: tokens.type.sm }}>
                {file}
              </Text>
            ))}
          </View>
          <Button
            label={mode === 'review' ? t.close : t.cancel}
            onPress={onClose}
            variant="secondary"
          />
        </View>
      ) : (
        <Text style={{ color: tokens.color.inkMuted }}>{t.noRunSelected}</Text>
      )}
    </BottomSheet>
  );
}

function getSheetTitle(
  mode: MobileInspectorSheetMode,
  fallback: string,
  t: ReturnType<typeof useStrings>,
): string {
  if (mode === 'approveConfirm') {
    return t.confirmApproval;
  }
  if (mode === 'rejectConfirm') {
    return t.confirmRejection;
  }
  if (mode === 'approvalError') {
    return t.approvalSubmitErrorTitle;
  }

  return fallback;
}

function getPrimaryAction(
  mode: MobileInspectorSheetMode,
  t: ReturnType<typeof useStrings>,
  onClose: () => void,
) {
  if (mode === 'approveConfirm') {
    return { label: t.approve, onPress: onClose };
  }
  if (mode === 'rejectConfirm') {
    return { label: t.reject, onPress: onClose, danger: true };
  }
  if (mode === 'approvalError') {
    return { label: t.retry, onPress: onClose, danger: true };
  }

  return undefined;
}
