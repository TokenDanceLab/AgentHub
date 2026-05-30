import { type ReactNode, useMemo, useState } from 'react';
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
import { useAgentList } from '@/api/agentQueries';
import {
  summarizeExecutionTargets,
  useHubExecutionTargets,
  usePingHubExecutionTarget,
  type ExecutionTargetInventoryItem,
} from '@/api/executionTargetQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import {
  useModelSettingsStore,
  type ProviderHealth,
  type ReasoningEffortPreference,
  type ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import {
  getSurfaceByDesktopSectionId,
  getSurfaceStatusMetadata,
  type SurfaceMetadata,
} from '@shared/surfaceMetadata';
import { ActivityCard } from '@shared/ui';
import type { AgentInfo, RunInfo, RunnerHealthItem } from '@shared/types';
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
  description: string;
  sourceLabel: string;
  statusLabel: string;
  icon: ReactNode;
  group: 'workspace' | 'automation' | 'system';
  surface?: SurfaceMetadata;
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

const STORAGE_PREFIX = 'agenthub-settings.';
const DEVICE_ID_KEY = 'agenthub_device_id';
const OIDC_PENDING_KEY = 'agenthub_oidc_pkce_pending';

const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance Gateway'],
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

function buildNavItem(
  id: SectionId,
  labelKey: string,
  icon: ReactNode,
  group: NavItem['group'],
  t: ReturnType<typeof useTranslation>['t'],
): NavItem {
  const surface = getSurfaceByDesktopSectionId(id);
  const status = surface ? getSurfaceStatusMetadata(surface.defaultStatus) : null;
  const item = {
    id,
    label: t(surface?.labelKey ?? labelKey),
    description: surface
      ? t(surface.descriptionKey)
      : t(`settings.webLocal.${id}.description`, { defaultValue: t('settings.webLocal.description') }),
    sourceLabel: surface ? t('settings.sharedDesktopSection') : t('settings.webLocal.section'),
    statusLabel: status ? t(status.labelKey) : t('settings.webLocal.status'),
    icon,
    group,
  };

  return surface ? { ...item, surface } : item;
}

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

