import { type ReactNode, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
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
  Download,
  Eye,
  EyeOff,
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
  RotateCcw,
  Route,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Upload,
  UserCircle,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import { APP_VERSION, HUB_URL, getPersistedEdgeUrl, setPersistedEdgeUrl } from '@/config';
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
import { requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import {
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  clearCustomInstructions,
  readCustomInstructions,
  writeCustomInstructions,
} from '@/utils/customInstructions';
import { getSelectedWorkspace } from '@/utils/workspaceStore';
import KeyboardSection from '@/components/settings/sections/KeyboardSection';
import AgentMarketSection from '@/components/settings/sections/AgentMarketSection';
import PermissionsSection, { type AllowlistEntry, readAllowlist, mergeAllowlistFromTarget, writeAllowlist } from '@/components/settings/sections/PermissionsSection';
import DataSection from '@/components/settings/sections/DataSection';
import {
  useModelSettingsStore,
  maskApiKey,
  type CredentialTestResult,
  type ProviderCredential,
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
  | 'credentials'
  | 'workspace'
  | 'environment'
  | 'platforms'
  | 'account'
  | 'securityAudit'
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
  const { themeMode, setThemeMode } = useTheme();
  const { language, setLanguage } = useLanguage();
  const hubAuth = useAuth();
  const addToast = useToastStore((s) => s.addToast);
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
  const [navSearch, setNavSearch] = useState('');
  const navSearchRef = useRef<HTMLInputElement>(null);
  const [teamDraftName, setTeamDraftName] = useState('');
  const [teamDraftDescription, setTeamDraftDescription] = useState('');
  const [teamMemberProfileId, setTeamMemberProfileId] = useState('');
  const [teamMemberRole, setTeamMemberRole] = useState('executor');
  const [teamRunPrompt, setTeamRunPrompt] = useState('');

  // Remote Edge URL configuration
  const [remoteEdgeUrl, setRemoteEdgeUrl] = useState(getPersistedEdgeUrl);
  const [remoteEdgeSaved, setRemoteEdgeSaved] = useState(false);

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

  // Detect real environment values via Tauri APIs
  useEffect(() => {
    const detect = async () => {
      try {
        // OS detection
        const ua = navigator.userAgent;
        if (ua.includes('Windows NT') || ua.includes('Win')) {
          setEnvOs('Windows');
          setEnvShell('PowerShell 5+ / pwsh');
        } else if (ua.includes('Mac OS X') || ua.includes('macOS')) {
          setEnvOs('macOS');
          setEnvShell('zsh / bash');
        } else if (ua.includes('Linux') && !ua.includes('Android')) {
          setEnvOs('Linux');
          setEnvShell('bash');
        } else {
          setEnvOs(navigator.platform || 'Unknown');
          setEnvShell('Unknown');
        }
        setEnvPackageManager('pnpm (default)');
        setEnvNodeVersion('>=20 (required by Tauri 2.x)');
        // Try to detect real Node version via Tauri shell plugin
        try {
          const shell = await import('@tauri-apps/plugin-shell');
          const nodeResult = await shell.Command.create('exec-sh', ['node', '-v']).execute();
          if (nodeResult.code === 0 && nodeResult.stdout) {
            setEnvNodeVersion(nodeResult.stdout.trim());
          }
          const pmResult = await shell.Command.create('exec-sh', ['pnpm', '-v']).execute();
          if (pmResult.code === 0 && pmResult.stdout) {
            setEnvPackageManager(`pnpm ${pmResult.stdout.trim()}`);
          }
        } catch {
          // Tauri shell plugin not available or command failed, keep fallback values
        }
      } catch {
        // Environment detection failed, keep defaults
      }
    };
    void detect();
  }, []);

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
  const [desktopNotifications, setDesktopNotifications] = useStoredBooleanState('desktopNotifications', false);
  const [closeToTray, setCloseToTray] = useState(true);

  // Load close-to-tray preference from backend on mount.
  useEffect(() => {
    invoke<boolean>('get_close_to_tray')
      .then(setCloseToTray)
      .catch(() => {
        // Backend unavailable — fall back to default (true).
      });
  }, []);

  // Sync desktop notification toggle with actual OS permission on mount.
  // If the OS has already granted notification permission (e.g. from a previous
  // run or system settings), automatically enable the in-app toggle so the user
  // doesn't have to re-enable it manually.
  useEffect(() => {
    const syncPermission = async () => {
      try {
        const granted = await isPermissionGranted();
        if (granted && !desktopNotifications) {
          setDesktopNotifications(true);
          writeStoredValue('desktopNotifications', true);
        }
      } catch {
        // Non-Tauri environment (tests/dev in browser) — ignore.
      }
    };
    void syncPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user navigates to the onlineIm section, re-check the OS
  // notification permission to keep the toggle in sync with system settings.
  useEffect(() => {
    if (active !== 'onlineIm') return;
    const checkPermission = async () => {
      try {
        const granted = await isPermissionGranted();
        if (granted !== desktopNotifications) {
          setDesktopNotifications(granted);
          writeStoredValue('desktopNotifications', granted);
        }
      } catch {
        // Non-Tauri environment — ignore.
      }
    };
    void checkPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Persist close-to-tray changes to backend.
  const handleCloseToTrayToggle = useCallback(async (enabled: boolean) => {
    setCloseToTray(enabled);
    try {
      await invoke('set_close_to_tray', { enabled });
    } catch {
      // Silently ignore if backend isn't available.
    }
  }, []);
  const [detailLevel, setDetailLevel] = useStoredValueState<SelectValue>('detailLevel', 'detailed');
  const [approvalMode, setApprovalMode] = useStoredValueState<SelectValue>('approvalMode', 'ask');
  const [allowlistEntries, setAllowlistEntries] = useState<AllowlistEntry[]>(() => readAllowlist());

  // Auto-merge execution target workspace_allowlist paths into the AllowlistEditor.
  // This ensures directories configured on Hub targets are reflected in the local allowlist UI.
  useEffect(() => {
    if (!hubTargetsQuery.data?.items) return;
    const allTargetPaths: string[] = [];
    for (const target of hubTargetsQuery.data.items) {
      if (target.workspace_allowlist && target.workspace_allowlist.length > 0) {
        for (const p of target.workspace_allowlist) allTargetPaths.push(p);
      }
    }
    if (allTargetPaths.length === 0) return;
    setAllowlistEntries((prev) => {
      const merged = mergeAllowlistFromTarget(prev, allTargetPaths);
      // Only persist if new paths were actually added
      if (merged.length !== prev.length) {
        writeAllowlist(merged);
        return merged;
      }
      return prev;
    });
  }, [hubTargetsQuery.data?.items]);
  const [customInstructions, setCustomInstructions] = useState(() => readCustomInstructions());
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState(() => readCustomInstructions());
  // Environment detection state
  const [envOs, setEnvOs] = useState('Detecting...');
  const [envShell, setEnvShell] = useState('Detecting...');
  const [envNodeVersion, setEnvNodeVersion] = useState('Detecting...');
  const [envPackageManager, setEnvPackageManager] = useState('Detecting...');
  const [workspaceTab, setWorkspaceTab] = useState<'git' | 'worktree' | 'browser' | 'computerUse'>('git');
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
  const credentials = useModelSettingsStore((s) => s.credentials);
  const setCredential = useModelSettingsStore((s) => s.setCredential);
  const setCredentialTestResult = useModelSettingsStore((s) => s.setCredentialTestResult);
  const resetModelSettings = useModelSettingsStore((s) => s.reset);
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

  const testProviderConnection = useCallback(async (providerId: string) => {
    const cred = credentials.find((c) => c.providerId === providerId);
    if (!cred) return;
    setCredentialTestResult(providerId, 'connecting');
    try {
      const baseUrl = cred.baseUrl || `https://api.${providerId}.com/v1`;
      const url = baseUrl.replace(/\/$/, '') + '/models';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cred.apiKey) {
        headers['Authorization'] = `Bearer ${cred.apiKey}`;
      }
      const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        setCredentialTestResult(providerId, 'success');
      } else {
        setCredentialTestResult(providerId, 'error', `HTTP ${response.status}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setCredentialTestResult(providerId, 'error', message);
    }
  }, [credentials, setCredentialTestResult]);

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
      { id: 'credentials', label: t('settings.credentials'), icon: <LockKeyhole size={17} />, group: 'automation' },
      { id: 'workspace', label: t('settings.workspace'), icon: <FolderGit2 size={17} />, group: 'system' },
      { id: 'environment', label: t('settings.environment'), icon: <HardDrive size={17} />, group: 'system' },
      { id: 'platforms', label: t('settings.platforms'), icon: <Monitor size={17} />, group: 'system' },
      { id: 'account', label: t('settings.account'), icon: <LockKeyhole size={17} />, group: 'system' },
      { id: 'securityAudit', label: t('settings.securityAudit'), icon: <ShieldCheck size={17} />, group: 'system' },
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

  const handleDesktopNotificationsToggle = async (value: boolean) => {
    if (value) {
      try {
        const permission = await requestPermission();
        if (permission === 'granted') {
          setDesktopNotifications(true);
          writeStoredValue('desktopNotifications', true);
          addToast({ type: 'success', message: t('settings.notificationPermissionGranted') });
        } else {
          addToast({ type: 'warning', message: t('toast.notificationPermissionDenied') });
        }
      } catch {
        // Non-Tauri environment (tests/dev in browser) — allow the toggle without requesting OS permission
        setDesktopNotifications(true);
        writeStoredValue('desktopNotifications', true);
      }
    } else {
      setDesktopNotifications(false);
      writeStoredValue('desktopNotifications', false);
    }
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
                  title={t('settings.closeToTray')}
                  description={t('settings.closeToTrayDesc')}
                  control={
                    <Switch checked={closeToTray} onChange={handleCloseToTrayToggle} />
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
              <Panel title={t('settings.language')} description={t('settings.languageDesc')}>
                <div className={styles.settingRow}>
                  <div className={styles.settingCopy}>
                    <strong>{t('settings.language')}</strong>
                    <span>{t('settings.languageDesc')}</span>
                  </div>
                  <SelectControl
                    value={language}
                    options={[['en', 'English'], ['zh', '中文']]}
                    onChange={(value) => setLanguage(value as 'en' | 'zh')}
                  />
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
              <div className={styles.instructionsRow}>
                <div className={styles.instructionsHeader}>
                  <div className={styles.settingCopy}>
                    <strong>{t('settings.instructions')}</strong>
                    <span>{t('settings.instructionsDesc')}</span>
                  </div>
                  <span className={`${styles.statusPill} ${customInstructions ? styles.statusPillOn : ''}`}>
                    {customInstructions ? t('settings.enabled') : t('settings.notConfigured')}
                  </span>
                </div>
                <label className={styles.instructionsEditor}>
                  <span>{t('settings.instructionsLabel')}</span>
                  <textarea
                    className={styles.textInput}
                    value={customInstructionsDraft}
                    maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
                    placeholder={t('settings.instructionsPlaceholder')}
                    onChange={(event) => setCustomInstructionsDraft(event.target.value)}
                  />
                </label>
                <div className={styles.instructionsFooter}>
                  <span>{t('settings.instructionsRuntimeDesc')}</span>
                  <em>{t('settings.instructionsCharsRemaining', { count: customInstructionsRemaining })}</em>
                </div>
                <div className={styles.instructionsActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={handleClearCustomInstructions}
                    disabled={!customInstructions && !customInstructionsDraft}
                  >
                    <XCircle size={15} />
                    {t('settings.clearInstructions')}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleSaveCustomInstructions}
                    disabled={!customInstructionsDirty}
                  >
                    <Check size={15} />
                    {t('settings.saveInstructions')}
                  </button>
                </div>
              </div>
              <Callout title={t('settings.personalizationNote')} body={t('settings.personalizationNoteDesc')} />
            </Panel>
          )}

          {active === 'permissions' && (
            <PermissionsSection
              autoReview={autoReview}
              setAutoReview={setAutoReview}
              fullAccess={fullAccess}
              setFullAccess={setFullAccess}
              allowlistEntries={allowlistEntries}
              setAllowlistEntries={setAllowlistEntries}
            />
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
              {/* Remote Edge URL configuration */}
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.remoteEdgeUrl')}</strong>
                  <span>{t('settings.remoteEdgeUrlDesc')}</span>
                </div>
                <div className={styles.settingRow}>
                  <div className={styles.settingCopy}>
                    <strong>{t('settings.edgeAddress')}</strong>
                    <span>{t('settings.edgeAddressDesc')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                    <input
                      type="text"
                      value={remoteEdgeUrl}
                      onChange={(e) => { setRemoteEdgeUrl(e.target.value); setRemoteEdgeSaved(false); }}
                      placeholder="http://host:3210"
                      className={styles.textInput}
                      style={{ width: '280px' }}
                    />
                    {remoteEdgeUrl && (
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => {
                          setRemoteEdgeUrl('');
                          setPersistedEdgeUrl('');
                          setRemoteEdgeSaved(true);
                        }}
                      >
                        {t('settings.clear')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => {
                        setPersistedEdgeUrl(remoteEdgeUrl);
                        setRemoteEdgeSaved(true);
                      }}
                    >
                      {remoteEdgeSaved ? t('settings.saved') : t('settings.save')}
                    </button>
                  </div>
                </div>
                <Callout title={t('settings.remoteEdgeNote')} body={t('settings.remoteEdgeNoteDesc')} />
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
              <Callout
                title={t('settings.remoteControl')}
                body={t('settings.remoteControlCalloutDesc')}
              />
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
                control={
                  <SwitchControl
                    checked={taskSyncAvailable && taskSync}
                    onChange={setBooleanSetting('taskSync', setTaskSync)}
                    disabled={!taskSyncAvailable}
                    title={!taskSyncAvailable ? t('settings.requiresHubSignIn') : undefined}
                    status={!taskSyncAvailable ? t('settings.notConfigured') : undefined}
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
              <SettingRow
                title={t('settings.desktopNotifications')}
                description={t('settings.desktopNotificationsDesc')}
                control={
                  <Switch checked={desktopNotifications} onChange={handleDesktopNotificationsToggle} />
                }
              />
            </Panel>
          )}

          {active === 'groupChat' && (
            <Panel title={t('settings.groupChat')} description={t('settings.groupChatDesc')}>
              <SettingRow
                title={t('settings.enableGroupChat')}
                description={t('settings.enableGroupChatDesc')}
                control={
                  <SwitchControl
                    checked={groupChatAvailable && groupChatEnabled}
                    onChange={setBooleanSetting('groupChat', setGroupChatEnabled)}
                    disabled={!groupChatAvailable}
                    title={!groupChatAvailable ? t('settings.requiresHubSignIn') : undefined}
                    status={!groupChatAvailable ? t('settings.notConfigured') : undefined}
                  />
                }
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
                  icon={<GitBranch size={18} />}
                  label={t('settings.agentTeamRuns')}
                  value={`${activeTeamRuns}/${teamRunTotal}`}
                  detail={pendingTeamApprovals.length > 0
                    ? t('settings.agentTeamPendingApprovals', { count: pendingTeamApprovals.length })
                    : t('settings.agentTeamRunsDesc', { count: agentTeamCount })}
                />
                <SummaryCard
                  icon={<Route size={18} />}
                  label={t('settings.localOrchestration')}
                  value={localOrchestration.available ? t('settings.localOrchestrationReadyStatus') : t('settings.notConfigured')}
                  detail={localOrchestration.available
                    ? t('settings.localOrchestrationAvailableDesc', { count: localOrchestration.availableSubAgents })
                    : t('settings.localOrchestrationNoOrchestratorDesc')}
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
                title={t('settings.agentTeamApi')}
                description={t('settings.agentTeamApiDesc')}
                value={
                  !hubInventoryEnabled
                    ? t('settings.targetHubSignInRequired')
                    : agentTeamsQuery.isError
                      ? t('settings.targetHubError')
                      : t('settings.statusReady')
                }
              />
              <div className={styles.taskSection} data-testid="settings-local-orchestration">
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.localOrchestration')}</strong>
                  <span>{t('settings.localOrchestrationDesc')}</span>
                </div>
                {localOrchestration.available ? (
                  <div className={styles.capabilityGrid}>
                    <CapabilityCard
                      title={t('settings.localOrchestrationRuntime')}
                      description={t('settings.localOrchestrationRuntimeDesc')}
                      status={localOrchestratorName}
                    />
                    <CapabilityCard
                      title={t('settings.localOrchestrationSubagents')}
                      description={t('settings.localOrchestrationSubagentsDesc')}
                      status={`${localOrchestration.availableSubAgents}/${availableRuntimes}`}
                    />
                    <CapabilityCard
                      title={t('settings.localOrchestrationHubBoundary')}
                      description={t('settings.localOrchestrationHubBoundaryDesc')}
                      status={hubInventoryEnabled ? t('settings.enabled') : t('settings.notConfigured')}
                    />
                  </div>
                ) : (
                  <EmptyBlock
                    title={t('settings.localOrchestrationNoOrchestrator')}
                    description={t('settings.localOrchestrationNoOrchestratorDesc')}
                  />
                )}
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.agentTeamBuilder')}</strong>
                  <span>{t('settings.agentTeamBuilderDesc')}</span>
                </div>
                <AgentTeamBuilder
                  hubReady={hubInventoryEnabled}
                  selectedTeam={agentTeamOverview?.selectedTeam}
                  customAgents={hubCustomAgents}
                  teamName={teamDraftName}
                  teamDescription={teamDraftDescription}
                  memberProfileId={teamMemberProfileId}
                  memberRole={teamMemberRole}
                  runPrompt={teamRunPrompt}
                  creating={createAgentTeamMutation.isPending}
                  addingMember={addAgentTeamMemberMutation.isPending}
                  startingRun={startTeamRunMutation.isPending}
                  onTeamNameChange={setTeamDraftName}
                  onTeamDescriptionChange={setTeamDraftDescription}
                  onMemberProfileChange={setTeamMemberProfileId}
                  onMemberRoleChange={setTeamMemberRole}
                  onRunPromptChange={setTeamRunPrompt}
                  onCreateTeam={handleCreateAgentTeam}
                  onAddMember={handleAddAgentTeamMember}
                  onStartRun={handleStartTeamRun}
                />
              </div>
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.agentTeamConsole')}</strong>
                  <span>{t('settings.agentTeamConsoleDesc')}</span>
                </div>
                {!hubInventoryEnabled ? (
                  <EmptyBlock
                    title={t('settings.agentTeamSignInRequired')}
                    description={t('settings.agentTeamSignInRequiredDesc')}
                  />
                ) : agentTeamsQuery.isLoading ? (
                  <EmptyBlock title={t('settings.loading')} description={t('settings.agentTeamLoadingDesc')} />
                ) : agentTeamsQuery.isError ? (
                  <EmptyBlock title={t('settings.agentTeamError')} description={agentTeamErrorMessage} />
                ) : agentTeamCount === 0 ? (
                  <EmptyBlock title={t('settings.agentTeamEmpty')} description={t('settings.agentTeamEmptyDesc')} />
                ) : (
                  <AgentTeamConsole
                    teams={agentTeamOverview?.teams ?? []}
                    bundles={agentTeamBundles}
                    selectedTeam={agentTeamOverview?.selectedTeam}
                    selectedRun={agentTeamOverview?.selectedRun}
                    state={teamRunState}
                    tasks={teamRunTasks}
                    members={teamRunMembers}
                    assignments={teamRunAssignments}
                    approvals={teamRunApprovals}
                    conflicts={teamRunConflicts}
                    events={teamRunEvents}
                    artifacts={teamRunState?.artifacts ?? []}
                    budget={teamRunState?.budget}
                    terminalReason={teamRunState?.terminal_reason}
                    routeLog={teamRouteLog}
                    refreshing={agentTeamsQuery.isFetching}
                    approvalBusy={decideTeamApprovalMutation.isPending}
                    conflictBusy={resolveTeamConflictMutation.isPending}
                    onSelectTeam={handleSelectAgentTeam}
                    onSelectRun={handleSelectTeamRun}
                    onApprovalDecision={(approval, decision) => {
                      if (!agentTeamOverview?.selectedTeam || !agentTeamOverview.selectedRun) return;
                      void decideTeamApprovalMutation.mutateAsync({
                        teamId: agentTeamOverview.selectedTeam.id,
                        runId: agentTeamOverview.selectedRun.id,
                        approvalId: approval.approval_id,
                        decision: {
                          decision,
                          reason: 'Desktop TeamRun Console decision',
                        },
                      });
                    }}
                    onResolveConflict={(conflict, decision) => {
                      if (!agentTeamOverview?.selectedTeam || !agentTeamOverview.selectedRun) return;
                      void resolveTeamConflictMutation.mutateAsync({
                        teamId: agentTeamOverview.selectedTeam.id,
                        runId: agentTeamOverview.selectedRun.id,
                        conflictId: conflict.conflict_id,
                        resolution: {
                          path: conflict.path,
                          resolution: decision.resolution,
                          selected_agent_task_id: decision.selectedAgentTaskId,
                          reason: decision.reason,
                        },
                      });
                    }}
                  />
                )}
              </div>
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
                    status={remoteControlAvailable && remoteControlEnabled ? t('settings.statusInProgress') : t('settings.statusPlanned')}
                    metric="SSH / Tailscale"
                    connected={remoteControlAvailable && remoteControlEnabled}
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
                    status={remoteControlAvailable && remoteControlEnabled ? t('settings.enabled') : t('settings.statusPlanned')}
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
                  detail={edgeOnline ? t('settings.marketLocalProfilesDesc') : t('settings.edgeOffline')}
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

          {active === 'keyboard' && <KeyboardSection />}

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
                  value={hubSessionActive && mcpAvailable && enableMcp ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubAuthenticated ? t('settings.mcpHubSyncDesc') : t('settings.mcpHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.enableMcp')}
                description={t('settings.enableMcpDesc')}
                control={
                  <SwitchControl
                    checked={mcpAvailable && enableMcp}
                    onChange={setBooleanSetting('enableMcp', setEnableMcp)}
                    disabled={!mcpAvailable}
                    title={!edgeOnline ? t('settings.requiresEdgeOnline') : t('settings.requiresMcpRuntime')}
                    status={!mcpAvailable ? t('settings.notConfigured') : undefined}
                  />
                }
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
                  value={hubSessionActive && skillSyncAvailable && skillSync ? t('settings.enabled') : t('settings.notConfigured')}
                  detail={hubAuthenticated ? t('settings.skillHubSyncDesc') : t('settings.skillHubSyncSignedOut')}
                />
              </div>
              <SettingRow
                title={t('settings.skillSync')}
                description={t('settings.skillSyncDesc')}
                control={
                  <SwitchControl
                    checked={skillSyncAvailable && skillSync}
                    onChange={setBooleanSetting('skillSync', setSkillSync)}
                    disabled={!skillSyncAvailable}
                    title={t('settings.requiresSkillSyncApi')}
                    status={t('settings.notConfigured')}
                  />
                }
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
                    options={modelSelectOptions}
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
                    options={providerSelectOptions}
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
                      modelOptions={aliasModelSelectOptions}
                      providerOptions={providerSelectOptions}
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

          {active === 'credentials' && (
            <Panel title={t('settings.credentials')} description={t('settings.credentialsDesc')}>
              <SettingRow
                title={t('settings.credentialsLocalNote')}
                description={t('settings.credentialsLocalNoteDesc')}
              />
              <div className={styles.taskSection}>
                <div className={styles.taskSectionHeader}>
                  <strong>{t('settings.credentialsProviders')}</strong>
                  <span>{t('settings.credentialsProvidersDesc')}</span>
                </div>
                <div className={styles.providerList}>
                  {credentials.map((cred) => (
                    <ProviderCredentialRow
                      key={cred.providerId}
                      credential={cred}
                      onApiKeyChange={(apiKey) => setCredential(cred.providerId, { apiKey })}
                      onBaseUrlChange={(baseUrl) => setCredential(cred.providerId, { baseUrl })}
                      onToggleEnabled={() => setCredential(cred.providerId, { enabled: !cred.enabled })}
                      onTestConnection={() => testProviderConnection(cred.providerId)}
                    />
                  ))}
                </div>
              </div>
              <Callout title={t('settings.credentialsGuard')} body={t('settings.credentialsGuardDesc')} />
            </Panel>
          )}

          {active === 'workspace' && (
            <Panel title={t('settings.workspace')} description={t('settings.workspaceDesc')}>
              <div className={styles.segmented}>
                {(['git', 'worktree', 'browser', 'computerUse'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={workspaceTab === tab ? styles.segmentActive : ''}
                    onClick={() => setWorkspaceTab(tab)}
                  >
                    {tab === 'git' && 'Git'}
                    {tab === 'worktree' && t('settings.worktree')}
                    {tab === 'browser' && t('settings.browser')}
                    {tab === 'computerUse' && t('settings.computerUse')}
                  </button>
                ))}
              </div>
              {workspaceTab === 'git' && (
                <>
                  <SettingRow
                    title={t('settings.autoDetectGit')}
                    description={t('settings.autoDetectGitDesc')}
                    control={
                      <Switch checked={autoDetectGit} onChange={setBooleanSetting('autoDetectGit', setAutoDetectGit)} />
                    }
                  />
                  <SettingRow title={t('settings.branchPolicy')} description="feat/* -> dev/delicious233 -> master" />
                  <SettingRow title={t('settings.commitStyle')} description="type(scope): summary" />
                </>
              )}
              {workspaceTab === 'worktree' && (
                <>
                  <SettingRow
                    title={t('settings.defaultWorkspace')}
                    description={(() => {
                      const ws = getSelectedWorkspace();
                      return ws ? `${ws.name} (${ws.path})` : t('settings.noWorkspaceSelected');
                    })()}
                  />
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
                </>
              )}
              {workspaceTab === 'browser' && (
                <>
                  <SettingRow
                    title={t('settings.browserPreview')}
                    description={t('settings.browserPreviewDesc')}
                    control={
                      <Switch checked={browserPreview} onChange={setBooleanSetting('browserPreview', setBrowserPreview)} />
                    }
                  />
                  <SettingRow title={t('settings.browserEngine')} description="Chromium / Playwright" value="Auto" />
                </>
              )}
              {workspaceTab === 'computerUse' && (
                <>
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
                </>
              )}
            </Panel>
          )}

          {active === 'environment' && (
            <Panel title={t('settings.environment')} description={t('settings.environmentDesc')}>
              <SettingRow title={t('settings.environmentOs')} description={t('settings.environmentOsDesc')} value={envOs} />
              <SettingRow title={t('settings.environmentShell')} description={t('settings.environmentShellDesc')} value={envShell} />
              <SettingRow title="Node.js" description={t('settings.environmentNodeDesc')} value={envNodeVersion} />
              <SettingRow title={t('settings.environmentPackageManager')} description={t('settings.environmentPmDesc')} value={envPackageManager} />
              <SettingRow title="Tauri" description={t('settings.environmentTauriDesc')} value={t('settings.enabled')} />
            </Panel>
          )}

          {active === 'platforms' && (
            <Panel title={t('settings.platforms')} description={t('settings.platformsDesc')}>
              <SettingRow
                title={t('settings.platformSync')}
                description={t('settings.platformSyncDesc')}
                control={
                  <SwitchControl
                    checked={platformSyncAvailable && platformSync}
                    onChange={setBooleanSetting('platformSync', setPlatformSync)}
                    disabled={!platformSyncAvailable}
                    title={t('settings.requiresPlatformSyncApi')}
                    status={t('settings.statusPlanned')}
                  />
                }
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
                    <UserCircle size={16} />
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
                    description={t('settings.tokenDanceOidcDesc')}
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
                control={
                  <SwitchControl
                    checked={auditTrailAvailable && auditTrail}
                    onChange={setBooleanSetting('auditTrail', setAuditTrail)}
                    disabled={!auditTrailAvailable}
                    title={t('settings.requiresAuditStore')}
                    status={t('settings.statusPlanned')}
                  />
                }
              />
              <SettingRow title={t('settings.permissionLedger')} description={t('settings.permissionLedgerDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.secretScan')} description={t('settings.secretScanDesc')} value={t('settings.statusPlanned')} />
              <Callout title={t('settings.securityGuard')} body={t('settings.securityGuardDesc')} />
            </Panel>
          )}

          {active === 'data' && <DataSection t={t} addToast={addToast} resetModelSettings={resetModelSettings} />}
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

function normalizeTeamTasks(state: TeamRunState | undefined, tasks: Array<{
  id: string;
  assignment_id?: string;
  assignee_member_id?: string;
  parent_task_id?: string;
  status: string;
  objective?: string;
  run_id?: string;
  attempt?: number;
  risk_level?: string;
}>): TeamTaskState[] {
  if (state?.tasks && state.tasks.length > 0) return state.tasks;
  return tasks.map((task) => ({
    task_id: task.id,
    assignment_id: task.assignment_id,
    assignee_member_id: task.assignee_member_id,
    parent_task_id: task.parent_task_id,
    status: task.status,
    objective: task.objective,
    run_id: task.run_id,
    attempt: task.attempt,
    risk_level: task.risk_level,
  }));
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const nodeClass: Record<TeamGraphNodeKind, string> = {
    artifact: styles.teamGraphNodeArtifact ?? '',
    conflict: styles.teamGraphNodeConflict ?? '',
    coordinator: styles.teamGraphNodeCoordinator ?? '',
    member: styles.teamGraphNodeMember ?? '',
    runtime: styles.teamGraphNodeRuntime ?? '',
    task: styles.teamGraphNodeTask ?? '',
  };
  const selectedNode = selectedNodeId
    ? graph.nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  const relatedNodeIds = new Set<string>();
  const visibleEdges = selectedNode
    ? graph.edges.filter((edge) => {
        const related = edge.from === selectedNode.id || edge.to === selectedNode.id;
        if (related) {
          relatedNodeIds.add(edge.from);
          relatedNodeIds.add(edge.to);
        }
        return related;
      })
    : graph.edges;
  const incomingCount = selectedNode ? graph.edges.filter((edge) => edge.to === selectedNode.id).length : 0;
  const outgoingCount = selectedNode ? graph.edges.filter((edge) => edge.from === selectedNode.id).length : 0;

  return (
    <section className={styles.teamSurface} data-testid="agent-team-communication-graph">
      <div className={styles.teamBlockHeader}>
        <strong>{t('settings.agentTeamCommunicationGraph')}</strong>
        <span>{t('settings.agentTeamCommunicationGraphDesc')}</span>
      </div>
      {graph.nodes.length > 0 || graph.edges.length > 0 ? (
        <div className={styles.teamGraph}>
          <div className={styles.teamGraphNodes} aria-label={t('settings.agentTeamGraphNodes')}>
            <button
              type="button"
              data-team-graph-node="all"
              className={`${styles.teamGraphNode} ${styles.teamGraphNodeAll} ${!selectedNode ? styles.teamGraphNodeActive : ''}`}
              aria-pressed={!selectedNode}
              onClick={() => setSelectedNodeId(null)}
            >
              <strong>{t('settings.agentTeamGraphAllLinks')}</strong>
              <span>{t('settings.agentTeamGraphAllLinksDesc', { count: graph.edges.length })}</span>
              <em>{graph.nodes.length} / {graph.edges.length}</em>
            </button>
            {graph.nodes.map((node) => (
              <button
                type="button"
                data-team-graph-node={node.kind}
                key={node.id}
                className={[
                  styles.teamGraphNode,
                  nodeClass[node.kind],
                  selectedNode?.id === node.id ? styles.teamGraphNodeActive : '',
                  selectedNode && selectedNode.id !== node.id && !relatedNodeIds.has(node.id) ? styles.teamGraphNodeMuted : '',
                ].filter(Boolean).join(' ')}
                aria-pressed={selectedNode?.id === node.id}
                onClick={() => setSelectedNodeId(node.id)}
              >
                <strong>{node.label}</strong>
                <span>{node.meta}</span>
                {node.status ? <em>{node.status}</em> : null}
              </button>
            ))}
          </div>
          <div className={styles.teamGraphInspector}>
            <div className={styles.teamGraphInspectorHead}>
              <strong>{selectedNode?.label ?? t('settings.agentTeamGraphAllLinks')}</strong>
              <span>{selectedNode ? t(`settings.agentTeamGraphKind.${selectedNode.kind}`, { defaultValue: selectedNode.kind }) : t('settings.agentTeamGraphAllLinksDesc', { count: graph.edges.length })}</span>
              {selectedNode ? (
                <div className={styles.taskMeta}>
                  <span>{t('settings.agentTeamGraphIncoming', { count: incomingCount })}</span>
                  <span>{t('settings.agentTeamGraphOutgoing', { count: outgoingCount })}</span>
                </div>
              ) : null}
            </div>
            <div className={styles.teamGraphEdges} aria-label={t('settings.agentTeamGraphEdges')}>
              {visibleEdges.map((edge) => {
              const from = graph.nodes.find((node) => node.id === edge.from);
              const to = graph.nodes.find((node) => node.id === edge.to);
              return (
                <div
                  key={edge.id}
                  data-team-graph-edge={edge.kind}
                  className={`${styles.teamGraphEdge} ${selectedNode && edge.from !== selectedNode.id && edge.to !== selectedNode.id ? styles.teamGraphEdgeMuted : ''}`}
                >
                  <span>{from?.label ?? shortGraphId(edge.from)}</span>
                  <strong>{edge.label}</strong>
                  <span>{to?.label ?? shortGraphId(edge.to)}</span>
                </div>
              );
              })}
              {visibleEdges.length === 0 ? (
                <div className={styles.teamGraphEmptyEdge}>
                  {t('settings.agentTeamGraphNoSelectedEdges')}
                </div>
              ) : null}
            </div>
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
    ? new Intl.NumberFormat(i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US').format(value)
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

function ProviderCredentialRow({
  credential,
  onApiKeyChange,
  onBaseUrlChange,
  onToggleEnabled,
  onTestConnection,
}: {
  credential: ProviderCredential;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onToggleEnabled: () => void;
  onTestConnection: () => void;
}) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);

  const displayKey = reveal ? credential.apiKey : maskApiKey(credential.apiKey);
  const testLabel = (() => {
    switch (credential.testResult) {
      case 'connecting': return t('settings.credentials.testing');
      case 'success': return t('settings.credentials.testSuccess');
      case 'error': return t('settings.credentials.testError');
      default: return t('settings.credentials.testConnection');
    }
  })();

  const statusPillClass = credential.testResult === 'success'
    ? styles.statusPillOn
    : credential.testResult === 'error'
      ? styles.statusPillOn
      : credential.enabled
        ? styles.statusPillOn
        : '';

  const statusLabel = credential.testResult === 'success'
    ? t('settings.credentials.testSuccess')
    : credential.testResult === 'error'
      ? credential.testError || t('settings.credentials.testError')
      : credential.enabled
        ? t('settings.enabled')
        : t('settings.disabled');

  return (
    <div className={styles.providerRow}>
      <div className={styles.providerMain}>
        <div className={styles.connectionIcon}>
          <LockKeyhole size={17} />
        </div>
        <div className={styles.settingCopy}>
          <strong>{credential.providerId}</strong>
          <span>{t('settings.credentials.apiKey')}</span>
        </div>
        <div className={styles.switchControl}>
          <span className={[styles.statusPill, statusPillClass].filter(Boolean).join(' ')}>
            {statusLabel}
          </span>
          <Switch checked={credential.enabled} onChange={onToggleEnabled} />
        </div>
      </div>
      <div className={styles.providerControls}>
        <label>
          <span>{t('settings.credentials.apiKey')}</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              className={styles.textInput}
              type={reveal ? 'text' : 'password'}
              value={displayKey || ''}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder={t('settings.credentials.apiKeyPlaceholder')}
              style={{ flex: 1, minWidth: 0 }}
            />
            {credential.apiKey ? (
              <button
                type="button"
                onClick={() => setReveal(!reveal)}
                style={{
                  position: 'absolute',
                  right: 4,
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--settings-muted)',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={reveal ? t('settings.credentials.hideKey') : t('settings.credentials.showKey')}
              >
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            ) : null}
          </div>
        </label>
        <label>
          <span>{t('settings.credentials.baseUrl')}</span>
          <input
            className={styles.textInput}
            type="text"
            value={credential.baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder={t('settings.credentials.baseUrlPlaceholder')}
          />
        </label>
        <label style={{ alignItems: 'center' }}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onTestConnection}
            disabled={credential.testResult === 'connecting' || !credential.enabled}
          >
            <RefreshCw
              size={14}
              style={credential.testResult === 'connecting' ? { animation: 'spin 1s linear infinite' } : undefined}
            />
            {testLabel}
          </button>
        </label>
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
