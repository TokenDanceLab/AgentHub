import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createHubClient } from '@/api/hubClient';
import { createHubEventStream, type HubEventStream, type HubWebSocketLike } from '@/api/hubEvents';
import { AppShell, BottomTabs } from '@/components/layout';
import { AgentHubIcon } from '@/components/icons';
import { Badge, Button, EmptyState, ErrorBoundary, StatusPill, Surface } from '@/components/primitives';
import {
  startExpoAgentHubDeepLinkBridge,
  type AgentHubDeepLinkBridge,
} from '@/integrations/deepLinking';
import {
  startExpoAgentHubNotificationBridge,
  type AgentHubNotificationBridge,
} from '@/integrations/notificationBridge';
import type { MobileNavigationTarget } from '@/integrations/notificationIntents';
import { reduceNavigationTarget } from '@/navigation/navigationRouting';
import {
  registerExpoForPushNotificationsAsync,
  type PushPermissionState,
} from '@/pushRegistration';
import { createExpoMobileAuthSession, type CreateExpoMobileAuthSessionResult } from '@/session/mobileAuthSession';
import type { HubSessionSnapshot } from '@/session/sessionState';
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

type LocalPreviewPhase = 'loading' | 'live' | 'unavailable';

/**
 * What the preview renders while the local preview data plane is loading or
 * unavailable. Deliberately NOT the rich default fixture: rendering fixture
 * content while the mock Hub is unreachable would silently fake a green run.
 */
