import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Archive, ArrowLeft, Bot, ClipboardList, Code2, Computer, Cpu, Eye,
  FolderGit2, GitBranch, Globe2, HardDrive, Keyboard, Link2, LockKeyhole, LogIn,
  LogOut, MessageSquareText, Monitor, Palette, Plug, Route, Server,
  ShieldCheck, SlidersHorizontal, TerminalSquare, UserCircle, Wrench,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useHubStore } from '@/stores/hubStore';
import { createHubClient } from '@/api/hubClient';
import { useAgentList } from '@/api/agentQueries';
import { useCancelRun, useRuns } from '@/api/runQueries';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import { preferredProfileAlias } from '@/utils/agentProfile';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { ContactInfo, FriendRequestInfo, HubNotification, Session } from '@/api/hubClient';

import GeneralSection from './settings/sections/GeneralSection';
import AppearanceSection from './settings/sections/AppearanceSection';
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
import {
  useStoredBooleanState, useStoredValueState,
  readBrowserStorage, isActiveRun, getRecentRuns, statusLabelFromQuery,
  statusLabelFromDevice, shortId, formatTimestamp,
} from './settings/utils';
import styles from './SettingsPage.module.css';

export type SectionId =
  | 'general' | 'appearance' | 'configuration' | 'personalization' | 'permissions'
  | 'agentProfiles' | 'executionTargets' | 'tasks' | 'onlineIm' | 'groupChat'
  | 'agentScheduling' | 'agentMarket' | 'keyboard' | 'mcp' | 'skills' | 'hooks'
  | 'models' | 'modelMapping' | 'ccSwitch' | 'connections' | 'remoteControl'
  | 'git' | 'environment' | 'worktree' | 'browser' | 'computerUse' | 'platforms'
  | 'account' | 'securityAudit' | 'archived';

type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';

interface HubIMSnapshot {
  contacts: ContactInfo[];
  sessions: Session[];
  friendRequests: FriendRequestInfo[];
  notifications: HubNotification[];
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  group: 'workspace' | 'automation' | 'system';
}

const DEVICE_ID_KEY = 'agenthub_device_id';

