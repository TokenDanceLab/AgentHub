import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createHubClient } from '@/api/hubClient';
import { createHubEventStream, type HubEventStream, type HubWebSocketLike } from '@/api/hubEvents';
import { AppShell } from '@/components/layout';
import { AgentHubIcon } from '@/components/icons';
import { Badge, Button, StatusPill, Surface } from '@/components/primitives';
import {
  getMobileFixtureForScenario,
  getPendingReviewCount,
  getThreadRun,
  getUnreadThreadCount,
} from '@/data/mobileFixtures';
import { useStrings } from '@/i18n/strings';
import { AccountScreen, ChatScreen, TasksScreen, ThreadsScreen, WorkbenchSurfaceScreen } from '@/screens';
import { AgentHubThemeProvider, useAgentHubTheme } from '@/theme';
import type {
  MobileAppFixture,
  MobileAccountState,
  MobileFixtureScenario,
  MobileInspectorSheetMode,
  MobileRun,
  MobileTab,
  MobileThemeMode,
} from '@/types';

interface PreviewOptions {
  scenario: MobileFixtureScenario;
  sheetMode?: MobileInspectorSheetMode;
  tab?: MobileTab;
  threadId?: string;
  runId?: string;
}

type TabletInspectorMode = 'overview' | 'files' | 'browser';

