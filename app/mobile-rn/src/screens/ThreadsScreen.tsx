import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AgentHubIcon } from '@/components/icons';
import { BottomSheet, EmptyState, SearchField } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture, MobileThread } from '@/types';

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
  const t = useStrings();
  const pendingTaskCount = fixture.runs.filter((run) => run.status === 'approval_required').length;
  const activeTaskCount = fixture.runs.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const failedTaskCount = fixture.runs.filter((run) => run.status === 'failed').length;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const visibleThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return fixture.threads;
    }

    return fixture.threads.filter((thread) => (
      thread.title.toLowerCase().includes(normalizedQuery)
      || thread.subtitle.toLowerCase().includes(normalizedQuery)
      || thread.statusDetail?.toLowerCase().includes(normalizedQuery)
    ));
  }, [fixture.threads, query]);
  const isEmpty = visibleThreads.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.panel }}>
      <HomeHeader
        searchActive={searchOpen}
        onOpenAccount={onOpenAccount}
        onOpenNewEntry={() => setNewEntryOpen(true)}
        onToggleSearch={() => setSearchOpen((current) => !current)}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: tokens.space.lg }}>
        {searchOpen ? (
          <View style={{ paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.sm }}>
            <SearchField placeholder={t.searchMessages} value={query} onChangeText={setQuery} />
          </View>
        ) : null}
        {fixture.account.hubSession === 'expired' ? (
          <CompactRecoveryBanner />
        ) : null}
        {pendingTaskCount > 0 || activeTaskCount > 0 || failedTaskCount > 0 ? (
          <TaskDigestStrip
            activeTaskCount={activeTaskCount}
            failedTaskCount={failedTaskCount}
            pendingTaskCount={pendingTaskCount}
          />
        ) : null}
        {isEmpty ? (
          <View style={{ paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.md }}>
            <EmptyState
              icon="chat"
              title={query.trim() ? t.noMessageResultsTitle : (fixture.account.hubSync === 'offline' ? t.previewOfflineTitle : t.emptyQueueTitle)}
              description={query.trim() ? t.noMessageResultsDescription : (fixture.account.hubSync === 'offline' ? t.previewOfflineDescription : t.emptyQueueDescription)}
            />
          </View>
        ) : (
          <View style={{ paddingTop: 0 }}>
            {visibleThreads.map((thread) => (
              <ThreadListItem
                key={thread.id}
                onPress={() => onSelectThread(thread.id)}
                selected={thread.id === selectedThreadId}
                thread={thread}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <NewEntrySheet
        visible={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
      />
    </View>
  );
}

function CompactRecoveryBanner(): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: pressed ? tokens.color.warningSoft : tokens.color.surfaceStrong,
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.xs,
      })}
    >
      <AgentHubIcon color={tokens.color.warning} name="shield" size={16} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.ink, ...tokens.type.role.body, fontWeight: tokens.type.weight.medium }}
        >
          {t.hubSessionRecoveryTitle}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.inkMuted, ...tokens.type.role.meta }}
        >
          {t.hubSessionRecoveryDescription}
        </Text>
      </View>
      <Text style={{ color: tokens.color.warning, ...tokens.type.role.meta, fontWeight: tokens.type.weight.medium }}>
        {t.retry}
      </Text>
    </Pressable>
  );
}

function HomeHeader({
  searchActive,
  onOpenAccount,
  onOpenNewEntry,
  onToggleSearch,
}: {
  searchActive: boolean;
  onOpenAccount: () => void;
  onOpenNewEntry: () => void;
  onToggleSearch: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.panel,
        paddingHorizontal: tokens.space.md,
        paddingTop: tokens.space.md,
        paddingBottom: 9,
      }}
    >
      <Pressable
        accessibilityLabel={t.openAccountDrawer}
        accessibilityRole="button"
        onPress={onOpenAccount}
      >
        <View>
          <View
            style={{
              width: 46,
              height: 46,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 23,
              backgroundColor: tokens.color.accentSoft,
              borderWidth: 1,
              borderColor: tokens.color.accentSoft,
            }}
          >
            <Text style={{ color: tokens.color.accent, ...tokens.type.role.profileName }}>D</Text>
          </View>
          <View
            style={{
              position: 'absolute',
              right: -1,
              top: -1,
              width: 12,
              height: 12,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: tokens.color.canvas,
              backgroundColor: tokens.color.danger,
            }}
          />
        </View>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.ink, ...tokens.type.role.profileName }}
        >
          Delicious233
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.inkMuted, ...tokens.type.role.meta }}
        >
          {t.workspaceSubtitle}
        </Text>
      </View>
      <HeaderIcon accessibilityLabel={t.search} active={searchActive} icon="search" onPress={onToggleSearch} />
      <HeaderIcon accessibilityLabel={t.add} icon="plusCircle" onPress={onOpenNewEntry} />
    </View>
  );
}

