import { Text, View } from 'react-native';

import { BottomSheet, Button, StatusPill } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileRun } from '@/types';

interface InspectorSheetProps {
  run: MobileRun | undefined;
  visible: boolean;
  onClose: () => void;
}

export function InspectorSheet({ run, visible, onClose }: InspectorSheetProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <BottomSheet
      title={run ? run.title : 'Run inspector'}
      visible={visible}
      onClose={onClose}
      primaryAction={
        run?.status === 'approval_required'
          ? { label: 'Review approval', onPress: onClose }
          : undefined
      }
    >
      {run ? (
        <View style={{ gap: tokens.space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <StatusPill status={run.status === 'approval_required' ? 'waiting' : run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'running'} />
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm }}>{run.updatedAt}</Text>
          </View>
          <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.base, lineHeight: 22 }}>{run.summary}</Text>
          <View style={{ gap: tokens.space.sm }}>
            {run.changedFiles.map((file) => (
              <Text key={file} style={{ color: tokens.color.ink, fontSize: tokens.type.sm }}>
                {file}
              </Text>
            ))}
          </View>
          <Button label="Close" onPress={onClose} variant="secondary" />
        </View>
      ) : (
        <Text style={{ color: tokens.color.inkMuted }}>No run selected.</Text>
      )}
    </BottomSheet>
  );
}
