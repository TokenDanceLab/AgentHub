import { type ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  ClipboardList,
  Code2,
  Computer,
  Cpu,
  Eye,
  FolderGit2,
  GitBranch,
  Globe2,
  HardDrive,
  Keyboard,
  Link2,
  LockKeyhole,
  LogIn,
  LogOut,
  MessageSquareText,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  Route,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  UserCircle,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useHubStore } from '@/stores/hubStore';
import { APP_VERSION, HUB_URL } from '@/config';
import { createHubClient } from '@/api/hubClient';
import { useAgentList } from '@/api/agentQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import {
  useModelSettingsStore,
  type ProviderHealth,
  type ReasoningEffortPreference,
  type ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import type { AgentInfo, RunInfo, RunnerHealthItem } from '@shared/types';
import type { ContactInfo, FriendRequestInfo, HubNotification, Session } from '@/api/hubClient';
import styles from './SettingsPage.module.css';

export type SectionId =
  | 'general'
  | 'appearance'
  | 'configuration'
  | 'personalization'
  | 'permissions'
  | 'agentProfiles'
  | 'executionTargets'
  | 'tasks'
  | 'onlineIm'
  | 'groupChat'
  | 'agentScheduling'
  | 'agentMarket'
  | 'keyboard'
  | 'mcp'
  | 'skills'
  | 'hooks'
  | 'models'
  | 'modelMapping'
  | 'ccSwitch'
  | 'connections'
  | 'remoteControl'
  | 'git'
  | 'environment'
  | 'worktree'
  | 'browser'
  | 'computerUse'
  | 'platforms'
  | 'account'
  | 'securityAudit'
  | 'archived';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';
type SettingsSelectValue = SelectValue | ReasoningEffortPreference | ProviderHealth | string;

interface Props {
  onBack: () => void;
  onOpenAuth: () => void;
  initialSection?: SectionId;
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: ReactNode;
  group: 'workspace' | 'automation' | 'system';
}

interface ShortcutRow {
  keys: string[];
  action: string;
}

interface ProjectSkill {
  id: string;
  title: string;
  descriptionKey: string;
  status: 'ready' | 'review';
  hasScripts: boolean;
  hasReferences: boolean;
}

interface CustomAgentMarketItem {
  id: string;
  name: string;
  agentType: string;
  systemPrompt: string;
  capabilities: string[];
  source: string;
  updatedAt?: string;
}

interface HubIMSnapshot {
  contacts: ContactInfo[];
  sessions: Session[];
  friendRequests: FriendRequestInfo[];
  notifications: HubNotification[];
}

const STORAGE_PREFIX = 'agenthub-settings.';
const DEVICE_ID_KEY = 'agenthub_device_id';
const TD_CODE_VERIFIER_KEY = 'td_code_verifier';
const TD_STATE_KEY = 'td_state';

const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

const PROVIDER_OPTIONS = [
  ['tokendance-relay', 'TokenDance Relay'],
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['cc-switch-local', 'cc-switch local'],
] as const;

const REASONING_OPTIONS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['max', 'Max'],
] as const;

const PROVIDER_HEALTH_OPTIONS = [
  ['ready', 'Ready'],
  ['degraded', 'Degraded'],
  ['disabled', 'Disabled'],
] as const;

const PROJECT_SKILLS: ProjectSkill[] = [
  {
    id: 'adapter-dev',
    title: 'adapter-dev',
    descriptionKey: 'settings.skill.adapterDevDesc',
    status: 'ready',
    hasScripts: false,
    hasReferences: false,
  },
  {
    id: 'dev-loop',
    title: 'dev-loop',
    descriptionKey: 'settings.skill.devLoopDesc',
    status: 'ready',
    hasScripts: false,
    hasReferences: true,
  },
  {
    id: 'env-sandbox',
    title: 'env-sandbox',
    descriptionKey: 'settings.skill.envSandboxDesc',
    status: 'ready',
    hasScripts: false,
    hasReferences: false,
  },
  {
    id: 'integration-test',
    title: 'integration-test',
    descriptionKey: 'settings.skill.integrationTestDesc',
    status: 'ready',
    hasScripts: false,
    hasReferences: false,
  },
  {
    id: 'pre-push',
    title: 'pre-push',
    descriptionKey: 'settings.skill.prePushDesc',
    status: 'review',
    hasScripts: false,
    hasReferences: false,
  },
  {
    id: 'test-coverage',
    title: 'test-coverage',
    descriptionKey: 'settings.skill.testCoverageDesc',
    status: 'ready',
    hasScripts: false,
    hasReferences: false,
  },
  {
    id: 'ui-screenshot',
    title: 'ui-screenshot',
    descriptionKey: 'settings.skill.uiScreenshotDesc',
    status: 'ready',
    hasScripts: true,
    hasReferences: false,
  },
];

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

function readStoredValue<T extends string>(key: string, fallback: T) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored) return stored as T;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

function writeStoredValue(key: string, value: string | boolean) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