function MobileAppContent({ preview }: { preview: PreviewOptions }): React.ReactElement {
  const fallbackFixture = useMemo(() => getMobileFixtureForScenario(preview.scenario), [preview.scenario]);
  const localPreviewEnabled = shouldUseLocalHubPreview(preview);
  const localPreviewBaseUrl = localPreviewEnabled ? getLocalPreviewHubBaseUrl() : undefined;
  const localPreviewKey = [
    preview.scenario,
    preview.sheetMode ?? '',
    preview.tab ?? '',
    preview.threadId ?? '',
    preview.runId ?? '',
    localPreviewBaseUrl ?? '',
  ].join('|');
  const [localHubSnapshot, setLocalHubSnapshot] = useState<{ key: string; fixture: MobileAppFixture }>();
  const fixture = localPreviewEnabled && localHubSnapshot?.key === localPreviewKey
    ? localHubSnapshot.fixture
    : fallbackFixture;
  const { mode, setMode, tokens } = useAgentHubTheme();
  const { width } = useWindowDimensions();
  const useSplitPane = width >= 700;
  const useInspectorPane = width >= 1024;
  const [activeTab, setActiveTab] = useState<MobileTab>(preview.tab ?? inferInitialTab(preview.scenario));
  const [accountReturnTab, setAccountReturnTab] = useState<MobileTab>('chat');
  const [selectedThreadId, setSelectedThreadId] = useState(preview.threadId ?? fixture.threads[0]?.id ?? '');
  const [selectedRunId, setSelectedRunId] = useState(preview.runId ?? fixture.runs[0]?.id ?? '');
  const counters = useMemo(
    () => ({
      pendingReviews: getPendingReviewCount(fixture),
      unreadThreads: getUnreadThreadCount(fixture),
    }),
    [fixture],
  );

  useEffect(() => {
    let cancelled = false;
    let stream: HubEventStream | undefined;

    if (!localPreviewEnabled || !localPreviewBaseUrl) {
      return () => {
        cancelled = true;
      };
    }

    const client = createHubClient({ baseUrl: localPreviewBaseUrl });
    const loadSnapshot = () => {
      client.getMobileSnapshot().then((snapshot) => {
        if (!cancelled) {
          setLocalHubSnapshot({ key: localPreviewKey, fixture: snapshot });
          setSelectedThreadId((current) => (
            snapshot.threads.some((thread) => thread.id === current)
              ? current
              : (snapshot.threads[0]?.id ?? '')
          ));
          setSelectedRunId((current) => (
            snapshot.runs.some((run) => run.id === current)
              ? current
              : (snapshot.runs[0]?.id ?? '')
          ));
        }
      }).catch(() => {
        if (!cancelled) {
          setLocalHubSnapshot(undefined);
        }
      });
    };

    loadSnapshot();

    const createWebSocket = getPreviewWebSocketFactory();
    if (createWebSocket) {
      stream = createHubEventStream({
        baseUrl: localPreviewBaseUrl,
        createWebSocket,
        onEvent(event) {
          if (
            event.type === 'snapshot.updated'
            || event.type === 'thread.updated'
            || event.type === 'run.updated'
            || event.type === 'approval.updated'
          ) {
            loadSnapshot();
          }
        },
      });
    }

    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [
    localPreviewBaseUrl,
    localPreviewEnabled,
    localPreviewKey,
  ]);

  const openAccountDrawer = () => {
    setAccountReturnTab(activeTab === 'account' ? 'chat' : activeTab);
    setActiveTab('account');
  };
  const openThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    if (!useSplitPane) {
      setActiveTab('thread');
    }
  };
  const selectedThreadRun = getThreadRun(fixture, selectedThreadId);
  const splitPaneChat = (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        backgroundColor: tokens.color.canvas,
      }}
    >
      <View
        testID="tablet-thread-list-pane"
        style={{
          width: width >= 1024 ? 360 : 312,
          maxWidth: '44%',
          minWidth: 280,
          borderRightWidth: 1,
          borderRightColor: tokens.color.line,
        }}
      >
        <ThreadsScreen
          fixture={fixture}
          selectedThreadId={selectedThreadId}
          onOpenAccount={openAccountDrawer}
          onSelectThread={openThread}
        />
      </View>
      <View
        testID="tablet-thread-transcript-pane"
        style={{
          flex: 1,
          minWidth: 0,
          borderRightWidth: useInspectorPane ? 1 : 0,
          borderRightColor: tokens.color.line,
        }}
      >
        <ChatScreen
          fixture={fixture}
          selectedThreadId={selectedThreadId}
          showBack={false}
          onBack={() => setActiveTab('chat')}
          onOpenRuns={() => setActiveTab('tasks')}
        />
      </View>
      {useInspectorPane ? (
        <View
          testID="tablet-thread-inspector-pane"
          style={{
            width: width >= 1180 ? 340 : 304,
            maxWidth: '32%',
            minWidth: 292,
            backgroundColor: tokens.color.canvas,
          }}
        >
          <TabletInspectorPane account={fixture.account} run={selectedThreadRun} />
        </View>
      ) : null}
    </View>
  );

  const content = {
    chat: useSplitPane ? splitPaneChat : (
      <ThreadsScreen
        fixture={fixture}
        selectedThreadId={selectedThreadId}
        onOpenAccount={openAccountDrawer}
        onSelectThread={openThread}
      />
    ),
    contacts: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="contacts"
      />
    ),
    docs: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="docs"
      />
    ),
    agents: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="agents"
      />
    ),
    tasks: (
      <TasksScreen
        fixture={fixture}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
        {...(preview.sheetMode ? { initialSheetMode: preview.sheetMode } : {})}
      />
    ),
    projects: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="projects"
      />
    ),
    settings: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="settings"
      />
    ),
    more: (
      <WorkbenchSurfaceScreen
        onNavigate={setActiveTab}
        onOpenAccount={openAccountDrawer}
        pendingReviews={counters.pendingReviews}
        surface="more"
      />
    ),
    thread: useSplitPane ? splitPaneChat : (
      <ChatScreen
        fixture={fixture}
        selectedThreadId={selectedThreadId}
        showBack
        onBack={() => setActiveTab('chat')}
        onOpenRuns={() => setActiveTab('tasks')}
      />
    ),
    account: (
      <AccountScreen
        account={fixture.account}
        themeMode={mode}
        onChangeThemeMode={setMode}
        onClose={() => setActiveTab(accountReturnTab)}
      />
    ),
  } satisfies Record<MobileTab, React.ReactNode>;

  return (
    <>
      <StatusBar style={tokens.scheme === 'light' ? 'dark' : 'light'} />
      <AppShell
        activeTab={useSplitPane && activeTab === 'thread' ? 'chat' : activeTab}
        hideTabs={!useSplitPane && (activeTab === 'thread' || activeTab === 'account')}
        onChangeTab={setActiveTab}
        pendingReviews={counters.pendingReviews}
        unreadThreads={counters.unreadThreads}
      >
        {content[activeTab]}
      </AppShell>
    </>
  );
}

