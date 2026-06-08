import { ScrollView, Text, TextInput, View } from 'react-native';
import type { TranscriptBlock } from '@agenthub/shared/transcript';

import { ScreenHeader } from '@/components/layout';
import { Badge, Button, ErrorNotice, Surface } from '@/components/primitives';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture } from '@/types';

interface ChatScreenProps {
  fixture: MobileAppFixture;
  selectedThreadId: string;
  onOpenRuns: () => void;
}

function getBlockTitle(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text':
      return block.displayTitle ?? block.author.name;
    case 'approval':
    case 'artifact':
    case 'diff':
    case 'run_session':
      return block.title;
    case 'tool_call':
      return block.toolName;
    case 'run_step_group':
      return block.title;
    case 'thinking':
      return 'Thinking';
    case 'subagent':
    case 'child_agent':
      return block.title;
    case 'route_decision':
      return block.action;
    case 'context_usage':
      return block.modelLabel ?? 'Context usage';
    case 'result':
      return block.success ? 'Result completed' : 'Result failed';
    case 'agent_timeline':
      return block.title ?? 'Agent timeline';
    default:
      return 'Transcript block';
  }
}

function getBlockDetail(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text;
    case 'approval':
      return block.reason ?? block.status;
    case 'diff':
      return `${block.files.join(', ')} · +${block.additions ?? 0} / -${block.deletions ?? 0}`;
    case 'tool_call':
      return block.summary ?? block.status;
    case 'run_session':
      return block.meta ?? block.status ?? 'running';
    default:
      return block.kind;
  }
}

export function ChatScreen({ fixture, selectedThreadId, onOpenRuns }: ChatScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const thread = fixture.threads.find((item) => item.id === selectedThreadId) ?? fixture.threads[0];
  const transcript = thread ? fixture.transcript[thread.id] ?? [] : [];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        eyebrow="Thread"
        title={thread?.title ?? 'No thread'}
        description="Native transcript flow: messages, run state, approvals, diffs, and recovery."
      />
      <ScrollView contentContainerStyle={{ gap: tokens.space.md, padding: tokens.space.lg }}>
        <Surface emphasis="strong">
          <View style={{ gap: tokens.space.sm }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: '900' }}>Scope</Text>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 20 }}>
              Project: AgentHub Mobile · Target: Hub-mediated remote review · Runtime: no Local Edge
            </Text>
          </View>
        </Surface>
        {fixture.account.websocket !== 'connected' ? (
          <ErrorNotice
            title="WebSocket reconnecting"
            description="Messages remain readable. New approvals and run updates resync when Hub events reconnect."
            onRetry={onOpenRuns}
          />
        ) : null}
        {transcript.map((block) => (
          <Surface
            emphasis={block.kind === 'approval' ? 'warning' : block.kind === 'diff' ? 'tint' : 'normal'}
            key={block.id}
          >
            <View style={{ gap: tokens.space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
                <Text style={{ flex: 1, color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: '900' }}>
                  {getBlockTitle(block)}
                </Text>
                <Badge label={block.kind} tone={block.kind === 'approval' ? 'warning' : 'accent'} />
              </View>
              <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: 21 }}>
                {getBlockDetail(block)}
              </Text>
            </View>
          </Surface>
        ))}
      </ScrollView>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: tokens.color.line,
          backgroundColor: tokens.color.panel,
          padding: tokens.space.lg,
          gap: tokens.space.md,
        }}
      >
        <View
          style={{
            minHeight: 46,
            borderWidth: 1,
            borderColor: tokens.color.line,
            borderRadius: tokens.radius.panel,
            backgroundColor: tokens.color.surface,
            paddingHorizontal: tokens.space.md,
            paddingVertical: tokens.space.sm,
          }}
        >
          <TextInput
            multiline
            placeholder="Ask Builder to continue..."
            placeholderTextColor={tokens.color.inkSubtle}
            style={{ color: tokens.color.ink, fontSize: tokens.type.base, minHeight: 32 }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: tokens.space.sm }}>
          <Button label="Stop" variant="secondary" />
          <Button icon="send" label="Send" style={{ flex: 1 }} variant="primary" />
        </View>
      </View>
    </View>
  );
}
