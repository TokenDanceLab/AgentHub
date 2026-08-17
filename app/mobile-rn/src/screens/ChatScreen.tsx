import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import type { TranscriptBlock } from '@agenthub/shared/transcript';

import { AgentHubIcon } from '@/components/icons';
import { Badge, BottomSheet, IconButton, StatusPill, Surface } from '@/components/primitives';
import { useStrings } from '@/i18n/strings';
import { useAgentHubTheme } from '@/theme';
import type { MobileAppFixture, MobileRun, MobileThread } from '@/types';

type ChatDisplayName = 'Delicious233' | 'TokenDance' | 'AgentHub';

interface ChatScreenProps {
  fixture: MobileAppFixture;
  selectedThreadId: string;
  showBack?: boolean;
  onBack: () => void;
  onOpenRuns: () => void;
  onToggleInspector?: () => void;
}

function formatChatCopy(value: string): string {
  return value
    .replace(/\bweb\s*socket\b/gi, 'live sync')
    .replace(/\bwebsocket\b/gi, 'live sync')
    .replace(/\breconnecting\b/gi, 'recovering sync')
    .replace(/\breconnect(ed|s)?\b/gi, 'recover$1')
    .replace(/\bsocket\b/gi, 'sync channel');
}

function formatChatDisplayName(name: string | undefined, role?: string): ChatDisplayName {
  const normalized = name?.trim().toLowerCase() ?? '';

  if (normalized.includes('delicious') || role === 'human') {
    return 'Delicious233';
  }
  if (normalized.includes('tokendance')) {
    return 'TokenDance';
  }

  return 'AgentHub';
}

function getDisplayInitials(name: ChatDisplayName): string {
  if (name === 'Delicious233') {
    return 'D';
  }
  if (name === 'TokenDance') {
    return 'TD';
  }

  return 'AH';
}

function getBlockTitle(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text':
      return formatChatCopy(
        block.displayTitle ?? formatChatDisplayName(block.author.name, block.author.role)
      );
    case 'approval':
    case 'artifact':
    case 'diff':
    case 'run_session':
      return formatChatCopy(block.title);
    case 'tool_call':
      return formatChatCopy(block.toolName);
    case 'run_step_group':
      return formatChatCopy(block.title);
    case 'thinking':
      return 'Thinking';
    case 'subagent':
    case 'child_agent':
      return formatChatCopy(block.title);
    case 'route_decision':
      return formatChatCopy(block.action);
    case 'context_usage':
      return block.modelLabel ? formatChatCopy(block.modelLabel) : 'Context usage';
    case 'result':
      return block.success ? 'Result completed' : 'Result failed';
    case 'agent_timeline':
      return block.title ? formatChatCopy(block.title) : 'Agent timeline';
    default:
      return 'Transcript block';
  }
}

function formatApprovalDetail(
  block: Extract<TranscriptBlock, { kind: 'approval' }>,
  t: ReturnType<typeof useStrings>
): string {
  return [formatEvidenceStatusLabel(block.status, t), block.reason ? formatChatCopy(block.reason) : undefined]
    .filter(Boolean)
    .join('\n');
}

function formatDiffDetail(block: Extract<TranscriptBlock, { kind: 'diff' }>): string {
  const fileLines = block.files.slice(0, 2).map((file) => `• ${formatCompactFileName(file)}`);
  const hiddenFileCount = Math.max(0, block.files.length - fileLines.length);
  const summary = `${block.files.length} files · +${block.additions ?? 0} / -${block.deletions ?? 0}`;

  return [
    summary,
    ...fileLines,
    hiddenFileCount > 0 ? `+${hiddenFileCount} more files` : undefined,
  ].filter(Boolean).join('\n');
}

function formatRunSessionDetail(
  block: Extract<TranscriptBlock, { kind: 'run_session' }>,
  t: ReturnType<typeof useStrings>
): string {
  return [block.status ? formatEvidenceStatusLabel(block.status, t) : undefined, block.meta ? formatChatCopy(block.meta) : undefined]
    .filter(Boolean)
    .join('\n');
}