function runStatusToPill(status: MobileRun['status']): 'running' | 'waiting' | 'failed' | 'completed' {
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

function TabletInspectorPane({
  account,
  run,
}: {
  account: MobileAccountState;
  run: MobileRun | undefined;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const [activeMode, setActiveMode] = useState<TabletInspectorMode>('overview');

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <View
        style={{
          minHeight: 64,
          justifyContent: 'center',
          borderBottomWidth: 1,
          borderBottomColor: tokens.color.line,
          backgroundColor: tokens.color.panel,
          paddingHorizontal: tokens.space.md,
          paddingTop: tokens.space.sm,
        }}
      >
        <Text
          style={{
            color: tokens.color.inkMuted,
            fontSize: tokens.type.xs,
            fontWeight: tokens.type.weight.semibold,
            lineHeight: tokens.type.lineHeight.xs,
            textTransform: 'uppercase',
          }}
        >
          {t.runInspector}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: tokens.type.sm,
            fontWeight: tokens.type.weight.semibold,
            lineHeight: tokens.type.lineHeight.sm,
          }}
        >
          {run?.title ?? t.noRunSelected}
        </Text>
      </View>
      <View
        accessibilityLabel={t.inspectorTabs}
        style={{
          minHeight: 46,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space.xs,
          borderBottomWidth: 1,
          borderBottomColor: tokens.color.line,
          backgroundColor: tokens.color.panel,
          paddingHorizontal: tokens.space.sm,
        }}
      >
        {(
          [
            { mode: 'overview', icon: 'overview', label: t.inspectorOverview },
            { mode: 'files', icon: 'file', label: t.inspectorFiles },
            { mode: 'browser', icon: 'browser', label: t.inspectorBrowser },
          ] as const
        ).map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeMode === item.mode }}
            key={item.mode}
            onPress={() => setActiveMode(item.mode)}
            style={({ pressed }) => ({
              minHeight: 44,
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: tokens.space.xs,
              borderRadius: tokens.radius.control,
              backgroundColor: activeMode === item.mode
                ? tokens.color.accentSoft
                : pressed
                  ? tokens.color.tint
                  : 'transparent',
            })}
          >
            <AgentHubIcon
              color={activeMode === item.mode ? tokens.color.accent : tokens.color.inkMuted}
              name={item.icon}
              size={15}
            />
            <Text
              numberOfLines={1}
              style={{
                color: activeMode === item.mode ? tokens.color.accent : tokens.color.inkMuted,
                fontSize: tokens.type.xs,
                fontWeight: tokens.type.weight.semibold,
                lineHeight: tokens.type.lineHeight.xs,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.space.md,
          padding: tokens.space.md,
          paddingBottom: tokens.space.xl,
        }}
      >
        {run ? (
          <TabletInspectorContent account={account} mode={activeMode} run={run} />
        ) : (
          <Surface style={{ padding: tokens.space.md }}>
            <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
              {t.noRunSelected}
            </Text>
          </Surface>
        )}
      </ScrollView>
    </View>
  );
}

function TabletInspectorContent({
  account,
  mode,
  run,
}: {
  account: MobileAccountState;
  mode: TabletInspectorMode;
  run: MobileRun;
}): React.ReactElement {
  if (mode === 'files') {
    return <TabletInspectorFiles run={run} />;
  }

  if (mode === 'browser') {
    return <TabletInspectorBrowser run={run} />;
  }

  return <TabletInspectorOverview account={account} run={run} />;
}

function TabletInspectorOverview({
  account,
  run,
}: {
  account: MobileAccountState;
  run: MobileRun;
}): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <>
      <Surface emphasis="strong" style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
          <StatusPill status={runStatusToPill(run.status)} />
          <Text style={{ color: tokens.color.inkSubtle, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
            {run.updatedAt}
          </Text>
        </View>
        <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
          {run.summary}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
          <Badge label={`${t.scopeLabel}: ${formatUserScopeLabel(run.target, t)}`} tone="accent" />
          {run.approvalRisk ? <Badge label={`${t.approvalBadge}: ${formatRiskLabel(run.approvalRisk, t)}`} tone="warning" /> : null}
        </View>
        {run.statusDetail ? (
          <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
            {run.statusDetail}
          </Text>
        ) : null}
        {run.status === 'approval_required' ? (
          <Button
            icon="approval"
            label={t.reviewApproval}
            onPress={() => undefined}
            variant="secondary"
          />
        ) : null}
      </Surface>
      <Surface emphasis="tint" style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
          {t.hubSession}
        </Text>
        <InspectorMetaRow label={t.tokenDanceIdentity} value={formatIdentityStatus(account.tokenDanceId, t)} />
        <InspectorMetaRow label={t.hubSyncStatus} value={formatHubSyncStatus(account.hubSync, t)} />
        <InspectorMetaRow label={t.notificationPermission} value={formatNotificationStatus(account.notification, t)} />
      </Surface>
    </>
  );
}