function readBrowserStorage(storage: 'local' | 'session', key: string) {
  try {
    const target = storage === 'local' ? localStorage : sessionStorage;
    return target.getItem(key);
  } catch {
    return null;
  }
}

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general' }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const hubAuth = useAuth();
  const { online: edgeOnline, health } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const {
    data: runData,
    isError: runsError,
    isFetching: runsFetching,
    isLoading: runsLoading,
    refetch: refetchRuns,
  } = useRuns();
  const cancelRunMutation = useCancelRun();
  const bridgedTasks = useTaskBridgeStore((s) => s.tasks);
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const username = useHubStore((s) => s.username);
  const [active, setActive] = useState<SectionId>(initialSection);
  const [compactMode, setCompactMode] = useStoredBooleanState('compactMode', false);
  const [autoReview, setAutoReview] = useStoredBooleanState('autoReview', true);
  const [fullAccess, setFullAccess] = useStoredBooleanState('fullAccess', false);
  const [enableMcp, setEnableMcp] = useStoredBooleanState('enableMcp', true);
  const [, setSkillSync] = useStoredBooleanState('skillSync', true);
  const [taskSync, setTaskSync] = useStoredBooleanState('taskSync', true);
  const [groupChatEnabled, setGroupChatEnabled] = useStoredBooleanState('groupChat', true);
  const [agentSchedulingEnabled, setAgentSchedulingEnabled] = useStoredBooleanState('agentScheduling', true);
  const [enableHooks, setEnableHooks] = useStoredBooleanState('enableHooks', false);
  const [, setRemoteControlEnabled] = useStoredBooleanState('remoteControl', false);
  const [autoDetectGit, setAutoDetectGit] = useStoredBooleanState('autoDetectGit', true);
  const [worktreeIsolation, setWorktreeIsolation] = useStoredBooleanState('worktreeIsolation', true);
  const [browserPreview, setBrowserPreview] = useStoredBooleanState('browserPreview', true);
  const [computerConfirm, setComputerConfirm] = useStoredBooleanState('computerConfirm', true);
  const [, setPlatformSync] = useStoredBooleanState('platformSync', true);
  const [auditTrail, setAuditTrail] = useStoredBooleanState('auditTrail', true);
  const [detailLevel, setDetailLevel] = useStoredValueState<SelectValue>('detailLevel', 'detailed');
  const [approvalMode, setApprovalMode] = useStoredValueState<SelectValue>('approvalMode', 'ask');
  const defaultModel = useModelSettingsStore((s) => s.defaultModel);
  const defaultProvider = useModelSettingsStore((s) => s.defaultProvider);
  const modelReasoningEffort = useModelSettingsStore((s) => s.reasoningEffort);
  const providerFallbackEnabled = useModelSettingsStore((s) => s.providerFallbackEnabled);
  const modelMappingEnabled = useModelSettingsStore((s) => s.modelMappingEnabled);
  const modelAliases = useModelSettingsStore((s) => s.aliases);
  const ccSwitchBridge = useModelSettingsStore((s) => s.ccSwitchBridgeEnabled);
  const ccSwitchProviders = useModelSettingsStore((s) => s.ccSwitchProviders);
  const setDefaultModel = useModelSettingsStore((s) => s.setDefaultModel);
  const setDefaultProvider = useModelSettingsStore((s) => s.setDefaultProvider);
  const setModelReasoningEffort = useModelSettingsStore((s) => s.setReasoningEffort);
  const setProviderFallbackEnabled = useModelSettingsStore((s) => s.setProviderFallbackEnabled);
  const setModelMappingEnabled = useModelSettingsStore((s) => s.setModelMappingEnabled);
  const updateModelAlias = useModelSettingsStore((s) => s.updateAlias);
  const toggleModelAlias = useModelSettingsStore((s) => s.toggleAlias);
  const setCcSwitchBridge = useModelSettingsStore((s) => s.setCcSwitchBridgeEnabled);
  const updateCcSwitchProvider = useModelSettingsStore((s) => s.updateProvider);
  const resolveRunRequestOptions = useModelSettingsStore((s) => s.resolveRunRequestOptions);
  const hubSessionActive = hubAuthenticated || hubAuth.isAuthenticated;
  const settingsHubClient = useMemo(
    () => createHubClient({ getToken: () => hubAuth.token ?? null }),
    [hubAuth.token],
  );
  const deviceRegistration = useDeviceRegistration(hubSessionActive ? settingsHubClient : null);
  const shouldLoadAgentMarket = hubSessionActive && active === 'agentMarket';
  const shouldLoadIMSnapshot = hubSessionActive && (active === 'onlineIm' || active === 'groupChat');
  const customAgentsQuery = useQuery({
    queryKey: ['hub-settings', 'custom-agents', hubAuth.token],
    queryFn: () => settingsHubClient.listCustomAgents(),
    enabled: shouldLoadAgentMarket,
    retry: false,
  });
  const hubIMSnapshotQuery = useQuery<HubIMSnapshot>({
    queryKey: ['hub-settings', 'im-snapshot', hubAuth.token],
    queryFn: async () => {
      const [contacts, sessions, friendRequests, notifications] = await Promise.all([
        settingsHubClient.listContacts(),
        settingsHubClient.listSessions(),
        settingsHubClient.listFriendRequests(),
        settingsHubClient.listNotifications({ limit: 20 }),
      ]);
      return { contacts, sessions, friendRequests, notifications };
    },
    enabled: shouldLoadIMSnapshot,
    retry: false,
  });
  const agents = agentData?.items ?? [];
  const localAgentProfiles = useMemo(
    () => agents.map((agent) => ({
      agent,
      alias: preferredProfileAlias(agent),
      route: resolveRunRequestOptions({ model: preferredProfileAlias(agent) }),
    })),
    [
      agents,
      defaultModel,
      defaultProvider,
      modelAliases,
      modelMappingEnabled,
      modelReasoningEffort,
      providerFallbackEnabled,
      resolveRunRequestOptions,
    ],
  );
  const availableRuntimes = agents.filter((agent) => agent.status === 'available').length;
  const runnerHealth = health?.checks?.runners;
  const runnerItems = runnerHealth?.items ?? [];
  const availableRunners = runnerHealth?.available ?? runnerItems.filter((item) => item.status === 'online').length;
  const totalRunners = runnerHealth?.total ?? runnerItems.length;
  const runnerSummary = edgeOnline
    ? t('settings.runnerSummary', { available: availableRunners, total: totalRunners })
    : t('settings.edgeOffline');
  const runs = runData?.items ?? [];
  const activeRuns = runs.filter(isActiveRun).length;
  const latestRun = getRecentRuns(runs, 1)[0];
  const recentRuns = getRecentRuns(runs, 5);
  const activeHubTasks = bridgedTasks.filter(isActiveBridgeTask).length;
  const recentBridgeTasks = getRecentTasks(bridgedTasks, 5);
  const imSnapshot = hubIMSnapshotQuery.data;
  const imContacts = imSnapshot?.contacts ?? [];
  const imSessions = imSnapshot?.sessions ?? [];
  const imFriendRequests = imSnapshot?.friendRequests ?? [];
  const imNotifications = imSnapshot?.notifications ?? [];
  const imGroupSessions = imSessions.filter((session) => session.type === 'group');
  const imPrivateSessions = imSessions.filter((session) => session.type !== 'group');
  const remoteControlReady = false;
  const schedulerActiveItems = activeRuns + activeHubTasks;
  const schedulerTotalItems = runs.length + bridgedTasks.length;
  const schedulerTargetReadyCount = [
    edgeOnline,
    remoteControlReady,
    false,
    false,
  ].filter(Boolean).length;
  const schedulerLocalMetric = totalRunners > 0 ? runnerSummary : edgeOnline ? t('settings.edgeOnline') : t('settings.edgeOffline');
  const customAgents = (customAgentsQuery.data ?? []).map(normalizeCustomAgent);
  const marketPublishReady = customAgents.length;
  const marketCapabilityCount = countAgentCapabilities(agents);
  const skillScriptCount = PROJECT_SKILLS.filter((skill) => skill.hasScripts).length;
  const skillReferenceCount = PROJECT_SKILLS.filter((skill) => skill.hasReferences).length;
  const skillReadyCount = PROJECT_SKILLS.filter((skill) => skill.status === 'ready').length;
  const mcpCapableAgents = agents.filter((agent) => agent.capabilities.mcpIntegration).length;
  const mcpPermissionHookAgents = agents.filter((agent) => agent.capabilities.permissionHooks).length;
  const mcpSubAgentAgents = agents.filter((agent) => agent.capabilities.subAgentSpawn).length;
  const accountName = hubAuth.user?.username ?? username ?? t('settings.signedIn');
  const tokenSource = hubAuth.tokenSource;
  const tokenSourceLabel =
    tokenSource === 'tokendance'
      ? 'TokenDance ID'
      : tokenSource === 'hub'
        ? t('settings.hubLocalLogin')
        : t('settings.notConfigured');
  const imSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive,
    isLoading: hubIMSnapshotQuery.isLoading,
    isFetching: hubIMSnapshotQuery.isFetching,
    isError: hubIMSnapshotQuery.isError,
    isSuccess: hubIMSnapshotQuery.isSuccess,
    t,
  });
  const marketSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive,
    isLoading: customAgentsQuery.isLoading,
    isFetching: customAgentsQuery.isFetching,
    isError: customAgentsQuery.isError,
    isSuccess: customAgentsQuery.isSuccess,
    t,
  });
  const desktopDeviceStatus = statusLabelFromDevice({
    signedIn: hubSessionActive,
    status: deviceRegistration.status,
    registeredLabel: 'registered',
    idleLabel: 'deviceStatus',
    t,
  });
  const deviceId = deviceRegistration.deviceId ?? readBrowserStorage('local', DEVICE_ID_KEY);
  const pkceStateReady =
    Boolean(readBrowserStorage('session', TD_CODE_VERIFIER_KEY)) && Boolean(readBrowserStorage('session', TD_STATE_KEY));
  const handleSignOut = () => {
    void hubAuth.logout();
  };
  const handleRefreshRuns = () => {
    void refetchRuns();
  };
  const handleCancelRun = (runId: string) => {
    void cancelRunMutation.mutateAsync(runId);
  };
  const schedulerPolicyReadyCount = [
    modelMappingEnabled,
    ccSwitchBridge,
    autoReview,
    remoteControlReady,
  ].filter(Boolean).length;

  const navItems = useMemo<NavItem[]>(
    () => [
      { id: 'general', label: t('settings.general'), icon: <SlidersHorizontal size={17} />, group: 'workspace' },
      { id: 'appearance', label: t('settings.appearance'), icon: <Palette size={17} />, group: 'workspace' },
      { id: 'configuration', label: t('settings.configuration'), icon: <Wrench size={17} />, group: 'workspace' },
      { id: 'personalization', label: t('settings.personalization'), icon: <UserCircle size={17} />, group: 'workspace' },
      { id: 'permissions', label: t('settings.permissions'), icon: <ShieldCheck size={17} />, group: 'workspace' },
      { id: 'agentProfiles', label: t('settings.agentProfiles'), icon: <Bot size={17} />, group: 'workspace' },
      { id: 'executionTargets', label: t('settings.executionTargets'), icon: <Server size={17} />, group: 'workspace' },
      { id: 'tasks', label: t('settings.tasks'), icon: <ClipboardList size={17} />, group: 'workspace' },
      { id: 'onlineIm', label: t('settings.onlineIm'), icon: <Globe2 size={17} />, group: 'workspace' },
      { id: 'groupChat', label: t('settings.groupChat'), icon: <MessageSquareText size={17} />, group: 'workspace' },
      { id: 'agentScheduling', label: t('settings.agentScheduling'), icon: <Route size={17} />, group: 'workspace' },
      { id: 'agentMarket', label: t('settings.agentMarket'), icon: <Bot size={17} />, group: 'workspace' },
      { id: 'keyboard', label: t('settings.keyboard'), icon: <Keyboard size={17} />, group: 'workspace' },
      { id: 'mcp', label: t('settings.mcp'), icon: <Plug size={17} />, group: 'automation' },
      { id: 'skills', label: t('settings.skills'), icon: <Code2 size={17} />, group: 'automation' },
      { id: 'hooks', label: t('settings.hooks'), icon: <TerminalSquare size={17} />, group: 'automation' },
      { id: 'models', label: t('settings.models'), icon: <SlidersHorizontal size={17} />, group: 'automation' },
      { id: 'modelMapping', label: t('settings.modelMapping'), icon: <Link2 size={17} />, group: 'automation' },
      { id: 'ccSwitch', label: t('settings.ccSwitch'), icon: <Plug size={17} />, group: 'automation' },
      { id: 'connections', label: t('settings.connections'), icon: <Globe2 size={17} />, group: 'automation' },
      { id: 'remoteControl', label: t('settings.remoteControl'), icon: <Computer size={17} />, group: 'automation' },
      { id: 'git', label: t('settings.git'), icon: <GitBranch size={17} />, group: 'automation' },
      { id: 'environment', label: t('settings.environment'), icon: <HardDrive size={17} />, group: 'system' },
      { id: 'worktree', label: t('settings.worktree'), icon: <FolderGit2 size={17} />, group: 'system' },
      { id: 'browser', label: t('settings.browser'), icon: <Eye size={17} />, group: 'system' },
      { id: 'computerUse', label: t('settings.computerUse'), icon: <Computer size={17} />, group: 'system' },
      { id: 'platforms', label: t('settings.platforms'), icon: <Monitor size={17} />, group: 'system' },
      { id: 'account', label: t('settings.account'), icon: <LockKeyhole size={17} />, group: 'system' },
      { id: 'securityAudit', label: t('settings.securityAudit'), icon: <ShieldCheck size={17} />, group: 'system' },
      { id: 'archived', label: t('settings.archived'), icon: <Archive size={17} />, group: 'system' },
    ],
    [t],
  );

  const activeLabel = navItems.find((item) => item.id === active)?.label ?? t('settings.title');
  const shortcuts: ShortcutRow[] = [
    { keys: ['Enter'], action: t('shortcut.send') },
    { keys: ['Shift', 'Enter'], action: t('shortcut.newline') },
    { keys: ['Ctrl', 'K'], action: t('shortcut.search') },
    { keys: ['⌘/Ctrl', 'B'], action: t('shortcut.toggleSidebar') },
    { keys: ['⌘/Ctrl', 'J'], action: t('shortcut.toggleRunPanel') },
    { keys: ['Esc'], action: t('shortcut.close') },
    { keys: ['?'], action: t('shortcut.help') },
  ];

  const setBooleanSetting = (key: string, setter: (value: boolean) => void) => (value: boolean) => {
    setter(value);
    writeStoredValue(key, value);
  };

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={18} />
          <span>{t('settings.back')}</span>
        </button>

        <nav className={styles.nav} aria-label={t('settings.title')}>
          {(['workspace', 'automation', 'system'] as const).map((group) => (
            <div key={group} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>{t(`settings.group.${group}`)}</div>
              {navItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    className={`${styles.navItem} ${active === item.id ? styles.navItemActive : ''}`}
                    onClick={() => setActive(item.id)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarAccount}>
          <button className={styles.sidebarAccountBtn} onClick={() => setActive('account')}>
            <UserCircle size={18} />
            <span>{hubSessionActive ? accountName : t('settings.notSignedIn')}</span>
          </button>
          {hubSessionActive ? (
            <button className={styles.sidebarActionBtn} onClick={handleSignOut}>
              <LogOut size={17} />
              <span>{t('settings.signOut')}</span>
            </button>
          ) : (
            <button className={styles.sidebarActionBtn} onClick={onOpenAuth}>
              <LogIn size={17} />
              <span>{t('settings.signIn')}</span>
            </button>
          )}
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <div className={styles.header}>
            <span>{t('settings.title')}</span>
            <h1>{activeLabel}</h1>
          </div>

          {active === 'general' && (
            <>
              <Panel title={t('settings.workMode')} description={t('settings.workModeDesc')}>
                <div className={styles.modeGrid}>
                  <ModeCard
                    active={detailLevel === 'detailed'}
                    icon={<Monitor size={20} />}
                    title={t('settings.modeCoding')}
                    description={t('settings.modeCodingDesc')}
                    onClick={() => {
                      setDetailLevel('detailed');
                      writeStoredValue('detailLevel', 'detailed');
                    }}
                  />
                  <ModeCard
                    active={detailLevel === 'balanced'}
                    icon={<Eye size={20} />}
                    title={t('settings.modeDaily')}
                    description={t('settings.modeDailyDesc')}
                    onClick={() => {
                      setDetailLevel('balanced');
                      writeStoredValue('detailLevel', 'balanced');
                    }}
                  />
                </div>
              </Panel>

              <Panel title={t('settings.general')}>
                <SettingRow
                  title={t('settings.compactMode')}
                  description={t('settings.compactModeDesc')}
                  control={
                    <Switch checked={compactMode} onChange={setBooleanSetting('compactMode', setCompactMode)} />
                  }
                />
                <SettingRow
                  title={t('settings.detailLevel')}
                  description={t('settings.detailLevelDesc')}
                  control={
                    <SelectControl
                      value={detailLevel}
                      onChange={(value) => {
                        setDetailLevel(value as SelectValue);
                        writeStoredValue('detailLevel', value);
                      }}
                      options={[
                        ['detailed', t('settings.detailLevel.detailed')],
                        ['balanced', t('settings.detailLevel.balanced')],
                      ]}
                    />
                  }
                />
              </Panel>
            </>
          )}

          {active === 'appearance' && (
            <>
              <Panel title={t('settings.theme')} description={t('settings.themeDesc')}>
                <div className={styles.segmented}>
                  {(['dark', 'light', 'system'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={themeMode === mode ? styles.segmentActive : ''}
                      onClick={() => setThemeMode(mode)}
                    >
                      {t(`settings.theme.${mode}`)}
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel title={t('settings.density')}>
                <SettingRow
                  title={t('settings.compactMode')}
                  description={t('settings.compactModeDesc')}
                  control={
                    <Switch checked={compactMode} onChange={setBooleanSetting('compactMode', setCompactMode)} />
                  }
                />
              </Panel>
            </>
          )}

          {active === 'configuration' && (
            <Panel title={t('settings.configuration')} description={t('settings.configurationDesc')}>
              <SettingRow title={t('settings.defaultAgent')} description="Claude Code / Codex / OpenCode" value="Auto" />
              <SettingRow
                title={t('settings.routing')}
                description={t('settings.routingDesc')}
                value={t('settings.routingAuto')}
              />
              <SettingRow
                title={t('settings.approvalMode')}
                description={t('settings.approvalModeDesc')}
                control={
                  <SelectControl
                    value={approvalMode}
                    onChange={(value) => {
                      setApprovalMode(value as SelectValue);
                      writeStoredValue('approvalMode', value);
                    }}
                    options={[
                      ['ask', t('settings.approvalMode.ask')],
                      ['auto', t('settings.approvalMode.auto')],
                      ['manual', t('settings.approvalMode.manual')],
                    ]}
                  />
                }
              />
            </Panel>
          )}

          {active === 'personalization' && (
            <Panel title={t('settings.personalization')} description={t('settings.personalizationDesc')}>
              <SettingRow title={t('settings.displayName')} description={username ?? 'AgentHub User'} value="Local" />
              <SettingRow title={t('settings.instructions')} description={t('settings.instructionsDesc')} action />
              <Callout title={t('settings.personalizationNote')} body={t('settings.personalizationNoteDesc')} />
            </Panel>
          )}

          {active === 'permissions' && (
            <Panel title={t('settings.permissions')} description={t('settings.permissionsDesc')}>
              <SettingRow
                title={t('settings.autoReview')}
                description={t('settings.autoReviewDesc')}
                control={<Switch checked={autoReview} onChange={setBooleanSetting('autoReview', setAutoReview)} />}
              />
              <SettingRow
                title={t('settings.fullAccess')}
                description={t('settings.fullAccessDesc')}
                control={<Switch checked={fullAccess} onChange={setBooleanSetting('fullAccess', setFullAccess)} />}
              />
              <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'agentProfiles' && (
            <Panel title={t('settings.agentProfiles')} description={t('settings.agentProfilesDesc')}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.profileAvailable')}
                  value={`${availableRuntimes}/${agents.length}`}
                  detail={edgeOnline ? t('settings.runtimeInventoryDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<Cpu size={18} />}
                  label={t('settings.profileRuntimeCoverage')}
                  value={runnerSummary}
                  detail={t('settings.profileRuntimeCoverageDesc')}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.runtimeInventory')}</strong>
                  <span>{t('settings.runtimeInventoryDesc')}</span>
                </div>
                {agents.length > 0 ? (
                  <div className={styles.profileGrid}>
                    {agents.map((agent) => <RuntimeInventoryCard key={agent.id} agent={agent} />)}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.noRuntimes')} description={t('settings.noRuntimesDesc')} />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.profileComposition')}</strong>
                  <span>{t('settings.profileCompositionDesc')}</span>
                </div>
                {localAgentProfiles.length > 0 ? (
                  <div className={styles.profileGrid}>
                    {localAgentProfiles.map((profile) => (
                      <LocalAgentProfileCard
                        key={`profile-${profile.agent.id}`}
                        agent={profile.agent}
                        alias={profile.alias}
                        route={profile.route}
                        edgeOnline={edgeOnline}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.noProfiles')} description={t('settings.noProfilesDesc')} />
                )}
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.profileRuntime')}
                    description={t('settings.profileRuntimeDesc')}
                    status={agents.length > 0 ? t('settings.statusReady') : t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title={t('settings.profileModel')}
                    description={t('settings.profileModelDesc')}
                    status={t('settings.statusInProgress')}
                  />
                  <CapabilityCard
                    title={t('settings.profileConfig')}
                    description={t('settings.profileConfigDesc')}
                    status={t('settings.statusInProgress')}
                  />
                  <CapabilityCard
                    title={t('settings.executionTargets')}
                    description={t('settings.profileExecutionTargetDesc')}
                    status={edgeOnline ? t('settings.statusReady') : t('settings.notConfigured')}
                  />
                </div>
              </div>
              <SettingRow title={t('settings.profileConfigSource')} description={t('settings.profileConfigSourceDesc')} value="AGENTS.md / memory / skills" />
              <SettingRow title={t('settings.profilePublish')} description={t('settings.profilePublishDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'executionTargets' && (
            <Panel title={t('settings.executionTargets')} description={t('settings.executionTargetsDesc')}>
              <div className={styles.targetGrid}>
                <ExecutionTargetCard
                  icon={<Monitor size={18} />}
                  title={t('settings.targetLocalEdge')}
                  description={t('settings.targetLocalEdgeDesc')}
                  status={edgeOnline ? health?.status ?? 'ok' : t('settings.offline')}
                  metric={runnerSummary}
                  connected={edgeOnline && availableRunners > 0}
                />
                <ExecutionTargetCard
                  icon={<Globe2 size={18} />}
                  title={t('settings.targetHubRelay')}
                  description={t('settings.targetHubRelayDesc')}
                  status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  metric={hubSessionActive ? t('settings.targetHubSignedIn') : t('settings.targetHubSignInRequired')}
                  connected={false}
                />
                <ExecutionTargetCard
                  icon={<Monitor size={18} />}
                  title={t('settings.desktopDevice')}
                  description={t('settings.desktopDeviceDesc')}
                  status={t(`settings.deviceStatus.${deviceRegistration.status}`)}
                  metric={deviceId ? shortId(deviceId) : t('settings.desktopDeviceMissingDesc')}
                  connected={deviceRegistration.status === 'registered'}
                />
                <ExecutionTargetCard
                  icon={<Server size={18} />}
                  title={t('settings.targetSsh')}
                  description={t('settings.targetSshDesc')}
                  status={t('settings.statusPlanned')}
                  metric="SSH / Tailscale"
                />
                <ExecutionTargetCard
                  icon={<Computer size={18} />}
                  title={t('settings.targetCloudEdge')}
                  description={t('settings.targetCloudEdgeDesc')}
                  status={t('settings.statusPlanned')}
                  metric="Cloud Edge"
                />
              </div>
              {runnerItems.length > 0 ? (
                <div className={styles.runnerList}>
                  {runnerItems.map((runner) => <RunnerRow key={runner.id} runner={runner} />)}
                </div>
              ) : (
                <Callout title={t('settings.runnerInventory')} body={t('settings.runnerInventoryDesc')} />
              )}
            </Panel>
          )}

          {active === 'tasks' && (
            <Panel title={t('settings.tasks')} description={t('settings.tasksDesc')}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Route size={18} />}
                  label={t('settings.taskLocalRuns')}
                  value={`${activeRuns}/${runs.length}`}
                  detail={runsLoading ? t('settings.loading') : t('settings.taskLocalRunsDesc')}
                />
                <SummaryCard
                  icon={<ClipboardList size={18} />}
                  label={t('settings.taskHubBridge')}
                  value={`${activeHubTasks}/${bridgedTasks.length}`}
                  detail={hubSessionActive ? t('settings.taskHubBridgeDesc') : t('settings.taskHubBridgeSignedOut')}
                />
                <SummaryCard
                  icon={<Monitor size={18} />}
                  label={t('settings.taskLastRun')}
                  value={latestRun ? t(`run.status.${latestRun.status}`, { defaultValue: latestRun.status }) : t('settings.noData')}
                  detail={latestRun ? formatTimestamp(latestRun.finishedAt ?? latestRun.startedAt ?? latestRun.createdAt) : t('settings.taskLastRunDesc')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.taskHubSnapshot')}
                  value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  detail={hubSessionActive ? t('settings.taskHubSnapshotUnavailable') : t('settings.taskHubBridgeSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.taskSync')}
                description={t('settings.taskSyncDesc')}
                control={
                  <Switch
                    checked={hubSessionActive && taskSync}
                    onChange={setBooleanSetting('taskSync', setTaskSync)}
                    disabled={!hubSessionActive}
                  />
                }
              />
              <SettingRow
                title={t('settings.taskInbox')}
                description={t('settings.taskInboxDesc')}
                value={runsError ? t('settings.edgeOffline') : t('settings.statusInProgress')}
              />
              <SettingRow title={t('settings.taskRunBinding')} description={t('settings.taskRunBindingDesc')} value={t('settings.statusInProgress')} />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <div className={styles.taskSectionTitleRow}>
                    <div>
                      <strong>{t('settings.taskHubSnapshot')}</strong>
                      <span>{t('settings.taskHubSnapshotDesc')}</span>
                    </div>
                    <div className={styles.taskSectionActions}>
                      <span className={styles.statusPill}>
                        {hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                      </span>
                    </div>
                  </div>
                </div>
                {!hubSessionActive ? (
                  <AuthGapBlock
                    title={t('settings.hubSignInRequired')}
                    description={t('settings.taskHubBridgeSignedOut')}
                    actionLabel={t('settings.signIn')}
                    onAction={onOpenAuth}
                  />
                ) : (
                  <EmptyBlock title={t('settings.status.interfaceGap')} description={t('settings.taskHubSnapshotUnavailable')} />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <div className={styles.taskSectionTitleRow}>
                    <div>
                      <strong>{t('settings.taskRecentRuns')}</strong>
                      <span>{runsFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRecentRunsDesc')}</span>
                    </div>
                    <div className={styles.taskSectionActions}>
                      <span className={`${styles.statusPill} ${runsError ? '' : styles.statusPillOn}`}>
                        {runsError ? t('settings.edgeOffline') : t('settings.taskRunLive')}
                      </span>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={handleRefreshRuns}
                        disabled={runsFetching}
                      >
                        <RefreshCw size={15} />
                        {runsFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRefreshRuns')}
                      </button>
                    </div>
                  </div>
                </div>
                {recentRuns.length > 0 ? (
                  <div className={styles.taskList}>
                    {recentRuns.map((run) => (
                      <TaskRunRow
                        key={run.runId}
                        run={run}
                        onCancel={isActiveRun(run) ? handleCancelRun : undefined}
                        cancelling={cancelRunMutation.isPending && cancelRunMutation.variables === run.runId}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.taskNoRuns')} description={t('settings.taskNoRunsDesc')} />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.taskBridgeQueue')}</strong>
                  <span>{t('settings.taskBridgeQueueDesc')}</span>
                </div>
                {recentBridgeTasks.length > 0 ? (
                  <div className={styles.taskList}>
                    {recentBridgeTasks.map((task) => (
                      <HubTaskRow key={task.taskId} task={task} />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.taskNoHubTasks')} description={t('settings.taskNoHubTasksDesc')} />
                )}
              </div>
            </Panel>
          )}

          {active === 'onlineIm' && (
            <Panel title={t('settings.onlineIm')} description={t('settings.onlineImDesc')}>
              {!hubSessionActive ? (
                <AuthGapBlock
                  title={t('settings.hubSignInRequired')}
                  description={t('settings.onlineImSignedOutDesc')}
                  actionLabel={t('settings.signIn')}
                  onAction={onOpenAuth}
                />
              ) : hubIMSnapshotQuery.isError ? (
                <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.onlineImHubErrorDesc')} />
              ) : null}
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<MessageSquareText size={18} />}
                  label={t('settings.onlineImSessions')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imSessions.length}`}
                  detail={hubSessionActive ? t('settings.onlineImSessionsDesc') : t('settings.onlineImSignedOutDesc')}
                />
                <SummaryCard
                  icon={<UserCircle size={18} />}
                  label={t('settings.onlineImContacts')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imContacts.length}`}
                  detail={t('settings.onlineImContactsDesc')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.onlineImFriendRequests')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imFriendRequests.length}`}
                  detail={t('settings.onlineImFriendRequestsDesc')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.onlineImNotifications')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imNotifications.length}`}
                  detail={t('settings.onlineImNotificationsDesc')}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <div className={styles.taskSectionTitleRow}>
                    <div>
                      <strong>{t('settings.onlineImSnapshot')}</strong>
                      <span>{t('settings.onlineImSnapshotDesc')}</span>
                    </div>
                    {hubSessionActive ? (
                      <div className={styles.taskSectionActions}>
                        <span className={`${styles.statusPill} ${hubIMSnapshotQuery.isSuccess ? styles.statusPillOn : ''}`}>
                          {imSnapshotStatus}
                        </span>
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => void hubIMSnapshotQuery.refetch()}
                          disabled={hubIMSnapshotQuery.isFetching}
                        >
                          <RefreshCw size={15} />
                          {hubIMSnapshotQuery.isFetching ? t('settings.taskRefreshingRuns') : t('settings.taskRefreshRuns')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                {hubSessionActive && !hubIMSnapshotQuery.isError && imSessions.length > 0 ? (
                  <div className={styles.taskList}>
                    {imSessions.slice(0, 5).map((session) => (
                      <HubSessionRow key={sessionIdOfSettings(session)} session={session} />
                    ))}
                  </div>
                ) : hubSessionActive && !hubIMSnapshotQuery.isError ? (
                  <EmptyBlock title={t('settings.onlineImNoSessions')} description={t('settings.onlineImNoSessionsDesc')} />
                ) : null}
              </div>
              {hubSessionActive && !hubIMSnapshotQuery.isError ? (
                <div className={styles.taskSection}>
                  <div className={styles.taskSectionHeader}>
                    <strong>{t('settings.onlineImReadonlySummary')}</strong>
                    <span>{t('settings.onlineImReadonlySummaryDesc')}</span>
                  </div>
                  {imFriendRequests.length > 0 || imNotifications.length > 0 ? (
                    <div className={styles.taskList}>
                      {imFriendRequests.slice(0, 3).map((request) => (
                        <HubFriendRequestRow key={request.request_id} request={request} />
                      ))}
                      {imNotifications.slice(0, 3).map((notification) => (
                        <HubNotificationRow key={notification.id} notification={notification} />
                      ))}
                    </div>
                  ) : (
                    <EmptyBlock title={t('settings.onlineImNoReadonlyItems')} description={t('settings.onlineImNoReadonlyItemsDesc')} />
                  )}
                </div>
              ) : null}
              <div className={styles.capabilityGrid}>
                <CapabilityCard
                  title={t('settings.onlineImPresence')}
                  description={t('settings.onlineImPresenceDesc')}
                  status={
                    deviceRegistration.status === 'error'
                      ? t('settings.status.error')
                      : hubSessionActive
                        ? t('settings.status.interfaceGap')
                        : t('settings.status.loginLocked')
                  }
                />
                <CapabilityCard
                  title={t('settings.onlineImNotificationActions')}
                  description={t('settings.onlineImNotificationActionsDesc')}
                  status={imSnapshotStatus}
                />
              </div>
            </Panel>
          )}

          {active === 'groupChat' && (
            <Panel title={t('settings.groupChat')} description={t('settings.groupChatDesc')}>
              {!hubSessionActive ? (
                <AuthGapBlock
                  title={t('settings.hubSignInRequired')}
                  description={t('settings.onlineImSignedOutDesc')}
                  actionLabel={t('settings.signIn')}
                  onAction={onOpenAuth}
                />
              ) : hubIMSnapshotQuery.isError ? (
                <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.onlineImHubErrorDesc')} />
              ) : null}
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<MessageSquareText size={18} />}
                  label={t('settings.groupChatRooms')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imGroupSessions.length}`}
                  detail={t('settings.groupChatRoomsDesc')}
                />
                <SummaryCard
                  icon={<UserCircle size={18} />}
                  label={t('settings.onlineImContacts')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imContacts.length}`}
                  detail={t('settings.onlineImContactsDesc')}
                />
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.groupChatAgents')}
                  value={`${agents.length}`}
                  detail={edgeOnline ? t('settings.groupChatAgentsDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.onlineImSessions')}
                  value={hubIMSnapshotQuery.isLoading ? t('settings.loading') : `${imPrivateSessions.length}/${imSessions.length}`}
                  detail={t('settings.groupChatSessionMixDesc')}
                />
              </div>
              <SettingRow
                title={t('settings.enableGroupChat')}
                description={t('settings.enableGroupChatDesc')}
                control={
                  <Switch
                    checked={hubSessionActive && groupChatEnabled}
                    onChange={setBooleanSetting('groupChat', setGroupChatEnabled)}
                    disabled={!hubSessionActive}
                  />
                }
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.groupChatHubRooms')}</strong>
                  <span>{t('settings.groupChatHubRoomsDesc')}</span>
                </div>
                {hubSessionActive && !hubIMSnapshotQuery.isError && imGroupSessions.length > 0 ? (
                  <div className={styles.taskList}>
                    {imGroupSessions.slice(0, 5).map((session) => (
                      <HubSessionRow key={`group-${sessionIdOfSettings(session)}`} session={session} />
                    ))}
                  </div>
                ) : hubSessionActive && !hubIMSnapshotQuery.isError ? (
                  <EmptyBlock title={t('settings.groupChatNoRooms')} description={t('settings.groupChatNoRoomsDesc')} />
                ) : null}
              </div>
              <SettingRow
                title={t('settings.groupChatModeration')}
                description={t('settings.groupChatModerationDesc')}
                value={imSnapshotStatus}
              />
            </Panel>
          )}

          {active === 'agentScheduling' && (
            <Panel title={t('settings.agentScheduling')} description={t('settings.agentSchedulingDesc')}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<ClipboardList size={18} />}
                  label={t('settings.schedulerQueueLive')}
                  value={`${schedulerActiveItems}/${schedulerTotalItems}`}
                  detail={runsLoading ? t('settings.loading') : t('settings.schedulerQueueLiveDesc')}
                />
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.schedulerProfiles')}
                  value={`${availableRuntimes}/${agents.length}`}
                  detail={edgeOnline ? t('settings.schedulerProfilesDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<Server size={18} />}
                  label={t('settings.schedulerTargets')}
                  value={`${schedulerTargetReadyCount}/4`}
                  detail={t('settings.schedulerTargetsDesc')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.schedulerPolicyReady')}
                  value={`${schedulerPolicyReadyCount}/4`}
                  detail={t('settings.schedulerPolicyReadyDesc')}
                />
              </div>
              <SettingRow
                title={t('settings.enableAgentScheduling')}
                description={t('settings.enableAgentSchedulingDesc')}
                control={<Switch checked={agentSchedulingEnabled} onChange={setBooleanSetting('agentScheduling', setAgentSchedulingEnabled)} />}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.schedulerLiveQueue')}</strong>
                  <span>{t('settings.schedulerLiveQueueDesc')}</span>
                </div>
                {recentRuns.length > 0 || recentBridgeTasks.length > 0 ? (
                  <div className={styles.taskList}>
                    {recentRuns.slice(0, 3).map((run) => (
                      <TaskRunRow key={`scheduler-${run.runId}`} run={run} />
                    ))}
                    {recentBridgeTasks.slice(0, 3).map((task) => (
                      <HubTaskRow key={`scheduler-${task.taskId}`} task={task} />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.schedulerNoQueue')} description={t('settings.schedulerNoQueueDesc')} />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.schedulerTargets')}</strong>
                  <span>{t('settings.schedulerTargetsDesc')}</span>
                </div>
                <div className={styles.targetGrid}>
                  <ExecutionTargetCard
                    icon={<Monitor size={18} />}
                    title={t('settings.schedulerRouteLocal')}
                    description={t('settings.schedulerRouteLocalDesc')}
                    status={edgeOnline ? t('settings.enabled') : t('settings.offline')}
                    metric={schedulerLocalMetric}
                    connected={edgeOnline}
                  />
                  <ExecutionTargetCard
                    icon={<Globe2 size={18} />}
                    title={t('settings.schedulerRouteHub')}
                    description={t('settings.schedulerRouteHubDesc')}
                    status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                    metric={hubSessionActive ? t('settings.targetHubSignedIn') : t('settings.targetHubSignInRequired')}
                    connected={false}
                  />
                  <ExecutionTargetCard
                    icon={<Computer size={18} />}
                    title={t('settings.schedulerRouteRemote')}
                    description={t('settings.schedulerRouteRemoteDesc')}
                    status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                    metric="SSH / Tailscale"
                    connected={remoteControlReady}
                  />
                  <ExecutionTargetCard
                    icon={<Server size={18} />}
                    title={t('settings.schedulerRouteCloud')}
                    description={t('settings.schedulerRouteCloudDesc')}
                    status={t('settings.statusPlanned')}
                    metric="Cloud Edge"
                  />
                </div>
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.schedulerPolicy')}</strong>
                  <span>{t('settings.schedulerPolicyDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.schedulerPolicyModelMapping')}
                    description={t('settings.schedulerPolicyModelMappingDesc')}
                    status={modelMappingEnabled ? t('settings.enabled') : t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title={t('settings.schedulerPolicyCcSwitch')}
                    description={t('settings.schedulerPolicyCcSwitchDesc')}
                    status={ccSwitchBridge ? t('settings.enabled') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.schedulerPolicyRemote')}
                    description={t('settings.schedulerPolicyRemoteDesc')}
                    status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  />
                  <CapabilityCard
                    title={t('settings.schedulerPolicyApproval')}
                    description={t('settings.schedulerPolicyApprovalDesc')}
                    status={autoReview ? t('settings.enabled') : t('settings.approvalMode.manual')}
                  />
                </div>
              </div>
              <Callout title={t('settings.schedulerGuard')} body={t('settings.schedulerGuardDesc')} />
            </Panel>
          )}

          {active === 'agentMarket' && (
            <Panel title={t('settings.agentMarket')} description={t('settings.agentMarketDesc')}>
              {!hubSessionActive ? (
                <AuthGapBlock
                  title={t('settings.hubSignInRequired')}
                  description={t('settings.marketSignedOutDesc')}
                  actionLabel={t('settings.signIn')}
                  onAction={onOpenAuth}
                />
              ) : customAgentsQuery.isError ? (
                <EmptyBlock title={t('settings.hubUnavailable')} description={t('settings.marketHubErrorDesc')} />
              ) : null}
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.marketLocalProfiles')}
                  value={`${agents.length}`}
                  detail={edgeOnline ? t('settings.marketLocalProfilesDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.marketPublishReady')}
                  value={customAgentsQuery.isLoading ? t('settings.loading') : `${marketPublishReady}`}
                  detail={t('settings.marketPublishReadyDesc')}
                />
                <SummaryCard
                  icon={<Code2 size={18} />}
                  label={t('settings.marketCapabilities')}
                  value={`${marketCapabilityCount}`}
                  detail={t('settings.marketCapabilitiesDesc')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.marketHubSync')}
                  value={marketSnapshotStatus}
                  detail={hubSessionActive ? t('settings.marketHubSyncDesc') : t('settings.marketHubSyncSignedOut')}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <div className={styles.taskSectionTitleRow}>
                    <div>
                      <strong>{t('settings.marketInstalledProfiles')}</strong>
                      <span>{t('settings.marketInstalledProfilesDesc')}</span>
                    </div>
                    <div className={styles.taskSectionActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => void customAgentsQuery.refetch()}
                        disabled={!hubSessionActive || customAgentsQuery.isFetching}
                      >
                        <RefreshCw size={15} />
                        {customAgentsQuery.isFetching ? t('settings.marketRefreshing') : t('settings.marketRefresh')}
                      </button>
                    </div>
                  </div>
                </div>
                {customAgentsQuery.isLoading ? (
                  <EmptyBlock title={t('settings.loading')} description={t('settings.marketLoadingDesc')} />
                ) : customAgents.length > 0 ? (
                  <div className={styles.profileGrid}>
                    {customAgents.map((agent) => (
                      <AgentMarketCard key={`market-${agent.id}`} agent={agent} />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock
                    title={t('settings.marketNoProfiles')}
                    description={hubSessionActive ? t('settings.marketNoProfilesDesc') : t('settings.marketSignedOutDesc')}
                  />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.marketReleaseReadiness')}</strong>
                  <span>{t('settings.marketReleaseReadinessDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.agentTemplates')}
                    description={t('settings.agentTemplatesDesc')}
                    status={customAgents.length > 0 ? t('settings.statusReady') : t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title={t('settings.agentCapabilityTags')}
                    description={t('settings.agentCapabilityTagsDesc')}
                    status={marketCapabilityCount > 0 ? t('settings.statusReady') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.agentReviewFlow')}
                    description={t('settings.agentReviewFlowDesc')}
                    status={t('settings.status.interfaceGap')}
                  />
                  <CapabilityCard
                    title={t('settings.marketTokenDancePublish')}
                    description={t('settings.marketTokenDancePublishDesc')}
                    status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  />
                </div>
              </div>
              <Callout title={t('settings.marketGuard')} body={t('settings.marketGuardDesc')} />
            </Panel>
          )}

          {active === 'keyboard' && (
            <Panel title={t('settings.keyboard')} description={t('settings.keyboardDesc')}>
              <div className={styles.shortcutTable}>
                {shortcuts.map((shortcut) => (
                  <div key={`${shortcut.keys.join('+')}-${shortcut.action}`} className={styles.shortcutRow}>
                    <span>{shortcut.action}</span>
                    <div>
                      {shortcut.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {active === 'mcp' && (
            <Panel title={t('settings.mcp')} description={t('settings.mcpDesc')}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Plug size={18} />}
                  label={t('settings.mcpRuntimeSupport')}
                  value={`${mcpCapableAgents}/${agents.length}`}
                  detail={edgeOnline ? t('settings.mcpRuntimeSupportDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.mcpPermissionHooks')}
                  value={`${mcpPermissionHookAgents}`}
                  detail={t('settings.mcpPermissionHooksDesc')}
                />
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.mcpSubAgentSpawn')}
                  value={`${mcpSubAgentAgents}`}
                  detail={t('settings.mcpSubAgentSpawnDesc')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.mcpHubSync')}
                  value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  detail={hubSessionActive ? t('settings.mcpHubSyncNoInterface') : t('settings.mcpHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.enableMcp')}
                description={t('settings.enableMcpDesc')}
                control={<Switch checked={enableMcp && edgeOnline} onChange={setBooleanSetting('enableMcp', setEnableMcp)} disabled={!edgeOnline} />}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.mcpRuntimeMatrix')}</strong>
                  <span>{t('settings.mcpRuntimeMatrixDesc')}</span>
                </div>
                {agents.length > 0 ? (
                  <div className={styles.profileGrid}>
                    {agents.map((agent) => (
                      <McpRuntimeCard key={`mcp-${agent.id}`} agent={agent} />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.mcpNoRuntimes')} description={t('settings.mcpNoRuntimesDesc')} />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.mcpTemplates')}</strong>
                  <span>{t('settings.mcpTemplatesDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title="Filesystem"
                    description={t('settings.mcpFilesystem')}
                    status={t('settings.mcpTemplate')}
                  />
                  <CapabilityCard
                    title="GitHub"
                    description={t('settings.mcpGitHub')}
                    status={t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title={t('settings.mcpTokenDanceHub')}
                    description={t('settings.mcpTokenDanceHubDesc')}
                    status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  />
                  <CapabilityCard
                    title={t('settings.mcpRemoteServer')}
                    description={t('settings.mcpRemoteServerDesc')}
                    status={t('settings.status.interfaceGap')}
                  />
                </div>
              </div>
              <Callout title={t('settings.mcpGuard')} body={t('settings.mcpGuardDesc')} />
            </Panel>
          )}

          {active === 'skills' && (
            <Panel title={t('settings.skills')} description={t('settings.skillsDesc')}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Code2 size={18} />}
                  label={t('settings.skillProjectRegistry')}
                  value={`${PROJECT_SKILLS.length}`}
                  detail={t('settings.skillProjectRegistryDesc')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.skillReviewReady')}
                  value={`${skillReadyCount}/${PROJECT_SKILLS.length}`}
                  detail={t('settings.skillReviewReadyDesc')}
                />
                <SummaryCard
                  icon={<TerminalSquare size={18} />}
                  label={t('settings.skillScripts')}
                  value={`${skillScriptCount}`}
                  detail={t('settings.skillScriptsDesc')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.skillHubSync')}
                  value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
                  detail={hubSessionActive ? t('settings.skillHubSyncNoInterface') : t('settings.skillHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.skillSync')}
                description={t('settings.skillSyncDesc')}
                control={<Switch checked={false} onChange={setBooleanSetting('skillSync', setSkillSync)} disabled />}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.skillInstalled')}</strong>
                  <span>{t('settings.skillInstalledDesc')}</span>
                </div>
                <div className={styles.profileGrid}>
                  {PROJECT_SKILLS.map((skill) => (
                    <ProjectSkillCard key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.skillGovernance')}</strong>
                  <span>{t('settings.skillGovernanceDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.skillLocalRegistry')}
                    description={t('settings.skillLocalRegistryDesc')}
                    status=".agents/skills"
                  />
                  <CapabilityCard
                    title={t('settings.skillReview')}
                    description={t('settings.skillReviewDesc')}
                    status={`${skillReadyCount}/${PROJECT_SKILLS.length}`}
                  />
                  <CapabilityCard
                    title={t('settings.skillScriptAudit')}
                    description={t('settings.skillScriptAuditDesc')}
                    status={`${skillScriptCount}`}
                  />
                  <CapabilityCard
                    title={t('settings.skillReferences')}
                    description={t('settings.skillReferencesDesc')}
                    status={`${skillReferenceCount}`}
                  />
                </div>
              </div>
              <Callout title={t('settings.skillGuard')} body={t('settings.skillGuardDesc')} />
            </Panel>
          )}

          {active === 'hooks' && (
            <Panel title={t('settings.hooks')} description={t('settings.hooksDesc')}>
              <SettingRow
                title={t('settings.enableHooks')}
                description={t('settings.enableHooksDesc')}
                control={<Switch checked={enableHooks} onChange={setBooleanSetting('enableHooks', setEnableHooks)} />}
              />
              <SettingRow title="pre-run" description={t('settings.hookPreRun')} value={t('settings.notConfigured')} />
              <SettingRow title="post-run" description={t('settings.hookPostRun')} value={t('settings.notConfigured')} />
            </Panel>
          )}

          {active === 'models' && (
            <Panel title={t('settings.models')} description={t('settings.modelsDesc')}>
              <SettingRow
                title={t('settings.modelConfigSource')}
                description={t('settings.modelConfigSourceDesc')}
                value={t('settings.status.localSource')}
              />
              <SettingRow
                title={t('settings.modelDefault')}
                description={t('settings.modelDefaultDesc')}
                control={
                  <SelectControl
                    value={defaultModel}
                    options={MODEL_OPTIONS.map(([value, label]) => [value, label])}
                    onChange={setDefaultModel}
                  />
                }
              />
              <SettingRow
                title={t('settings.modelDefaultProvider')}
                description={t('settings.modelDefaultProviderDesc')}
                control={
                  <SelectControl
                    value={defaultProvider}
                    options={PROVIDER_OPTIONS.map(([value, label]) => [value, label])}
                    onChange={setDefaultProvider}
                  />
                }
              />
              <SettingRow
                title={t('settings.modelReasoning')}
                description={t('settings.modelReasoningDesc')}
                control={
                  <SelectControl
                    value={modelReasoningEffort}
                    options={REASONING_OPTIONS.map(([value, label]) => [value, label])}
                    onChange={(value) => setModelReasoningEffort(value as ReasoningEffortPreference)}
                  />
                }
              />
              <SettingRow
                title={t('settings.modelProviderFallback')}
                description={t('settings.modelProviderFallbackDesc')}
                control={<Switch checked={providerFallbackEnabled} onChange={setProviderFallbackEnabled} />}
              />
              <Callout title={t('settings.modelLocalGuard')} body={t('settings.modelLocalGuardDesc')} />
            </Panel>
          )}

          {active === 'modelMapping' && (
            <Panel title={t('settings.modelMapping')} description={t('settings.modelMappingDesc')}>
              <SettingRow
                title={t('settings.modelMappingSource')}
                description={t('settings.modelMappingSourceDesc')}
                value={t('settings.status.localSource')}
              />
              <SettingRow
                title={t('settings.enableModelMapping')}
                description={t('settings.enableModelMappingDesc')}
                control={<Switch checked={modelMappingEnabled} onChange={setModelMappingEnabled} />}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.modelAlias')}</strong>
                  <span>{t('settings.modelAliasDesc')}</span>
                </div>
                <div className={styles.modelAliasList}>
                  {modelAliases.map((item) => (
                    <AliasMappingRow
                      key={item.alias}
                      alias={item.alias}
                      model={item.model}
                      provider={item.provider}
                      reasoningEffort={item.reasoningEffort}
                      enabled={item.enabled}
                      onToggle={() => toggleModelAlias(item.alias)}
                      onModelChange={(model) => updateModelAlias(item.alias, { model })}
                      onProviderChange={(provider) => updateModelAlias(item.alias, { provider })}
                      onReasoningChange={(reasoningEffort) => updateModelAlias(item.alias, { reasoningEffort })}
                    />
                  ))}
                </div>
              </div>
              <Callout title={t('settings.modelPolicy')} body={t('settings.modelPolicyDesc')} />
            </Panel>
          )}

          {active === 'ccSwitch' && (
            <Panel title={t('settings.ccSwitch')} description={t('settings.ccSwitchDesc')}>
              <SettingRow
                title={t('settings.ccSwitchSource')}
                description={t('settings.ccSwitchSourceDesc')}
                value={t('settings.status.localSource')}
              />
              <SettingRow
                title={t('settings.ccSwitchBridge')}
                description={t('settings.ccSwitchBridgeDesc')}
                control={<Switch checked={ccSwitchBridge} onChange={setCcSwitchBridge} />}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.ccSwitchProviders')}</strong>
                  <span>{t('settings.ccSwitchProvidersDesc')}</span>
                </div>
                <div className={styles.providerList}>
                  {ccSwitchProviders.map((provider) => (
                    <ProviderHealthRow
                      key={provider.id}
                      id={provider.id}
                      name={provider.name}
                      health={provider.health}
                      modelCount={provider.modelCount}
                      notes={provider.notes}
                      onHealthChange={(health) => updateCcSwitchProvider(provider.id, { health })}
                      onNotesChange={(notes) => updateCcSwitchProvider(provider.id, { notes })}
                    />
                  ))}
                </div>
              </div>
              <Callout title={t('settings.ccSwitchHealth')} body={t('settings.ccSwitchHealthDesc')} />
            </Panel>
          )}

          {active === 'connections' && (
            <Panel title={t('settings.connections')} description={t('settings.connectionsDesc')}>
              <ConnectionRow
                name="Hub"
                description={hubSessionActive ? t('status.hubConnected') : t('status.hubDisconnected')}
                connected={hubSessionActive}
                onlineLabel={t('settings.online')}
                offlineLabel={t('settings.offline')}
              />
              <ConnectionRow
                name="Edge"
                description={`${t('settings.edgeLocal')} · ${runnerSummary}`}
                connected={edgeOnline}
                onlineLabel={t('settings.online')}
                offlineLabel={t('settings.offline')}
              />
              <ConnectionRow
                name="WebSocket"
                description={t('status.wsConnected')}
                connected={edgeOnline}
                onlineLabel={t('settings.online')}
                offlineLabel={t('settings.offline')}
              />
            </Panel>
          )}

          {active === 'remoteControl' && (
            <Panel title={t('settings.remoteControl')} description={t('settings.remoteControlDesc')}>
              <SettingRow
                title={t('settings.remoteControlEnable')}
                description={t('settings.remoteControlEnableDesc')}
                control={<Switch checked={false} onChange={setBooleanSetting('remoteControl', setRemoteControlEnabled)} disabled />}
              />
              <SettingRow title={t('settings.remoteControlApproval')} description={t('settings.remoteControlApprovalDesc')} value={t('settings.approvalMode.ask')} />
              <SettingRow
                title={t('settings.remoteControlDevices')}
                description={t('settings.remoteControlDevicesDesc')}
                value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
              />
            </Panel>
          )}

          {active === 'git' && (
            <Panel title={t('settings.git')} description={t('settings.gitDesc')}>
              <SettingRow
                title={t('settings.autoDetectGit')}
                description={t('settings.autoDetectGitDesc')}
                control={
                  <Switch checked={autoDetectGit} onChange={setBooleanSetting('autoDetectGit', setAutoDetectGit)} />
                }
              />
              <SettingRow title={t('settings.branchPolicy')} description="feat/* -> dev/delicious233 -> master" />
              <SettingRow title={t('settings.commitStyle')} description="type(scope): summary" />
            </Panel>
          )}

          {active === 'environment' && (
            <Panel title={t('settings.environment')} description={t('settings.environmentDesc')}>
              <SettingRow title="Shell" description="PowerShell 7" value="pwsh" />
              <SettingRow title="Node" description={t('settings.environmentNodeDesc')} value="pnpm" />
              <SettingRow title="Tauri" description={t('settings.environmentTauriDesc')} value={t('settings.enabled')} />
            </Panel>
          )}

          {active === 'worktree' && (
            <Panel title={t('settings.worktree')} description={t('settings.worktreeDesc')}>
              <SettingRow title={t('settings.defaultWorkspace')} description="D:\\Code\\TokenDance" />
              <SettingRow
                title={t('settings.worktreeIsolation')}
                description={t('settings.worktreeIsolationDesc')}
                control={
                  <Switch
                    checked={worktreeIsolation}
                    onChange={setBooleanSetting('worktreeIsolation', setWorktreeIsolation)}
                  />
                }
              />
              <SettingRow title={t('settings.worktreePolicy')} description=".worktrees/<feature>" />
            </Panel>
          )}

          {active === 'browser' && (
            <Panel title={t('settings.browser')} description={t('settings.browserDesc')}>
              <SettingRow
                title={t('settings.browserPreview')}
                description={t('settings.browserPreviewDesc')}
                control={
                  <Switch checked={browserPreview} onChange={setBooleanSetting('browserPreview', setBrowserPreview)} />
                }
              />
              <SettingRow title={t('settings.browserEngine')} description="Chromium / Playwright" value="Auto" />
            </Panel>
          )}

          {active === 'computerUse' && (
            <Panel title={t('settings.computerUse')} description={t('settings.computerUseDesc')}>
              <SettingRow
                title={t('settings.computerConfirm')}
                description={t('settings.computerConfirmDesc')}
                control={
                  <Switch
                    checked={computerConfirm}
                    onChange={setBooleanSetting('computerConfirm', setComputerConfirm)}
                  />
                }
              />
              <Callout title={t('settings.computerUseGuard')} body={t('settings.computerUseGuardDesc')} />
            </Panel>
          )}

          {active === 'platforms' && (
            <Panel title={t('settings.platforms')} description={t('settings.platformsDesc')}>
              <SettingRow
                title={t('settings.platformSync')}
                description={t('settings.platformSyncDesc')}
                control={<Switch checked={false} onChange={setBooleanSetting('platformSync', setPlatformSync)} disabled />}
              />
              <SettingRow
                title={t('settings.platformSyncSource')}
                description={t('settings.platformSyncSourceDesc')}
                value={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')}
              />
              <div className={styles.capabilityGrid}>
                <CapabilityCard title="macOS" description={t('settings.platformMacosDesc')} status={t('settings.status.localSource')} />
                <CapabilityCard title="Windows" description={t('settings.platformWindowsDesc')} status={t('settings.status.localSource')} />
                <CapabilityCard title="Android" description={t('settings.platformAndroidDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
                <CapabilityCard title="Web" description={t('settings.platformWebDesc')} status={hubSessionActive ? t('settings.status.interfaceGap') : t('settings.status.loginLocked')} />
              </div>
            </Panel>
          )}

          {active === 'account' && (
            <Panel title={t('settings.account')} description={t('settings.accountDesc')}>
              <div className={styles.accountCard}>
                <UserCircle size={34} />
                <div className={styles.accountInfo}>
                  <strong>{hubSessionActive ? accountName : t('settings.notSignedIn')}</strong>
                  <span>{hubSessionActive ? t('settings.accountConnected') : t('settings.accountDisconnected')}</span>
                </div>
                {hubSessionActive ? (
                  <button className={styles.secondaryBtn} onClick={handleSignOut}>
                    <LogOut size={16} />
                    {t('settings.signOut')}
                  </button>
                ) : (
                  <button className={styles.primaryBtn} onClick={onOpenAuth}>
                    <LogIn size={16} />
                    {t('settings.signIn')}
                  </button>
                )}
              </div>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<LockKeyhole size={18} />}
                  label={t('settings.hubSession')}
                  value={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubSessionActive ? t('settings.hubSessionDesc') : t('settings.hubSessionSignedOutDesc')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label="TokenDance ID"
                  value={tokenSource === 'tokendance' ? t('settings.enabled') : t('settings.statusInProgress')}
                  detail={tokenSource === 'tokendance' ? t('settings.tokenDanceSessionDesc') : t('settings.tokenDanceOidcPendingDesc')}
                />
                <SummaryCard
                  icon={<Monitor size={18} />}
                  label={t('settings.desktopDevice')}
                  value={desktopDeviceStatus}
                  detail={
                    deviceRegistration.status === 'error'
                      ? deviceRegistration.error ?? t('settings.desktopDeviceRegisterFailed')
                      : deviceId
                        ? shortId(deviceId)
                        : t('settings.desktopDeviceMissingDesc')
                  }
                />
                <SummaryCard
                  icon={<Route size={18} />}
                  label={t('settings.syncScope')}
                  value={deviceRegistration.status === 'registered' ? t('settings.enabled') : t('settings.signedOut')}
                  detail={t('settings.syncScopeDesc')}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.identityBoundary')}</strong>
                  <span>{t('settings.identityBoundaryDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.hubSession')}
                    description={t('settings.hubSessionCapabilityDesc')}
                    status={hubSessionActive ? t('settings.statusReady') : t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title="TokenDance ID OIDC"
                    description={t('settings.tokenDanceOidcDesc')}
                    status={pkceStateReady ? t('settings.statusInProgress') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.authTokenSource')}
                    description={t('settings.authTokenSourceDesc')}
                    status={tokenSourceLabel}
                  />
                  <CapabilityCard
                    title={t('settings.deviceProof')}
                    description={t('settings.deviceProofDesc')}
                    status={t(`settings.deviceStatus.${deviceRegistration.status}`)}
                  />
                </div>
              </div>
              <SettingRow title={t('settings.hubEndpoint')} description={HUB_URL} value={hubSessionActive ? t('settings.enabled') : t('settings.notConfigured')} />
              <SettingRow title={t('settings.appVersion')} description={APP_VERSION} value={t('settings.statusReady')} />
              <Callout title={t('settings.accountGuard')} body={t('settings.accountGuardDesc')} />
            </Panel>
          )}

          {active === 'securityAudit' && (
            <Panel title={t('settings.securityAudit')} description={t('settings.securityAuditDesc')}>
              <SettingRow
                title={t('settings.auditTrail')}
                description={t('settings.auditTrailDesc')}
                control={<Switch checked={auditTrail} onChange={setBooleanSetting('auditTrail', setAuditTrail)} />}
              />
              <SettingRow
                title={t('settings.auditTrailSource')}
                description={t('settings.auditTrailSourceDesc')}
                value={auditTrail ? t('settings.status.localSource') : t('settings.notConfigured')}
              />
              <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.status.interfaceGap')} />
              <SettingRow title={t('settings.secretScan')} description={t('settings.secretScanDesc')} value={t('settings.status.interfaceGap')} />
              <Callout title={t('settings.securityGuard')} body={t('settings.securityGuardDesc')} />
            </Panel>
          )}

          {active === 'archived' && (
            <Panel title={t('settings.archived')} description={t('settings.archivedDesc')}>
              <EmptyBlock title={t('settings.noArchived')} description={t('settings.noArchivedDesc')} />
            </Panel>
          )}
        </div>
      </main>
    </div>
  );
}

function useStoredBooleanState(key: string, fallback: boolean) {
  return useState(() => readStoredBoolean(key, fallback));
}

function useStoredValueState<T extends string>(key: string, fallback: T) {
  return useState<T>(() => readStoredValue(key, fallback));
}

function isActiveRun(run: RunInfo) {
  return ['queued', 'started', 'running', 'cancelling'].includes(run.status);
}

function isActiveBridgeTask(task: AgentTask) {
  return task.status === 'queued' || task.status === 'running';
}

function getRecentRuns(runs: RunInfo[], limit: number) {
  return [...runs]
    .sort((a, b) => timestampOf(b.finishedAt ?? b.startedAt ?? b.createdAt) - timestampOf(a.finishedAt ?? a.startedAt ?? a.createdAt))
    .slice(0, limit);
}

function getRecentTasks(tasks: AgentTask[], limit: number) {
  return [...tasks].sort((a, b) => timestampOf(b.createdAt) - timestampOf(a.createdAt)).slice(0, limit);
}

function countAgentCapabilities(agents: AgentInfo[]) {
  const names = new Set<string>();
  for (const agent of agents) {
    for (const [name, enabled] of Object.entries(agent.capabilities)) {
      if (enabled) names.add(name);
    }
  }
  return names.size;
}

function timestampOf(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatTimestamp(value?: string) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(value?: string) {
  if (!value) return '--';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

function TaskRunRow({
  run,
  onCancel,
  cancelling = false,
}: {
  run: RunInfo;
  onCancel?: (runId: string) => void;
  cancelling?: boolean;
}) {
  const { t } = useTranslation();
  const timestamp = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <Route size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{shortId(run.runId)}</strong>
        <span>{run.projectId} / {run.threadId}</span>
        <div className={styles.taskMeta}>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${isActiveRun(run) ? styles.statusPillOn : ''}`}>
        {t(`run.status.${run.status}`, { defaultValue: run.status })}
      </span>
      {onCancel ? (
        <button
          type="button"
          className={`${styles.secondaryBtn} ${styles.taskRowAction}`}
          onClick={() => onCancel(run.runId)}
          disabled={cancelling}
          aria-label={t('settings.taskCancelRun')}
          title={t('settings.taskCancelRun')}
        >
          <XCircle size={15} />
          {cancelling ? t('settings.taskCancellingRun') : t('settings.taskCancelRun')}
        </button>
      ) : null}
    </div>
  );
}

function HubTaskRow({ task }: { task: AgentTask }) {
  const { t } = useTranslation();
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <ClipboardList size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{shortId(task.taskId)}</strong>
        <span>{task.prompt}</span>
        <div className={styles.taskMeta}>
          <span>{task.agentId}</span>
          <span>{task.runId ? shortId(task.runId) : t('settings.taskUnbound')}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${isActiveBridgeTask(task) ? styles.statusPillOn : ''}`}>
        {t(`settings.taskStatus.${task.status}`, { defaultValue: task.status })}
      </span>
    </div>
  );
}

function HubSessionRow({ session }: { session: Session }) {
  const { t } = useTranslation();
  const sessionId = sessionIdOfSettings(session);
  const timestamp = session.last_message_at ?? session.updated_at ?? session.created_at;
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <MessageSquareText size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{session.name || shortId(sessionId)}</strong>
        <span>{sessionId}</span>
        <div className={styles.taskMeta}>
          <span>{session.type}</span>
          <span>{t('settings.memberCount', { count: session.member_count ?? session.members?.length ?? 0 })}</span>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${styles.statusPillOn}`}>
        {t('settings.enabled')}
      </span>
    </div>
  );
}

function HubFriendRequestRow({ request }: { request: FriendRequestInfo }) {
  const { t } = useTranslation();
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <UserCircle size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{request.nickname || request.username || request.user_id}</strong>
        <span>{request.message || t('settings.onlineImFriendRequestNoMessage')}</span>
        <div className={styles.taskMeta}>
          <span>{t('settings.onlineImFriendRequests')}</span>
          <span>{request.user_id}</span>
          <span>{formatTimestamp(request.created_at)}</span>
        </div>
      </div>
      <span className={styles.statusPill}>{t('settings.readOnly')}</span>
    </div>
  );
}

function HubNotificationRow({ notification }: { notification: HubNotification }) {
  const { t } = useTranslation();
  const payload = parseNotificationPayload(notification.payload);
  const title = payload.title || payload.subject || notification.type || notification.id;
  const body =
    payload.content ||
    payload.message ||
    payload.text ||
    payload.body ||
    t('settings.onlineImNotificationNoBody');
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <Globe2 size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{body}</span>
        <div className={styles.taskMeta}>
          <span>{notification.read ? t('settings.onlineImNotificationRead') : t('settings.onlineImNotificationUnread')}</span>
          <span>{notification.type || t('settings.onlineImNotifications')}</span>
          <span>{formatTimestamp(notification.created_at)}</span>
        </div>
      </div>
      <span className={styles.statusPill}>{t('settings.readOnly')}</span>
    </div>
  );
}

function parseNotificationPayload(payload: string): Record<string, string> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className={`${styles.modeCard} ${active ? styles.modeCardActive : ''}`} onClick={onClick}>
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {active ? <Check size={16} className={styles.modeCheck} /> : null}
    </button>
  );
}

function CapabilityCard({ title, description, status }: { title: string; description: string; status: string }) {
  return (
    <div className={styles.capabilityCard}>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{status}</em>
    </div>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryIcon}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function AliasMappingRow({
  alias,
  model,
  provider,
  reasoningEffort,
  enabled,
  onToggle,
  onModelChange,
  onProviderChange,
  onReasoningChange,
}: {
  alias: string;
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffortPreference;
  enabled: boolean;
  onToggle: () => void;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onReasoningChange: (reasoningEffort: ReasoningEffortPreference) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.modelAliasRow}>
      <div className={styles.modelAliasHead}>
        <div>
          <strong>{alias}</strong>
          <span>{t('settings.modelAliasRoute', { model, provider })}</span>
        </div>
        <Switch checked={enabled} onChange={onToggle} />
      </div>
      <div className={styles.modelAliasControls}>
        <label>
          <span>{t('settings.modelAliasModel')}</span>
          <SelectControl
            value={model}
            options={MODEL_OPTIONS.filter(([value]) => value !== 'auto').map(([value, label]) => [value, label])}
            onChange={onModelChange}
          />
        </label>
        <label>
          <span>{t('settings.modelAliasProvider')}</span>
          <SelectControl
            value={provider}
            options={PROVIDER_OPTIONS.map(([value, label]) => [value, label])}
            onChange={onProviderChange}
          />
        </label>
        <label>
          <span>{t('settings.modelAliasReasoning')}</span>
          <SelectControl
            value={reasoningEffort}
            options={REASONING_OPTIONS.map(([value, label]) => [value, label])}
            onChange={(value) => onReasoningChange(value as ReasoningEffortPreference)}
          />
        </label>
      </div>
    </div>
  );
}

function ProviderHealthRow({
  id,
  name,
  health,
  modelCount,
  notes,
  onHealthChange,
  onNotesChange,
}: {
  id: string;
  name: string;
  health: ProviderHealth;
  modelCount: number;
  notes: string;
  onHealthChange: (health: ProviderHealth) => void;
  onNotesChange: (notes: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.providerRow}>
      <div className={styles.providerMain}>
        <div className={styles.connectionIcon}>
          <Plug size={17} />
        </div>
        <div className={styles.settingCopy}>
          <strong>{name}</strong>
          <span>{id}</span>
          <div className={styles.taskMeta}>
            <span>{t('settings.ccSwitchModelCount', { count: modelCount })}</span>
          </div>
        </div>
        <span className={`${styles.statusPill} ${health === 'ready' ? styles.statusPillOn : ''}`}>
          {t(`settings.providerHealth.${health}`)}
        </span>
      </div>
      <div className={styles.providerControls}>
        <label>
          <span>{t('settings.ccSwitchHealth')}</span>
          <SelectControl
            value={health}
            options={PROVIDER_HEALTH_OPTIONS.map(([value, label]) => [value, label])}
            onChange={(value) => onHealthChange(value as ProviderHealth)}
          />
        </label>
        <label>
          <span>{t('settings.ccSwitchNotes')}</span>
          <textarea
            className={styles.textInput}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function RuntimeInventoryCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.description || t('settings.runtimeDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles[`profileStatus_${agent.status}`]}`}>
          {t(`agent.status.${agent.status}`)}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.runtimeAdapter')}: {agent.id}</span>
        <span>{t('settings.profileRuntime')}: {t('settings.statusReady')}</span>
        <span>{t('settings.profileModel')}: {t('settings.statusPlanned')}</span>
        <span>{t('settings.profileConfig')}: {t('settings.statusPlanned')}</span>
      </div>
    </div>
  );
}

function LocalAgentProfileCard({
  agent,
  alias,
  route,
  edgeOnline,
}: {
  agent: AgentInfo;
  alias?: string;
  route: ResolvedRunModelSettings;
  edgeOnline: boolean;
}) {
  const { t } = useTranslation();
  const profileReady = edgeOnline && agent.status === 'available';
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{t('settings.localProfileName', { runtime: agent.name })}</strong>
          <span>{t('settings.localProfileDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${profileReady ? styles.profileStatus_available : styles.profileStatus_configuring}`}>
          {profileReady ? t('settings.enabled') : t('settings.notConfigured')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.profileModel')}: {route.model ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasProvider')}: {route.provider ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasReasoning')}: {route.reasoningEffort ?? t('prompt.routeAuto')}</span>
        {alias ? <span>{t('settings.profileAlias')}: {alias}</span> : null}
        <span>{t('settings.executionTargets')}: {t('settings.targetLocalEdge')}</span>
        <span>{t('settings.profileConfigSource')}: AGENTS.md / memory / skills</span>
      </div>
    </div>
  );
}

function AgentMarketCard({ agent }: { agent: CustomAgentMarketItem }) {
  const { t } = useTranslation();

  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.systemPrompt || t('settings.marketProfileDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles.profileStatus_available}`}>
          {t('settings.statusReady')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.marketCustomAgentId')}: {agent.id}</span>
        <span>{t('settings.marketAgentType')}: {agent.agentType}</span>
        <span>{t('settings.marketInstallSource')}: {agent.source}</span>
        <span>{t('settings.marketPublishStatus')}: {t('settings.statusReady')}</span>
        {agent.updatedAt ? <span>{t('settings.marketUpdatedAt')}: {formatTimestamp(agent.updatedAt)}</span> : null}
      </div>
      <div className={styles.profileMeta}>
        {agent.capabilities.length > 0 ? (
          agent.capabilities.map((name) => <span key={name}>{name}</span>)
        ) : (
          <span>{t('settings.marketNoCapabilityTags')}</span>
        )}
      </div>
    </div>
  );
}

function ProjectSkillCard({ skill }: { skill: ProjectSkill }) {
  const { t } = useTranslation();
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Code2 size={17} />
        </div>
        <div>
          <strong>{skill.title}</strong>
          <span>{t(skill.descriptionKey)}</span>
        </div>
        <em className={`${styles.profileStatus} ${skill.status === 'ready' ? styles.profileStatus_available : styles.profileStatus_configuring}`}>
          {skill.status === 'ready' ? t('settings.statusReady') : t('settings.statusInProgress')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.skillLocalRegistry')}: .agents/skills/{skill.id}</span>
        <span>{t('settings.skillScripts')}: {skill.hasScripts ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.skillReferences')}: {skill.hasReferences ? t('settings.enabled') : t('settings.notConfigured')}</span>
      </div>
    </div>
  );
}

function McpRuntimeCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const { mcpIntegration, permissionHooks, subAgentSpawn } = agent.capabilities;
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Plug size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.description || t('settings.mcpRuntimeDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${mcpIntegration ? styles.profileStatus_available : styles.profileStatus_configuring}`}>
          {mcpIntegration ? t('settings.statusReady') : t('settings.notConfigured')}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.mcpIntegration')}: {mcpIntegration ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpPermissionHooks')}: {permissionHooks ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpSubAgentSpawn')}: {subAgentSpawn ? t('settings.enabled') : t('settings.notConfigured')}</span>
      </div>
    </div>
  );
}

function ExecutionTargetCard({
  icon,
  title,
  description,
  status,
  metric,
  connected = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  metric: string;
  connected?: boolean;
}) {
  return (
    <div className={styles.targetCard}>
      <div className={styles.targetTop}>
        <div className={styles.targetIcon}>{icon}</div>
        <span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>{status}</span>
      </div>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{metric}</em>
    </div>
  );
}

function RunnerRow({ runner }: { runner: RunnerHealthItem }) {
  return (
    <div className={styles.runnerRow}>
      <div className={styles.connectionIcon}>
        <Cpu size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{runner.name}</strong>
        <span>{runner.capabilities?.join(' / ') || runner.id}</span>
      </div>
      <span className={`${styles.statusPill} ${runner.status === 'online' ? styles.statusPillOn : ''}`}>
        {runner.status}
      </span>
    </div>
  );
}

function SettingRow({
  title,
  description,
  value,
  control,
  action,
}: {
  title: string;
  description: string;
  value?: string;
  control?: ReactNode;
  action?: boolean;
}) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {control ?? (value ? <span className={styles.settingValue}>{value}</span> : null)}
      {action ? <ChevronRight size={17} className={styles.rowChevron} /> : null}
    </div>
  );
}

function ConnectionRow({
  name,
  description,
  connected,
  onlineLabel,
  offlineLabel,
}: {
  name: string;
  description: string;
  connected: boolean;
  onlineLabel: string;
  offlineLabel: string;
}) {
  return (
    <div className={styles.connectionRow}>
      <div className={styles.connectionIcon}>
        <Link2 size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{name}</strong>
        <span>{description}</span>
      </div>
      <span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>
        {connected ? onlineLabel : offlineLabel}
      </span>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function AuthGapBlock({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className={styles.authGapBlock}>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button type="button" className={styles.primaryBtn} onClick={onAction}>
        <LogIn size={16} />
        {actionLabel}
      </button>
    </div>
  );
}

function normalizeCustomAgent(raw: Record<string, unknown>): CustomAgentMarketItem {
  const id = readUnknownString(raw.id) ?? readUnknownString(raw.agent_id) ?? readUnknownString(raw.custom_agent_id) ?? 'custom-agent';
  const capabilityTags = readUnknownArray(raw.capability_tags);
  return {
    id,
    name: readUnknownString(raw.name) ?? id,
    agentType: readUnknownString(raw.agent_type) ?? readUnknownString(raw.type) ?? 'custom',
    systemPrompt: readUnknownString(raw.system_prompt) ?? readUnknownString(raw.description) ?? '',
    capabilities: capabilityTags.length > 0 ? capabilityTags : readUnknownArray(raw.capabilities),
    source: '/web/custom-agents',
    updatedAt: readUnknownString(raw.updated_at) ?? readUnknownString(raw.created_at),
  };
}

function sessionIdOfSettings(session: Session) {
  return session.session_id ?? session.id ?? 'session';
}

function readUnknownString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readUnknownArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return readUnknownArray(parsed);
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function SelectControl({
  value,
  options,
  onChange,
}: {
  value: SettingsSelectValue;
  options: Array<[SettingsSelectValue, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Callout({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.callout}>
      <ShieldCheck size={18} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

function EmptyBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyBlock}>
      <Archive size={24} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function statusLabelFromQuery({
  signedIn,
  isLoading,
  isFetching,
  isError,
  isSuccess,
  t,
}: {
  signedIn: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  t: (key: string) => string;
}) {
  if (!signedIn) return t('settings.status.loginLocked');
  if (isError) return t('settings.status.error');
  if (isLoading || isFetching || !isSuccess) return t('settings.loading');
  return t('settings.status.snapshot');
}

function statusLabelFromDevice({
  signedIn,
  status,
  registeredLabel = 'snapshot',
  idleLabel = 'localSource',
  t,
}: {
  signedIn: boolean;
  status: 'idle' | 'registering' | 'registered' | 'error';
  registeredLabel?: 'snapshot' | 'registered';
  idleLabel?: 'localSource' | 'deviceStatus';
  t: (key: string) => string;
}) {
  if (!signedIn) return t('settings.status.loginLocked');
  if (status === 'error') return t('settings.status.error');
  if (status === 'registered') {
    return registeredLabel === 'registered' ? t('settings.deviceStatus.registered') : t('settings.status.snapshot');
  }
  if (status === 'registering') return t('settings.deviceStatus.registering');
  return idleLabel === 'deviceStatus' ? t('settings.deviceStatus.idle') : t('settings.status.localSource');
}