const previewDegradedFixture: MobileAppFixture = {
  threads: [],
  runs: [],
  transcript: {},
  account: {
    tokenDanceId: 'recovering',
    hubSession: 'missing',
    notification: 'prompt',
    hubSync: 'offline',
    deviceLabel: 'Preview data unavailable',
  },
};

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
  const [localPreviewPhase, setLocalPreviewPhase] = useState<LocalPreviewPhase>(
    localPreviewEnabled ? 'loading' : 'live',
  );
  const [liveFixture, setLiveFixture] = useState<MobileAppFixture>();
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  const fixture = !localPreviewEnabled
    ? fallbackFixture
    : localPreviewPhase === 'live' && liveFixture
      ? liveFixture
      : previewDegradedFixture;
  const { mode, setMode, tokens } = useAgentHubTheme();
  const { width } = useWindowDimensions();
  const useSplitPane = width >= 700;
  const useInspectorPane = width >= 1024;
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const showInspector = useInspectorPane && !inspectorCollapsed;
  const [activeTab, setActiveTab] = useState<MobileTab>(preview.tab ?? inferInitialTab(preview.scenario));
  const [accountReturnTab, setAccountReturnTab] = useState<MobileTab>('chat');
  const [selectedThreadId, setSelectedThreadId] = useState(preview.threadId ?? fixture.threads[0]?.id ?? '');
  const [selectedRunId, setSelectedRunId] = useState(preview.runId ?? fixture.runs[0]?.id ?? '');
  const [pushPermission, setPushPermission] = useState<PushPermissionState | undefined>();
  // Real Hub session state (SecureStore-backed, #1824): overrides the fixture
  // account surface once the auth assembly is mounted. `missing` so the demo
  // never claims a live session before one exists.
  const [hubSessionStatus, setHubSessionStatus] = useState<Extract<HubSessionSnapshot['status'], 'active' | 'missing'>>('missing');
  const [authHandle, setAuthHandle] = useState<CreateExpoMobileAuthSessionResult | undefined>();
  const [authPhase, setAuthPhase] = useState<'idle' | 'signing_in' | 'signing_out'>('idle');
  const [launchSheetMode, setLaunchSheetMode] = useState<MobileInspectorSheetMode | undefined>();
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
      client.getPreviewSnapshot().then((snapshot) => {
        if (cancelled) {
          return;
        }
        setLiveFixture(snapshot);
        setLocalPreviewPhase('live');
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
      }).catch(() => {
        if (!cancelled) {
          // Fail loudly: never fall back to the rich fixture when the
          // preview data plane is unreachable — that would fake a green run.
          setLiveFixture(undefined);
          setLocalPreviewPhase('unavailable');
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
    snapshotReloadKey,
  ]);

  // Mount-once push registration (#1824): request notification permission and
  // grab the Expo push token for LOCAL notification handling. Deliberately no
  // Hub device registration here — verified (lane C-1824) that hub-server has
  // no push delivery facility (no FCM/APNs/Expo push consumer, no push_token
  // field on registerDevice), so forwarding tokens would be a half-wired
  // claim. The real permission state drives the account surface; delivery is
  // local only until the Hub side lands a delivery path.
  useEffect(() => {
    let cancelled = false;
    registerExpoForPushNotificationsAsync()
      .then((result) => {
        if (!cancelled) {
          setPushPermission(result.status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPushPermission('unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Latest-value ref so the bridge event handlers never read a stale closure
  // state while still keeping the reducer testable (#1824 deep link routing).
  const navigationRef = useRef<{ activeTab: MobileTab; threadId: string; runId: string }>({
    activeTab,
    threadId: selectedThreadId,
    runId: selectedRunId,
  });
  useEffect(() => {
    navigationRef.current = { activeTab, threadId: selectedThreadId, runId: selectedRunId };
  });

  const applyMobileNavigationTarget = (target: MobileNavigationTarget) => {
    const route = reduceNavigationTarget(navigationRef.current, target);
    setActiveTab(route.activeTab);
    if (route.threadId) {
      setSelectedThreadId(route.threadId);
    }
    if (route.runId) {
      setSelectedRunId(route.runId);
    }
    setLaunchSheetMode(route.approvalSheetMode);
  };

  // Mount-once auth assembly (#1824): the shared Hub auth state machine
  // (createHubAuthCore) with SecureStore ports + the deep-link OIDC callback
  // channel, plus the notification bridge so push click intents route
  // in-app. Cold start restores the stored session; every transition is
  // reflected in hubSessionStatus so the account surface can stop claiming
  // fixture-only sign-in states. Best-effort: native module or network
  // failures do not crash the app; the local fixture remains the UI fallback.
  useEffect(() => {
    let cancelled = false;
    let deepLinkBridge: AgentHubDeepLinkBridge | undefined;
    let notificationBridge: AgentHubNotificationBridge | undefined;
    const baseUrl = resolveAppHubBaseUrl();

    createExpoMobileAuthSession(baseUrl)
      .then((assembly) => {
        if (cancelled) return;
        setAuthHandle(assembly);
        assembly.authSession.subscribe((snapshot) => {
          if (!cancelled) {
            setHubSessionStatus(snapshot.status === 'active' ? 'active' : 'missing');
          }
        });
        return startExpoAgentHubDeepLinkBridge({
          onAuthCallback(callback) {
            // Authorization responses arrive via the deep-link bridge; the
            // auth ports validate state + expiry against the pending login.
            if (callback.kind !== 'success') return;
            assembly.handleIncomingOidcCallback({ code: callback.code, state: callback.state });
          },
          onNavigate: applyMobileNavigationTarget,
          onIgnored: () => undefined,
          onError: () => undefined,
        })
          .then((started) => {
            if (cancelled) return;
            deepLinkBridge = started;
            return startExpoAgentHubNotificationBridge({
              onNavigate: applyMobileNavigationTarget,
            }).then((startedNotifications) => {
              if (!cancelled) {
                notificationBridge = startedNotifications;
              }
            });
          })
          .catch(() => {
            /* notifications module unavailable in this runtime — skip */
          })
          .then(() => assembly.authSession.restore())
          .then((snapshot) => {
            if (!cancelled) {
              setHubSessionStatus(snapshot.status === 'active' ? 'active' : 'missing');
            }
          })
          .catch(() => {
            /* restore failure surfaces as missing; fixture stays the fallback */
          });
      })
      .catch(() => {
        /* native modules unavailable in this runtime — skip assembly */
      });

    return () => {
      cancelled = true;
      deepLinkBridge?.stop();
      notificationBridge?.stop();
    };
  }, []);

  const handleSignIn = async () => {
    if (!authHandle || authPhase !== 'idle') return;
    setAuthPhase('signing_in');
    try {
      const snapshot = await authHandle.authSession.login();
      setHubSessionStatus(snapshot.status === 'active' ? 'active' : 'missing');
    } catch {
      /* OIDC failure (state mismatch / expiry / exchange) leaves status missing */
    } finally {
      setAuthPhase('idle');
    }
  };

  const handleSignOut = async () => {
    if (!authHandle || authPhase !== 'idle') return;
    setAuthPhase('signing_out');
    try {
      await authHandle.authSession.logout();
    } finally {
      setHubSessionStatus('missing');
      setAuthPhase('idle');
    }
  };

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
  // Real account surface (#1824): the auth assembly overrides the fixture
  // identity/session/permission states it actually knows; hubSync stays
  // fixture-backed (the mobile data plane does not yet claim live sync).
  const effectiveAccount = useMemo<MobileAccountState>(() => {
    const notification: MobileAccountState['notification'] =
      pushPermission === 'granted'
        ? 'granted'
        : pushPermission === 'denied'
          ? 'blocked'
          : pushPermission === 'unavailable'
            ? 'blocked'
            : fixture.account.notification;
    return {
      ...fixture.account,
      tokenDanceId: hubSessionStatus === 'active' ? 'signed_in' : 'signed_out',
      hubSession: hubSessionStatus === 'active' ? 'active' : 'missing',
      notification,
    };
  }, [fixture.account, hubSessionStatus, pushPermission]);

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
          flexDirection: 'column',
          borderRightWidth: 1,
          borderRightColor: tokens.color.line,
        }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <ThreadsScreen
            fixture={fixture}
            selectedThreadId={selectedThreadId}
            onOpenAccount={openAccountDrawer}
            onSelectThread={openThread}
          />
        </View>
        <BottomTabs
          activeTab="chat"
          onChange={setActiveTab}
          pendingReviews={counters.pendingReviews}
          unreadThreads={counters.unreadThreads}
        />
      </View>
      <View
        testID="tablet-thread-transcript-pane"
        style={{
          flex: 1,
          minWidth: 0,
          borderRightWidth: showInspector ? 1 : 0,
          borderRightColor: tokens.color.line,
        }}
      >
        <ChatScreen
          fixture={fixture}
          selectedThreadId={selectedThreadId}
          showBack={false}
          onBack={() => setActiveTab('chat')}
          onOpenRuns={() => setActiveTab('tasks')}
          {...(useInspectorPane ? { onToggleInspector: () => setInspectorCollapsed((c) => !c) } : {})}
        />
      </View>
      {showInspector ? (
        <View
          testID="tablet-thread-inspector-pane"
          style={{
            width: width >= 1180 ? 340 : 304,
            maxWidth: '32%',
            minWidth: 292,
            backgroundColor: tokens.color.canvas,
          }}
        >
          <TabletInspectorPane account={effectiveAccount} run={selectedThreadRun} />
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
    tasks: (() => {
      const tasksLaunchSheetMode = preview.sheetMode ?? launchSheetMode;
      return (
        <TasksScreen
          fixture={fixture}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          // Deep-link / notification approval targets remount the screen so the
          // review sheet is shown for the routed run (#1824).
          key={`tasks-${tasksLaunchSheetMode ?? 'default'}`}
          {...(tasksLaunchSheetMode ? { initialSheetMode: tasksLaunchSheetMode } : {})}
        />
      );
    })(),
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
        account={effectiveAccount}
        themeMode={mode}
        onChangeThemeMode={setMode}
        onClose={() => setActiveTab(accountReturnTab)}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        authBusy={authPhase !== 'idle'}
      />
    ),
  } satisfies Record<MobileTab, React.ReactNode>;
  const useInlineTabRail = useSplitPane && (activeTab === 'chat' || activeTab === 'thread');

  const retryPreviewSnapshot = () => {
    setLiveFixture(undefined);
    setLocalPreviewPhase('loading');
    setSnapshotReloadKey((key) => key + 1);
  };

  return (
    <>
      <StatusBar style={tokens.scheme === 'light' ? 'dark' : 'light'} />
      <AppShell
        activeTab={useSplitPane && activeTab === 'thread' ? 'chat' : activeTab}
        hideTabs={!useSplitPane && (activeTab === 'thread' || activeTab === 'account')}
        onChangeTab={setActiveTab}
        pendingReviews={counters.pendingReviews}
        tabRailPlacement={useInlineTabRail ? 'inlinePane' : 'bottom'}
        unreadThreads={counters.unreadThreads}
      >
        {/* The mobile build is fixture-driven end to end; the banner keeps
            the demo identity explicit instead of implying a live workspace
            (#1818). */}
        <FixturePreviewBanner />
        {localPreviewEnabled && localPreviewPhase === 'unavailable' ? (
          <PreviewUnavailableBanner onRetry={retryPreviewSnapshot} />
        ) : null}
        {content[activeTab]}
      </AppShell>
    </>
  );
}

function FixturePreviewBanner(): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View
      accessibilityLabel={t.fixturePreviewBannerTitle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.tint,
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.xs,
      }}
      testID="fixture-preview-banner"
    >
      <AgentHubIcon color={tokens.color.accent} name="shield" size={14} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: tokens.type.xs,
            fontWeight: tokens.type.weight.semibold,
            lineHeight: tokens.type.lineHeight.xs,
          }}
        >
          {t.fixturePreviewBannerTitle}
        </Text>
        <Text
          numberOfLines={2}
          style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}
        >
          {t.fixturePreviewBannerDescription}
        </Text>
      </View>
    </View>
  );
}