function TabletInspectorFiles({ run }: { run: MobileRun }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const previewFile = run.filePreview?.selectedPath ?? run.changedFiles[0];
  const visibleFiles = run.changedFiles.slice(0, 8);
  const hiddenFileCount = Math.max(0, run.changedFiles.length - visibleFiles.length);
  const diffLines = run.filePreview?.diffLines ?? [
    { type: 'add' as const, content: `+ ${t.mobileInspectorDiffLine}` },
    { type: 'ctx' as const, content: t.diffPreview },
  ];

  return (
    <>
      <Surface style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
            {t.changedFiles}
          </Text>
          <Badge label={`${run.changedFiles.length} ${t.fileBadge}`} />
        </View>
        {visibleFiles.length > 0 ? visibleFiles.map((file) => (
          <View
            key={file}
            testID={file === previewFile ? 'tablet-file-row-selected' : 'tablet-file-row'}
            style={{
              minHeight: 38,
              flexDirection: 'row',
              alignItems: 'center',
              gap: tokens.space.xs,
              borderTopWidth: 1,
              borderTopColor: file === previewFile ? tokens.color.accentSoft : tokens.color.line,
              backgroundColor: file === previewFile ? tokens.color.tint : 'transparent',
              paddingTop: tokens.space.xs,
            }}
          >
            <AgentHubIcon color={file === previewFile ? tokens.color.accent : tokens.color.inkMuted} name="file" size={15} />
            <Text
              numberOfLines={2}
              style={{
                flex: 1,
                color: file === previewFile ? tokens.color.ink : tokens.color.inkMuted,
                fontSize: tokens.type.xs,
                lineHeight: tokens.type.lineHeight.xs,
              }}
            >
              {file}
            </Text>
          </View>
        )) : (
          <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.sm, lineHeight: tokens.type.lineHeight.sm }}>
            {t.noChangedFiles}
          </Text>
        )}
        {hiddenFileCount > 0 ? <Badge label={`+${hiddenFileCount} ${t.additionalFiles}`} tone="accent" /> : null}
      </Surface>
      {previewFile ? (
        <Surface emphasis="strong" style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs }}>
            <AgentHubIcon color={tokens.color.accent} name="diff" size={16} />
            <Text style={{ flex: 1, color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
              {t.readonlyFilePreview}
            </Text>
          </View>
          <Text numberOfLines={2} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
            {previewFile}
          </Text>
          <View
            style={{
              borderWidth: 1,
              borderColor: tokens.color.line,
              borderRadius: tokens.radius.control,
              backgroundColor: tokens.color.canvas,
              padding: tokens.space.sm,
              gap: tokens.space.xs,
            }}
          >
            {diffLines.map((line, index) => {
              const color = line.type === 'add'
                ? tokens.color.moss
                : line.type === 'del'
                  ? tokens.color.danger
                  : tokens.color.inkMuted;

              return (
                <Text
                  key={`${line.type}-${index}`}
                  numberOfLines={2}
                  style={{ color, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}
                >
                  {line.content}
                </Text>
              );
            })}
          </View>
        </Surface>
      ) : null}
    </>
  );
}