function TaskDigestStrip({
  activeTaskCount,
  failedTaskCount,
  pendingTaskCount,
}: {
  activeTaskCount: number;
  failedTaskCount: number;
  pendingTaskCount: number;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const tone = failedTaskCount > 0 ? 'danger' : pendingTaskCount > 0 ? 'warning' : 'accent';

  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.surfaceStrong,
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.xs,
      }}
    >
      <AgentHubIcon
        color={tone === 'warning' ? tokens.color.warning : tone === 'danger' ? tokens.color.danger : tokens.color.accent}
        name={tone === 'warning' ? 'approval' : 'runs'}
        size={16}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            ...tokens.type.role.meta,
            fontWeight: tokens.type.weight.medium,
          }}
        >
          {t.taskDigestTitle}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.inkMuted, ...tokens.type.role.caption }}
        >
          {t.taskDigestDescription
            .replace('{pending}', String(pendingTaskCount))
            .replace('{active}', String(activeTaskCount))
            .replace('{failed}', String(failedTaskCount))}
        </Text>
      </View>
    </View>
  );
}

function HeaderIcon({
  active = false,
  accessibilityLabel,
  icon,
  onPress,
}: {
  active?: boolean;
  accessibilityLabel: string;
  icon: 'search' | 'plusCircle';
  onPress: () => void;
}) {
  const { tokens } = useAgentHubTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: active ? tokens.color.accentSoft : 'transparent',
      }}
    >
      <AgentHubIcon color={active ? tokens.color.accent : tokens.color.ink} name={icon} size={20} />
    </Pressable>
  );
}

function NewEntrySheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const actions = [
    { icon: 'chat' as const, title: t.newChatWithAgentHub, subtitle: t.newChatWithAgentHubDescription },
    { icon: 'approval' as const, title: t.newReviewThread, subtitle: t.newReviewThreadDescription },
    { icon: 'file' as const, title: t.newProjectMessage, subtitle: t.newProjectMessageDescription },
  ];

  return (
    <BottomSheet
      title={t.newEntryTitle}
      visible={visible}
      onClose={onClose}
      primaryAction={{ label: t.close, onPress: onClose }}
    >
      <View style={{ gap: tokens.space.xs }}>
        {actions.map((action) => (
          <Pressable
            accessibilityRole="button"
            key={action.title}
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: 58,
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.space.sm,
              borderRadius: tokens.radius.panel,
              backgroundColor: pressed ? tokens.color.tint : tokens.color.surfaceStrong,
              paddingHorizontal: tokens.space.md,
              paddingVertical: tokens.space.sm,
            })}
          >
            <AgentHubIcon color={tokens.color.accent} name={action.icon} size={20} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: tokens.color.ink, ...tokens.type.role.rowTitle }}>
                {action.title}
              </Text>
              <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, ...tokens.type.role.meta }}>
                {action.subtitle}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

function getToneColor(
  tokens: ReturnType<typeof useAgentHubTheme>['tokens'],
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
): string {
  return {
    accent: tokens.color.accent,
    success: tokens.color.moss,
    warning: tokens.color.warning,
    danger: tokens.color.danger,
    neutral: tokens.color.inkMuted,
  }[tone];
}

function getToneSoft(
  tokens: ReturnType<typeof useAgentHubTheme>['tokens'],
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
): string {
  return {
    accent: tokens.color.accentSoft,
    success: tokens.color.mossSoft,
    warning: tokens.color.warningSoft,
    danger: tokens.color.dangerSoft,
    neutral: tokens.color.surfaceStrong,
  }[tone];
}

function getAvatarTone(
  thread: MobileThread,
  fallback: 'accent' | 'warning'
): 'accent' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (thread.avatarTone === 'success') {
    return 'success';
  }
  if (thread.avatarTone === 'warning') {
    return 'warning';
  }
  if (thread.avatarTone === 'danger') {
    return 'danger';
  }
  if (thread.avatarTone === 'neutral') {
    return 'neutral';
  }

  return fallback;
}