function getBlockDetail(block: TranscriptBlock, t: ReturnType<typeof useStrings>): string {
  switch (block.kind) {
    case 'text':
      return formatChatCopy(block.text);
    case 'approval':
      return formatApprovalDetail(block, t);
    case 'diff':
      return formatDiffDetail(block);
    case 'tool_call':
      return block.summary ? formatChatCopy(block.summary) : formatEvidenceStatusLabel(block.status, t);
    case 'run_session':
      return formatRunSessionDetail(block, t);
    default:
      return block.kind;
  }
}

function getEvidenceStatusTone(status?: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    case 'running':
      return 'accent';
    default:
      return 'neutral';
  }
}

function formatEvidenceStatusLabel(status: string | undefined, t: ReturnType<typeof useStrings>): string {
  switch (status) {
    case 'completed':
      return t.done;
    case 'failed':
      return t.failed;
    case 'pending':
      return t.reviewRequired;
    case 'running':
      return t.runningStatus;
    default:
      return t.status;
  }
}

function formatApprovalRiskLabel(
  risk: Extract<TranscriptBlock, { kind: 'approval' }>['risk'],
  t: ReturnType<typeof useStrings>
): string {
  switch (risk) {
    case 'critical':
    case 'high':
      return t.blocked;
    case 'medium':
      return t.needsAction;
    case 'low':
      return t.reviewApproval;
    default:
      return t.reviewApproval;
  }
}

function getApprovalTone(risk?: Extract<TranscriptBlock, { kind: 'approval' }>['risk']): 'accent' | 'warning' | 'danger' {
  if (risk === 'critical' || risk === 'high') {
    return 'danger';
  }

  return risk === 'medium' ? 'warning' : 'accent';
}

function formatSafeScopeLabel(target: string | undefined, t: ReturnType<typeof useStrings>): string {
  if (!target) {
    return 'AgentHub';
  }
  if (target.includes('mobile-rn')) {
    return t.mobileWorkspaceScope;
  }
  if (target.includes('hub-server')) {
    return t.hubServiceScope;
  }
  if (target.toLowerCase().includes('tokendance')) {
    return 'TokenDance';
  }

  return 'AgentHub';
}

function formatCompactFileName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1] ?? path;
  const parent = segments[segments.length - 2];

  return parent ? `${parent}/${fileName}` : fileName;
}

export function ChatScreen({
  fixture,
  selectedThreadId,
  showBack = true,
  onBack,
  onOpenRuns,
  onToggleInspector,
}: ChatScreenProps): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const thread = fixture.threads.find((item) => item.id === selectedThreadId) ?? fixture.threads[0];
  const transcript = thread ? (fixture.transcript[thread.id] ?? []) : [];
  const activeRun = thread?.activeRunId
    ? fixture.runs.find((run) => run.id === thread.activeRunId)
    : undefined;
  const [showPinnedCard, setShowPinnedCard] = useState(true);
  const [evidenceSheetVisible, setEvidenceSheetVisible] = useState(false);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tokens.color.panel }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ChatHeader activeRun={activeRun} showBack={showBack} onBack={onBack} thread={thread} {...(onToggleInspector ? { onToggleInspector } : {})} />
      <ChatTabs />
      <ScrollView
        contentContainerStyle={{
          gap: 10,
          paddingHorizontal: tokens.space.md,
          paddingTop: 10,
          paddingBottom: tokens.space.md,
        }}
      >
        {showPinnedCard ? (
          <PinnedCard
            activeRun={activeRun}
            onClose={() => setShowPinnedCard(false)}
            onOpenEvidence={() => setEvidenceSheetVisible(true)}
            onOpenRuns={onOpenRuns}
            thread={thread}
          />
        ) : null}
        <Text
          style={{
            alignSelf: 'center',
            color: tokens.color.inkMuted,
            ...tokens.type.role.caption,
            fontWeight: tokens.type.weight.medium,
          }}
        >
          {t.yesterday} 17:18
        </Text>
        {transcript.map((block, index) => (
          <MessageBlock
            block={block}
            compactWithPrevious={
              transcript[index - 1]?.author.id === block.author.id &&
              transcript[index - 1]?.kind === 'text' &&
              block.kind === 'text'
            }
            key={block.id}
          />
        ))}
      </ScrollView>
      <Composer
        deliveryState={
          thread?.previewIntent === 'sendPending'
            ? 'sending'
            : thread?.retryAvailable
              ? 'failed'
              : 'idle'
        }
        sendTo={t.sendTo}
      />
      <RunEvidenceSheet
        run={activeRun}
        visible={evidenceSheetVisible}
        onClose={() => setEvidenceSheetVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}