function TabletInspectorBrowser({ run }: { run: MobileRun }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const preview = run.browserPreview ?? {
    status: 'empty' as const,
    description: t.browserPreviewDescription,
  };
  const previewTone = preview.status === 'ready'
    ? 'success'
    : preview.status === 'error'
      ? 'danger'
      : preview.status === 'loading'
        ? 'accent'
        : 'neutral';
  const previewLabel = preview.status === 'ready'
    ? t.browserPreviewReady
    : preview.status === 'error'
      ? t.browserPreviewError
      : preview.status === 'loading'
        ? t.browserPreviewLoading
        : t.browserPreviewEmpty;

  return (
    <>
      <Surface emphasis="strong" style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm }}>
          <View
            style={{
              width: 34,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              backgroundColor: tokens.color.accentSoft,
            }}
          >
            <AgentHubIcon color={tokens.color.accent} name="browser" size={19} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
              {t.browserPreview}
            </Text>
            <Text numberOfLines={1} style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
              {preview.url ?? t.browserPreviewDescription}
            </Text>
          </View>
        </View>
        <View
          testID={`tablet-browser-preview-${preview.status}`}
          style={{
            minHeight: 104,
            borderWidth: 1,
            borderColor: tokens.color.line,
            borderRadius: tokens.radius.panel,
            backgroundColor: tokens.color.canvas,
            padding: tokens.space.md,
            gap: tokens.space.xs,
          }}
        >
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
            {preview.title ?? t.artifactPreview}
          </Text>
          <Text style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
            {preview.description ?? t.browserPreviewDescription}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs }}>
            <Badge label={previewLabel} tone={previewTone} />
            <Badge label={`${run.evidenceCount ?? run.changedFiles.length} ${t.taskEvidence}`} tone="accent" />
            {preview.status === 'error' ? <Badge label={t.retryPreview} tone="warning" /> : null}
          </View>
        </View>
      </Surface>
      <Surface style={{ gap: tokens.space.sm, padding: tokens.space.md }}>
        <Text style={{ color: tokens.color.ink, fontSize: tokens.type.sm, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.sm }}>
          {t.remoteTargetStatus}
        </Text>
        <InspectorMetaRow label={t.scopeLabel} value={formatUserScopeLabel(run.target, t)} />
        <InspectorMetaRow label={t.status} value={formatRunStatusLabel(run.status, t)} />
      </Surface>
    </>
  );
}

function formatUserScopeLabel(scope: string, t: ReturnType<typeof useStrings>): string {
  if (scope.includes('mobile-rn')) {
    return t.mobileWorkspaceScope;
  }
  if (scope.includes('hub-server')) {
    return t.hubServiceScope;
  }
  if (scope.toLowerCase().includes('tokendance')) {
    return 'TokenDance';
  }

  return 'AgentHub';
}

function formatRiskLabel(risk: MobileRun['approvalRisk'], t: ReturnType<typeof useStrings>): string {
  if (risk === 'critical' || risk === 'high') {
    return t.blocked;
  }
  if (risk === 'medium') {
    return t.needsAction;
  }
  if (risk === 'low') {
    return t.reviewApproval;
  }

  return t.reviewApproval;
}

function formatRunStatusLabel(status: MobileRun['status'], t: ReturnType<typeof useStrings>): string {
  if (status === 'approval_required') {
    return t.reviewRequired;
  }
  if (status === 'running' || status === 'queued') {
    return t.runningStatus;
  }
  if (status === 'failed') {
    return t.failed;
  }
  if (status === 'completed') {
    return t.done;
  }

  return t.status;
}

function formatIdentityStatus(status: MobileAccountState['tokenDanceId'], t: ReturnType<typeof useStrings>): string {
  if (status === 'signed_in') {
    return t.signedIn;
  }
  if (status === 'recovering') {
    return t.recovering;
  }

  return t.signedOut;
}

function formatNotificationStatus(status: MobileAccountState['notification'], t: ReturnType<typeof useStrings>): string {
  if (status === 'granted') {
    return t.done;
  }
  if (status === 'prompt') {
    return t.needsAction;
  }

  return t.blocked;
}

function InspectorMetaRow({ label, value }: { label: string; value: string }): React.ReactElement {
  const { tokens } = useAgentHubTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm }}>
      <Text style={{ flex: 1, color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}>
        {label}
      </Text>
      <Text style={{ color: tokens.color.ink, fontSize: tokens.type.xs, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.xs }}>
        {value}
      </Text>
    </View>
  );
}

function inferInitialTab(scenario: MobileFixtureScenario): MobileTab {
  if (
    scenario === 'deeplink'
    || scenario === 'offline'
    || scenario === 'sendError'
    || scenario === 'sendPending'
    || scenario === 'diffPreview'
  ) {
    return 'thread';
  }
  if (scenario === 'notification' || scenario === 'approvalPending' || scenario === 'approvalError' || scenario === 'approvalResolved') {
    return 'tasks';
  }

  return 'chat';
}