interface Props {
  onBack: () => void;
  onOpenAuth: () => void;
  initialSection?: SectionId;
}

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general' }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode: rawSetThemeMode } = useTheme();
  const setThemeMode = (mode: string) => rawSetThemeMode(mode as 'dark' | 'light' | 'system');
  const hubAuth = useAuth();
  const { online: edgeOnline, health } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const { data: runData, isError: runsError, isFetching: runsFetching, isLoading: runsLoading, refetch: refetchRuns } = useRuns();
  const cancelRunMutation = useCancelRun();
  const bridgedTasks = useTaskBridgeStore((s) => s.tasks);
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const username = useHubStore((s) => s.username);
  const [active, setActive] = useState<SectionId>(initialSection);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const hubSessionActive = hubAuthenticated || hubAuth.isAuthenticated;
  const settingsHubClient = useMemo(() => createHubClient({ getToken: () => hubAuth.token ?? null }), [hubAuth.token]);
  const deviceRegistration = useDeviceRegistration(hubSessionActive ? settingsHubClient : null);
  const shouldLoadAgentMarket = hubSessionActive && active === 'agentMarket';
  const shouldLoadIMSnapshot = hubSessionActive && (active === 'onlineIm' || active === 'groupChat');
  const customAgentsQuery = useQuery({
    queryKey: ['hub-settings', 'custom-agents', hubAuth.token],
    queryFn: () => settingsHubClient.listCustomAgents() as Promise<Record<string, unknown>[]>,
    enabled: shouldLoadAgentMarket,
    retry: false,
  });
  const hubIMSnapshotQuery = useQuery<HubIMSnapshot>({
    queryKey: ['hub-settings', 'im-snapshot', hubAuth.token],
    queryFn: async () => {
      const [contacts, sessions, friendRequests, notifications] = await Promise.all([
        settingsHubClient.listContacts(), settingsHubClient.listSessions(),
        settingsHubClient.listFriendRequests(), settingsHubClient.listNotifications({ limit: 20 }),
      ]);
      return { contacts, sessions, friendRequests, notifications };
    },
    enabled: shouldLoadIMSnapshot,
    retry: false,
  });
  const agents = agentData?.items ?? [];
  const localAgentProfiles = useMemo(
    () => agents.map((agent) => ({
      agent, alias: preferredProfileAlias(agent) ?? '',
      route: resolveRunRequestOptions({ model: preferredProfileAlias(agent) ?? undefined }),
    })),
    [agents, resolveRunRequestOptions],
  );
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
  const accountName = hubAuth.user?.username ?? username ?? t('settings.signedIn');
  const tokenSource = hubAuth.tokenSource ?? 'none';
  const tokenSourceLabel = tokenSource === 'tokendance' ? 'TokenDance ID' : tokenSource === 'hub' ? t('settings.hubLocalLogin') : t('settings.notConfigured');
  const imSnapshot = hubIMSnapshotQuery.data;
  const imSnapshotStatus = statusLabelFromQuery({
    signedIn: hubSessionActive, isLoading: hubIMSnapshotQuery.isLoading,
    isFetching: hubIMSnapshotQuery.isFetching, isError: hubIMSnapshotQuery.isError,
    isSuccess: hubIMSnapshotQuery.isSuccess, t,
  });
  const desktopDeviceStatus = statusLabelFromDevice({
    signedIn: hubSessionActive, status: deviceRegistration.status,
    registeredLabel: 'registered', idleLabel: 'deviceStatus', t,
  });
  const deviceId = deviceRegistration.deviceId ?? readBrowserStorage('local', DEVICE_ID_KEY);
  const handleSignOut = () => { void hubAuth.logout(); };

  const navItems = useMemo<NavItem[]>(() => [
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
  ], [t]);

  const activeLabel = navItems.find((item) => item.id === active)?.label ?? t('settings.title');

  const renderSection = (active: SectionId) => {
    switch (active) {
      case 'general':
        return <GeneralSection detailLevel={detailLevel} setDetailLevel={setDetailLevel} compactMode={compactMode} setCompactMode={setCompactMode} />;
      case 'appearance':
        return <AppearanceSection themeMode={themeMode} setThemeMode={setThemeMode} compactMode={compactMode} setCompactMode={setCompactMode} />;
      case 'configuration':
        return <ConfigurationSection approvalMode={approvalMode} setApprovalMode={setApprovalMode} />;
      case 'personalization':
        return <PersonalizationSection username={username} />;
      case 'permissions':
        return <PermissionsSection autoReview={autoReview} setAutoReview={setAutoReview} fullAccess={fullAccess} setFullAccess={setFullAccess} />;
      case 'agentProfiles':
        return <AgentProfilesSection agents={agents} edgeOnline={edgeOnline} runnerSummary={runnerSummary} runnerItems={runnerItems} localAgentProfiles={localAgentProfiles} />;
      case 'executionTargets':
        return <ExecutionTargetsSection edgeOnline={edgeOnline} health={health} hubSessionActive={hubSessionActive} runnerSummary={runnerSummary} runnerItems={runnerItems} availableRunners={availableRunners} desktopDeviceStatus={desktopDeviceStatus} deviceId={deviceId} />;
      case 'tasks':
        return <TasksSection runs={runs} activeRuns={activeRuns} runsLoading={runsLoading} runsFetching={runsFetching} runsError={runsError} refetchRuns={refetchRuns} cancelRunMutation={cancelRunMutation} bridgedTasks={bridgedTasks} hubSessionActive={hubSessionActive} taskSync={taskSync} setTaskSync={setTaskSync} onOpenAuth={onOpenAuth} latestRun={latestRun} />;
      case 'onlineIm':
        return <OnlineImSection hubSessionActive={hubSessionActive} imSessions={imSnapshot?.sessions ?? []} imContacts={imSnapshot?.contacts ?? []} imFriendRequests={imSnapshot?.friendRequests ?? []} imNotifications={imSnapshot?.notifications ?? []} isLoading={hubIMSnapshotQuery.isLoading} isFetching={hubIMSnapshotQuery.isFetching} isError={hubIMSnapshotQuery.isError} isSuccess={hubIMSnapshotQuery.isSuccess} refetch={() => void hubIMSnapshotQuery.refetch()} deviceRegistrationStatus={deviceRegistration.status} onOpenAuth={onOpenAuth} />;
      case 'groupChat':
        return <GroupChatSection hubSessionActive={hubSessionActive} isLoading={hubIMSnapshotQuery.isLoading} isError={hubIMSnapshotQuery.isError} imSessions={imSnapshot?.sessions ?? []} imContactsCount={(imSnapshot?.contacts ?? []).length} imSnapshotStatus={imSnapshotStatus} agents={agents} edgeOnline={edgeOnline} groupChatEnabled={groupChatEnabled} setGroupChatEnabled={setGroupChatEnabled} onOpenAuth={onOpenAuth} />;
      case 'agentScheduling':
        return <AgentSchedulingSection runs={runs} activeRuns={activeRuns} runsLoading={runsLoading} bridgedTasks={bridgedTasks} agents={agents} edgeOnline={edgeOnline} hubSessionActive={hubSessionActive} totalRunners={totalRunners} runnerSummary={runnerSummary} modelMappingEnabled={modelMappingEnabled} ccSwitchBridge={ccSwitchBridge} autoReview={autoReview} agentSchedulingEnabled={agentSchedulingEnabled} setAgentSchedulingEnabled={setAgentSchedulingEnabled} />;
      case 'agentMarket':
        return <AgentMarketSection hubSessionActive={hubSessionActive} agents={agents} edgeOnline={edgeOnline} customAgents={(customAgentsQuery.data as Record<string, unknown>[]) ?? []} isLoading={customAgentsQuery.isLoading} isFetching={customAgentsQuery.isFetching} isError={customAgentsQuery.isError} isSuccess={customAgentsQuery.isSuccess} refetch={() => void customAgentsQuery.refetch()} onOpenAuth={onOpenAuth} />;
      case 'keyboard':
        return <KeyboardSection />;
      case 'mcp':
        return <McpSection agents={agents} edgeOnline={edgeOnline} hubSessionActive={hubSessionActive} enableMcp={enableMcp} setEnableMcp={setEnableMcp} />;
      case 'skills':
        return <SkillsSection hubSessionActive={hubSessionActive} />;
      case 'hooks':
        return <HooksSection enableHooks={enableHooks} setEnableHooks={setEnableHooks} />;
      case 'models':
        return <ModelsSection defaultModel={defaultModel} defaultProvider={defaultProvider} modelReasoningEffort={modelReasoningEffort} providerFallbackEnabled={providerFallbackEnabled} setDefaultModel={setDefaultModel} setDefaultProvider={setDefaultProvider} setModelReasoningEffort={setModelReasoningEffort} setProviderFallbackEnabled={setProviderFallbackEnabled} />;
      case 'modelMapping':
        return <ModelMappingSection modelMappingEnabled={modelMappingEnabled} setModelMappingEnabled={setModelMappingEnabled} modelAliases={modelAliases} toggleModelAlias={toggleModelAlias} updateModelAlias={updateModelAlias} />;
      case 'ccSwitch':
        return <CcSwitchSection ccSwitchBridge={ccSwitchBridge} setCcSwitchBridge={setCcSwitchBridge} ccSwitchProviders={ccSwitchProviders} updateCcSwitchProvider={updateCcSwitchProvider} />;
      case 'connections':
        return <ConnectionsSection edgeOnline={edgeOnline} hubSessionActive={hubSessionActive} runnerSummary={runnerSummary} />;
      case 'remoteControl':
        return <RemoteControlSection hubSessionActive={hubSessionActive} />;
      case 'git':
        return <GitSection autoDetectGit={autoDetectGit} setAutoDetectGit={setAutoDetectGit} />;
      case 'environment':
        return <EnvironmentSection />;
      case 'worktree':
        return <WorktreeSection worktreeIsolation={worktreeIsolation} setWorktreeIsolation={setWorktreeIsolation} />;
      case 'browser':
        return <BrowserSection browserPreview={browserPreview} setBrowserPreview={setBrowserPreview} />;
      case 'computerUse':
        return <ComputerUseSection computerConfirm={computerConfirm} setComputerConfirm={setComputerConfirm} />;
      case 'platforms':
        return <PlatformsSection hubSessionActive={hubSessionActive} />;
      case 'account':
        return <AccountSection hubSessionActive={hubSessionActive} accountName={accountName} tokenSource={tokenSource} tokenSourceLabel={tokenSourceLabel} desktopDeviceStatus={desktopDeviceStatus} deviceId={deviceId} deviceRegistration={deviceRegistration} onOpenAuth={onOpenAuth} onSignOut={handleSignOut} />;
      case 'securityAudit':
        return <SecurityAuditSection auditTrail={auditTrail} setAuditTrail={setAuditTrail} />;
      case 'archived':
        return <ArchivedSection />;
    }
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
              {navItems.filter((item) => item.group === group).map((item) => (
                <button key={item.id} className={`${styles.navItem} ${active === item.id ? styles.navItemActive : ''}`} onClick={() => setActive(item.id)}>
                  {item.icon}<span>{item.label}</span>
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
            <button className={styles.sidebarActionBtn} onClick={handleSignOut}><LogOut size={17} /><span>{t('settings.signOut')}</span></button>
          ) : (
            <button className={styles.sidebarActionBtn} onClick={onOpenAuth}><LogIn size={17} /><span>{t('settings.signIn')}</span></button>
          )}
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.content}>
          <div className={styles.header}>
            <span>{t('settings.title')}</span>
            <h1>{activeLabel}</h1>
          </div>
          {renderSection(active)}
        </div>
      </main>
    </div>
  );
}