function ChatHeader({
  showBack,
  thread,
  onBack,
  onToggleInspector,
}: {
  activeRun: MobileRun | undefined;
  showBack: boolean;
  thread: MobileThread | undefined;
  onBack: () => void;
  onToggleInspector?: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const participantLabel =
    thread?.participantKind === 'group'
      ? t.workflow
      : thread?.participantKind === 'bot'
        ? t.bot
        : thread?.participantKind === 'agent'
          ? t.agent
          : thread?.participantKind === 'external'
            ? t.external
            : t.chat;

  return (
    <View
      style={{
        minHeight: 62,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.panel,
        paddingHorizontal: tokens.space.md,
        paddingTop: tokens.space.xs,
      }}
    >
      {showBack ? (
        <IconButton accessibilityLabel={t.backToMessages} icon="back" onPress={onBack} />
      ) : (
        <View style={{ width: 44 }} />
      )}
      <View
        style={{ flex: 1, alignItems: 'center', minWidth: 0, paddingHorizontal: tokens.space.sm }}
      >
        <View
          style={{
            maxWidth: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space.xs,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: tokens.color.ink,
              ...tokens.type.role.screenTitle,
            }}
          >
            {thread?.title ?? 'AgentHub'}
          </Text>
          <Badge label={participantLabel} size="micro" tone="warning" />
          <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={15} />
        </View>
        <Text
          numberOfLines={1}
          style={{ color: tokens.color.inkMuted, ...tokens.type.role.caption }}
        >
          {thread?.subtitle ?? t.workflowChatSubtitle}
        </Text>
      </View>
      <View style={{ width: 48, alignItems: 'flex-end' }}>
        <IconButton accessibilityLabel={t.openMenu} icon="more" {...(onToggleInspector ? { onPress: onToggleInspector } : {})} />
      </View>
    </View>
  );
}

function ChatTabs(): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
      <View
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.md,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.line,
          backgroundColor: tokens.color.panel,
          paddingHorizontal: tokens.space.md,
      }}
    >
      <View
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.sm,
          borderRadius: 8,
          backgroundColor: tokens.color.accentSoft,
          paddingHorizontal: 10,
        }}
      >
        <AgentHubIcon color={tokens.color.accent} name="chat" size={16} />
        <Text style={{ color: tokens.color.accent, ...tokens.type.role.meta, fontWeight: tokens.type.weight.medium }}>
          {t.messageTab}
        </Text>
      </View>
      <View
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.xs,
          paddingHorizontal: 0,
        }}
      >
        <AgentHubIcon color={tokens.color.inkMuted} name="file" size={16} />
        <Text style={{ color: tokens.color.inkMuted, ...tokens.type.role.meta }}>
          {t.cloudDocsTab}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={t.add}
        accessibilityRole="button"
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 22,
          backgroundColor: pressed ? tokens.color.tint : 'transparent',
        })}
      >
        <AgentHubIcon color={tokens.color.inkMuted} name="plus" size={24} />
      </Pressable>
    </View>
  );
}