function PreviewUnavailableBanner({ onRetry }: { onRetry: () => void }): React.ReactElement {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();

  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space.sm,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        backgroundColor: tokens.color.warningSoft,
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.xs,
      }}
    >
      <AgentHubIcon color={tokens.color.warning} name="shield" size={16} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: tokens.color.ink,
            fontSize: tokens.type.xs,
            fontWeight: tokens.type.weight.semibold,
            lineHeight: tokens.type.lineHeight.xs,
          }}
        >
          {t.previewUnavailableTitle}
        </Text>
        <Text
          numberOfLines={2}
          style={{ color: tokens.color.inkMuted, fontSize: tokens.type.xs, lineHeight: tokens.type.lineHeight.xs }}
        >
          {t.previewUnavailableDescription}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={t.retry}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onRetry}
        style={({ pressed }) => ({
          minHeight: tokens.touch.minimum,
          justifyContent: 'center',
          borderRadius: tokens.radius.control,
          backgroundColor: pressed ? tokens.color.tint : 'transparent',
          paddingHorizontal: tokens.space.sm,
        })}
      >
        <Text style={{ color: tokens.color.warning, fontSize: tokens.type.xs, fontWeight: tokens.type.weight.semibold, lineHeight: tokens.type.lineHeight.xs }}>
          {t.retry}
        </Text>
      </Pressable>
    </View>
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

  return paramValue || resolveAppHubBaseUrl();
}