function hasPendingBrowserOIDC() {
  const raw = readBrowserStorage('session', OIDC_PENDING_KEY);
  if (!raw) return false;
  try {
    const pending = JSON.parse(raw) as {
      state?: unknown;
      codeVerifier?: unknown;
      deviceId?: unknown;
      redirectUri?: unknown;
    };
    return [pending.state, pending.codeVerifier, pending.deviceId, pending.redirectUri].every(
      (value) => typeof value === 'string' && value.length > 0,
    );
  } catch {
    return false;
  }
}

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general' }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const hubAuth = useAuth();
  const [active, setActive] = useState<SectionId>(initialSection);
  const { online: edgeOnline, health } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const {
    data: hubTargetData,
    isError: hubTargetsError,
    isFetching: hubTargetsFetching,
    isLoading: hubTargetsLoading,
  } = useHubExecutionTargets(active === 'executionTargets' || active === 'agentScheduling');
  const pingHubTargetMutation = usePingHubExecutionTarget();
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
  const [compactMode, setCompactMode] = useStoredBooleanState('compactMode', false);
  const [autoReview, setAutoReview] = useStoredBooleanState('autoReview', true);
  const [fullAccess, setFullAccess] = useStoredBooleanState('fullAccess', false);
  const [enableMcp, setEnableMcp] = useStoredBooleanState('enableMcp', true);
  const [skillSync, setSkillSync] = useStoredBooleanState('skillSync', true);
  const [taskSync, setTaskSync] = useStoredBooleanState('taskSync', true);
  const [groupChatEnabled, setGroupChatEnabled] = useStoredBooleanState('groupChat', true);
  const [agentSchedulingEnabled, setAgentSchedulingEnabled] = useStoredBooleanState('agentScheduling', true);
  const [enableHooks, setEnableHooks] = useStoredBooleanState('enableHooks', false);
  const [remoteControlEnabled, setRemoteControlEnabled] = useStoredBooleanState('remoteControl', false);
  const [autoDetectGit, setAutoDetectGit] = useStoredBooleanState('autoDetectGit', true);
  const [worktreeIsolation, setWorktreeIsolation] = useStoredBooleanState('worktreeIsolation', true);
  const [browserPreview, setBrowserPreview] = useStoredBooleanState('browserPreview', true);
  const [computerConfirm, setComputerConfirm] = useStoredBooleanState('computerConfirm', true);
  const [platformSync, setPlatformSync] = useStoredBooleanState('platformSync', true);
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
  const agents = agentData?.items ?? [];
  const hubTargets = hubTargetData?.items ?? [];
  const hubTargetSummary = useMemo(() => summarizeExecutionTargets(hubTargets), [hubTargets]);
  const localTargetCount = hubTargetSummary.byType.local_edge;
  const hubRelayCount = hubTargetSummary.byType.hub_relay;
  const remoteTargetCount = hubTargetSummary.byType.remote_ssh + hubTargetSummary.byType.tailscale;
  const cloudTargetCount = hubTargetSummary.byType.cloud_edge;
  const localTargetOnline = hubTargets.some((target) => target.target_type === 'local_edge' && target.is_online);
  const hubRelayOnline = hubTargets.some((target) => target.target_type === 'hub_relay' && target.is_online);
  const remoteTargetOnline = hubTargets.some(
    (target) => (target.target_type === 'remote_ssh' || target.target_type === 'tailscale') && target.is_online,
  );
  const cloudTargetOnline = hubTargets.some((target) => target.target_type === 'cloud_edge' && target.is_online);
  const hubTargetInventoryMetric = hubAuthenticated
    ? t('settings.targetInventoryMetric', { total: hubTargetSummary.total, online: hubTargetSummary.online })
    : t('settings.targetHubSignInRequired');
  const hubTargetHealthMetric = hubTargetSummary.total > 0
    ? t('settings.targetHealthMetric', {
        healthy: hubTargetSummary.healthy,
        degraded: hubTargetSummary.degraded,
        offline: hubTargetSummary.offline,
        unknown: hubTargetSummary.unknown,
      })
    : t('settings.targetHealthUnknown');
  const hubTargetsErrorMessage = t('settings.targetHubErrorDesc');
  const hubOnlyHealth = health?.status === 'hub-only' || health?.edgeId === 'web-hub-only';
  const localEdgeOnline = edgeOnline && !hubOnlyHealth;
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
  const runnerHealth = hubOnlyHealth ? undefined : health?.checks?.runners;
  const runnerItems = runnerHealth?.items ?? [];
  const availableRunners = runnerHealth?.available ?? runnerItems.filter((item) => item.status === 'online').length;
  const totalRunners = runnerHealth?.total ?? runnerItems.length;
  const runnerSummary = localEdgeOnline
    ? t('settings.runnerSummary', { available: availableRunners, total: totalRunners })
    : t('settings.edgeOffline');
  const runs = runData?.items ?? [];
  const activeRuns = runs.filter(isActiveRun).length;
  const latestRun = getRecentRuns(runs, 1)[0];
  const recentRuns = getRecentRuns(runs, 5);
  const activeHubTasks = bridgedTasks.filter(isActiveBridgeTask).length;
  const recentBridgeTasks = getRecentTasks(bridgedTasks, 5);
  const schedulerActiveItems = activeRuns + activeHubTasks;
  const schedulerTotalItems = runs.length + bridgedTasks.length;
  const schedulerTargetReadyCount = hubTargetSummary.online;
  const marketPublishReady = agents.filter((agent) => agent.status === 'available').length;
  const marketCapabilityCount = countAgentCapabilities(agents);
  const skillScriptCount = PROJECT_SKILLS.filter((skill) => skill.hasScripts).length;
  const skillReferenceCount = PROJECT_SKILLS.filter((skill) => skill.hasReferences).length;
  const skillReadyCount = PROJECT_SKILLS.filter((skill) => skill.status === 'ready').length;
  const mcpCapableAgents = agents.filter((agent) => agent.capabilities.mcpIntegration).length;
  const mcpPermissionHookAgents = agents.filter((agent) => agent.capabilities.permissionHooks).length;
  const mcpSubAgentAgents = agents.filter((agent) => agent.capabilities.subAgentSpawn).length;
  const hubSessionActive = hubAuthenticated || hubAuth.isAuthenticated;
  const accountName = hubAuth.user?.username ?? username ?? t('settings.signedIn');
  const tokenSource = hubAuth.tokenSource;
  const tokenSourceLabel =
    tokenSource === 'tokendance'
      ? 'TokenDance ID'
      : tokenSource === 'hub'
        ? t('settings.hubLocalLogin')
        : t('settings.notConfigured');
  const deviceId = readBrowserStorage('local', DEVICE_ID_KEY);
  const oidcRoundTripPending = hasPendingBrowserOIDC();
  const tokenDanceOidcStatus = tokenSource === 'tokendance' ? t('settings.statusReady') : t('settings.statusInProgress');
  const tokenDanceOidcDesc = oidcRoundTripPending ? t('settings.tokenDanceOidcPendingDesc') : t('settings.tokenDanceOidcDesc');
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
    remoteControlEnabled,
  ].filter(Boolean).length;

  const navItems = useMemo<NavItem[]>(
    () => [
      buildNavItem('general', 'settings.general', <SlidersHorizontal size={17} />, 'workspace', t),
      buildNavItem('appearance', 'settings.appearance', <Palette size={17} />, 'workspace', t),
      buildNavItem('configuration', 'settings.configuration', <Wrench size={17} />, 'workspace', t),
      buildNavItem('personalization', 'settings.personalization', <UserCircle size={17} />, 'workspace', t),
      buildNavItem('permissions', 'settings.permissions', <ShieldCheck size={17} />, 'workspace', t),
      buildNavItem('agentProfiles', 'settings.agentProfiles', <Bot size={17} />, 'workspace', t),
      buildNavItem('executionTargets', 'settings.executionTargets', <Server size={17} />, 'workspace', t),
      buildNavItem('tasks', 'settings.tasks', <ClipboardList size={17} />, 'workspace', t),
      buildNavItem('onlineIm', 'settings.onlineIm', <Globe2 size={17} />, 'workspace', t),
      buildNavItem('groupChat', 'settings.groupChat', <MessageSquareText size={17} />, 'workspace', t),
      buildNavItem('agentScheduling', 'settings.agentScheduling', <Route size={17} />, 'workspace', t),
      buildNavItem('agentMarket', 'settings.agentMarket', <Bot size={17} />, 'workspace', t),
      buildNavItem('keyboard', 'settings.keyboard', <Keyboard size={17} />, 'workspace', t),
      buildNavItem('mcp', 'settings.mcp', <Plug size={17} />, 'automation', t),
      buildNavItem('skills', 'settings.skills', <Code2 size={17} />, 'automation', t),
      buildNavItem('hooks', 'settings.hooks', <TerminalSquare size={17} />, 'automation', t),
      buildNavItem('models', 'settings.models', <SlidersHorizontal size={17} />, 'automation', t),
      buildNavItem('modelMapping', 'settings.modelMapping', <Link2 size={17} />, 'automation', t),
      buildNavItem('ccSwitch', 'settings.ccSwitch', <Plug size={17} />, 'automation', t),
      buildNavItem('connections', 'settings.connections', <Globe2 size={17} />, 'automation', t),
      buildNavItem('remoteControl', 'settings.remoteControl', <Computer size={17} />, 'automation', t),
      buildNavItem('git', 'settings.git', <GitBranch size={17} />, 'automation', t),
      buildNavItem('environment', 'settings.environment', <HardDrive size={17} />, 'system', t),
      buildNavItem('worktree', 'settings.worktree', <FolderGit2 size={17} />, 'system', t),
      buildNavItem('browser', 'settings.browser', <Eye size={17} />, 'system', t),
      buildNavItem('computerUse', 'settings.computerUse', <Computer size={17} />, 'system', t),
      buildNavItem('platforms', 'settings.platforms', <Monitor size={17} />, 'system', t),
      buildNavItem('account', 'settings.account', <LockKeyhole size={17} />, 'system', t),
      buildNavItem('securityAudit', 'settings.securityAudit', <ShieldCheck size={17} />, 'system', t),
      buildNavItem('archived', 'settings.archived', <Archive size={17} />, 'system', t),
    ],
    [t],
  );

  const activeItem = navItems.find((item) => item.id === active);
  const activeLabel = activeItem?.label ?? t('settings.title');
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
            {activeItem ? (
              <>
                <p>{activeItem.description}</p>
                <div className={styles.headerMeta}>
                  <span>{activeItem.sourceLabel}</span>
                  <span>{activeItem.statusLabel}</span>
                </div>
              </>
            ) : null}
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
                  detail={localEdgeOnline ? t('settings.runtimeInventoryDesc') : t('settings.edgeOffline')}
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
                        edgeOnline={localEdgeOnline}
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
                    status={localEdgeOnline ? t('settings.statusReady') : t('settings.notConfigured')}
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
                  status={localTargetCount > 0 ? hubTargetsFetching ? t('settings.loading') : t('settings.enabled') : t('settings.notConfigured')}
                  metric={hubAuthenticated ? t('settings.targetTypeCount', { count: localTargetCount }) : t('settings.targetHubSignInRequired')}
                  connected={localTargetOnline}
                />
                <ExecutionTargetCard
                  icon={<Globe2 size={18} />}
                  title={t('settings.targetHubRelay')}
                  description={t('settings.targetHubRelayDesc')}
                  status={hubAuthenticated ? hubTargetsFetching ? t('settings.loading') : t('settings.enabled') : t('settings.notConfigured')}
                  metric={hubAuthenticated ? t('settings.targetTypeCount', { count: hubRelayCount }) : t('settings.targetHubSignInRequired')}
                  connected={hubRelayOnline}
                />
                <ExecutionTargetCard
                  icon={<Server size={18} />}
                  title={t('settings.targetSsh')}
                  description={t('settings.targetSshDesc')}
                  status={remoteTargetCount > 0 ? t('settings.enabled') : t('settings.statusPlanned')}
                  metric={t('settings.targetTypeCount', { count: remoteTargetCount })}
                  connected={remoteTargetOnline}
                />
                <ExecutionTargetCard
                  icon={<Computer size={18} />}
                  title={t('settings.targetCloudEdge')}
                  description={t('settings.targetCloudEdgeDesc')}
                  status={cloudTargetCount > 0 ? t('settings.enabled') : t('settings.statusPlanned')}
                  metric={t('settings.targetTypeCount', { count: cloudTargetCount })}
                  connected={cloudTargetOnline}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.targetHubInventory')}</strong>
                  <span>{t('settings.targetHubInventoryDesc')}</span>
                </div>
                <div className={styles.capabilityGrid}>
                  <CapabilityCard
                    title={t('settings.targetHubInventory')}
                    description={t('settings.targetHubInventoryCardDesc')}
                    status={hubTargetInventoryMetric}
                  />
                  <CapabilityCard
                    title={t('settings.targetHubHealth')}
                    description={t('settings.targetHubHealthDesc')}
                    status={hubTargetHealthMetric}
                  />
                </div>
                {!hubAuthenticated ? (
                  <EmptyBlock title={t('settings.targetHubSignIn')} description={t('settings.targetHubSignInDesc')} />
                ) : hubTargetsLoading ? (
                  <EmptyBlock title={t('settings.targetHubLoading')} description={t('settings.targetHubLoadingDesc')} />
                ) : hubTargetsError ? (
                  <EmptyBlock title={t('settings.targetHubError')} description={hubTargetsErrorMessage} />
                ) : hubTargets.length > 0 ? (
                  <div className={styles.taskList}>
                    {hubTargets.map((target) => (
                      <HubExecutionTargetRow
                        key={target.id}
                        target={target}
                        onPing={(targetId) => pingHubTargetMutation.mutate(targetId)}
                        pinging={pingHubTargetMutation.isPending && pingHubTargetMutation.variables === target.id}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.targetHubEmpty')} description={t('settings.targetHubEmptyDesc')} />
                )}
                {pingHubTargetMutation.isError ? (
                  <Callout title={t('settings.targetPingError')} body={t('settings.targetPingErrorDesc')} />
                ) : null}
              </div>
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
                  detail={hubAuthenticated ? t('settings.taskHubBridgeDesc') : t('settings.taskHubBridgeSignedOut')}
                />
                <SummaryCard
                  icon={<Monitor size={18} />}
                  label={t('settings.taskLastRun')}
                  value={latestRun ? t(`run.status.${latestRun.status}`, { defaultValue: latestRun.status }) : t('settings.noData')}
                  detail={latestRun ? formatTimestamp(latestRun.finishedAt ?? latestRun.startedAt ?? latestRun.createdAt) : t('settings.taskLastRunDesc')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.taskApprovalQueue')}
                  value={t('settings.statusPlanned')}
                  detail={t('settings.taskApprovalQueueDesc')}
                />
              </div>
              <SettingRow
                title={t('settings.taskSync')}
                description={t('settings.taskSyncDesc')}
                control={<Switch checked={taskSync} onChange={setBooleanSetting('taskSync', setTaskSync)} />}
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
              <div className={styles.capabilityGrid}>
                <CapabilityCard
                  title={t('settings.onlineImSessions')}
                  description={t('settings.onlineImSessionsDesc')}
                  status={t('settings.statusReady')}
                />
                <CapabilityCard
                  title={t('settings.onlineImPresence')}
                  description={t('settings.onlineImPresenceDesc')}
                  status={t('settings.statusPlanned')}
                />
                <CapabilityCard
                  title={t('settings.onlineImNotifications')}
                  description={t('settings.onlineImNotificationsDesc')}
                  status={t('settings.statusPlanned')}
                />
              </div>
            </Panel>
          )}

          {active === 'groupChat' && (
            <Panel title={t('settings.groupChat')} description={t('settings.groupChatDesc')}>
              <SettingRow
                title={t('settings.enableGroupChat')}
                description={t('settings.enableGroupChatDesc')}
                control={<Switch checked={groupChatEnabled} onChange={setBooleanSetting('groupChat', setGroupChatEnabled)} />}
              />
              <SettingRow title={t('settings.groupChatAgents')} description={t('settings.groupChatAgentsDesc')} value={t('settings.statusReady')} />
              <SettingRow title={t('settings.groupChatRooms')} description={t('settings.groupChatRoomsDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.groupChatModeration')} description={t('settings.groupChatModerationDesc')} value={t('settings.statusPlanned')} />
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
                  detail={localEdgeOnline ? t('settings.schedulerProfilesDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<Server size={18} />}
                  label={t('settings.schedulerTargets')}
                  value={`${schedulerTargetReadyCount}/${hubTargetSummary.total}`}
                  detail={hubAuthenticated ? t('settings.schedulerTargetsDesc') : t('settings.targetHubSignInRequired')}
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
                    status={localTargetCount > 0 ? t('settings.enabled') : t('settings.notConfigured')}
                    metric={t('settings.targetTypeCount', { count: localTargetCount })}
                    connected={localTargetOnline}
                  />
                  <ExecutionTargetCard
                    icon={<Globe2 size={18} />}
                    title={t('settings.schedulerRouteHub')}
                    description={t('settings.schedulerRouteHubDesc')}
                    status={hubRelayCount > 0 ? t('settings.enabled') : t('settings.notConfigured')}
                    metric={t('settings.targetTypeCount', { count: hubRelayCount })}
                    connected={hubRelayOnline}
                  />
                  <ExecutionTargetCard
                    icon={<Computer size={18} />}
                    title={t('settings.schedulerRouteRemote')}
                    description={t('settings.schedulerRouteRemoteDesc')}
                    status={remoteTargetCount > 0 ? t('settings.enabled') : t('settings.notConfigured')}
                    metric={t('settings.targetTypeCount', { count: remoteTargetCount })}
                    connected={remoteTargetOnline}
                  />
                  <ExecutionTargetCard
                    icon={<Server size={18} />}
                    title={t('settings.schedulerRouteCloud')}
                    description={t('settings.schedulerRouteCloudDesc')}
                    status={cloudTargetCount > 0 ? t('settings.enabled') : t('settings.notConfigured')}
                    metric={t('settings.targetTypeCount', { count: cloudTargetCount })}
                    connected={cloudTargetOnline}
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
                    status={remoteControlEnabled ? t('settings.enabled') : t('settings.statusPlanned')}
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
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Bot size={18} />}
                  label={t('settings.marketLocalProfiles')}
                  value={`${agents.length}`}
                  detail={localEdgeOnline ? t('settings.marketLocalProfilesDesc') : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.marketPublishReady')}
                  value={`${marketPublishReady}/${agents.length}`}
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
                  value={hubAuthenticated ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubAuthenticated ? t('settings.marketHubSyncDesc') : t('settings.marketHubSyncSignedOut')}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.marketInstalledProfiles')}</strong>
                  <span>{t('settings.marketInstalledProfilesDesc')}</span>
                </div>
                {agents.length > 0 ? (
                  <div className={styles.profileGrid}>
                    {agents.map((agent) => (
                      <AgentMarketCard key={`market-${agent.id}`} agent={agent} />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.marketNoProfiles')} description={t('settings.marketNoProfilesDesc')} />
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
                    status={agents.length > 0 ? t('settings.statusInProgress') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.agentCapabilityTags')}
                    description={t('settings.agentCapabilityTagsDesc')}
                    status={marketCapabilityCount > 0 ? t('settings.statusReady') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.agentReviewFlow')}
                    description={t('settings.agentReviewFlowDesc')}
                    status={autoReview ? t('settings.statusInProgress') : t('settings.statusPlanned')}
                  />
                  <CapabilityCard
                    title={t('settings.marketTokenDancePublish')}
                    description={t('settings.marketTokenDancePublishDesc')}
                    status={hubAuthenticated ? t('settings.statusInProgress') : t('settings.notConfigured')}
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
                  detail={localEdgeOnline ? t('settings.mcpRuntimeSupportDesc') : t('settings.edgeOffline')}
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
                  value={hubAuthenticated && enableMcp ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubAuthenticated ? t('settings.mcpHubSyncDesc') : t('settings.mcpHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.enableMcp')}
                description={t('settings.enableMcpDesc')}
                control={<Switch checked={enableMcp} onChange={setBooleanSetting('enableMcp', setEnableMcp)} />}
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
                    status={hubAuthenticated ? t('settings.statusInProgress') : t('settings.notConfigured')}
                  />
                  <CapabilityCard
                    title={t('settings.mcpRemoteServer')}
                    description={t('settings.mcpRemoteServerDesc')}
                    status={t('settings.statusPlanned')}
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
                  value={hubAuthenticated && skillSync ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubAuthenticated ? t('settings.skillHubSyncDesc') : t('settings.skillHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.skillSync')}
                description={t('settings.skillSyncDesc')}
                control={<Switch checked={skillSync} onChange={setBooleanSetting('skillSync', setSkillSync)} />}
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
                description={hubAuthenticated ? t('status.hubConnected') : t('status.hubDisconnected')}
                connected={hubAuthenticated}
              />
              <ConnectionRow name="Edge" description={`${t('settings.edgeLocal')} · ${runnerSummary}`} connected={localEdgeOnline} />
              <ConnectionRow name="WebSocket" description={t('status.wsConnected')} connected={edgeOnline} />
            </Panel>
          )}

          {active === 'remoteControl' && (
            <Panel title={t('settings.remoteControl')} description={t('settings.remoteControlDesc')}>
              <SettingRow
                title={t('settings.remoteControlEnable')}
                description={t('settings.remoteControlEnableDesc')}
                control={<Switch checked={remoteControlEnabled} onChange={setBooleanSetting('remoteControl', setRemoteControlEnabled)} />}
              />
              <SettingRow title={t('settings.remoteControlApproval')} description={t('settings.remoteControlApprovalDesc')} value={t('settings.approvalMode.ask')} />
              <SettingRow title={t('settings.remoteControlDevices')} description={t('settings.remoteControlDevicesDesc')} value={t('settings.statusPlanned')} />
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
                control={<Switch checked={platformSync} onChange={setBooleanSetting('platformSync', setPlatformSync)} />}
              />
              <div className={styles.capabilityGrid}>
                <CapabilityCard title="macOS" description={t('settings.platformMacosDesc')} status={t('settings.statusReady')} />
                <CapabilityCard title="Windows" description={t('settings.platformWindowsDesc')} status={t('settings.statusReady')} />
                <CapabilityCard title="Android" description={t('settings.platformAndroidDesc')} status={t('settings.statusPlanned')} />
                <CapabilityCard title="Web" description={t('settings.platformWebDesc')} status={t('settings.statusPlanned')} />
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
                  value={deviceId ? shortId(deviceId) : t('settings.notConfigured')}
                  detail={deviceId ? t('settings.desktopDeviceDesc') : t('settings.desktopDeviceMissingDesc')}
                />
                <SummaryCard
                  icon={<Route size={18} />}
                  label={t('settings.syncScope')}
                  value={hubSessionActive ? 'Hub' : t('settings.notConfigured')}
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
                    description={tokenDanceOidcDesc}
                    status={tokenDanceOidcStatus}
                  />
                  <CapabilityCard
                    title={t('settings.authTokenSource')}
                    description={t('settings.authTokenSourceDesc')}
                    status={tokenSourceLabel}
                  />
                  <CapabilityCard
                    title={t('settings.deviceProof')}
                    description={t('settings.deviceProofDesc')}
                    status={deviceId ? t('settings.statusInProgress') : t('settings.notConfigured')}
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
              <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.secretScan')} description={t('settings.secretScanDesc')} value={t('settings.statusPlanned')} />
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
  onCancel?: ((runId: string) => void) | undefined;
  cancelling?: boolean;
}) {
  const { t } = useTranslation();
  const timestamp = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return (
    <ActivityCard
      className={styles.taskRow}
      iconClassName={styles.connectionIcon}
      labelClassName={styles.taskRowLabel}
      contentClassName={styles.taskRowContent}
      actionsClassName={styles.taskRowActions}
      icon={<Route size={17} />}
      label={shortId(run.runId)}
      actions={(
        <>
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
        </>
      )}
    >
      <span className={styles.taskRowDescription}>{run.projectId} / {run.threadId}</span>
      <span className={styles.taskMeta}>
        <span>{formatTimestamp(timestamp)}</span>
      </span>
    </ActivityCard>
  );
}

function HubTaskRow({ task }: { task: AgentTask }) {
  const { t } = useTranslation();
  return (
    <ActivityCard
      className={styles.taskRow}
      iconClassName={styles.connectionIcon}
      labelClassName={styles.taskRowLabel}
      contentClassName={styles.taskRowContent}
      actionsClassName={styles.taskRowActions}
      icon={<ClipboardList size={17} />}
      label={shortId(task.taskId)}
      actions={(
        <span className={`${styles.statusPill} ${isActiveBridgeTask(task) ? styles.statusPillOn : ''}`}>
          {t(`settings.taskStatus.${task.status}`, { defaultValue: task.status })}
        </span>
      )}
    >
      <span className={styles.taskRowDescription}>{task.prompt}</span>
      <span className={styles.taskMeta}>
        <span>{task.agentId}</span>
        <span>{task.runId ? shortId(task.runId) : t('settings.taskUnbound')}</span>
      </span>
    </ActivityCard>
  );
}

function HubExecutionTargetRow({
  target,
  onPing,
  pinging,
}: {
  target: ExecutionTargetInventoryItem;
  onPing: (targetId: string) => void;
  pinging: boolean;
}) {
  const { t } = useTranslation();
  const workspaceLabel = target.workspace_allowlist.length > 0
    ? t('settings.targetWorkspaceCount', { count: target.workspace_allowlist.length })
    : t('settings.targetWorkspaceEmpty');
  const identityLabel = target.device_id
    ? t('settings.targetDevice', { id: shortId(target.device_id) })
    : shortId(target.id);

  return (
    <ActivityCard
      className={styles.taskRow}
      iconClassName={styles.connectionIcon}
      labelClassName={styles.taskRowLabel}
      contentClassName={styles.taskRowContent}
      actionsClassName={styles.taskRowActions}
      icon={<Server size={17} />}
      label={target.name}
      actions={(
        <>
          <span className={`${styles.statusPill} ${target.is_online ? styles.statusPillOn : ''}`}>
            {t(`settings.targetHealth.${target.health_state}`, { defaultValue: target.health_state })}
          </span>
          <button
            type="button"
            className={`${styles.secondaryBtn} ${styles.taskRowAction}`}
            onClick={() => onPing(target.id)}
            disabled={pinging}
            aria-label={t('settings.targetPing')}
            title={t('settings.targetPing')}
          >
            <RefreshCw size={15} />
            {pinging ? t('settings.targetPinging') : t('settings.targetPing')}
          </button>
        </>
      )}
    >
      <span className={styles.taskRowDescription}>{identityLabel}</span>
      <span className={styles.taskMeta}>
        <span>{t(`settings.targetType.${target.target_type}`, { defaultValue: target.target_type })}</span>
        <span>{t(`settings.targetTrust.${target.trust_level}`, { defaultValue: target.trust_level })}</span>
        <span>{workspaceLabel}</span>
      </span>
    </ActivityCard>
  );
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
    <ActivityCard
      className={styles.capabilityCard}
      metaClassName={styles.capabilityMeta}
      labelClassName={styles.capabilityLabel}
      contentClassName={styles.capabilityDescription}
      label={title}
      meta={<em className={styles.capabilityStatus}>{status}</em>}
    >
      {description}
    </ActivityCard>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <ActivityCard
      className={styles.summaryCard}
      iconClassName={styles.summaryIcon}
      metaClassName={styles.summaryBody}
      labelClassName={styles.summaryLabel}
      contentClassName={styles.summaryDetail}
      label={value}
      meta={<span className={styles.summaryMeta}>{label}</span>}
      icon={icon}
    >
      {detail}
    </ActivityCard>
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

function ProfileActivityCard({
  icon,
  title,
  description,
  status,
  statusClassName,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  status: ReactNode;
  statusClassName: string | undefined;
  children: ReactNode;
}) {
  return (
    <ActivityCard
      className={styles.profileCard}
      iconClassName={styles.profileIcon}
      labelClassName={styles.profileTitle}
      contentClassName={styles.profileContent}
      actionsClassName={styles.profileActions}
      icon={icon}
      label={title}
      actions={<em className={`${styles.profileStatus} ${statusClassName ?? ''}`}>{status}</em>}
    >
      <span className={styles.profileDescription}>{description}</span>
      {children}
    </ActivityCard>
  );
}

function RuntimeInventoryCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  return (
    <ProfileActivityCard
      icon={<Bot size={17} />}
      title={agent.name}
      description={agent.description || t('settings.runtimeDefaultDesc')}
      status={t(`agent.status.${agent.status}`)}
      statusClassName={styles[`profileStatus_${agent.status}`]}
    >
      <span className={styles.profileMeta}>
        <span>{t('settings.runtimeAdapter')}: {agent.id}</span>
        <span>{t('settings.profileRuntime')}: {t('settings.statusReady')}</span>
        <span>{t('settings.profileModel')}: {t('settings.statusPlanned')}</span>
        <span>{t('settings.profileConfig')}: {t('settings.statusPlanned')}</span>
      </span>
    </ProfileActivityCard>
  );
}

function LocalAgentProfileCard({
  agent,
  alias,
  route,
  edgeOnline,
}: {
  agent: AgentInfo;
  alias?: string | undefined;
  route: ResolvedRunModelSettings;
  edgeOnline: boolean;
}) {
  const { t } = useTranslation();
  const profileReady = edgeOnline && agent.status === 'available';
  return (
    <ProfileActivityCard
      icon={<Bot size={17} />}
      title={t('settings.localProfileName', { runtime: agent.name })}
      description={t('settings.localProfileDesc')}
      status={profileReady ? t('settings.enabled') : t('settings.notConfigured')}
      statusClassName={profileReady ? styles.profileStatus_available : styles.profileStatus_configuring}
    >
      <span className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.profileModel')}: {route.model ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasProvider')}: {route.provider ?? t('prompt.routeAuto')}</span>
        <span>{t('settings.modelAliasReasoning')}: {route.reasoningEffort ?? t('prompt.routeAuto')}</span>
        {alias ? <span>{t('settings.profileAlias')}: {alias}</span> : null}
        <span>{t('settings.executionTargets')}: {t('settings.targetLocalEdge')}</span>
        <span>{t('settings.profileConfigSource')}: AGENTS.md / memory / skills</span>
      </span>
    </ProfileActivityCard>
  );
}

function AgentMarketCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const capabilityNames = Object.entries(agent.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => t(`settings.capability.${name}`, { defaultValue: name }));

  return (
    <ProfileActivityCard
      icon={<Bot size={17} />}
      title={agent.name}
      description={agent.description || t('settings.marketProfileDefaultDesc')}
      status={t(`agent.status.${agent.status}`)}
      statusClassName={styles[`profileStatus_${agent.status}`]}
    >
      <span className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.runtimeId ?? agent.id}</span>
        <span>{t('settings.marketInstallSource')}: TokenDance Hub</span>
        <span>{t('settings.marketPublishStatus')}: {agent.status === 'available' ? t('settings.statusInProgress') : t('settings.statusPlanned')}</span>
      </span>
      <span className={styles.profileMeta}>
        {capabilityNames.length > 0 ? (
          capabilityNames.map((name) => <span key={name}>{name}</span>)
        ) : (
          <span>{t('settings.marketNoCapabilityTags')}</span>
        )}
      </span>
    </ProfileActivityCard>
  );
}

function ProjectSkillCard({ skill }: { skill: ProjectSkill }) {
  const { t } = useTranslation();
  return (
    <ProfileActivityCard
      icon={<Code2 size={17} />}
      title={skill.title}
      description={t(skill.descriptionKey)}
      status={skill.status === 'ready' ? t('settings.statusReady') : t('settings.statusInProgress')}
      statusClassName={skill.status === 'ready' ? styles.profileStatus_available : styles.profileStatus_configuring}
    >
      <span className={styles.profileMeta}>
        <span>{t('settings.skillLocalRegistry')}: .agents/skills/{skill.id}</span>
        <span>{t('settings.skillScripts')}: {skill.hasScripts ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.skillReferences')}: {skill.hasReferences ? t('settings.enabled') : t('settings.notConfigured')}</span>
      </span>
    </ProfileActivityCard>
  );
}

function McpRuntimeCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const { mcpIntegration, permissionHooks, subAgentSpawn } = agent.capabilities;
  return (
    <ProfileActivityCard
      icon={<Plug size={17} />}
      title={agent.name}
      description={agent.description || t('settings.mcpRuntimeDefaultDesc')}
      status={mcpIntegration ? t('settings.statusReady') : t('settings.notConfigured')}
      statusClassName={mcpIntegration ? styles.profileStatus_available : styles.profileStatus_configuring}
    >
      <span className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.mcpIntegration')}: {mcpIntegration ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpPermissionHooks')}: {permissionHooks ? t('settings.enabled') : t('settings.notConfigured')}</span>
        <span>{t('settings.mcpSubAgentSpawn')}: {subAgentSpawn ? t('settings.enabled') : t('settings.notConfigured')}</span>
      </span>
    </ProfileActivityCard>
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
    <ActivityCard
      className={styles.targetCard}
      iconClassName={styles.targetIcon}
      labelClassName={styles.targetTitle}
      contentClassName={styles.targetContent}
      actionsClassName={styles.targetActions}
      icon={icon}
      label={title}
      actions={<span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>{status}</span>}
    >
      <span className={styles.targetDescription}>{description}</span>
      <em className={styles.targetMetric}>{metric}</em>
    </ActivityCard>
  );
}

function RunnerRow({ runner }: { runner: RunnerHealthItem }) {
  return (
    <ActivityCard
      className={styles.runnerRow}
      iconClassName={styles.connectionIcon}
      labelClassName={styles.settingTitle}
      contentClassName={styles.settingContent}
      actionsClassName={styles.settingActions}
      icon={<Cpu size={17} />}
      label={runner.name}
      actions={
        <span className={`${styles.statusPill} ${runner.status === 'online' ? styles.statusPillOn : ''}`}>
          {runner.status}
        </span>
      }
    >
      <span className={styles.settingDescription}>{runner.capabilities?.join(' / ') || runner.id}</span>
    </ActivityCard>
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
  const actions = control ?? (value ? <span className={styles.settingValue}>{value}</span> : null);
  return (
    <ActivityCard
      className={styles.settingRow}
      labelClassName={styles.settingTitle}
      contentClassName={styles.settingContent}
      actionsClassName={styles.settingActions}
      label={title}
      actions={
        actions || action ? (
          <>
            {actions}
            {action ? <ChevronRight size={17} className={styles.rowChevron} /> : null}
          </>
        ) : undefined
      }
    >
      <span className={styles.settingDescription}>{description}</span>
    </ActivityCard>
  );
}

function ConnectionRow({ name, description, connected }: { name: string; description: string; connected: boolean }) {
  return (
    <ActivityCard
      className={styles.connectionRow}
      iconClassName={styles.connectionIcon}
      labelClassName={styles.settingTitle}
      contentClassName={styles.settingContent}
      actionsClassName={styles.settingActions}
      icon={<Link2 size={17} />}
      label={name}
      actions={
        <span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>
          {connected ? 'Online' : 'Offline'}
        </span>
      }
    >
      <span className={styles.settingDescription}>{description}</span>
    </ActivityCard>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
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