function getPreviewOptions(): PreviewOptions {
  const search = (globalThis as typeof globalThis & { location?: { search?: string } }).location?.search;
  const params = new URLSearchParams(search ?? '');
  const scenario = params.get('scenario');
  const tab = params.get('tab');
  const threadId = params.get('thread');
  const runId = params.get('run');
  const sheet = params.get('sheet');
  const preview: PreviewOptions = {
    scenario: isMobileFixtureScenario(scenario) ? scenario : 'default',
  };

  const normalizedTab = normalizeMobileTab(tab);
  const normalizedSheet = normalizeInspectorSheetMode(sheet);
  if (normalizedTab) {
    preview.tab = normalizedTab;
  }
  if (normalizedSheet) {
    preview.sheetMode = normalizedSheet;
  }
  if (threadId) {
    preview.threadId = threadId;
  }
  if (runId) {
    preview.runId = runId;
  }

  return preview;
}

function shouldUseLocalHubPreview(preview: PreviewOptions): boolean {
  return preview.scenario === 'default'
    && !preview.sheetMode
    && !preview.tab
    && !preview.threadId
    && !preview.runId
    && isBrowserPreviewRuntime();
}

function getLocalPreviewHubBaseUrl(): string {
  const location = (globalThis as typeof globalThis & {
    location?: { search?: string };
  }).location;
  const paramValue = new URLSearchParams(location?.search ?? '').get('hubBaseUrl')?.trim();

  return paramValue || 'http://127.0.0.1:8088';
}

function isBrowserPreviewRuntime(): boolean {
  return typeof (globalThis as typeof globalThis & { window?: unknown }).window !== 'undefined';
}

function getPreviewWebSocketFactory(): ((url: string) => HubWebSocketLike) | undefined {
  const WebSocketCtor = (globalThis as typeof globalThis & {
    WebSocket?: new (url: string) => HubWebSocketLike;
  }).WebSocket;

  if (!WebSocketCtor) {
    return undefined;
  }

  return (url: string) => new WebSocketCtor(url) as unknown as HubWebSocketLike;
}

function formatHubSyncStatus(
  status: MobileAccountState['hubSync'],
  t: ReturnType<typeof useStrings>,
): string {
  if (status === 'active') {
    return t.online;
  }
  if (status === 'recovering') {
    return t.recovering;
  }

  return t.offline;
}

function normalizeInspectorSheetMode(value: string | null): MobileInspectorSheetMode | undefined {
  if (
    value === 'review'
    || value === 'approveConfirm'
    || value === 'rejectConfirm'
    || value === 'approvalError'
  ) {
    return value;
  }

  return undefined;
}

function getPreviewThemeMode(): MobileThemeMode | undefined {
  const search = (globalThis as typeof globalThis & { location?: { search?: string } }).location?.search;
  const theme = new URLSearchParams(search ?? '').get('theme');

  return theme === 'dark' || theme === 'oled' || theme === 'light' ? theme : undefined;
}

function isMobileFixtureScenario(value: string | null): value is MobileFixtureScenario {
  return value === 'default'
    || value === 'empty'
    || value === 'offline'
    || value === 'notification'
    || value === 'deeplink'
    || value === 'sendError'
    || value === 'sendPending'
    || value === 'approvalPending'
    || value === 'approvalError'
    || value === 'approvalResolved'
    || value === 'diffPreview'
    || value === 'previewMatrix';
}

function normalizeMobileTab(value: string | null): MobileTab | undefined {
  if (value === 'messages') {
    return 'chat';
  }
  if (value === 'conversation' || value === 'threadDetail') {
    return 'thread';
  }
  if (value === 'runs' || value === 'run' || value === 'approvals' || value === 'approval' || value === 'activity' || value === 'targets') {
    return 'tasks';
  }
  if (isMobileTab(value)) {
    return value;
  }

  return undefined;
}

function isMobileTab(value: string | null): value is MobileTab {
  return value === 'chat'
    || value === 'thread'
    || value === 'contacts'
    || value === 'docs'
    || value === 'agents'
    || value === 'tasks'
    || value === 'projects'
    || value === 'settings'
    || value === 'more'
    || value === 'account';
}

export default function App(): React.ReactElement {
  const preview = getPreviewOptions();

  return (
    <SafeAreaProvider>
      <AgentHubThemeProvider initialMode={getPreviewThemeMode() ?? 'light'}>
        <MobileAppContent preview={preview} />
      </AgentHubThemeProvider>
    </SafeAreaProvider>
  );
}
