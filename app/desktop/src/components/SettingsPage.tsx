import { type ReactNode, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
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
  MessageSquareText,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  Route,
  Search,
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
import { APP_VERSION } from '@/config';
import { useAgentList } from '@/api/agentQueries';
import { useHubExecutionTargets, usePingHubExecutionTarget } from '@/api/executionTargetQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import {
  useModelSettingsStore,
  type ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import type { AgentInfo, RunInfo, RunnerHealthItem } from '@shared/types';
import type { ExecutionTarget, ExecutionTargetHealthState, ExecutionTargetType } from '@/api/hubClient';
import styles from './SettingsPage.module.css';
import { Select } from '@shared/ui';
import { useKeybindingStore, BINDING_IDS, getBinding, type BindingId } from '@/stores/keybindingStore';
import { keysFromEvent } from '@/utils/keybinding';
import { useToastStore } from '@/stores/toastStore';
import {
  createHubClient,
  type ContactInfo,
  type FriendRequestInfo,
  type HubNotification,
  type Session,
} from '@/api/hubClient';
import OnlineImSection from '@/components/settings/sections/OnlineImSection';
import GroupChatSection from '@/components/settings/sections/GroupChatSection';
import TasksSection from '@/components/settings/sections/TasksSection';
import AgentMarketSection from '@/components/settings/sections/AgentMarketSection';
import McpSection from '@/components/settings/sections/McpSection';
import ModelsSection from '@/components/settings/sections/ModelsSection';
import ModelMappingSection from '@/components/settings/sections/ModelMappingSection';
import CcSwitchSection from '@/components/settings/sections/CcSwitchSection';
import RemoteControlSection from '@/components/settings/sections/RemoteControlSection';
import PlatformsSection from '@/components/settings/sections/PlatformsSection';
import AccountSection from '@/components/settings/sections/AccountSection';
import SecurityAuditSection from '@/components/settings/sections/SecurityAuditSection';
import SkillsSection from '@/components/settings/sections/SkillsSection';

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
type SettingsSelectValue = SelectValue | string;

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

const STORAGE_PREFIX = 'agenthub-settings.';
const DEVICE_ID_KEY = 'agenthub_device_id';

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

function isHubTargetConnected(target: ExecutionTarget) {
  return target.is_online || target.health_state === 'healthy';
}

function filterTargetsByType(targets: ExecutionTarget[], types: ExecutionTargetType[]) {
  const typeSet = new Set<ExecutionTargetType>(types);
  return targets.filter((target) => typeSet.has(target.target_type));
}

function countTargetsByHealth(targets: ExecutionTarget[], health: ExecutionTargetHealthState) {
  return targets.filter((target) => (target.health_state ?? 'unknown') === health).length;
}

function getTargetGroupHealth(targets: ExecutionTarget[]): ExecutionTargetHealthState {
  if (targets.some((target) => target.health_state === 'healthy' || target.is_online)) return 'healthy';
  if (targets.some((target) => target.health_state === 'degraded')) return 'degraded';
  if (targets.some((target) => target.health_state === 'offline')) return 'offline';
  return 'unknown';
}

function formatTargetEndpoint(target: ExecutionTarget) {
  if (target.host && target.port) return `${target.host}:${target.port}`;
  if (target.host) return target.host;
  if (target.workspace_root) return target.workspace_root;
  if (target.device_id) return shortId(target.device_id);
  return '';
}

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general' }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const hubAuth = useAuth();
  const hubInventoryEnabled = hubAuth.isAuthenticated && Boolean(hubAuth.token);
  const hubTargetsQuery = useHubExecutionTargets({
    enabled: hubInventoryEnabled,
    getToken: () => hubAuth.token,
  });
  const pingHubTargetMutation = usePingHubExecutionTarget({
    getToken: () => hubAuth.token,
  });
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
  const addToast = useToastStore((s) => s.addToast);
  const [active, setActive] = useState<SectionId>(initialSection);
  const [navSearch, setNavSearch] = useState('');
  const navSearchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: `/` focuses the search input
  const handleSettingsKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/') {
      e.preventDefault();
      navSearchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleSettingsKeyDown);
    return () => window.removeEventListener('keydown', handleSettingsKeyDown);
  }, [handleSettingsKeyDown]);

  useEffect(() => {
    if (typeof mainRef.current?.scrollTo === 'function') {
      mainRef.current.scrollTo(0, 0);
    }
  }, [active]);

  const [recordingBinding, setRecordingBinding] = useState<BindingId | null>(null);

  // Keybinding recording: capture keydown when a binding row is clicked
  useEffect(() => {
    if (!recordingBinding) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = keysFromEvent(e);
      if (keys.length > 0 && keys.some((k) => !['Ctrl', '⌘', 'Shift', 'Alt'].includes(k))) {
        useKeybindingStore.getState().setBinding(recordingBinding, keys);
        setRecordingBinding(null);
      }
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRecordingBinding(null);
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keydown', cancel);
    };
  }, [recordingBinding]);

  const handleRestoreDefaults = useCallback(() => {
    useKeybindingStore.getState().resetAll();
    addToast({ type: 'success', message: t('settings.keyboard.restored') });
  }, [addToast, t]);

  const [compactMode, setCompactMode] = useStoredBooleanState('compactMode', false);
  const [autoReview, setAutoReview] = useStoredBooleanState('autoReview', true);
  const [fullAccess, setFullAccess] = useStoredBooleanState('fullAccess', false);
  const [enableMcp, setEnableMcp] = useStoredBooleanState('enableMcp', true);
  const [taskSync, setTaskSync] = useStoredBooleanState('taskSync', true);
  const [groupChatEnabled, setGroupChatEnabled] = useStoredBooleanState('groupChat', true);
  const [agentSchedulingEnabled, setAgentSchedulingEnabled] = useStoredBooleanState('agentScheduling', true);
  const [enableHooks, setEnableHooks] = useStoredBooleanState('enableHooks', false);
  const [remoteControlEnabled] = useStoredBooleanState('remoteControl', false);
  const [autoDetectGit, setAutoDetectGit] = useStoredBooleanState('autoDetectGit', true);
  const [worktreeIsolation, setWorktreeIsolation] = useStoredBooleanState('worktreeIsolation', true);
  const [browserPreview, setBrowserPreview] = useStoredBooleanState('browserPreview', true);
  const [computerConfirm, setComputerConfirm] = useStoredBooleanState('computerConfirm', true);
  const [auditTrail, setAuditTrail] = useStoredBooleanState('auditTrail', true);
  const [detailLevel, setDetailLevel] = useStoredValueState<SelectValue>('detailLevel', 'detailed');
  const [approvalMode, setApprovalMode] = useStoredValueState<SelectValue>('approvalMode', 'ask');
  const [defaultAgent, setDefaultAgent] = useStoredValueState<string>('defaultAgent', 'auto');
  const [routing, setRouting] = useStoredValueState<string>('routing', 'auto');
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
  const agents = useMemo(() => agentData?.items ?? [], [agentData?.items]);
  const localAgentProfiles = agents.map((agent) => ({
    agent,
    alias: preferredProfileAlias(agent),
    route: resolveRunRequestOptions({ model: preferredProfileAlias(agent) }),
  }));
  const defaultAgentOptions = useMemo<Array<[string, string]>>(() => {
    const opts: Array<[string, string]> = [['auto', t('settings.defaultAgent.auto')]];
    for (const agent of agents) {
      if (agent.status === 'available') opts.push([agent.id, agent.name]);
    }
    return opts;
  }, [agents, t]);

  const availableRuntimes = agents.filter((agent) => agent.status === 'available').length;
  const runnerHealth = health?.checks?.runners;
  const runnerItems = runnerHealth?.items ?? [];
  const availableRunners = runnerHealth?.available ?? runnerItems.filter((item) => item.status === 'online').length;
  const totalRunners = runnerHealth?.total ?? runnerItems.length;
  const runnerSummary = edgeOnline
    ? t('settings.runnerSummary', { available: availableRunners, total: totalRunners })
    : t('settings.edgeOffline');
  const hubTargets = useMemo(() => hubTargetsQuery.data?.items ?? [], [hubTargetsQuery.data?.items]);
  const hubOnlineTargets = hubTargets.filter(isHubTargetConnected).length;
  const routingOptions = useMemo<Array<[string, string]>>(() => {
    const opts: Array<[string, string]> = [['auto', t('settings.defaultAgent.auto')]];
    for (const target of hubTargets) {
      if (isHubTargetConnected(target)) opts.push([target.id, target.name]);
    }
    return opts;
  }, [hubTargets, t]);
  const hubHealthyTargets = countTargetsByHealth(hubTargets, 'healthy');
  const hubDegradedTargets = countTargetsByHealth(hubTargets, 'degraded');
  const hubOfflineTargets = countTargetsByHealth(hubTargets, 'offline');
  const hubUnknownTargets = countTargetsByHealth(hubTargets, 'unknown');
  const hubRelayTargets = filterTargetsByType(hubTargets, ['hub_relay']);
  const remoteHubTargets = filterTargetsByType(hubTargets, ['remote_ssh', 'tailscale']);
  const cloudHubTargets = filterTargetsByType(hubTargets, ['cloud_edge']);
  const hubTargetErrorMessage = hubTargetsQuery.error instanceof Error
    ? hubTargetsQuery.error.message
    : t('settings.targetHubErrorDesc');
  const hubTargetInventoryDetail = !hubInventoryEnabled
    ? t('settings.targetHubSignedOutDesc')
    : hubTargetsQuery.isLoading
      ? t('settings.targetHubLoading')
      : hubTargetsQuery.isError
        ? t('settings.targetHubError')
        : hubTargets.length > 0
          ? t('settings.targetCountSummary', { online: hubOnlineTargets, total: hubTargets.length })
          : t('settings.targetHubEmpty');
  const targetHealthBreakdown = t('settings.targetHealthBreakdown', {
    healthy: hubHealthyTargets,
    degraded: hubDegradedTargets,
    offline: hubOfflineTargets,
    unknown: hubUnknownTargets,
  });
  const getHubTargetGroupStatus = (targets: ExecutionTarget[]) => {
    if (!hubInventoryEnabled) return t('settings.targetHubSignInRequired');
    if (hubTargetsQuery.isLoading) return t('settings.targetHubLoading');
    if (hubTargetsQuery.isError) return t('settings.targetHubError');
    if (targets.length === 0) return t('settings.targetHubEmpty');
    return t(`settings.targetHealth.${getTargetGroupHealth(targets)}`);
  };
  const getHubTargetGroupMetric = (targets: ExecutionTarget[]) => {
    if (!hubInventoryEnabled) return t('settings.targetHubSignInRequired');
    if (hubTargetsQuery.isLoading) return t('settings.targetHubLoading');
    if (hubTargetsQuery.isError) return t('settings.targetHubError');
    return t('settings.targetCountSummary', {
      online: targets.filter(isHubTargetConnected).length,
      total: targets.length,
    });
  };
  const runs = runData?.items ?? [];
  const activeRuns = runs.filter(isActiveRun).length;
  const latestRun = getRecentRuns(runs, 1)[0];
  const recentRuns = getRecentRuns(runs, 5);
  const activeHubTasks = bridgedTasks.filter(isActiveBridgeTask).length;
  const recentBridgeTasks = getRecentTasks(bridgedTasks, 5);
  const schedulerActiveItems = activeRuns + activeHubTasks;
  const schedulerTotalItems = runs.length + bridgedTasks.length;
  const schedulerTargetReadyCount = [
    edgeOnline,
    hubOnlineTargets > 0,
    remoteControlEnabled,
    false,
  ].filter(Boolean).length;
  const schedulerLocalMetric = totalRunners > 0 ? runnerSummary : edgeOnline ? t('settings.edgeOnline') : t('settings.edgeOffline');
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
  const hubClient = useMemo(
    () => createHubClient({ getToken: () => hubAuth.token }),
    [hubAuth.token],
  );
  const hubSnapshotEnabled = hubSessionActive && Boolean(hubAuth.token);
  const imContactsQuery = useQuery<ContactInfo[]>({
    queryKey: ['settings', 'hub', 'contacts', hubAuth.token],
    enabled: hubSnapshotEnabled,
    queryFn: () => hubClient.listContacts(),
  });
  const imSessionsQuery = useQuery<Session[]>({
    queryKey: ['settings', 'hub', 'sessions', hubAuth.token],
    enabled: hubSnapshotEnabled,
    queryFn: () => hubClient.listSessions(),
  });
  const imFriendRequestsQuery = useQuery<FriendRequestInfo[]>({
    queryKey: ['settings', 'hub', 'friend-requests', hubAuth.token],
    enabled: hubSnapshotEnabled,
    queryFn: () => hubClient.listFriendRequests(),
  });
  const imNotificationsQuery = useQuery<HubNotification[]>({
    queryKey: ['settings', 'hub', 'notifications', hubAuth.token],
    enabled: hubSnapshotEnabled,
    queryFn: () => hubClient.listNotifications({ limit: 20 }) as Promise<HubNotification[]>,
  });
  const customAgentsQuery = useQuery<Record<string, unknown>[]>({
    queryKey: ['settings', 'hub', 'custom-agents', hubAuth.token],
    enabled: hubSnapshotEnabled,
    queryFn: () => hubClient.listCustomAgents(),
  });
  const deviceRegistrationQuery = useQuery({
    queryKey: ['settings', 'hub', 'device-registration', deviceId, hubAuth.token],
    enabled: hubSnapshotEnabled && Boolean(deviceId),
    queryFn: () => hubClient.registerDevice({
      device_id: deviceId ?? '',
      app_version: APP_VERSION,
    }),
  });
  const imContacts = imContactsQuery.data ?? [];
  const imSessions = imSessionsQuery.data ?? [];
  const imFriendRequests = imFriendRequestsQuery.data ?? [];
  const imNotifications = imNotificationsQuery.data ?? [];
  const imIsLoading = imContactsQuery.isLoading || imSessionsQuery.isLoading || imFriendRequestsQuery.isLoading || imNotificationsQuery.isLoading;
  const imIsFetching = imContactsQuery.isFetching || imSessionsQuery.isFetching || imFriendRequestsQuery.isFetching || imNotificationsQuery.isFetching;
  const imIsError = imContactsQuery.isError || imSessionsQuery.isError || imFriendRequestsQuery.isError || imNotificationsQuery.isError;
  const imIsSuccess = imContactsQuery.isSuccess && imSessionsQuery.isSuccess && imFriendRequestsQuery.isSuccess && imNotificationsQuery.isSuccess;
  const imSnapshotStatus = !hubSessionActive
    ? t('settings.status.loginLocked')
    : imIsError
      ? t('settings.status.error')
      : imIsLoading || imIsFetching || !imIsSuccess
        ? t('settings.loading')
        : t('settings.status.snapshot');
  const deviceRegistrationStatus = !hubSnapshotEnabled || !deviceId
    ? 'idle'
    : deviceRegistrationQuery.isError
      ? 'error'
      : deviceRegistrationQuery.isSuccess
        ? 'registered'
        : deviceRegistrationQuery.isFetching
          ? 'registering'
          : 'idle';
  const desktopDeviceStatus = deviceRegistrationStatus === 'registered'
    ? t('settings.deviceStatus.registered')
    : deviceRegistrationStatus === 'registering'
      ? t('settings.deviceStatus.registering')
      : deviceRegistrationStatus === 'error'
        ? t('settings.status.error')
        : t('settings.deviceStatus.idle');
  const handleSignOut = () => {
    void hubAuth.logout();
  };
  const handleRefreshRuns = () => {
    void refetchRuns();
  };
  const schedulerPolicyReadyCount = [
    modelMappingEnabled,
    ccSwitchBridge,
    autoReview,
    remoteControlEnabled,
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

  const filteredNavItems = useMemo(() => {
    if (!navSearch.trim()) return navItems;
    const query = navSearch.toLowerCase();
    return navItems.filter((item) => item.label.toLowerCase().includes(query));
  }, [navItems, navSearch]);

  const groupedNavItems = useMemo(() => {
    const groups = ['workspace', 'automation', 'system'] as const;
    return groups.map((group) => ({
      group,
      items: filteredNavItems.filter((item) => item.group === group),
    }));
  }, [filteredNavItems]);

  const activeLabel = navItems.find((item) => item.id === active)?.label ?? t('settings.title');
  const ACTION_LABELS: Record<BindingId, string> = {
    send: t('shortcut.send'),
    newline: t('shortcut.newline'),
    search: t('shortcut.search'),
    toggleSidebar: t('shortcut.toggleSidebar'),
    toggleRunPanel: t('shortcut.toggleRunPanel'),
    close: t('shortcut.close'),
    help: t('shortcut.help'),
  };

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

        <div className={styles.sidebarSearch}>
          <Search size={14} />
          <input
            ref={navSearchRef}
            type="text"
            placeholder={t('settings.searchPlaceholder')}
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
          />
        </div>

        <nav className={styles.nav} aria-label={t('settings.title')}>
          {groupedNavItems.map(({ group, items }) => (
            <div key={group} className={styles.navGroup}>
              {items.length > 0 && <div className={styles.navGroupLabel}>{t(`settings.group.${group}`)}</div>}
              {items.map((item) => (
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
            <ChevronRight size={15} className={styles.sidebarAccountChevron} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main className={styles.main} ref={mainRef}>
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
              <SettingRow
                title={t('settings.defaultAgent')}
                description={t('settings.defaultAgentDesc')}
                control={
                  <SelectControl
                    value={defaultAgent}
                    onChange={(value) => {
                      setDefaultAgent(value);
                      writeStoredValue('defaultAgent', value);
                    }}
                    options={defaultAgentOptions}
                  />
                }
              />
              <SettingRow
                title={t('settings.routing')}
                description={t('settings.routingDesc')}
                control={
                  <SelectControl
                    value={routing}
                    onChange={(value) => {
                      setRouting(value);
                      writeStoredValue('routing', value);
                    }}
                    options={routingOptions}
                  />
                }
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
              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<Monitor size={18} />}
                  label={t('settings.targetLocalInventory')}
                  value={`${availableRunners}/${totalRunners}`}
                  detail={edgeOnline ? runnerSummary : t('settings.edgeOffline')}
                />
                <SummaryCard
                  icon={<Globe2 size={18} />}
                  label={t('settings.targetHubInventory')}
                  value={hubTargetsQuery.isLoading ? t('settings.loading') : `${hubOnlineTargets}/${hubTargets.length}`}
                  detail={hubTargetInventoryDetail}
                />
                <SummaryCard
                  icon={<ShieldCheck size={18} />}
                  label={t('settings.targetHubHealth')}
                  value={hubTargets.length > 0 ? `${hubHealthyTargets}/${hubTargets.length}` : t('settings.noData')}
                  detail={targetHealthBreakdown}
                />
              </div>
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
                  status={getHubTargetGroupStatus(hubRelayTargets)}
                  metric={getHubTargetGroupMetric(hubRelayTargets)}
                  connected={hubRelayTargets.some(isHubTargetConnected)}
                />
                <ExecutionTargetCard
                  icon={<Server size={18} />}
                  title={t('settings.targetSsh')}
                  description={t('settings.targetSshDesc')}
                  status={getHubTargetGroupStatus(remoteHubTargets)}
                  metric={getHubTargetGroupMetric(remoteHubTargets)}
                  connected={remoteHubTargets.some(isHubTargetConnected)}
                />
                <ExecutionTargetCard
                  icon={<Computer size={18} />}
                  title={t('settings.targetCloudEdge')}
                  description={t('settings.targetCloudEdgeDesc')}
                  status={getHubTargetGroupStatus(cloudHubTargets)}
                  metric={getHubTargetGroupMetric(cloudHubTargets)}
                  connected={cloudHubTargets.some(isHubTargetConnected)}
                />
              </div>
              {runnerItems.length > 0 ? (
                <div className={styles.runnerList}>
                  {runnerItems.map((runner) => <RunnerRow key={runner.id} runner={runner} />)}
                </div>
              ) : (
                <Callout title={t('settings.runnerInventory')} body={t('settings.runnerInventoryDesc')} />
              )}
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.targetHubInventory')}</strong>
                  <span>{t('settings.targetHubInventoryDesc')}</span>
                </div>
                {!hubInventoryEnabled ? (
                  <EmptyBlock
                    title={t('settings.targetHubSignInRequired')}
                    description={t('settings.targetHubSignedOutDesc')}
                  />
                ) : hubTargetsQuery.isLoading ? (
                  <EmptyBlock title={t('settings.targetHubLoading')} description={t('settings.targetHubLoadingDesc')} />
                ) : hubTargetsQuery.isError ? (
                  <EmptyBlock title={t('settings.targetHubError')} description={hubTargetErrorMessage} />
                ) : hubTargets.length > 0 ? (
                  <div className={styles.runnerList}>
                    {hubTargets.map((target) => (
                      <HubExecutionTargetRow
                        key={target.id}
                        target={target}
                        pinging={pingHubTargetMutation.isPending && pingHubTargetMutation.variables === target.id}
                        onPing={(targetId) => pingHubTargetMutation.mutate(targetId)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyBlock title={t('settings.targetHubEmpty')} description={t('settings.targetHubEmptyDesc')} />
                )}
              </div>
            </Panel>
          )}

          {active === 'tasks' && (
            <TasksSection
              runs={runs}
              activeRuns={activeRuns}
              runsLoading={runsLoading}
              runsFetching={runsFetching}
              runsError={runsError}
              refetchRuns={handleRefreshRuns}
              cancelRunMutation={cancelRunMutation}
              bridgedTasks={bridgedTasks}
              hubSessionActive={hubSessionActive}
              taskSync={taskSync}
              setTaskSync={setTaskSync}
              onOpenAuth={onOpenAuth}
              latestRun={latestRun}
            />
          )}

          {active === 'onlineIm' && (
            <OnlineImSection
              hubSessionActive={hubSessionActive}
              imSessions={imSessions}
              imContacts={imContacts}
              imFriendRequests={imFriendRequests}
              imNotifications={imNotifications}
              isLoading={imIsLoading}
              isFetching={imIsFetching}
              isError={imIsError}
              isSuccess={imIsSuccess}
              refetch={() => {
                void imContactsQuery.refetch();
                void imSessionsQuery.refetch();
                void imFriendRequestsQuery.refetch();
                void imNotificationsQuery.refetch();
              }}
              deviceRegistrationStatus={deviceRegistrationStatus}
              onOpenAuth={onOpenAuth}
            />
          )}

          {active === 'groupChat' && (
            <GroupChatSection
              hubSessionActive={hubSessionActive}
              isLoading={imIsLoading}
              isError={imIsError}
              imSessions={imSessions}
              imContactsCount={imContacts.length}
              imSnapshotStatus={imSnapshotStatus}
              agents={agents}
              edgeOnline={edgeOnline}
              groupChatEnabled={groupChatEnabled}
              setGroupChatEnabled={setGroupChatEnabled}
              onOpenAuth={onOpenAuth}
            />
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
                    status={hubAuthenticated ? t('settings.enabled') : t('settings.notConfigured')}
                    metric={hubAuthenticated ? t('settings.targetHubSignedIn') : t('settings.targetHubSignInRequired')}
                    connected={hubAuthenticated}
                  />
                  <ExecutionTargetCard
                    icon={<Computer size={18} />}
                    title={t('settings.schedulerRouteRemote')}
                    description={t('settings.schedulerRouteRemoteDesc')}
                    status={remoteControlEnabled ? t('settings.statusInProgress') : t('settings.statusPlanned')}
                    metric="SSH / Tailscale"
                    connected={remoteControlEnabled}
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
            <AgentMarketSection
              hubSessionActive={hubSessionActive}
              agents={agents}
              edgeOnline={edgeOnline}
              customAgents={customAgentsQuery.data ?? []}
              isLoading={customAgentsQuery.isLoading}
              isFetching={customAgentsQuery.isFetching}
              isError={customAgentsQuery.isError}
              isSuccess={customAgentsQuery.isSuccess}
              refetch={() => {
                void customAgentsQuery.refetch();
              }}
              onOpenAuth={onOpenAuth}
            />
          )}

          {active === 'keyboard' && (
            <Panel title={t('settings.keyboard')} description={t('settings.keyboardDesc')}>
              <div className={styles.shortcutTable}>
                {BINDING_IDS.map((id) => {
                  const keys = getBinding(id);
                  const isRecording = recordingBinding === id;
                  return (
                    <div
                      key={id}
                      className={`${styles.shortcutRow} ${isRecording ? styles.shortcutRowRecording : ''}`}
                      onClick={() => setRecordingBinding(isRecording ? null : id)}
                      role="button"
                      tabIndex={0}
                      aria-label={t('settings.keyboard.clickToRebind')}
                      title={t('settings.keyboard.clickToRebind')}
                    >
                      <span>{ACTION_LABELS[id]}</span>
                      <div>
                        {isRecording ? (
                          <span className={styles.recordingHint}>{t('settings.keyboard.recording')}</span>
                        ) : (
                          keys.map((key) => <kbd key={key}>{key}</kbd>)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className={styles.restoreButton}
                onClick={handleRestoreDefaults}
              >
                {t('settings.keyboard.restoreDefaults')}
              </button>
            </Panel>
          )}

          {active === 'mcp' && (
            <McpSection
              agents={agents}
              edgeOnline={edgeOnline}
              hubSessionActive={hubSessionActive}
              enableMcp={enableMcp}
              setEnableMcp={setEnableMcp}
            />
          )}

          {active === 'skills' && (
            <SkillsSection hubSessionActive={hubSessionActive} />
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
            <ModelsSection
              defaultModel={defaultModel}
              defaultProvider={defaultProvider}
              modelReasoningEffort={modelReasoningEffort}
              providerFallbackEnabled={providerFallbackEnabled}
              setDefaultModel={setDefaultModel}
              setDefaultProvider={setDefaultProvider}
              setModelReasoningEffort={setModelReasoningEffort}
              setProviderFallbackEnabled={setProviderFallbackEnabled}
            />
          )}

          {active === 'modelMapping' && (
            <ModelMappingSection
              modelMappingEnabled={modelMappingEnabled}
              setModelMappingEnabled={setModelMappingEnabled}
              modelAliases={modelAliases}
              toggleModelAlias={toggleModelAlias}
              updateModelAlias={updateModelAlias}
            />
          )}

          {active === 'ccSwitch' && (
            <CcSwitchSection
              ccSwitchBridge={ccSwitchBridge}
              setCcSwitchBridge={setCcSwitchBridge}
              ccSwitchProviders={ccSwitchProviders}
              updateCcSwitchProvider={updateCcSwitchProvider}
            />
          )}

          {active === 'connections' && (
            <Panel title={t('settings.connections')} description={t('settings.connectionsDesc')}>
              <ConnectionRow
                name="Hub"
                description={hubAuthenticated ? t('status.hubConnected') : t('status.hubDisconnected')}
                connected={hubAuthenticated}
              />
              <ConnectionRow name="Edge" description={`${t('settings.edgeLocal')} · ${runnerSummary}`} connected={edgeOnline} />
              <ConnectionRow name="WebSocket" description={t('status.wsConnected')} connected={edgeOnline} />
            </Panel>
          )}

          {active === 'remoteControl' && (
            <RemoteControlSection hubSessionActive={hubSessionActive} />
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
            <PlatformsSection hubSessionActive={hubSessionActive} />
          )}

          {active === 'account' && (
            <AccountSection
              hubSessionActive={hubSessionActive}
              accountName={accountName}
              tokenSource={tokenSource ?? ''}
              tokenSourceLabel={tokenSourceLabel}
              desktopDeviceStatus={desktopDeviceStatus}
              deviceId={deviceId}
              deviceRegistration={{
                status: deviceRegistrationStatus,
                error: deviceRegistrationQuery.error instanceof Error ? deviceRegistrationQuery.error.message : null,
              }}
              onOpenAuth={onOpenAuth}
              onSignOut={handleSignOut}
            />
          )}

          {active === 'securityAudit' && (
            <SecurityAuditSection
              auditTrail={auditTrail}
              setAuditTrail={setAuditTrail}
            />
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
  return ['queued', 'started', 'running', 'streaming', 'waiting_for_input', 'waiting_approval', 'cancelling'].includes(run.status);
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
          <span>{task.targetId ? t('settings.taskTarget', { target: shortId(task.targetId) }) : t('prompt.targetAuto')}</span>
          <span>{task.runId ? shortId(task.runId) : t('settings.taskUnbound')}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${isActiveBridgeTask(task) ? styles.statusPillOn : ''}`}>
        {t(`settings.taskStatus.${task.status}`, { defaultValue: task.status })}
      </span>
    </div>
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

function HubExecutionTargetRow({
  target,
  pinging,
  onPing,
}: {
  target: ExecutionTarget;
  pinging: boolean;
  onPing: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const health = target.health_state ?? 'unknown';
  const endpoint = formatTargetEndpoint(target);

  return (
    <div className={styles.runnerRow}>
      <div className={styles.connectionIcon}>
        {target.target_type === 'cloud_edge' ? (
          <Computer size={17} />
        ) : target.target_type === 'hub_relay' ? (
          <Globe2 size={17} />
        ) : (
          <Server size={17} />
        )}
      </div>
      <div className={styles.settingCopy}>
        <strong>{target.name}</strong>
        <span>{t(`settings.targetType.${target.target_type}`, { defaultValue: target.target_type })}</span>
        <div className={styles.taskMeta}>
          {target.trust_level ? (
            <span>{t(`settings.targetTrust.${target.trust_level}`, { defaultValue: target.trust_level })}</span>
          ) : null}
          {endpoint ? <span>{endpoint}</span> : null}
          <span>
            {target.last_seen_at
              ? t('settings.targetLastSeen', { time: formatTimestamp(target.last_seen_at) })
              : t('settings.targetNeverSeen')}
          </span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${isHubTargetConnected(target) ? styles.statusPillOn : ''}`}>
        {t(`settings.targetHealth.${health}`, { defaultValue: health })}
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

function ConnectionRow({ name, description, connected }: { name: string; description: string; connected: boolean }) {
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
        {connected ? 'Online' : 'Offline'}
      </span>
    </div>
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
  return <Select value={value} options={options} onChange={onChange} />;
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