function resolveAppHubBaseUrl(): string {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;

  if (env?.EXPO_PUBLIC_AGENTHUB_HUB_URL) {
    return env.EXPO_PUBLIC_AGENTHUB_HUB_URL;
  }
  if (env?.AGENTHUB_MOBILE_NATIVE_TARGET === 'android-emulator') {
    return 'http://10.0.2.2:8088';
  }

  return 'http://127.0.0.1:8088';
}

function isBrowserPreviewRuntime(): boolean {
  return typeof (globalThis as typeof globalThis & { window?: unknown }).window !== 'undefined';
}

function getPreviewWebSocketFactory():
  | ((url: string, protocols?: string[]) => HubWebSocketLike)
  | undefined {
  const WebSocketCtor = (globalThis as typeof globalThis & {
    WebSocket?: new (url: string, protocols?: string | string[]) => HubWebSocketLike;
  }).WebSocket;

  if (!WebSocketCtor) {
    return undefined;
  }

  // Prefer Sec-WebSocket-Protocol auth (agenthub.bearer.v1 + jwt) when provided.
  return (url: string, protocols?: string[]) =>
    (protocols && protocols.length > 0
      ? new WebSocketCtor(url, protocols)
      : new WebSocketCtor(url)) as unknown as HubWebSocketLike;
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
  const t = useStrings();

  return (
    <SafeAreaProvider>
      <AgentHubThemeProvider initialMode={getPreviewThemeMode() ?? 'light'}>
        <ErrorBoundary
          fallback={(retry) => (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
            >
              <EmptyState
                icon="danger"
                title="Something went wrong"
                description="An unexpected error occurred while rendering this section."
                action={{ label: t.retry, onPress: retry }}
              />
            </View>
          )}
        >
          <MobileAppContent preview={preview} />
        </ErrorBoundary>
      </AgentHubThemeProvider>
    </SafeAreaProvider>
  );
}