function getStatusTone(
  status: MobileThread['status']
): 'accent' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'online') {
    return 'success';
  }
  if (status === 'running') {
    return 'accent';
  }
  if (status === 'waiting') {
    return 'warning';
  }
  if (status === 'failed') {
    return 'danger';
  }

  return 'neutral';
}

function CompactBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'accent' | 'warning' | 'neutral';
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View
      style={{
        minHeight: 18,
        justifyContent: 'center',
        borderRadius: 5,
        backgroundColor: getToneSoft(tokens, tone),
        paddingHorizontal: 6,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ color: getToneColor(tokens, tone), ...tokens.type.role.badge }}
      >
        {label}
      </Text>
    </View>
  );
}

function ReviewMeta({ thread }: { thread: MobileThread }): React.ReactElement | null {
  const t = useStrings();
  const needsAttention = thread.reviewDensity === 'critical' || thread.status === 'waiting' || thread.status === 'failed';

  if (!thread.reviewDensity && !thread.evidenceCount && !thread.statusDetail) {
    return null;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
      {needsAttention ? (
        <CompactBadge label={t.needsAction} tone="warning" />
      ) : null}
    </View>
  );
}

function ThreadListItem({
  thread,
  selected,
  onPress,
  tone = 'accent',
}: {
  thread: MobileThread;
  selected: boolean;
  onPress: () => void;
  tone?: 'accent' | 'warning';
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const badgeLabel =
    thread.participantKind === 'external'
      ? t.external
      : thread.participantKind === 'bot'
        ? t.bot
        : thread.participantKind === 'agent'
          ? t.agent
          : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: pressed ? tokens.color.tint : selected ? tokens.color.surfaceStrong : tokens.color.panel,
        paddingHorizontal: tokens.space.md,
        paddingVertical: 7,
      })}
    >
      <ThreadAvatar thread={thread} tone={tone} />
        <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: tokens.color.ink,
              ...tokens.type.role.rowTitle,
            }}
          >
            {thread.title}
          </Text>
          {badgeLabel ? (
            <CompactBadge label={badgeLabel} tone={tone === 'warning' ? 'warning' : 'accent'} />
          ) : null}
          <Text
            style={{
              color: tokens.color.inkSubtle,
              ...tokens.type.role.meta,
            }}
          >
            {thread.lastActivity}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 18 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: tokens.color.inkMuted,
              ...tokens.type.role.meta,
            }}
          >
            {thread.subtitle}
          </Text>
          <ReviewMeta thread={thread} />
          {thread.muted ? (
            <AgentHubIcon color={tokens.color.inkSubtle} name="bell" size={14} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function ThreadAvatar({
  thread,
  tone,
}: {
  thread: MobileThread;
  tone: 'accent' | 'warning';
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const avatarTone = getAvatarTone(thread, tone);
  const statusTone = getStatusTone(thread.status);
  const color = getToneColor(tokens, avatarTone);
  const soft = getToneSoft(tokens, avatarTone);
  const iconName =
    thread.participantKind === 'agent'
      ? 'agent'
      : thread.participantKind === 'bot'
        ? 'shield'
        : thread.participantKind === 'group' && thread.initials === 'AH'
          ? 'chat'
          : undefined;

  return (
    <View>
      <View
        style={{
          width: 48,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius:
            thread.participantKind === 'human' || thread.participantKind === 'external' ? 24 : 14,
          borderWidth: 1,
          borderColor: tokens.color.line,
          backgroundColor: soft,
        }}
      >
        {iconName ? (
          <AgentHubIcon color={color} name={iconName} size={22} />
        ) : (
          <Text style={{ color, ...(thread.initials.length > 1 ? tokens.type.role.meta : tokens.type.role.screenTitle) }}>
            {thread.initials}
          </Text>
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          right: -1,
          bottom: -1,
          width: 13,
          height: 13,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: tokens.color.canvas,
          backgroundColor: getToneColor(tokens, statusTone),
        }}
      />
      {thread.unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -5,
            minWidth: 18,
            height: 18,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 9,
            borderWidth: 2,
            borderColor: tokens.color.canvas,
            backgroundColor: tokens.color.danger,
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: tokens.color.onDanger, ...tokens.type.role.badge }}>{thread.unread}</Text>
        </View>
      ) : null}
    </View>
  );
}
