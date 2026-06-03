import { type ReactNode, useMemo, useState, useEffect, useRef, useCallback } from 'react';
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
  LogOut,
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
import GeneralSection from './settings/sections/GeneralSection';
import ConfigurationSection from './settings/sections/ConfigurationSection';
import PersonalizationSection from './settings/sections/PersonalizationSection';
import PermissionsSection from './settings/sections/PermissionsSection';
import AgentProfilesSection from './settings/sections/AgentProfilesSection';
import ExecutionTargetsSection from './settings/sections/ExecutionTargetsSection';
import TasksSection from './settings/sections/TasksSection';
import OnlineImSection from './settings/sections/OnlineImSection';
import GroupChatSection from './settings/sections/GroupChatSection';
import AgentSchedulingSection from './settings/sections/AgentSchedulingSection';
import AgentMarketSection from './settings/sections/AgentMarketSection';
import KeyboardSection from './settings/sections/KeyboardSection';
import McpSection from './settings/sections/McpSection';
import SkillsSection from './settings/sections/SkillsSection';
import HooksSection from './settings/sections/HooksSection';
import ModelsSection from './settings/sections/ModelsSection';
import ModelMappingSection from './settings/sections/ModelMappingSection';
import CcSwitchSection from './settings/sections/CcSwitchSection';
import AppearanceSection from './settings/sections/AppearanceSection';
import ConnectionsSection from './settings/sections/ConnectionsSection';
import RemoteControlSection from './settings/sections/RemoteControlSection';
import GitSection from './settings/sections/GitSection';
import EnvironmentSection from './settings/sections/EnvironmentSection';
import WorktreeSection from './settings/sections/WorktreeSection';
import BrowserSection from './settings/sections/BrowserSection';
import ComputerUseSection from './settings/sections/ComputerUseSection';
import PlatformsSection from './settings/sections/PlatformsSection';
import AccountSection from './settings/sections/AccountSection';
import SecurityAuditSection from './settings/sections/SecurityAuditSection';
import ArchivedSection from './settings/sections/ArchivedSection';
import DataSection from './settings/sections/DataSection';
import { useHubStore } from '@/stores/hubStore';
import { APP_VERSION, HUB_URL, getEdgeBaseUrl } from '@/config';
import {
  useAddAgentTeamMember,
  useCreateAgentTeam,
  useDecideTeamApproval,
  useHubAgentTeams,
  useResolveTeamConflict,
  useStartTeamRun,
} from '@/api/agentTeamQueries';
import type { AgentTeamRunBundle } from '@/api/agentTeamQueries';
import { useAgentList } from '@/api/agentQueries';
import type { ModelCatalogResponse } from '@/api/modelCatalogQueries';
import { useHubExecutionTargets, usePingHubExecutionTarget } from '@/api/executionTargetQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import { resolveModelDisplayName, type ModelDisplayNameMap } from '@/utils/modelDisplay';
import { resolveLocalOrchestration } from '@/utils/localOrchestration';
import {
  buildTeamLocalExecutions,
  normalizeTeamTasks,
  type TeamLocalExecution,
} from '@/utils/teamLocalExecution';
import {
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  clearCustomInstructions,
  readCustomInstructions,
  writeCustomInstructions,
} from '@/utils/customInstructions';
import { KEYBOARD_SHORTCUT_GROUPS } from '@/utils/keyboardShortcuts';
import {
  useModelSettingsStore,
  type ProviderHealth,
  type ReasoningEffortPreference,
  type ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import type { AgentInfo, RunInfo, RunnerHealthItem } from '@shared/types';
import type {
  AgentTeamDetail,
  AgentTeamRun,
  CoordinatorRouteDecision,
  CustomAgent,
  ExecutionTarget,
  ExecutionTargetHealthState,
  ExecutionTargetType,
  TeamApprovalState,
  TeamArtifactState,
  TeamAssignmentState,
  TeamBudget,
  TeamConflictState,
  TeamMemberState,
  TeamRunEventState,
  TeamRunState,
  TeamTaskState,
} from '@/api/hubClient';
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
  | 'archived'
  | 'data';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';
type SettingsSelectValue = SelectValue | ReasoningEffortPreference | ProviderHealth | string;

interface Props {
  onBack: () => void;
  onOpenAuth: () => void;
  initialSection?: SectionId;
  modelCatalog?: ModelCatalogResponse;
  modelDisplayNames?: ModelDisplayNameMap;
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: ReactNode;
  group: 'workspace' | 'automation' | 'system';
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

const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['opus[1m]', 'opus[1m]'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance'],
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

function displayProviderName(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('tokendance') || lower.includes('newapi') || lower.includes('api.vectorcontrol.tech')) {
    return 'TokenDance';
  }
  return raw.replace(/\s+gateway\b/ig, '').trim() || raw;
}

function modelCatalogOptions(
  catalog?: ModelCatalogResponse,
  includeAuto = true,
  modelDisplayNames?: ModelDisplayNameMap,
): Array<[SettingsSelectValue, string]> {
  const options: Array<[SettingsSelectValue, string]> = includeAuto ? [['auto', 'Auto']] : [];
  const seen = new Set(options.map(([value]) => String(value)));
  for (const item of catalog?.items ?? []) {
    if (item.status === 'unavailable') continue;
    const value = item.value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = resolveModelDisplayName(item.label || item.resolvedModel || item.value, modelDisplayNames);
    const resolvedLabel = resolveModelDisplayName(item.resolvedModel, modelDisplayNames);
    const detail = resolvedLabel && item.resolvedModel !== item.value && resolvedLabel !== label ? ` -> ${resolvedLabel}` : '';
    const source = item.sourceLabel ? ` (${item.sourceLabel})` : '';
    options.push([value, `${label}${detail}${source}`]);
  }
  for (const [value, label] of MODEL_OPTIONS) {
    if (!includeAuto && value === 'auto') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push([value, resolveModelDisplayName(label, modelDisplayNames) || label]);
  }
  return options;
}

function providerCatalogOptions(catalog?: ModelCatalogResponse): Array<[SettingsSelectValue, string]> {
  const options: Array<[SettingsSelectValue, string]> = PROVIDER_OPTIONS.map(([value, label]) => [value, label]);
  const seen = new Set(options.map(([value]) => String(value)));
  for (const source of catalog?.sources ?? []) {
    if (source.status === 'unavailable' || seen.has(source.id)) continue;
    seen.add(source.id);
    options.push([source.id, displayProviderName(source.label) ?? source.label]);
  }
  return options;
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

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general', modelCatalog, modelDisplayNames }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, themePreset, setThemePreset } = useTheme();
  const hubAuth = useAuth();
  const hubInventoryEnabled = hubAuth.isAuthenticated && Boolean(hubAuth.token);
  const hubTargetsQuery = useHubExecutionTargets({
    enabled: hubInventoryEnabled,
    getToken: () => hubAuth.token,
  });
  const pingHubTargetMutation = usePingHubExecutionTarget({
    getToken: () => hubAuth.token,
  });
  const [selectedAgentTeamId, setSelectedAgentTeamId] = useState('');
  const [selectedTeamRunId, setSelectedTeamRunId] = useState('');
  const agentTeamsQuery = useHubAgentTeams({
    enabled: hubInventoryEnabled,
    getToken: () => hubAuth.token,
    selectedTeamId: selectedAgentTeamId || undefined,
    selectedRunId: selectedTeamRunId || undefined,
  });
  const createAgentTeamMutation = useCreateAgentTeam({
    getToken: () => hubAuth.token,
  });
  const addAgentTeamMemberMutation = useAddAgentTeamMember({
    getToken: () => hubAuth.token,
  });
  const startTeamRunMutation = useStartTeamRun({
    getToken: () => hubAuth.token,
  });
  const decideTeamApprovalMutation = useDecideTeamApproval({
    getToken: () => hubAuth.token,
  });
  const resolveTeamConflictMutation = useResolveTeamConflict({
    getToken: () => hubAuth.token,
  });
  const { online: edgeOnline, health, refetch: refetchHealth } = useHealth();
  const { data: agentData, refetch: refetchAgents } = useAgentList(edgeOnline);
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
  const [navSearch, setNavSearch] = useState('');
  const navSearchRef = useRef<HTMLInputElement>(null);
  const [teamDraftName, setTeamDraftName] = useState('');
  const [teamDraftDescription, setTeamDraftDescription] = useState('');
  const [teamMemberProfileId, setTeamMemberProfileId] = useState('');
  const [teamMemberRole, setTeamMemberRole] = useState('executor');
  const [teamRunPrompt, setTeamRunPrompt] = useState('');

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
  const [customInstructions, setCustomInstructions] = useState(() => readCustomInstructions());
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState(() => readCustomInstructions());
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
  const customInstructionsDirty = customInstructionsDraft.trim() !== customInstructions;
  const customInstructionsRemaining = Math.max(0, MAX_CUSTOM_INSTRUCTIONS_CHARS - customInstructionsDraft.length);

  const handleSaveCustomInstructions = useCallback(() => {
    const saved = writeCustomInstructions(customInstructionsDraft);
    setCustomInstructions(saved);
    setCustomInstructionsDraft(saved);
  }, [customInstructionsDraft]);

  const handleClearCustomInstructions = useCallback(() => {
    clearCustomInstructions();
    setCustomInstructions('');
    setCustomInstructionsDraft('');
  }, []);

  const agents = agentData?.items ?? [];
  const modelSelectOptions = useMemo(
    () => modelCatalogOptions(modelCatalog, true, modelDisplayNames),
    [modelCatalog, modelDisplayNames],
  );
  const aliasModelSelectOptions = useMemo(
    () => modelCatalogOptions(modelCatalog, false, modelDisplayNames),
    [modelCatalog, modelDisplayNames],
  );
  const providerSelectOptions = useMemo(
    () => providerCatalogOptions(modelCatalog),
    [modelCatalog],
  );
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
  const edgeAddress = getEdgeBaseUrl();
  const healthStatus = edgeOnline ? (health?.status ?? 'unknown') : 'offline';
  const handleRefreshConnections = useCallback(() => {
    refetchHealth();
    refetchAgents();
  }, [refetchHealth, refetchAgents]);
  const hubTargets = hubTargetsQuery.data?.items ?? [];
  const hubOnlineTargets = hubTargets.filter(isHubTargetConnected).length;
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
  const hubSessionActive = hubAuthenticated || hubAuth.isAuthenticated;
  const agentTeamOverview = agentTeamsQuery.data;
  const agentTeamBundles = agentTeamOverview?.bundles ?? [];
  const hubCustomAgents = agentTeamOverview?.customAgents ?? [];
  const agentTeamCount = agentTeamOverview?.teams.length ?? 0;
  const teamRunTotal = agentTeamBundles.reduce((sum, bundle) => sum + bundle.runs.length, 0);
  const activeTeamRuns = agentTeamBundles.reduce(
    (sum, bundle) => sum + bundle.runs.filter(isActiveTeamRun).length,
    0,
  );
  const teamRunState = agentTeamOverview?.state;
  const teamRunTasks = normalizeTeamTasks(teamRunState, agentTeamOverview?.tasks ?? []);
  const teamRunMembers = teamRunState?.members ?? [];
  const teamRunAssignments = teamRunState?.assignments ?? [];
  const teamRunApprovals = teamRunState?.approvals ?? [];
  const teamRunConflicts = teamRunState?.conflicts ?? [];
  const pendingTeamApprovals = teamRunApprovals.filter(isPendingTeamApproval);
  const pendingTeamConflicts = teamRunConflicts.filter((conflict) => conflict.status !== 'resolved');
  const teamRunEvents = teamRunState?.run_events ?? [];
  const teamRouteLog = teamRunState?.route_log ?? [];
  const teamLocalExecutions = buildTeamLocalExecutions({
    selectedRunId: agentTeamOverview?.selectedRun?.id,
    bridgeTasks: bridgedTasks,
    tasks: teamRunTasks,
    assignments: teamRunAssignments,
    events: teamRunEvents,
  });
  const teamActiveMembers = teamRunMembers.filter((member) => (member.active_tasks ?? 0) > 0).length;
  const teamCompletedTasks = teamRunTasks.filter((task) => task.status === 'done').length;
  const agentTeamErrorMessage = agentTeamsQuery.error instanceof Error
    ? agentTeamsQuery.error.message
    : t('settings.agentTeamErrorDesc');
  const taskSyncAvailable = hubSessionActive;
  const groupChatAvailable = hubSessionActive;
  const skillSyncAvailable = false;
  const remoteControlAvailable = false;
  const platformSyncAvailable = false;
  const auditTrailAvailable = false;
  const schedulerActiveItems = activeRuns + activeHubTasks + activeTeamRuns;
  const schedulerTotalItems = runs.length + bridgedTasks.length + teamRunTotal;
  const localOrchestration = resolveLocalOrchestration(agents);
  const localOrchestratorName = localOrchestration.orchestratorName ?? 'Orchestrator';
  const schedulerTargetReadyCount = [
    edgeOnline,
    hubOnlineTargets > 0,
    remoteControlAvailable && remoteControlEnabled,
    false,
  ].filter(Boolean).length;
  const schedulerLocalMetric = totalRunners > 0 ? runnerSummary : edgeOnline ? t('settings.edgeOnline') : t('settings.edgeOffline');
  const marketPublishReady = agents.filter((agent) => agent.status === 'available').length;
  const marketCapabilityCount = countAgentCapabilities(agents);
  const skillScriptCount = PROJECT_SKILLS.filter((skill) => skill.hasScripts).length;
  const skillReferenceCount = PROJECT_SKILLS.filter((skill) => skill.hasReferences).length;
  const skillReadyCount = PROJECT_SKILLS.filter((skill) => skill.status === 'ready').length;
  const mcpCapableAgents = agents.filter((agent) => agent.capabilities.mcpIntegration).length;
  const mcpPermissionHookAgents = agents.filter((agent) => agent.capabilities.permissionHooks).length;
  const mcpSubAgentAgents = agents.filter((agent) => agent.capabilities.subAgentSpawn).length;
  const mcpAvailable = edgeOnline && mcpCapableAgents > 0;
  const accountName = hubAuth.user?.username ?? username ?? t('settings.signedIn');
  const tokenSource = hubAuth.tokenSource;
  const tokenSourceLabel =
    tokenSource === 'tokendance'
      ? 'TokenDance ID'
      : tokenSource === 'hub'
        ? t('settings.hubLocalLogin')
        : t('settings.notConfigured');
  const deviceId = readBrowserStorage('local', DEVICE_ID_KEY);
  const tokenDanceOidcStatus = tokenSource === 'tokendance' ? t('settings.statusReady') : t('settings.statusInProgress');
  const handleSignOut = () => {
    void hubAuth.logout();
  };
  const handleRefreshRuns = () => {
    void refetchRuns();
  };
  const handleCancelRun = (runId: string) => {
    void cancelRunMutation.mutateAsync(runId);
  };
  const handleCreateAgentTeam = () => {
    const name = teamDraftName.trim();
    if (!name) return;
    void Promise.resolve(createAgentTeamMutation.mutateAsync({
      name,
      description: teamDraftDescription.trim(),
    })).then(() => {
      setTeamDraftName('');
      setTeamDraftDescription('');
    });
  };
  const handleAddAgentTeamMember = () => {
    const teamId = agentTeamOverview?.selectedTeam?.id;
    if (!teamId || !teamMemberProfileId) return;
    void addAgentTeamMemberMutation.mutateAsync({
      teamId,
      member: {
        agent_profile_id: teamMemberProfileId,
        role: teamMemberRole,
      },
    });
  };
  const handleStartTeamRun = () => {
    const teamId = agentTeamOverview?.selectedTeam?.id;
    const trigger = teamRunPrompt.trim();
    if (!teamId || !trigger) return;
    void Promise.resolve(startTeamRunMutation.mutateAsync({
      teamId,
      run: { trigger_message: trigger },
    })).then(() => {
      setTeamRunPrompt('');
    });
  };
  const handleSelectAgentTeam = (team: AgentTeamDetail) => {
    setSelectedAgentTeamId(team.id);
    setSelectedTeamRunId('');
  };
  const handleSelectTeamRun = (teamId: string, run: AgentTeamRun) => {
    setSelectedAgentTeamId(teamId);
    setSelectedTeamRunId(run.id);
  };
  const schedulerPolicyReadyCount = [
    modelMappingEnabled,
    ccSwitchBridge,
    autoReview,
    remoteControlAvailable && remoteControlEnabled,
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
      { id: 'data', label: t('settings.data'), icon: <HardDrive size={17} />, group: 'system' },
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
  const hasNavResults = filteredNavItems.length > 0;

  const activeLabel = navItems.find((item) => item.id === active)?.label ?? t('settings.title');
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
          {!hasNavResults && (
            <div className={styles.navEmpty} role="status">
              {t('settings.searchEmpty')}
            </div>
          )}
        </nav>

        <div className={styles.sidebarAccount}>
          <button className={styles.sidebarAccountBtn} onClick={() => setActive('account')}>
            <UserCircle size={18} />
            <span>{hubSessionActive ? accountName : t('settings.notSignedIn')}</span>
            <ChevronRight size={15} className={styles.sidebarAccountChevron} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <div className={styles.header}>
            <span>{t('settings.title')}</span>
            <h1>{activeLabel}</h1>
          </div>

          {active === 'general' && (
            <GeneralSection
              detailLevel={detailLevel}
              setDetailLevel={setDetailLevel}
              compactMode={compactMode}
              setCompactMode={setCompactMode}
            />
          )}

          {active === 'appearance' && (
            <AppearanceSection
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              compactMode={compactMode}
              setCompactMode={setCompactMode}
              themePreset={themePreset}
              setThemePreset={setThemePreset}
            />
          )}

          {active === 'configuration' && (
            <ConfigurationSection
              defaultAgent="Auto"
              setDefaultAgent={() => {}}
              routing={t('settings.routingAuto')}
              setRouting={() => {}}
              approvalMode={approvalMode}
              setApprovalMode={setApprovalMode}
              defaultAgentOptions={[['Auto', 'Auto']]}
              routingOptions={[['auto', t('settings.routingAuto')]]}
            />
          )}

          {active === 'personalization' && (
            <PersonalizationSection username={username} />
          )}

          {active === 'permissions' && (
            <PermissionsSection
              autoReview={autoReview}
              setAutoReview={setAutoReview}
              fullAccess={fullAccess}
              setFullAccess={setFullAccess}
              allowlistEntries={[]}
              setAllowlistEntries={() => {}}
            />
          )}

          {active === 'agentProfiles' && (
            <AgentProfilesSection
              agents={agents}
              edgeOnline={edgeOnline}
              runnerSummary={runnerSummary}
              localAgentProfiles={localAgentProfiles}
            />
          )}

          {active === 'executionTargets' && (
            <ExecutionTargetsSection
              edgeOnline={edgeOnline}
              health={health}
              hubSessionActive={hubSessionActive}
              runnerSummary={runnerSummary}
              runnerItems={runnerItems}
              availableRunners={availableRunners}
              desktopDeviceStatus={deviceId ? shortId(deviceId) : t('settings.notConfigured')}
              deviceId={deviceId}
            />
          )}

          {active === 'tasks' && (
            <TasksSection
              runs={runs}
              activeRuns={activeRuns}
              runsLoading={runsLoading}
              runsFetching={runsFetching}
              runsError={!!runsError}
              refetchRuns={() => void refetchRuns()}
              cancelRunMutation={{
                mutateAsync: (id: string) => cancelRunMutation.mutateAsync(id),
                isPending: cancelRunMutation.isPending,
                variables: cancelRunMutation.variables ?? undefined,
              }}
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
              imSessions={[]}
              imContacts={[]}
              imFriendRequests={[]}
              imNotifications={[]}
              isLoading={false}
              isFetching={false}
              isError={false}
              isSuccess={true}
              refetch={() => {}}
              deviceRegistrationStatus="idle"
              onOpenAuth={onOpenAuth}
            />
          )}

          {active === 'groupChat' && (
            <GroupChatSection
              hubSessionActive={hubSessionActive}
              isLoading={false}
              isError={false}
              imSessions={[]}
              imContactsCount={0}
              imSnapshotStatus={t('settings.status.interfaceGap')}
              agents={agents}
              edgeOnline={edgeOnline}
              groupChatEnabled={groupChatEnabled}
              setGroupChatEnabled={setGroupChatEnabled}
              onOpenAuth={onOpenAuth}
            />
          )}

          {active === 'agentScheduling' && (
            <AgentSchedulingSection
              runs={runs}
              activeRuns={activeRuns}
              runsLoading={runsLoading}
              bridgedTasks={bridgedTasks}
              agents={agents}
              edgeOnline={edgeOnline}
              hubSessionActive={hubSessionActive}
              totalRunners={totalRunners}
              runnerSummary={runnerSummary}
              modelMappingEnabled={modelMappingEnabled}
              ccSwitchBridge={ccSwitchBridge}
              autoReview={autoReview}
              agentSchedulingEnabled={agentSchedulingEnabled}
              setAgentSchedulingEnabled={setAgentSchedulingEnabled}
            />
          )}

          {active === 'agentMarket' && (
            <AgentMarketSection
              hubSessionActive={hubSessionActive}
              agents={agents}
              edgeOnline={edgeOnline}
              customAgents={[]}
              isLoading={false}
              isFetching={false}
              isError={false}
              isSuccess={true}
              refetch={() => {}}
              onOpenAuth={onOpenAuth}
            />
          )}

          {active === 'keyboard' && <KeyboardSection />}

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
            <HooksSection enableHooks={enableHooks} setEnableHooks={setEnableHooks} />
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
            <ConnectionsSection
              edgeOnline={edgeOnline}
              hubSessionActive={hubAuthenticated}
              edgeAddress={edgeAddress}
              healthStatus={healthStatus}
              availableRunners={availableRunners}
              totalRunners={totalRunners}
              onRefresh={handleRefreshConnections}
            />
          )}

          {active === 'remoteControl' && (
            <RemoteControlSection hubSessionActive={hubSessionActive} />
          )}

          {active === 'git' && (
            <GitSection autoDetectGit={autoDetectGit} setAutoDetectGit={setAutoDetectGit} />
          )}

          {active === 'environment' && <EnvironmentSection />}

          {active === 'worktree' && (
            <WorktreeSection worktreeIsolation={worktreeIsolation} setWorktreeIsolation={setWorktreeIsolation} />
          )}

          {active === 'browser' && (
            <BrowserSection browserPreview={browserPreview} setBrowserPreview={setBrowserPreview} />
          )}

          {active === 'computerUse' && (
            <ComputerUseSection computerConfirm={computerConfirm} setComputerConfirm={setComputerConfirm} />
          )}

          {active === 'platforms' && (
            <PlatformsSection hubSessionActive={hubSessionActive} />
          )}

          {active === 'account' && (
            <AccountSection
              hubSessionActive={hubSessionActive}
              accountName={accountName}
              tokenSource={tokenSource ?? 'hub'}
              tokenSourceLabel={tokenSourceLabel}
              desktopDeviceStatus={deviceId ? shortId(deviceId) : t('settings.notConfigured')}
              deviceId={deviceId}
              deviceRegistration={{ status: 'idle', error: null }}
              onOpenAuth={onOpenAuth}
              onSignOut={handleSignOut}
            />
          )}

          {active === 'securityAudit' && (
            <SecurityAuditSection auditTrail={auditTrail} setAuditTrail={setAuditTrail} />
          )}

          {active === 'archived' && <ArchivedSection />}
          {active === 'data' && (
            <DataSection
              t={t}
              addToast={(input) => { return ''; }}
              resetModelSettings={() => {
                setDefaultModel('auto');
                setDefaultProvider('tokendance-gateway');
                setModelReasoningEffort('medium');
                setProviderFallbackEnabled(false);
              }}
            />
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

function isActiveTeamRun(run: AgentTeamRun) {
  return ['queued', 'running'].includes(run.status);
}

function isPendingTeamApproval(approval: TeamApprovalState) {
  const status = approval.status.toLowerCase();
  return status === 'pending' || status === 'requested' || status === 'waiting';
}

function previewText(value?: string, max = 110) {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function pathBasename(value: string) {
  return value.split(/[\\/]+/).filter(Boolean).pop() ?? value;
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
        {t(`run.status.${run.status.toLowerCase()}`, { defaultValue: run.status })}
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

function AgentTeamBuilder({
  hubReady,
  selectedTeam,
  customAgents,
  teamName,
  teamDescription,
  memberProfileId,
  memberRole,
  runPrompt,
  creating,
  addingMember,
  startingRun,
  onTeamNameChange,
  onTeamDescriptionChange,
  onMemberProfileChange,
  onMemberRoleChange,
  onRunPromptChange,
  onCreateTeam,
  onAddMember,
  onStartRun,
}: {
  hubReady: boolean;
  selectedTeam?: AgentTeamDetail;
  customAgents: CustomAgent[];
  teamName: string;
  teamDescription: string;
  memberProfileId: string;
  memberRole: string;
  runPrompt: string;
  creating: boolean;
  addingMember: boolean;
  startingRun: boolean;
  onTeamNameChange: (value: string) => void;
  onTeamDescriptionChange: (value: string) => void;
  onMemberProfileChange: (value: string) => void;
  onMemberRoleChange: (value: string) => void;
  onRunPromptChange: (value: string) => void;
  onCreateTeam: () => void;
  onAddMember: () => void;
  onStartRun: () => void;
}) {
  const { t } = useTranslation();
  const canCreate = hubReady && teamName.trim().length > 0 && !creating;
  const canAddMember = hubReady && !!selectedTeam && !!memberProfileId && !addingMember;
  const canStart = hubReady && !!selectedTeam && runPrompt.trim().length > 0 && !startingRun;
  const memberOptions: Array<[string, string]> = [
    ['', t('settings.agentTeamSelectProfile')],
    ...customAgents.map((agent) => [agent.id, `${agent.name} (${agent.agent_type})`] as [string, string]),
  ];
  const roleOptions: Array<[string, string]> = [
    ['supervisor', t('settings.teamMemberRole.supervisor')],
    ['executor', t('settings.teamMemberRole.executor')],
    ['reviewer', t('settings.teamMemberRole.reviewer')],
  ];

  return (
    <div className={styles.teamBuilder} data-testid="agent-team-builder">
      <div className={styles.teamBuilderGrid}>
        <section className={styles.teamForm}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamCreate')}</strong>
            <span>{hubReady ? t('settings.agentTeamCreateDesc') : t('settings.agentTeamSignInRequired')}</span>
          </div>
          <label>
            <span>{t('settings.agentTeamName')}</span>
            <input
              className={styles.textInput}
              value={teamName}
              onChange={(event) => onTeamNameChange(event.target.value)}
              disabled={!hubReady || creating}
              placeholder={t('settings.agentTeamNamePlaceholder')}
            />
          </label>
          <label>
            <span>{t('settings.agentTeamDescription')}</span>
            <textarea
              className={styles.textInput}
              value={teamDescription}
              onChange={(event) => onTeamDescriptionChange(event.target.value)}
              disabled={!hubReady || creating}
              placeholder={t('settings.agentTeamDescriptionPlaceholder')}
            />
          </label>
          <button type="button" className={styles.primaryBtn} onClick={onCreateTeam} disabled={!canCreate}>
            {creating ? t('settings.creating') : t('settings.agentTeamCreateAction')}
          </button>
        </section>

        <section className={styles.teamForm}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamMembersSetup')}</strong>
            <span>{selectedTeam ? selectedTeam.name : t('settings.agentTeamSelectTeamFirst')}</span>
          </div>
          <label>
            <span>{t('settings.agentTeamProfile')}</span>
            <SelectControl
              value={memberProfileId}
              options={memberOptions}
              onChange={onMemberProfileChange}
              disabled={!hubReady || !selectedTeam || customAgents.length === 0 || addingMember}
            />
          </label>
          <label>
            <span>{t('settings.agentTeamRole')}</span>
            <SelectControl
              value={memberRole}
              options={roleOptions}
              onChange={onMemberRoleChange}
              disabled={!hubReady || !selectedTeam || addingMember}
            />
          </label>
          <button type="button" className={styles.secondaryBtn} onClick={onAddMember} disabled={!canAddMember}>
            {addingMember ? t('settings.adding') : t('settings.agentTeamAddMember')}
          </button>
          {customAgents.length === 0 ? (
            <span className={styles.teamFormHint}>{t('settings.agentTeamNoCustomAgents')}</span>
          ) : null}
        </section>
      </div>

      <section className={styles.teamForm}>
        <div className={styles.teamBlockHeader}>
          <strong>{t('settings.agentTeamStartRun')}</strong>
          <span>{selectedTeam ? t('settings.agentTeamStartRunDesc') : t('settings.agentTeamSelectTeamFirst')}</span>
        </div>
        <textarea
          className={styles.textInput}
          value={runPrompt}
          onChange={(event) => onRunPromptChange(event.target.value)}
          disabled={!hubReady || !selectedTeam || startingRun}
          placeholder={t('settings.agentTeamRunPromptPlaceholder')}
        />
        <button type="button" className={styles.primaryBtn} onClick={onStartRun} disabled={!canStart}>
          {startingRun ? t('settings.starting') : t('settings.agentTeamStartRunAction')}
        </button>
      </section>
    </div>
  );
}

function AgentTeamConsole({
  teams,
  bundles,
  selectedTeam,
  selectedRun,
  state,
  tasks,
  members,
  assignments,
  approvals,
  conflicts,
  events,
  artifacts,
  budget,
  terminalReason,
  routeLog,
  localExecutions,
  refreshing,
  approvalBusy,
  conflictBusy,
  onSelectTeam,
  onSelectRun,
  onApprovalDecision,
  onResolveConflict,
}: {
  teams: AgentTeamDetail[];
  bundles: AgentTeamRunBundle[];
  selectedTeam?: AgentTeamDetail;
  selectedRun?: AgentTeamRun;
  state?: TeamRunState;
  tasks: TeamTaskState[];
  members: TeamMemberState[];
  assignments: TeamAssignmentState[];
  approvals: TeamApprovalState[];
  conflicts: TeamConflictState[];
  events: TeamRunEventState[];
  artifacts: TeamArtifactState[];
  budget?: TeamBudget;
  terminalReason?: string;
  routeLog: CoordinatorRouteDecision[];
  localExecutions: TeamLocalExecution[];
  refreshing: boolean;
  approvalBusy: boolean;
  conflictBusy: boolean;
  onSelectTeam: (team: AgentTeamDetail) => void;
  onSelectRun: (teamId: string, run: AgentTeamRun) => void;
  onApprovalDecision: (approval: TeamApprovalState, decision: 'allow' | 'deny') => void;
  onResolveConflict: (conflict: TeamConflictState, decision: TeamConflictDecision) => void;
}) {
  const { t } = useTranslation();
  const pendingApprovals = approvals.filter(isPendingTeamApproval);
  const pendingConflicts = conflicts.filter((conflict) => conflict.status !== 'resolved');
  const activeMembers = members.filter((member) => (member.active_tasks ?? 0) > 0).length;
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const status = state?.status ?? selectedRun?.status ?? 'unknown';
  const resultRows = buildTeamResultRows(tasks, events, terminalReason);
  const communicationGraph = buildTeamCommunicationGraph({
    members,
    tasks,
    assignments,
    routeLog,
    events,
    artifacts,
    conflicts,
  });
  const runTitle = selectedRun?.trigger_message
    ? previewText(selectedRun.trigger_message, 86)
    : t('settings.agentTeamNoRunSelected');

  return (
    <div className={styles.teamConsole} data-testid="agent-team-console">
      <div className={styles.teamConsoleHeader}>
        <div className={styles.connectionIcon}>
          <GitBranch size={17} />
        </div>
        <div className={styles.settingCopy}>
          <strong>{selectedTeam?.name ?? t('settings.agentTeamConsole')}</strong>
          <span>{runTitle}</span>
          <div className={styles.taskMeta}>
            {selectedRun ? <span>{shortId(selectedRun.id)}</span> : null}
            {selectedRun?.updated_at || selectedRun?.created_at ? (
              <span>{formatTimestamp(selectedRun?.updated_at ?? selectedRun?.created_at)}</span>
            ) : null}
            {refreshing ? <span>{t('settings.refreshing')}</span> : null}
          </div>
        </div>
        <span className={`${styles.statusPill} ${isActiveTeamStatus(status) ? styles.statusPillOn : ''}`}>
          {t(`settings.teamRunStatus.${status}`, { defaultValue: status })}
        </span>
      </div>

      <div className={styles.teamMetricGrid}>
        <TeamMetric label={t('settings.agentTeamMembers')} value={`${activeMembers}/${members.length}`} />
        <TeamMetric label={t('settings.agentTeamTasks')} value={`${completedTasks}/${tasks.length}`} />
        <TeamMetric label={t('settings.agentTeamApprovals')} value={`${pendingApprovals.length}/${approvals.length}`} />
        <TeamMetric label={t('settings.agentTeamRoutes')} value={`${routeLog.length}`} />
      </div>

      <TeamCommunicationGraph graph={communicationGraph} />
      <TeamLocalExecutionPanel executions={localExecutions} />

      <div className={styles.teamConsoleGrid}>
        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeams')}</strong>
            <span>{t('settings.agentTeamsDesc')}</span>
          </div>
          <div className={styles.teamList}>
            {teams.map((team) => (
              <TeamTemplateRow
                key={team.id}
                team={team}
                selected={team.id === selectedTeam?.id}
                onSelect={onSelectTeam}
              />
            ))}
          </div>
        </section>

        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamBranchSwitch')}</strong>
            <span>{t('settings.agentTeamBranchSwitchDesc')}</span>
          </div>
          {bundles.some((bundle) => bundle.runs.length > 0) ? (
            <div className={styles.teamList}>
              {bundles.flatMap((bundle) => bundle.runs).slice(0, 8).map((run) => (
                <TeamRunBranchRow
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRun?.id}
                  onSelect={(nextRun) => onSelectRun(nextRun.team_id, nextRun)}
                />
              ))}
            </div>
          ) : (
            <EmptyBlock title={t('settings.agentTeamNoRuns')} description={t('settings.agentTeamNoRunsDesc')} />
          )}
        </section>
      </div>

      <section className={styles.teamSurface}>
        <div className={styles.teamBlockHeader}>
          <strong>{t('settings.agentTeamMemberStatus')}</strong>
          <span>{t('settings.agentTeamMemberStatusDesc')}</span>
        </div>
        {members.length > 0 ? (
          <div className={styles.teamList}>
            {members.map((member) => (
              <TeamMemberRow key={member.member_id} member={member} />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.agentTeamNoMembers')} description={t('settings.agentTeamNoMembersDesc')} />
        )}
      </section>

      <section className={styles.teamSurface}>
        <div className={styles.teamBlockHeader}>
          <strong>{t('settings.agentTeamTaskBoard')}</strong>
          <span>{t('settings.agentTeamTaskBoardDesc')}</span>
        </div>
        {tasks.length > 0 ? (
          <div className={styles.teamList}>
            {tasks.slice(0, 8).map((task) => (
              <TeamTaskRow key={task.task_id} task={task} />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.agentTeamNoTasks')} description={t('settings.agentTeamNoTasksDesc')} />
        )}
      </section>

      <div className={styles.teamConsoleGrid}>
        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamResults')}</strong>
            <span>{t('settings.agentTeamResultsDesc')}</span>
          </div>
          {resultRows.length > 0 ? (
            <div className={styles.teamList}>
              {resultRows.slice(0, 6).map((result) => (
                <TeamResultRow key={result.id} result={result} />
              ))}
            </div>
          ) : (
            <EmptyBlock title={t('settings.agentTeamNoResults')} description={t('settings.agentTeamNoResultsDesc')} />
          )}
        </section>

        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamArtifacts')}</strong>
            <span>{t('settings.agentTeamArtifactsDesc')}</span>
          </div>
          {artifacts.length > 0 ? (
            <div className={styles.teamList}>
              {artifacts.slice(0, 8).map((artifact, index) => (
                <TeamArtifactRow key={`${artifact.path}-${artifact.event_seq ?? index}`} artifact={artifact} />
              ))}
            </div>
          ) : (
            <EmptyBlock title={t('settings.agentTeamNoArtifacts')} description={t('settings.agentTeamNoArtifactsDesc')} />
          )}
        </section>
      </div>

      <TeamBudgetBlock budget={budget} />

      <div className={styles.teamConsoleGrid}>
        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamRouteLog')}</strong>
            <span>{t('settings.agentTeamRouteLogDesc')}</span>
          </div>
          {routeLog.length > 0 ? (
            <div className={styles.teamList}>
              {routeLog.slice(0, 5).map((decision, index) => (
                <TeamRouteRow key={`${decision.correlation_id ?? decision.action}-${index}`} decision={decision} />
              ))}
            </div>
          ) : (
            <EmptyBlock title={t('settings.agentTeamNoRoutes')} description={t('settings.agentTeamNoRoutesDesc')} />
          )}
        </section>

        <section className={styles.teamSurface}>
          <div className={styles.teamBlockHeader}>
            <strong>{t('settings.agentTeamApprovalsConflicts')}</strong>
            <span>{t('settings.agentTeamApprovalsConflictsDesc')}</span>
          </div>
          {approvals.length > 0 || conflicts.length > 0 ? (
            <div className={styles.teamList}>
              {approvals.slice(0, 4).map((approval) => (
                <TeamApprovalRow
                  key={approval.approval_id}
                  approval={approval}
                  busy={approvalBusy}
                  onDecision={onApprovalDecision}
                />
              ))}
              {conflicts.slice(0, 3).map((conflict) => (
                <TeamConflictRow
                  key={conflict.conflict_id}
                  conflict={conflict}
                  artifacts={artifacts}
                  busy={conflictBusy}
                  onResolve={onResolveConflict}
                />
              ))}
            </div>
          ) : (
            <EmptyBlock
              title={t('settings.agentTeamNoApprovals')}
              description={pendingConflicts.length > 0
                ? t('settings.agentTeamPendingConflicts', { count: pendingConflicts.length })
                : t('settings.agentTeamNoApprovalsDesc')}
            />
          )}
        </section>
      </div>

      <section className={styles.teamSurface}>
        <div className={styles.teamBlockHeader}>
          <strong>{t('settings.agentTeamActivity')}</strong>
          <span>{t('settings.agentTeamActivityDesc')}</span>
        </div>
        {events.length > 0 ? (
          <div className={styles.teamList}>
            {events.slice(0, 6).map((event) => (
              <TeamEventRow key={`${event.agent_task_id}-${event.event_seq}`} event={event} />
            ))}
          </div>
        ) : (
          <EmptyBlock title={t('settings.agentTeamNoEvents')} description={t('settings.agentTeamNoEventsDesc')} />
        )}
      </section>
    </div>
  );
}

function isActiveTeamStatus(status: string) {
  return status === 'queued' || status === 'running';
}

function TeamMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.teamMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TeamLocalExecutionPanel({ executions }: { executions: TeamLocalExecution[] }) {
  const { t } = useTranslation();
  return (
    <section className={styles.teamSurface} data-testid="agent-team-local-execution">
      <div className={styles.teamBlockHeader}>
        <strong>{t('settings.agentTeamLocalExecution')}</strong>
        <span>{t('settings.agentTeamLocalExecutionDesc')}</span>
      </div>
      {executions.length > 0 ? (
        <div className={styles.teamList}>
          {executions.slice(0, 8).map((execution) => (
            <TeamLocalExecutionRow key={execution.id} execution={execution} />
          ))}
        </div>
      ) : (
        <EmptyBlock
          title={t('settings.agentTeamNoLocalExecution')}
          description={t('settings.agentTeamNoLocalExecutionDesc')}
        />
      )}
    </section>
  );
}

function TeamLocalExecutionRow({ execution }: { execution: TeamLocalExecution }) {
  const { t } = useTranslation();
  const sourceLabel = execution.source === 'desktopBridge'
    ? t('settings.agentTeamLocalSource')
    : t('settings.agentTeamHubProjectionSource');
  return (
    <div className={`${styles.teamMiniRow} ${styles.teamExecutionRow}`}>
      <div>
        <strong>{previewText(execution.title, 120)}</strong>
        <span>{execution.error || sourceLabel}</span>
        <div className={styles.taskMeta}>
          <span>{execution.runtimeLabel}</span>
          {execution.agentTaskId ? <span>{t('settings.agentTeamHubTask')}: {shortId(execution.agentTaskId)}</span> : null}
          {execution.edgeRunId ? <span>{t('settings.agentTeamEdgeRun')}: {shortId(execution.edgeRunId)}</span> : null}
          {execution.hubTaskId ? <span>{shortId(execution.hubTaskId)}</span> : null}
          {execution.assignmentId ? <span>{shortId(execution.assignmentId)}</span> : null}
          {execution.memberId ? <span>{shortId(execution.memberId)}</span> : null}
          {execution.latestEventType ? <span>{execution.latestEventType}</span> : null}
          {execution.eventCount > 0 ? <span>{t('settings.agentTeamLocalEvents', { count: execution.eventCount })}</span> : null}
          {execution.createdAt ? <span>{formatTimestamp(execution.createdAt)}</span> : null}
        </div>
      </div>
      <em>{t(`settings.taskStatus.${execution.status}`, { defaultValue: execution.status })}</em>
    </div>
  );
}

type TeamGraphNodeKind = 'coordinator' | 'member' | 'task' | 'runtime' | 'artifact' | 'conflict';
type TeamGraphEdgeKind = 'assignment' | 'route' | 'task' | 'runtime' | 'artifact' | 'conflict';

interface TeamGraphNode {
  id: string;
  label: string;
  meta: string;
  kind: TeamGraphNodeKind;
  status?: string;
}

interface TeamGraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: TeamGraphEdgeKind;
}

interface TeamCommunicationGraphModel {
  nodes: TeamGraphNode[];
  edges: TeamGraphEdge[];
}

function TeamCommunicationGraph({ graph }: { graph: TeamCommunicationGraphModel }) {
  const { t } = useTranslation();
  const nodeClass: Record<TeamGraphNodeKind, string> = {
    artifact: styles.teamGraphNodeArtifact ?? '',
    conflict: styles.teamGraphNodeConflict ?? '',
    coordinator: styles.teamGraphNodeCoordinator ?? '',
    member: styles.teamGraphNodeMember ?? '',
    runtime: styles.teamGraphNodeRuntime ?? '',
    task: styles.teamGraphNodeTask ?? '',
  };

  return (
    <section className={styles.teamSurface} data-testid="agent-team-communication-graph">
      <div className={styles.teamBlockHeader}>
        <strong>{t('settings.agentTeamCommunicationGraph')}</strong>
        <span>{t('settings.agentTeamCommunicationGraphDesc')}</span>
      </div>
      {graph.nodes.length > 0 || graph.edges.length > 0 ? (
        <div className={styles.teamGraph}>
          <div className={styles.teamGraphNodes} aria-label={t('settings.agentTeamGraphNodes')}>
            {graph.nodes.map((node) => (
              <div key={node.id} className={`${styles.teamGraphNode} ${nodeClass[node.kind]}`}>
                <strong>{node.label}</strong>
                <span>{node.meta}</span>
                {node.status ? <em>{node.status}</em> : null}
              </div>
            ))}
          </div>
          <div className={styles.teamGraphEdges} aria-label={t('settings.agentTeamGraphEdges')}>
            {graph.edges.map((edge) => {
              const from = graph.nodes.find((node) => node.id === edge.from);
              const to = graph.nodes.find((node) => node.id === edge.to);
              return (
                <div key={edge.id} className={styles.teamGraphEdge}>
                  <span>{from?.label ?? shortGraphId(edge.from)}</span>
                  <strong>{edge.label}</strong>
                  <span>{to?.label ?? shortGraphId(edge.to)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyBlock
          title={t('settings.agentTeamNoCommunicationGraph')}
          description={t('settings.agentTeamNoCommunicationGraphDesc')}
        />
      )}
    </section>
  );
}

function buildTeamCommunicationGraph({
  members,
  tasks,
  assignments,
  routeLog,
  events,
  artifacts,
  conflicts,
}: {
  members: TeamMemberState[];
  tasks: TeamTaskState[];
  assignments: TeamAssignmentState[];
  routeLog: CoordinatorRouteDecision[];
  events: TeamRunEventState[];
  artifacts: TeamArtifactState[];
  conflicts: TeamConflictState[];
}): TeamCommunicationGraphModel {
  const nodeMap = new Map<string, TeamGraphNode>();
  const edgeMap = new Map<string, TeamGraphEdge>();
  const supervisor = members.find((member) => member.role === 'supervisor') ?? members[0];
  const coordinatorId = supervisor ? memberNodeId(supervisor.member_id) : 'coordinator:supervisor';
  const taskByAgentTask = new Map<string, TeamTaskState>();

  const addNode = (node: TeamGraphNode) => {
    const previous = nodeMap.get(node.id);
    nodeMap.set(node.id, previous ? { ...previous, ...node } : node);
  };
  const addEdge = (edge: TeamGraphEdge) => {
    if (edge.from === edge.to || edgeMap.has(edge.id)) return;
    edgeMap.set(edge.id, edge);
  };
  const ensureMember = (memberId?: string, role = 'member') => {
    if (!memberId) return undefined;
    const id = memberNodeId(memberId);
    if (!nodeMap.has(id)) {
      addNode({ id, label: shortId(memberId), meta: role, kind: 'member' });
    }
    return id;
  };
  const ensureTask = (taskId?: string, fallback?: Partial<TeamTaskState>) => {
    if (!taskId) return undefined;
    const id = taskNodeId(taskId);
    if (!nodeMap.has(id)) {
      addNode({
        id,
        label: previewText(fallback?.objective || taskId, 48),
        meta: shortId(taskId),
        kind: 'task',
        status: fallback?.status,
      });
    }
    return id;
  };

  if (!supervisor && (routeLog.length > 0 || assignments.length > 0 || tasks.length > 0)) {
    addNode({
      id: coordinatorId,
      label: 'Supervisor',
      meta: 'coordinator',
      kind: 'coordinator',
    });
  }

  members.forEach((member) => {
    addNode({
      id: memberNodeId(member.member_id),
      label: tFallbackRole(member.role),
      meta: member.agent_profile_id ? shortId(member.agent_profile_id) : shortId(member.member_id),
      kind: member.role === 'supervisor' ? 'coordinator' : 'member',
      status: `${member.active_tasks ?? 0}/${member.completed_tasks ?? 0}`,
    });
  });

  tasks.forEach((task) => {
    addNode({
      id: taskNodeId(task.task_id),
      label: previewText(task.objective || task.task_id, 48),
      meta: task.assignee_member_id ? shortId(task.assignee_member_id) : shortId(task.task_id),
      kind: 'task',
      status: task.status,
    });
    if (task.agent_task_id) taskByAgentTask.set(task.agent_task_id, task);
    if (task.assignee_member_id) {
      const memberId = ensureMember(task.assignee_member_id);
      if (memberId) {
        addEdge({
          id: `task:${task.assignee_member_id}:${task.task_id}`,
          from: memberId,
          to: taskNodeId(task.task_id),
          label: 'owns',
          kind: 'task',
        });
      }
    }
    if (task.parent_task_id) {
      const parentId = ensureTask(task.parent_task_id);
      if (parentId) {
        addEdge({
          id: `parent:${task.parent_task_id}:${task.task_id}`,
          from: parentId,
          to: taskNodeId(task.task_id),
          label: 'forks',
          kind: 'task',
        });
      }
    }
    if (task.edge_run_id || task.run_id) {
      const runtimeId = runtimeNodeId(task.edge_run_id ?? task.run_id);
      addNode({ id: runtimeId, label: shortId(task.edge_run_id ?? task.run_id), meta: 'Edge run', kind: 'runtime' });
      addEdge({
        id: `runtime:${task.task_id}:${task.edge_run_id ?? task.run_id}`,
        from: taskNodeId(task.task_id),
        to: runtimeId,
        label: 'runs',
        kind: 'runtime',
      });
    }
  });

  assignments.forEach((assignment) => {
    const from = ensureMember(assignment.from_member_id, 'from') ?? coordinatorId;
    const to = ensureMember(assignment.to_member_id, 'to');
    if (!to) return;
    addEdge({
      id: `assignment:${assignment.assignment_id}`,
      from,
      to,
      label: assignment.type || assignment.status || 'assigns',
      kind: 'assignment',
    });
  });

  routeLog.forEach((decision, index) => {
    const worker = ensureMember(decision.next_worker, 'worker');
    if (!worker) return;
    addEdge({
      id: `route:${decision.correlation_id ?? index}:${decision.action}:${decision.next_worker}`,
      from: coordinatorId,
      to: worker,
      label: decision.action,
      kind: 'route',
    });
  });

  events.slice(0, 8).forEach((event) => {
    const task = taskByAgentTask.get(event.agent_task_id);
    const taskId = task ? ensureTask(task.task_id, task) : ensureTask(event.agent_task_id, {
      objective: event.event_type,
      status: event.event_type,
    });
    if (!taskId || !event.edge_run_id) return;
    const runtimeId = runtimeNodeId(event.edge_run_id);
    addNode({ id: runtimeId, label: shortId(event.edge_run_id), meta: 'runtime event', kind: 'runtime' });
    addEdge({
      id: `event:${event.agent_task_id}:${event.edge_run_id}:${event.event_seq}`,
      from: taskId,
      to: runtimeId,
      label: previewText(event.event_type, 22),
      kind: 'runtime',
    });
  });

  artifacts.slice(0, 6).forEach((artifact, index) => {
    const sourceId = ensureTask(artifact.team_task_id ?? artifact.agent_task_id)
      ?? ensureMember(artifact.member_id)
      ?? (artifact.edge_run_id ? runtimeNodeId(artifact.edge_run_id) : undefined);
    if (artifact.edge_run_id && !nodeMap.has(runtimeNodeId(artifact.edge_run_id))) {
      addNode({ id: runtimeNodeId(artifact.edge_run_id), label: shortId(artifact.edge_run_id), meta: 'Edge run', kind: 'runtime' });
    }
    const artifactId = `artifact:${artifact.path}:${artifact.event_seq ?? index}`;
    addNode({
      id: artifactId,
      label: previewText(pathBasename(artifact.path), 36),
      meta: previewText(artifact.path, 44),
      kind: 'artifact',
      status: artifact.status || artifact.action,
    });
    if (sourceId) {
      addEdge({
        id: `artifact:${sourceId}:${artifactId}`,
        from: sourceId,
        to: artifactId,
        label: artifact.action || artifact.tool_name || 'artifact',
        kind: 'artifact',
      });
    }
  });

  conflicts.slice(0, 4).forEach((conflict) => {
    const conflictId = `conflict:${conflict.conflict_id}`;
    addNode({
      id: conflictId,
      label: previewText(pathBasename(conflict.path), 36),
      meta: previewText(conflict.path, 44),
      kind: 'conflict',
      status: conflict.status,
    });
    const sourceIds = [
      ...(conflict.team_task_ids ?? []).map((id) => ensureTask(id)),
      ...(conflict.agent_task_ids ?? []).map((id) => {
        const task = taskByAgentTask.get(id);
        return task ? ensureTask(task.task_id, task) : ensureTask(id);
      }),
      ...(conflict.member_ids ?? []).map((id) => ensureMember(id)),
    ].filter((id): id is string => Boolean(id));
    sourceIds.slice(0, 4).forEach((sourceId) => {
      addEdge({
        id: `conflict:${sourceId}:${conflict.conflict_id}`,
        from: sourceId,
        to: conflictId,
        label: 'conflict',
        kind: 'conflict',
      });
    });
  });

  return {
    nodes: [...nodeMap.values()].slice(0, 14),
    edges: [...edgeMap.values()]
      .filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to))
      .slice(0, 16),
  };
}

function memberNodeId(value: string) {
  return `member:${value}`;
}

function taskNodeId(value: string) {
  return `task:${value}`;
}

function runtimeNodeId(value?: string) {
  return `runtime:${value ?? 'unknown'}`;
}

function shortGraphId(value: string) {
  return shortId(value.replace(/^(member|task|runtime|artifact|conflict|coordinator):/, ''));
}

function tFallbackRole(role: string) {
  return role || 'member';
}

function TeamTemplateRow({
  team,
  selected,
  onSelect,
}: {
  team: AgentTeamDetail;
  selected: boolean;
  onSelect: (team: AgentTeamDetail) => void;
}) {
  const { t } = useTranslation();
  const memberCount = team.members?.length ?? 0;
  return (
    <button
      type="button"
      className={`${styles.teamMiniRow} ${styles.teamMiniButton} ${selected ? styles.teamMiniRowSelected : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(team)}
    >
      <div>
        <strong>{team.name}</strong>
        <span>{team.description || t('settings.agentTeamDefaultDesc')}</span>
      </div>
      <em>{t('settings.agentTeamMemberCount', { count: memberCount })}</em>
    </button>
  );
}

function TeamRunBranchRow({
  run,
  selected,
  onSelect,
}: {
  run: AgentTeamRun;
  selected: boolean;
  onSelect: (run: AgentTeamRun) => void;
}) {
  const { t } = useTranslation();
  const title = run.trigger_message ? previewText(run.trigger_message, 90) : shortId(run.id);
  return (
    <button
      type="button"
      className={`${styles.teamMiniRow} ${styles.teamMiniButton} ${selected ? styles.teamMiniRowSelected : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(run)}
    >
      <div>
        <strong>{title}</strong>
        <span>{shortId(run.team_id)}</span>
        <div className={styles.taskMeta}>
          <span>{shortId(run.id)}</span>
          {run.updated_at || run.created_at ? <span>{formatTimestamp(run.updated_at ?? run.created_at)}</span> : null}
        </div>
      </div>
      <em>{t(`settings.teamRunStatus.${run.status}`, { defaultValue: run.status })}</em>
    </button>
  );
}

function TeamMemberRow({ member }: { member: TeamMemberState }) {
  const { t } = useTranslation();
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{t(`settings.teamMemberRole.${member.role}`, { defaultValue: member.role })}</strong>
        <span>{member.agent_profile_id ? shortId(member.agent_profile_id) : shortId(member.member_id)}</span>
      </div>
      <em>{t('settings.agentTeamMemberLoad', {
        active: member.active_tasks ?? 0,
        done: member.completed_tasks ?? 0,
      })}</em>
    </div>
  );
}

function TeamTaskRow({ task }: { task: TeamTaskState }) {
  const { t } = useTranslation();
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{previewText(task.objective || task.task_id, 120)}</strong>
        <span>{task.assignee_member_id ? shortId(task.assignee_member_id) : t('settings.agentTeamUnassigned')}</span>
        <div className={styles.taskMeta}>
          {task.run_id ? <span>{shortId(task.run_id)}</span> : null}
          {task.risk_level ? <span>{task.risk_level}</span> : null}
          {task.attempt ? <span>{t('settings.agentTeamAttempt', { count: task.attempt })}</span> : null}
        </div>
      </div>
      <em>{t(`settings.teamTaskStatus.${task.status}`, { defaultValue: task.status })}</em>
    </div>
  );
}

interface TeamResultItem {
  id: string;
  title: string;
  body: string;
  meta: string[];
  status?: string;
}

function buildTeamResultRows(
  tasks: TeamTaskState[],
  events: TeamRunEventState[],
  terminalReason?: string,
): TeamResultItem[] {
  const rows: TeamResultItem[] = [];
  const terminal = terminalReason?.trim();
  if (terminal) {
    rows.push({
      id: 'terminal-reason',
      title: 'settings.agentTeamTerminalReason',
      body: terminal,
      meta: ['TeamRunState'],
      status: 'terminal',
    });
  }

  tasks.forEach((task) => {
    const result = (task as TeamTaskState & { result?: string }).result?.trim();
    if (!result) return;
    rows.push({
      id: `task-result-${task.task_id}`,
      title: task.objective || task.task_id,
      body: result,
      meta: [
        shortId(task.task_id),
        task.assignee_member_id ? shortId(task.assignee_member_id) : '',
        task.run_id ? shortId(task.run_id) : '',
      ].filter(Boolean),
      status: task.status,
    });
  });

  events.forEach((event) => {
    if (!isTeamResultEvent(event.event_type)) return;
    const body = extractTeamEventResult(event.payload);
    if (!body) return;
    rows.push({
      id: `event-result-${event.agent_task_id}-${event.event_seq}`,
      title: event.event_type,
      body,
      meta: [
        `#${event.event_seq}`,
        event.edge_run_id ? shortId(event.edge_run_id) : '',
        event.created_at ? formatTimestamp(event.created_at) : '',
      ].filter(Boolean),
      status: shortId(event.agent_task_id),
    });
  });

  return rows;
}

function isTeamResultEvent(eventType: string) {
  const normalized = eventType.toLowerCase();
  return normalized === 'agent.result'
    || normalized === 'agent.done'
    || normalized === 'run.agent.result'
    || normalized.endsWith('.result')
    || normalized.endsWith('.done');
}

function extractTeamEventResult(payload?: string) {
  const normalized = payload?.trim();
  if (!normalized) return '';
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const candidate = parsed.final_content
      ?? parsed.result_summary
      ?? parsed.content
      ?? parsed.result
      ?? parsed.reason
      ?? parsed.message
      ?? parsed.output;
    if (typeof candidate === 'string') return previewText(candidate, 180);
    if (candidate != null) return previewText(JSON.stringify(candidate), 180);
    return previewText(normalized, 180);
  } catch {
    return previewText(normalized, 180);
  }
}

function TeamResultRow({ result }: { result: TeamResultItem }) {
  const { t } = useTranslation();
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{t(result.title, { defaultValue: previewText(result.title, 120) })}</strong>
        <span>{result.body}</span>
        {result.meta.length > 0 ? (
          <div className={styles.taskMeta}>
            {result.meta.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
      </div>
      {result.status ? <em>{result.status}</em> : null}
    </div>
  );
}

function TeamArtifactRow({ artifact }: { artifact: TeamArtifactState }) {
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{artifact.path}</strong>
        <span>{artifact.tool_name || artifact.action || artifact.edge_run_id || shortId(artifact.team_task_id)}</span>
        <div className={styles.taskMeta}>
          {artifact.action ? <span>{artifact.action}</span> : null}
          {artifact.tool_name ? <span>{artifact.tool_name}</span> : null}
          {artifact.member_id ? <span>{shortId(artifact.member_id)}</span> : null}
          {artifact.created_at ? <span>{formatTimestamp(artifact.created_at)}</span> : null}
        </div>
      </div>
      <em>{artifact.status || artifact.action || 'artifact'}</em>
    </div>
  );
}

function TeamBudgetBlock({ budget }: { budget?: TeamBudget }) {
  const { t } = useTranslation();
  if (!budget) return null;

  const total = formatTeamNumber(budget.total_tokens_used);
  const limit = formatTeamNumber(budget.token_limit);
  const remaining = formatTeamNumber(budget.remaining_tokens);
  const input = formatTeamNumber(budget.input_tokens);
  const output = formatTeamNumber(budget.output_tokens);
  const usage = typeof budget.usage_percent === 'number' ? `${Math.round(budget.usage_percent)}%` : t('settings.agentTeamBudgetUnknown');

  return (
    <section className={styles.teamSurface}>
      <div className={styles.teamBlockHeader}>
        <strong>{t('settings.agentTeamBudget')}</strong>
        <span>{t('settings.agentTeamBudgetDesc')}</span>
      </div>
      <div className={styles.teamBudgetGrid}>
        <TeamMetric label={t('settings.agentTeamBudgetTokens')} value={`${total} / ${limit}`} />
        <TeamMetric label={t('settings.agentTeamBudgetUsage')} value={usage} />
        <TeamMetric label={t('settings.agentTeamBudgetRemaining')} value={remaining} />
        <TeamMetric label={t('settings.agentTeamBudgetIO')} value={`${input} / ${output}`} />
        <TeamMetric label={t('settings.agentTeamBudgetRuns')} value={formatTeamNumber(budget.run_count)} />
        <TeamMetric
          label={t('settings.agentTeamBudgetWarnings')}
          value={`${formatTeamNumber(budget.context_warnings)} / ${formatTeamNumber(budget.compactions)}`}
        />
      </div>
    </section>
  );
}

function formatTeamNumber(value?: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US').format(value)
    : '--';
}

function TeamRouteRow({ decision }: { decision: CoordinatorRouteDecision }) {
  const { t } = useTranslation();
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{t(`settings.teamRouteAction.${decision.action}`, { defaultValue: decision.action })}</strong>
        <span>{previewText(decision.instructions || decision.summary || decision.reasoning || decision.blocked_reason, 120)}</span>
        <div className={styles.taskMeta}>
          {decision.next_worker ? <span>{shortId(decision.next_worker)}</span> : null}
          {decision.correlation_id ? <span>{shortId(decision.correlation_id)}</span> : null}
        </div>
      </div>
      <em>{decision.action}</em>
    </div>
  );
}

function TeamApprovalRow({
  approval,
  busy,
  onDecision,
}: {
  approval: TeamApprovalState;
  busy: boolean;
  onDecision: (approval: TeamApprovalState, decision: 'allow' | 'deny') => void;
}) {
  const { t } = useTranslation();
  const pending = isPendingTeamApproval(approval);
  return (
    <div className={`${styles.teamMiniRow} ${styles.teamActionRow}`}>
      <div>
        <strong>{approval.tool_name || approval.request_id || approval.approval_id}</strong>
        <span>{approval.reason || approval.edge_run_id || t('settings.agentTeamApprovalDefaultDesc')}</span>
        <div className={styles.taskMeta}>
          <span>{approval.status}</span>
          {approval.member_id ? <span>{shortId(approval.member_id)}</span> : null}
        </div>
      </div>
      {pending ? (
        <div className={styles.teamActions}>
          <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={() => onDecision(approval, 'deny')}>
            {t('settings.deny')}
          </button>
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => onDecision(approval, 'allow')}>
            {t('settings.allow')}
          </button>
        </div>
      ) : (
        <em>{approval.status}</em>
      )}
    </div>
  );
}

interface TeamConflictDecision {
  resolution: 'accept_agent_task' | 'manual_merge' | 'keep_all' | 'discard_all' | 'blocked';
  selectedAgentTaskId?: string;
  reason: string;
}

function TeamConflictRow({
  conflict,
  artifacts,
  busy,
  onResolve,
}: {
  conflict: TeamConflictState;
  artifacts: TeamArtifactState[];
  busy: boolean;
  onResolve: (conflict: TeamConflictState, decision: TeamConflictDecision) => void;
}) {
  const { t } = useTranslation();
  const pending = conflict.status !== 'resolved';
  const sources = buildConflictSources(conflict, artifacts);
  const sourceCount = sources.length || conflict.agent_task_ids?.length || 0;
  return (
    <div className={`${styles.teamMiniRow} ${styles.teamActionRow}`}>
      <div>
        <strong>{conflict.path}</strong>
        <span>{t('settings.agentTeamConflictSources', { count: sourceCount })}</span>
        <div className={styles.taskMeta}>
          <span>{conflict.status}</span>
          {conflict.resolution ? <span>{conflict.resolution}</span> : null}
          {conflict.selected_agent_task_id ? <span>{shortId(conflict.selected_agent_task_id)}</span> : null}
        </div>
      </div>
      {sources.length > 0 ? (
        <div className={styles.conflictSourceGrid}>
          {sources.map((source) => (
            <div className={styles.conflictSourceCard} key={source.id}>
              <div className={styles.conflictSourceHead}>
                <strong>{source.label}</strong>
                <em>{source.action || source.status || t('settings.agentTeamArtifactSource')}</em>
              </div>
              <span>{source.path}</span>
              <div className={styles.taskMeta}>
                {source.memberId ? <span>{shortId(source.memberId)}</span> : null}
                {source.edgeRunId ? <span>{shortId(source.edgeRunId)}</span> : null}
                {source.createdAt ? <span>{formatTimestamp(source.createdAt)}</span> : null}
              </div>
              {pending && source.agentTaskId ? (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={busy}
                  onClick={() => onResolve(conflict, {
                    resolution: 'accept_agent_task',
                    selectedAgentTaskId: source.agentTaskId,
                    reason: `Accepted ${source.agentTaskId} from Desktop TeamRun Console`,
                  })}
                >
                  {t('settings.acceptAgentTask')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {pending ? (
        <div className={styles.teamActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => onResolve(conflict, {
              resolution: 'keep_all',
              reason: 'Keep all conflict artifacts from Desktop TeamRun Console',
            })}
          >
            {t('settings.keepAllArtifacts')}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => onResolve(conflict, {
              resolution: 'manual_merge',
              reason: 'Marked from Desktop TeamRun Console',
            })}
          >
            {t('settings.markManualMerge')}
          </button>
        </div>
      ) : (
        <em>{conflict.status}</em>
      )}
    </div>
  );
}

interface ConflictSourceView {
  id: string;
  label: string;
  path: string;
  agentTaskId?: string;
  memberId?: string;
  edgeRunId?: string;
  action?: string;
  status?: string;
  createdAt?: string;
}

function buildConflictSources(
  conflict: TeamConflictState,
  artifacts: TeamArtifactState[],
): ConflictSourceView[] {
  const path = normalizeArtifactPath(conflict.path);
  const matched = artifacts.filter((artifact) => {
    if (conflict.conflict_id && artifact.conflict_id === conflict.conflict_id) return true;
    return normalizeArtifactPath(artifact.path) === path;
  });

  const bySource = new Map<string, ConflictSourceView>();
  matched.forEach((artifact, index) => {
    const sourceId = artifact.agent_task_id
      || artifact.team_task_id
      || artifact.member_id
      || artifact.edge_run_id
      || `${artifact.path}-${artifact.event_seq ?? index}`;
    const prev = bySource.get(sourceId);
    const next: ConflictSourceView = {
      id: sourceId,
      label: artifact.agent_task_id
        ? shortId(artifact.agent_task_id)
        : artifact.member_id
          ? shortId(artifact.member_id)
          : shortId(sourceId),
      path: artifact.path,
      agentTaskId: artifact.agent_task_id,
      memberId: artifact.member_id,
      edgeRunId: artifact.edge_run_id,
      action: artifact.action,
      status: artifact.status,
      createdAt: artifact.created_at,
    };
    if (!prev || timestampOfArtifact(next.createdAt) >= timestampOfArtifact(prev.createdAt)) {
      bySource.set(sourceId, next);
    }
  });

  (conflict.agent_task_ids ?? []).forEach((agentTaskId) => {
    if (bySource.has(agentTaskId)) return;
    bySource.set(agentTaskId, {
      id: agentTaskId,
      label: shortId(agentTaskId),
      path: conflict.path,
      agentTaskId,
    });
  });

  return [...bySource.values()];
}

function normalizeArtifactPath(value?: string) {
  return (value ?? '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function timestampOfArtifact(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function TeamEventRow({ event }: { event: TeamRunEventState }) {
  return (
    <div className={styles.teamMiniRow}>
      <div>
        <strong>{event.event_type}</strong>
        <span>{previewText(event.payload, 120) || shortId(event.agent_task_id)}</span>
        <div className={styles.taskMeta}>
          <span>#{event.event_seq}</span>
          {event.edge_run_id ? <span>{shortId(event.edge_run_id)}</span> : null}
          {event.created_at ? <span>{formatTimestamp(event.created_at)}</span> : null}
        </div>
      </div>
      <em>{shortId(event.agent_task_id)}</em>
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
  modelOptions,
  providerOptions,
}: {
  alias: string;
  model: string;
  provider: string;
  reasoningEffort: ReasoningEffortPreference;
  enabled: boolean;
  modelOptions: Array<[SettingsSelectValue, string]>;
  providerOptions: Array<[SettingsSelectValue, string]>;
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
            options={modelOptions}
            onChange={onModelChange}
          />
        </label>
        <label>
          <span>{t('settings.modelAliasProvider')}</span>
          <SelectControl
            value={provider}
            options={providerOptions}
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

function AgentMarketCard({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const capabilityNames = Object.entries(agent.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => t(`settings.capability.${name}`, { defaultValue: name }));

  return (
    <div className={styles.profileCard}>
      <div className={styles.profileHeader}>
        <div className={styles.profileIcon}>
          <Bot size={17} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.description || t('settings.marketProfileDefaultDesc')}</span>
        </div>
        <em className={`${styles.profileStatus} ${styles[`profileStatus_${agent.status}`]}`}>
          {t(`agent.status.${agent.status}`)}
        </em>
      </div>
      <div className={styles.profileMeta}>
        <span>{t('settings.profileRuntime')}: {agent.id}</span>
        <span>{t('settings.marketInstallSource')}: Local Edge</span>
        <span>{t('settings.marketPublishStatus')}: {agent.status === 'available' ? t('settings.statusInProgress') : t('settings.statusPlanned')}</span>
      </div>
      <div className={styles.profileMeta}>
        {capabilityNames.length > 0 ? (
          capabilityNames.map((name) => <span key={name}>{name}</span>)
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
}: {
  title: string;
  description: string;
  value?: string;
  control?: ReactNode;
}) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {control ?? (value ? <span className={styles.settingValue}>{value}</span> : null)}
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

function SwitchControl({
  checked,
  onChange,
  disabled = false,
  title,
  status,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  status?: string;
}) {
  return (
    <div className={styles.switchControl}>
      {status ? <span className={styles.switchStatus}>{status}</span> : null}
      <Switch checked={checked} onChange={onChange} disabled={disabled} title={title} />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

function SelectControl({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: SettingsSelectValue;
  options: Array<[SettingsSelectValue, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
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
