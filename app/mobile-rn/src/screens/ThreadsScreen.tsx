import { ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/layout';
import { ErrorNotice, ListRow, SearchField, SegmentedControl, StatusPill, Surface } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture } from '@/types';

interface ThreadsScreenProps {
  fixture: MobileAppFixture;
  selectedThreadId: string;
  onSelectThread: (threadId: string) => void;
  onOpenAccount: () => void;
}

export function ThreadsScreen({
  fixture,
  selectedThreadId,
  onSelectThread,
  onOpenAccount,
}: ThreadsScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const activeThread = fixture.threads.find((thread) => thread.id === selectedThreadId) ?? fixture.threads[0];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        eyebrow="AgentHub Mobile"
        title="Review queue"
        description="Feishu-style queue density using AgentHub v4 status semantics."
        onSettingsPress={onOpenAccount}
      />
      <ScrollView contentContainerStyle={{ gap: tokens.space.md, padding: tokens.space.lg }}>
        <SearchField placeholder="Search threads, runs, agents" value="" onChangeText={() => undefined} />
        <SegmentedControl
          options={[
            { label: 'All', value: 'all' },
            { label: 'Unread', value: 'unread' },
            { label: 'Review', value: 'review' },
          ]}
          value="all"
          onChange={() => undefined}
        />
        <Surface emphasis="tint">
          <View style={{ gap: tokens.space.sm }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: '900' }}>
              Continue handoff
            </Text>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 20 }}>
              {activeThread?.subtitle ?? 'No active thread selected.'}
            </Text>
            {activeThread ? <StatusPill status={activeThread.status} /> : null}
          </View>
        </Surface>
        {fixture.account.hubSession === 'expired' ? (
          <ErrorNotice
            title="Hub session needs recovery"
            description="Queue remains visible from the last safe snapshot. Retry after TokenDance ID session refresh."
            onRetry={() => undefined}
          />
        ) : null}
        <View style={{ gap: tokens.space.sm }}>
          {fixture.threads.map((thread) => (
            <ListRow
              badge={thread.unread > 0 ? `${thread.unread} unread` : thread.muted ? 'Muted' : undefined}
              initials={thread.initials}
              key={thread.id}
              meta={thread.lastActivity}
              onPress={() => onSelectThread(thread.id)}
              selected={thread.id === selectedThreadId}
              subtitle={thread.subtitle}
              title={thread.title}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
