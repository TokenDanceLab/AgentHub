import { ScrollView, Text, View } from 'react-native';

import { InspectorSheet, ScreenHeader } from '@/components/layout';
import { Badge, Button, ListRow, StatusPill, Surface } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture, MobileRun } from '@/types';

interface RunsScreenProps {
  fixture: MobileAppFixture;
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}

function runStatusToPill(status: MobileRun['status']) {
  if (status === 'approval_required') {
    return 'waiting';
  }
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed') {
    return 'failed';
  }

  return 'running';
}

export function RunsScreen({ fixture, selectedRunId, onSelectRun }: RunsScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const selectedRun = fixture.runs.find((run) => run.id === selectedRunId) ?? fixture.runs[0];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        eyebrow="Remote control"
        title="Runs"
        description="Approval, diff, file preview, and failure recovery stay evidence-first."
      />
      <ScrollView contentContainerStyle={{ gap: tokens.space.md, padding: tokens.space.lg }}>
        {selectedRun ? (
          <Surface emphasis={selectedRun.status === 'approval_required' ? 'warning' : 'tint'}>
            <View style={{ gap: tokens.space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ flex: 1, color: tokens.color.ink, fontSize: tokens.type.lg, fontWeight: '900' }}>
                  Next review
                </Text>
                <StatusPill status={runStatusToPill(selectedRun.status)} />
              </View>
              <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 20 }}>
                {selectedRun.summary}
              </Text>
              <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
                <Button label="Approve" style={{ flex: 1 }} variant="primary" />
                <Button label="Reject" style={{ flex: 1 }} variant="danger" />
              </View>
            </View>
          </Surface>
        ) : null}
        <View style={{ gap: tokens.space.sm }}>
          {fixture.runs.map((run) => (
            <ListRow
              badge={run.status === 'approval_required' ? 'Approval' : run.status}
              initials={run.target.slice(0, 1).toUpperCase()}
              key={run.id}
              meta={run.updatedAt}
              onPress={() => onSelectRun(run.id)}
              selected={run.id === selectedRunId}
              subtitle={run.summary}
              title={run.title}
            />
          ))}
        </View>
        {selectedRun ? (
          <Surface>
            <View style={{ gap: tokens.space.sm }}>
              <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: '900' }}>Changed files</Text>
              {selectedRun.changedFiles.map((file) => (
                <View key={file} style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
                  <Badge label="file" />
                  <Text style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.sm }}>{file}</Text>
                </View>
              ))}
            </View>
          </Surface>
        ) : null}
      </ScrollView>
      <InspectorSheet run={selectedRun} visible={false} onClose={() => undefined} />
    </View>
  );
}