function PinnedCard({
  activeRun,
  onClose,
  onOpenEvidence,
  onOpenRuns,
  thread,
}: {
  activeRun: MobileRun | undefined;
  onClose: () => void;
  onOpenEvidence: () => void;
  onOpenRuns: () => void;
  thread: MobileThread | undefined;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View>
      <Surface
        elevation="sm"
        style={{
          borderRadius: 10,
          borderColor: tokens.color.line,
          backgroundColor: tokens.color.surfaceStrong,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <View
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space.sm,
          }}
        >
          <Pressable
            accessibilityLabel={formatChatCopy(activeRun?.title ?? thread?.subtitle ?? t.pinnedWorkflow)}
            accessibilityRole="button"
            onPress={onOpenRuns}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.space.sm,
              borderRadius: 8,
              backgroundColor: pressed ? tokens.color.tint : 'transparent',
              paddingRight: tokens.space.xs,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                backgroundColor: tokens.color.warningSoft,
              }}
            >
              <AgentHubIcon color={tokens.color.warning} name="runs" size={18} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: tokens.space.xs }}>
              <Text
                numberOfLines={1}
                style={{ color: tokens.color.ink, ...tokens.type.role.meta, fontWeight: tokens.type.weight.medium }}
              >
                {formatChatCopy(activeRun?.title ?? thread?.subtitle ?? t.pinnedWorkflow)}
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: tokens.color.inkMuted, ...tokens.type.role.caption }}
              >
                {activeRun
                  ? `${t.pinnedBy} Delicious233 · ${formatChatCopy(activeRun.updatedAt)}`
                  : `${t.pinnedBy} AgentHub`}
              </Text>
            </View>
            <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={15} />
          </Pressable>
          {activeRun ? (
            <Pressable
              accessibilityLabel={t.openEvidenceInspector}
              accessibilityRole="button"
              hitSlop={4}
              onPress={onOpenEvidence}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 22,
                borderWidth: pressed ? 1 : 0,
                borderColor: tokens.color.accentSoft,
                backgroundColor: pressed ? tokens.color.accentSoft : 'transparent',
              })}
            >
              <AgentHubIcon color={tokens.color.accent} name="file" size={18} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={t.close}
            accessibilityRole="button"
            hitSlop={4}
            onPress={onClose}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              backgroundColor: pressed ? tokens.color.tint : 'transparent',
            })}
          >
            <AgentHubIcon color={tokens.color.inkMuted} name="x" size={18} />
          </Pressable>
        </View>
      </Surface>
    </View>
  );
}

