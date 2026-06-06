import { type ReactNode, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ArrowLeft,
  Bot,
  ChevronRight,
  ClipboardList,
  Code2,
  Computer,
  Eye,
  FolderGit2,
  GitBranch,
  Globe2,
  HardDrive,
  Info as InfoIcon,
  Keyboard,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Monitor,
  Palette,
  Plug,
  Route,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  UserCircle,
  Wrench,
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
import AboutSection from './settings/sections/AboutSection';
import { useHubStore } from '@/stores/hubStore';
import { getEdgeBaseUrl } from '@/config';
import { useAgentList } from '@/api/agentQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import {
  useModelSettingsStore,
  type ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import {
  DEFAULT_AGENT_AUTO,
  buildDefaultAgentOptions,
  resolveAvailableDefaultAgentId,
} from '@/utils/defaultAgent';
import styles from './SettingsPage.module.css';
import {
  useStoredBooleanState,
  useStoredValueState,
  readBrowserStorage,
  isActiveRun,
  getRecentRuns,
  shortId,
  DEVICE_ID_KEY,
  NOOP,
} from './settings/utils';


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
  | 'data'
  | 'about';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';

interface Props {
  onBack: () => void;
  onOpenAuth: () => void;
  initialSection?: SectionId;
  defaultAgent: string;
  setDefaultAgent: (value: string) => void;
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: ReactNode;
  group: 'workspace' | 'automation' | 'system';
}

export default function SettingsPage({
  onBack,
  onOpenAuth,
  initialSection = 'general',
  defaultAgent,
  setDefaultAgent,
}: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, themePreset, setThemePreset } = useTheme();
  const hubAuth = useAuth();
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

  // Command palette (Ctrl+K / Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  const handleSettingsKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const inInput = Boolean(target.closest('input, textarea, select, [contenteditable]'));
    const metaCtrl = e.metaKey || e.ctrlKey;

    if (!inInput && e.key === '/') {
      e.preventDefault();
      navSearchRef.current?.focus();
      return;
    }

    if (metaCtrl && e.key === 'k' && !inInput) {
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }
  }, []);

  // Reset palette state on open
  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('');
      setPaletteIndex(0);
      // Focus the palette input after render
      requestAnimationFrame(() => paletteInputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleSettingsKeyDown);
    return () => window.removeEventListener('keydown', handleSettingsKeyDown);
  }, [handleSettingsKeyDown]);

  const [compactMode, setCompactMode] = useStoredBooleanState('compactMode', false);
  const [autoReview, setAutoReview] = useStoredBooleanState('autoReview', true);
  const [fullAccess, setFullAccess] = useStoredBooleanState('fullAccess', false);
  const [enableMcp, setEnableMcp] = useStoredBooleanState('enableMcp', true);
  const [taskSync, setTaskSync] = useStoredBooleanState('taskSync', true);
  const [groupChatEnabled, setGroupChatEnabled] = useStoredBooleanState('groupChat', true);
  const [agentSchedulingEnabled, setAgentSchedulingEnabled] = useStoredBooleanState('agentScheduling', true);
  const [enableHooks, setEnableHooks] = useStoredBooleanState('enableHooks', false);
  const [autoDetectGit, setAutoDetectGit] = useStoredBooleanState('autoDetectGit', true);
  const [worktreeIsolation, setWorktreeIsolation] = useStoredBooleanState('worktreeIsolation', true);
  const [browserPreview, setBrowserPreview] = useStoredBooleanState('browserPreview', true);
  const [computerConfirm, setComputerConfirm] = useStoredBooleanState('computerConfirm', true);
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

  const agents = useMemo(() => agentData?.items ?? [], [agentData?.items]);
  const defaultAgentAutoLabel = t('settings.defaultAgent.auto');
  const defaultAgentOptions = useMemo(
    () => buildDefaultAgentOptions(agents, defaultAgentAutoLabel),
    [agents, defaultAgentAutoLabel],
  );
  const defaultAgentValue = useMemo(
    () => resolveAvailableDefaultAgentId(defaultAgent, agents) ?? DEFAULT_AGENT_AUTO,
    [agents, defaultAgent],
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
  const runs = runData?.items ?? [];
  const activeRuns = runs.filter(isActiveRun).length;
  const latestRun = getRecentRuns(runs, 1)[0];
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
  const handleSignOut = () => {
    void hubAuth.logout();
  };

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
      { id: 'about', label: t('settings.about'), icon: <InfoIcon size={17} />, group: 'system' },
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

  // Command palette filtered items
  const paletteItems = useMemo(() => {
    if (!paletteQuery.trim()) return navItems;
    const q = paletteQuery.toLowerCase();
    return navItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        t(`settings.group.${item.group}`).toLowerCase().includes(q),
    );
  }, [navItems, paletteQuery, t]);

  const selectPaletteItem = useCallback(
    (id: SectionId) => {
      setActive(id);
      setPaletteOpen(false);
    },
    [],
  );

  const handlePaletteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteIndex((prev) => Math.min(prev + 1, paletteItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPaletteIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && paletteItems[paletteIndex]) {
        e.preventDefault();
        selectPaletteItem(paletteItems[paletteIndex].id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPaletteOpen(false);
      }
    },
    [paletteItems, paletteIndex, selectPaletteItem],
  );

  // Clamp palette index when items change
  useEffect(() => {
    if (paletteIndex >= paletteItems.length) {
      setPaletteIndex(Math.max(0, paletteItems.length - 1));
    }
  }, [paletteItems.length, paletteIndex]);

  return (
    <>
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
              defaultAgent={defaultAgentValue}
              setDefaultAgent={setDefaultAgent}
              routing={t('settings.routingAuto')}
              setRouting={NOOP}
              approvalMode={approvalMode}
              setApprovalMode={setApprovalMode}
              defaultAgentOptions={defaultAgentOptions}
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
              setAllowlistEntries={NOOP}
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
              refetch={NOOP}
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
              refetch={NOOP}
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
          {active === 'about' && <AboutSection />}
        </div>
      </main>
    </div>

    {paletteOpen && (
      <div className={styles.paletteOverlay} onClick={() => setPaletteOpen(false)}>
        <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
          <div className={styles.paletteInput}>
            <Search size={16} />
            <input
              ref={paletteInputRef}
              type="text"
              placeholder={t('settings.searchPlaceholder')}
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={handlePaletteKeyDown}
            />
            <kbd>ESC</kbd>
          </div>
          <div className={styles.paletteList}>
            {paletteItems.length === 0 ? (
              <div className={styles.paletteEmpty}>{t('settings.searchEmpty')}</div>
            ) : (
              paletteItems.map((item, idx) => (
                <button
                  key={item.id}
                  className={`${styles.paletteItem} ${idx === paletteIndex ? styles.paletteItemActive : ''}`}
                  onClick={() => selectPaletteItem(item.id)}
                  onMouseEnter={() => setPaletteIndex(idx)}
                >
                  <span className={styles.paletteItemIcon}>{item.icon}</span>
                  <span className={styles.paletteItemLabel}>{item.label}</span>
                  <span className={styles.paletteItemGroup}>{t(`settings.group.${item.group}`)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