function RunEvidenceSheet({
  run,
  visible,
  onClose,
}: {
  run: MobileRun | undefined;
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const preview = run?.browserPreview;
  const visibleFiles = run?.changedFiles.slice(0, 4) ?? [];
  const hiddenFileCount = run ? Math.max(0, run.changedFiles.length - visibleFiles.length) : 0;

  return (
    <BottomSheet
      title={t.evidenceInspector}
      visible={visible}
      onClose={onClose}
      primaryAction={{ label: t.close, onPress: onClose }}
    >
      {run ? (
        <View style={{ gap: tokens.space.md }}>
          <View style={{ gap: tokens.space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
              <StatusPill status={runStatusToPill(run.status)} />
              <Text style={{ color: tokens.color.inkSubtle, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
                {formatChatCopy(run.updatedAt)}
              </Text>
            </View>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.base, fontWeight: tokens.type.weight.medium, lineHeight: tokens.type.lineHeight.base }}>
              {formatChatCopy(run.title)}
            </Text>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
              {formatChatCopy(run.summary)}
            </Text>
          </View>
          <View style={{ gap: tokens.space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
              <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.medium }}>
                {t.changedFiles}
              </Text>
              <Badge label={`${run.changedFiles.length} ${t.fileBadge}`} size="micro" />
            </View>
            {visibleFiles.map((file) => (
              <View
                key={file}
                style={{
                  minHeight: 32,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: tokens.space.sm,
                  borderTopWidth: 1,
                  borderTopColor: tokens.color.line,
                  paddingVertical: tokens.space.xs,
                }}
              >
                <AgentHubIcon color={tokens.color.inkSubtle} name="file" size={14} />
                <Text numberOfLines={1} style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
                  {formatCompactFileName(file)}
                </Text>
              </View>
            ))}
            {hiddenFileCount > 0 ? <Badge label={`+${hiddenFileCount} ${t.additionalFiles}`} size="micro" tone="accent" /> : null}
          </View>
          <View style={{ gap: tokens.space.xs }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.medium }}>
              {t.browserPreview}
            </Text>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
              {formatChatCopy(preview?.description ?? t.browserPreviewDescription)}
            </Text>
            <Badge label={formatBrowserPreviewStatus(preview?.status, t)} tone={browserPreviewTone(preview?.status)} />
          </View>
        </View>
      ) : (
        <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
          {t.noRunSelected}
        </Text>
      )}
    </BottomSheet>
  );
}

function runStatusToPill(status: MobileRun['status']): 'running' | 'waiting' | 'failed' | 'completed' {
  if (status === 'approval_required') {
    return 'waiting';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'completed') {
    return 'completed';
  }

  return 'running';
}

function browserPreviewTone(status: NonNullable<MobileRun['browserPreview']>['status'] | undefined): 'neutral' | 'accent' | 'success' | 'danger' {
  if (status === 'ready') {
    return 'success';
  }
  if (status === 'error') {
    return 'danger';
  }
  if (status === 'loading') {
    return 'accent';
  }

  return 'neutral';
}

function formatBrowserPreviewStatus(status: NonNullable<MobileRun['browserPreview']>['status'] | undefined, t: ReturnType<typeof useStrings>): string {
  if (status === 'ready') {
    return t.browserPreviewReady;
  }
  if (status === 'error') {
    return t.browserPreviewError;
  }
  if (status === 'loading') {
    return t.browserPreviewLoading;
  }

  return t.browserPreviewEmpty;
}

function MessageBlock({
  block,
  compactWithPrevious,
}: {
  block: TranscriptBlock;
  compactWithPrevious: boolean;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const isReview =
    block.kind === 'diff' ||
    block.kind === 'approval' ||
    block.kind === 'run_session' ||
    block.kind === 'tool_call';
  const displayName = formatChatDisplayName(block.author.name, block.author.role);
  const isHuman = block.author.role === 'human' || displayName === 'Delicious233';
  const isText = block.kind === 'text';
  const avatar = getDisplayInitials(displayName);
  const reviewIcon =
    block.kind === 'diff'
      ? 'diff'
      : block.kind === 'approval'
        ? 'approval'
        : block.kind === 'tool_call'
          ? 'status'
          : 'runs';
  const showAvatar = isReview || !compactWithPrevious;

  return (
    <View
      style={{
        flexDirection: isHuman ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: tokens.space.xs,
        marginTop: compactWithPrevious ? -6 : 0,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: isReview ? 11 : isHuman ? 18 : 11,
          borderWidth: 1,
          borderColor: isReview ? tokens.color.accentSoft : tokens.color.line,
          backgroundColor: isHuman
            ? tokens.color.accentSoft
            : isReview
              ? tokens.color.warningSoft
              : tokens.color.surfaceStrong,
          opacity: showAvatar ? 1 : 0,
        }}
      >
        {!isHuman && displayName === 'AgentHub' ? (
          <AgentHubIcon color={isReview ? tokens.color.warning : tokens.color.accent} name={isReview ? reviewIcon : 'agent'} size={18} />
        ) : (
          <Text
            style={{
              color: isHuman ? tokens.color.accent : isReview ? tokens.color.warning : tokens.color.ink,
              fontSize: avatar.length > 1 ? 11 : 12,
              fontWeight: tokens.type.weight.medium,
            }}
          >
            {avatar}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityLabel={isReview ? getBlockTitle(block) : undefined}
        accessibilityRole={isReview ? 'button' : undefined}
        disabled={!isReview}
        onPress={isReview ? () => undefined : undefined}
        style={({ pressed }) => ({
          maxWidth: isReview ? '84%' : '78%',
          borderRadius: isReview ? 10 : 10,
          borderWidth: isReview ? 0.5 : 0,
          borderColor: pressed && isReview ? tokens.color.accentSoft : tokens.color.line,
          backgroundColor: pressed && isReview
            ? tokens.color.tint
            : isHuman
            ? tokens.color.accentSoft
            : isReview
              ? tokens.color.surfaceStrong
              : tokens.color.surface,
          paddingHorizontal: isReview ? 11 : 10,
          paddingVertical: isReview ? 8 : 7,
          gap: isReview ? tokens.space.xs : 2,
          opacity: pressed && isReview ? 0.92 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
          {isReview ? (
            <AgentHubIcon color={tokens.color.accent} name={reviewIcon} size={15} />
          ) : null}
          <Text
            numberOfLines={isReview ? 2 : 1}
            style={{
              flex: 1,
              color: isText ? tokens.color.inkMuted : tokens.color.ink,
              fontSize: isReview ? 12 : 12,
              fontWeight: tokens.type.weight.medium,
              lineHeight: isReview ? 17 : 16,
            }}
          >
            {getBlockTitle(block)}
          </Text>
          {block.createdAt ? (
            <Text style={{ color: tokens.color.inkSubtle, fontSize: 11 }}>
              {formatChatCopy(block.createdAt)}
            </Text>
          ) : null}
          {isReview ? (
            <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={14} />
          ) : null}
        </View>
        {isReview ? (
          <EvidenceBlockContent block={block} />
        ) : null}
        {!isReview ? (
          <Text
            style={{
              color: tokens.color.ink,
              fontSize: 14,
              lineHeight: 20,
              fontWeight: tokens.type.weight.regular,
            }}
          >
            {getBlockDetail(block, t)}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function EvidenceBlockContent({ block }: { block: TranscriptBlock }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  if (block.kind === 'approval') {
    return (
      <View style={{ gap: tokens.space.sm, borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: tokens.space.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
          <Badge label={formatEvidenceStatusLabel(block.status, t)} size="micro" tone={getEvidenceStatusTone(block.status)} />
          {block.risk ? <Badge label={formatApprovalRiskLabel(block.risk, t)} size="micro" tone={getApprovalTone(block.risk)} /> : null}
          {block.toolName ? <Badge label={formatChatCopy(block.toolName)} size="micro" /> : null}
        </View>
        {block.reason ? (
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
            {formatChatCopy(block.reason)}
          </Text>
        ) : null}
      </View>
    );
  }

  if (block.kind === 'diff') {
    const visibleFiles = block.files.slice(0, 2);
    const hiddenFileCount = Math.max(0, block.files.length - visibleFiles.length);

    return (
      <View style={{ gap: tokens.space.sm, borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: tokens.space.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
          <Badge label={`${block.files.length} ${t.fileBadge}`} size="micro" tone="accent" />
          <Badge label={`+${block.additions ?? 0}`} size="micro" tone="success" />
          <Badge label={`-${block.deletions ?? 0}`} size="micro" tone="danger" />
        </View>
        <View style={{ gap: tokens.space.xs }}>
          {visibleFiles.map((file) => (
            <View key={file} style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
              <AgentHubIcon color={tokens.color.inkMuted} name="file" size={13} />
              <Text numberOfLines={1} style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
                {formatCompactFileName(file)}
              </Text>
            </View>
          ))}
          {hiddenFileCount > 0 ? <Badge label={`+${hiddenFileCount} ${t.additionalFiles}`} size="micro" /> : null}
        </View>
      </View>
    );
  }

  if (block.kind === 'tool_call') {
    return (
      <View style={{ gap: tokens.space.sm, borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: tokens.space.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
          <Badge label={formatEvidenceStatusLabel(block.status, t)} size="micro" tone={getEvidenceStatusTone(block.status)} />
          {block.target ? <Badge label={`${t.scopeLabel}: ${formatSafeScopeLabel(block.target, t)}`} size="micro" /> : null}
        </View>
        {block.summary ? (
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
            {formatChatCopy(block.summary)}
          </Text>
        ) : null}
      </View>
    );
  }

  if (block.kind === 'run_session') {
    return (
      <View style={{ gap: tokens.space.sm, borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: tokens.space.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
          {block.status ? <Badge label={formatEvidenceStatusLabel(block.status, t)} size="micro" tone={getEvidenceStatusTone(block.status)} /> : null}
          {block.runId ? <Badge label={t.workflowRun} size="micro" tone="accent" /> : null}
        </View>
        {block.meta ? (
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
            {formatChatCopy(block.meta)}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
      {getBlockDetail(block, t)}
    </Text>
  );
}

function Composer({
  deliveryState,
  sendTo,
}: {
  deliveryState: 'idle' | 'sending' | 'failed';
  sendTo: string;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const [draft, setDraft] = useState('');
  const [actionsVisible, setActionsVisible] = useState(false);
  const canSend = draft.trim().length > 0;
  const deliveryTone = deliveryState === 'failed' ? 'danger' : 'accent';
  const actions = [
    { icon: 'file' as const, title: t.evidenceAttachment, subtitle: t.composerEvidenceDescription },
    { icon: 'approval' as const, title: t.composerReviewMode, subtitle: t.composerReviewDescription },
    { icon: 'agent' as const, title: t.agentPicker, subtitle: t.composerAgentDescription },
    { icon: 'settings' as const, title: t.composerFormat, subtitle: t.composerFormatDescription },
  ];

  return (
    <>
      <View
        style={{
          borderTopWidth: 0.5,
          borderTopColor: tokens.color.line,
          backgroundColor: tokens.color.panel,
          paddingHorizontal: tokens.space.sm,
          paddingTop: 7,
          paddingBottom: 8,
        }}
      >
        <View
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space.xs,
          }}
        >
          <Pressable
            accessibilityLabel={t.moreActions}
            accessibilityRole="button"
            accessibilityState={{ expanded: actionsVisible }}
            onPress={() => setActionsVisible((visible) => !visible)}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              borderWidth: actionsVisible ? 1 : 0,
              borderColor: tokens.color.accentSoft,
              backgroundColor: pressed || actionsVisible ? tokens.color.accentSoft : 'transparent',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <AgentHubIcon color={actionsVisible ? tokens.color.accent : tokens.color.inkMuted} name="plusCircle" size={22} />
          </Pressable>
          <View
            style={{
              minHeight: 44,
              flex: 1,
              justifyContent: 'center',
              borderRadius: 18,
              backgroundColor: tokens.color.surfaceStrong,
              paddingHorizontal: 13,
            }}
          >
          <TextInput
            multiline
            placeholder={sendTo}
            placeholderTextColor={tokens.color.inkSubtle}
            value={draft}
            onChangeText={setDraft}
            style={{
              maxHeight: 108,
              color: tokens.color.ink,
              ...tokens.type.role.composer,
              minHeight: 40,
              textAlignVertical: 'center',
            }}
          />
          </View>
          <Pressable
            accessibilityLabel={t.sendMessage}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => setDraft('')}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              backgroundColor: canSend ? tokens.color.accent : 'transparent',
              opacity: canSend ? (pressed ? 0.86 : 1) : 0.45,
            })}
          >
            <AgentHubIcon color={canSend ? tokens.color.onAccent : tokens.color.inkMuted} name="send" size={22} />
          </Pressable>
        </View>
        {deliveryState !== 'idle' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs, paddingHorizontal: tokens.space.md, paddingTop: 4 }}>
            <Badge
              label={deliveryState === 'sending' ? t.runningStatus : t.failed}
              size="micro"
              tone={deliveryTone}
            />
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: deliveryState === 'sending' ? tokens.color.inkMuted : tokens.color.danger,
                ...tokens.type.role.caption,
                fontWeight: tokens.type.weight.medium,
              }}
            >
              {deliveryState === 'sending' ? t.sendPendingMessage : t.sendFailedMessage}
            </Text>
          </View>
        ) : null}
      </View>
      <BottomSheet
        title={t.composerActionsTitle}
        visible={actionsVisible}
        onClose={() => setActionsVisible(false)}
        primaryAction={{ label: t.close, onPress: () => setActionsVisible(false) }}
      >
        <View style={{ gap: tokens.space.xs }}>
          {actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action.title}
              onPress={() => setActionsVisible(false)}
              style={({ pressed }) => ({
                minHeight: 58,
                flexDirection: 'row',
                alignItems: 'center',
                gap: tokens.space.sm,
                borderWidth: 1,
                borderColor: pressed ? tokens.color.accentSoft : tokens.color.line,
                borderRadius: tokens.radius.panel,
                backgroundColor: pressed ? tokens.color.tint : tokens.color.surfaceStrong,
                paddingHorizontal: tokens.space.md,
                paddingVertical: tokens.space.sm,
                opacity: pressed ? 0.94 : 1,
              })}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 16,
                  backgroundColor: tokens.color.accentSoft,
                }}
              >
                <AgentHubIcon color={tokens.color.accent} name={action.icon} size={18} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: tokens.color.ink, ...tokens.type.role.rowTitle }}>
                  {action.title}
                </Text>
                <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, ...tokens.type.role.meta }}>
                  {action.subtitle}
                </Text>
              </View>
              <AgentHubIcon color={tokens.color.inkSubtle} name="chevronRight" size={16} />
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}
