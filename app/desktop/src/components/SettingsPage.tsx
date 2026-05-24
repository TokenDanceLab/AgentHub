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
  Route,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  UserCircle,
  Wrench,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useHubStore } from '@/stores/hubStore';
import styles from './SettingsPage.module.css';

export type SectionId =
  | 'general'
  | 'appearance'
  | 'configuration'
  | 'personalization'
  | 'permissions'
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

const STORAGE_PREFIX = 'agenthub-settings.';

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

export default function SettingsPage({ onBack, onOpenAuth, initialSection = 'general' }: Props) {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const username = useHubStore((s) => s.username);
  const clearHubAuth = useHubStore((s) => s.clear);
  const [active, setActive] = useState<SectionId>(initialSection);
  const [compactMode, setCompactMode] = useStoredBooleanState('compactMode', false);
  const [autoReview, setAutoReview] = useStoredBooleanState('autoReview', true);
  const [fullAccess, setFullAccess] = useStoredBooleanState('fullAccess', false);
  const [enableMcp, setEnableMcp] = useStoredBooleanState('enableMcp', true);
  const [skillSync, setSkillSync] = useStoredBooleanState('skillSync', true);
  const [taskSync, setTaskSync] = useStoredBooleanState('taskSync', true);
  const [groupChatEnabled, setGroupChatEnabled] = useStoredBooleanState('groupChat', true);
  const [agentSchedulingEnabled, setAgentSchedulingEnabled] = useStoredBooleanState('agentScheduling', true);
  const [enableHooks, setEnableHooks] = useStoredBooleanState('enableHooks', false);
  const [modelMappingEnabled, setModelMappingEnabled] = useStoredBooleanState('modelMapping', true);
  const [ccSwitchBridge, setCcSwitchBridge] = useStoredBooleanState('ccSwitchBridge', false);
  const [remoteControlEnabled, setRemoteControlEnabled] = useStoredBooleanState('remoteControl', false);
  const [autoDetectGit, setAutoDetectGit] = useStoredBooleanState('autoDetectGit', true);
  const [worktreeIsolation, setWorktreeIsolation] = useStoredBooleanState('worktreeIsolation', true);
  const [browserPreview, setBrowserPreview] = useStoredBooleanState('browserPreview', true);
  const [computerConfirm, setComputerConfirm] = useStoredBooleanState('computerConfirm', true);
  const [platformSync, setPlatformSync] = useStoredBooleanState('platformSync', true);
  const [auditTrail, setAuditTrail] = useStoredBooleanState('auditTrail', true);
  const [detailLevel, setDetailLevel] = useStoredValueState<SelectValue>('detailLevel', 'detailed');
  const [approvalMode, setApprovalMode] = useStoredValueState<SelectValue>('approvalMode', 'ask');

  const navItems = useMemo<NavItem[]>(
    () => [
      { id: 'general', label: t('settings.general'), icon: <SlidersHorizontal size={17} />, group: 'workspace' },
      { id: 'appearance', label: t('settings.appearance'), icon: <Palette size={17} />, group: 'workspace' },
      { id: 'configuration', label: t('settings.configuration'), icon: <Wrench size={17} />, group: 'workspace' },
      { id: 'personalization', label: t('settings.personalization'), icon: <UserCircle size={17} />, group: 'workspace' },
      { id: 'permissions', label: t('settings.permissions'), icon: <ShieldCheck size={17} />, group: 'workspace' },
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
            <span>{hubAuthenticated ? username ?? t('settings.signedIn') : t('settings.notSignedIn')}</span>
          </button>
          {hubAuthenticated ? (
            <button className={styles.sidebarActionBtn} onClick={clearHubAuth}>
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
                        setDetailLevel(value);
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
                      setApprovalMode(value);
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

          {active === 'tasks' && (
            <Panel title={t('settings.tasks')} description={t('settings.tasksDesc')}>
              <SettingRow
                title={t('settings.taskSync')}
                description={t('settings.taskSyncDesc')}
                control={<Switch checked={taskSync} onChange={setBooleanSetting('taskSync', setTaskSync)} />}
              />
              <SettingRow title={t('settings.taskInbox')} description={t('settings.taskInboxDesc')} value={t('settings.statusReady')} />
              <SettingRow title={t('settings.taskRunBinding')} description={t('settings.taskRunBindingDesc')} value={t('settings.statusInProgress')} />
              <SettingRow title={t('settings.taskApprovalQueue')} description={t('settings.taskApprovalQueueDesc')} value={t('settings.statusPlanned')} />
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
              <SettingRow
                title={t('settings.enableAgentScheduling')}
                description={t('settings.enableAgentSchedulingDesc')}
                control={<Switch checked={agentSchedulingEnabled} onChange={setBooleanSetting('agentScheduling', setAgentSchedulingEnabled)} />}
              />
              <SettingRow title={t('settings.schedulerQueue')} description={t('settings.schedulerQueueDesc')} value={t('settings.statusInProgress')} />
              <SettingRow title={t('settings.schedulerPolicy')} description={t('settings.schedulerPolicyDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.schedulerRemote')} description={t('settings.schedulerRemoteDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'agentMarket' && (
            <Panel title={t('settings.agentMarket')} description={t('settings.agentMarketDesc')}>
              <SettingRow title={t('settings.agentTemplates')} description={t('settings.agentTemplatesDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.agentCapabilityTags')} description={t('settings.agentCapabilityTagsDesc')} value={t('settings.statusReady')} />
              <SettingRow title={t('settings.agentReviewFlow')} description={t('settings.agentReviewFlowDesc')} value={t('settings.statusPlanned')} />
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
              <SettingRow
                title={t('settings.enableMcp')}
                description={t('settings.enableMcpDesc')}
                control={<Switch checked={enableMcp} onChange={setBooleanSetting('enableMcp', setEnableMcp)} />}
              />
              <SettingRow title="Filesystem" description={t('settings.mcpFilesystem')} value={t('settings.enabled')} />
              <SettingRow title="GitHub" description={t('settings.mcpGitHub')} value={t('settings.notConfigured')} />
            </Panel>
          )}

          {active === 'skills' && (
            <Panel title={t('settings.skills')} description={t('settings.skillsDesc')}>
              <SettingRow
                title={t('settings.skillSync')}
                description={t('settings.skillSyncDesc')}
                control={<Switch checked={skillSync} onChange={setBooleanSetting('skillSync', setSkillSync)} />}
              />
              <SettingRow title={t('settings.skillLocalRegistry')} description={t('settings.skillLocalRegistryDesc')} value=".agents/skills" />
              <SettingRow title={t('settings.skillReview')} description={t('settings.skillReviewDesc')} value={t('settings.statusPlanned')} />
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
              <SettingRow title={t('settings.modelDefault')} description={t('settings.modelDefaultDesc')} value="Auto" />
              <SettingRow title={t('settings.modelReasoning')} description={t('settings.modelReasoningDesc')} value={t('settings.statusReady')} />
              <SettingRow title={t('settings.modelProviderFallback')} description={t('settings.modelProviderFallbackDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'modelMapping' && (
            <Panel title={t('settings.modelMapping')} description={t('settings.modelMappingDesc')}>
              <SettingRow
                title={t('settings.enableModelMapping')}
                description={t('settings.enableModelMappingDesc')}
                control={<Switch checked={modelMappingEnabled} onChange={setBooleanSetting('modelMapping', setModelMappingEnabled)} />}
              />
              <SettingRow title={t('settings.modelAlias')} description={t('settings.modelAliasDesc')} value="sonnet / opus / haiku" />
              <SettingRow title={t('settings.modelPolicy')} description={t('settings.modelPolicyDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'ccSwitch' && (
            <Panel title={t('settings.ccSwitch')} description={t('settings.ccSwitchDesc')}>
              <SettingRow
                title={t('settings.ccSwitchBridge')}
                description={t('settings.ccSwitchBridgeDesc')}
                control={<Switch checked={ccSwitchBridge} onChange={setBooleanSetting('ccSwitchBridge', setCcSwitchBridge)} />}
              />
              <SettingRow title={t('settings.ccSwitchProviders')} description={t('settings.ccSwitchProvidersDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.ccSwitchHealth')} description={t('settings.ccSwitchHealthDesc')} value={t('settings.statusPlanned')} />
            </Panel>
          )}

          {active === 'connections' && (
            <Panel title={t('settings.connections')} description={t('settings.connectionsDesc')}>
              <ConnectionRow
                name="Hub"
                description={hubAuthenticated ? t('status.hubConnected') : t('status.hubDisconnected')}
                connected={hubAuthenticated}
              />
              <ConnectionRow name="Edge" description={t('settings.edgeLocal')} connected />
              <ConnectionRow name="WebSocket" description={t('status.wsConnected')} connected />
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
                  <strong>{hubAuthenticated ? username ?? t('settings.signedIn') : t('settings.notSignedIn')}</strong>
                  <span>{hubAuthenticated ? t('settings.accountConnected') : t('settings.accountDisconnected')}</span>
                </div>
                {hubAuthenticated ? (
                  <button className={styles.secondaryBtn} onClick={clearHubAuth}>
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
              <SettingRow title="TokenDance ID" description={t('settings.tokenDanceIdDesc')} value={t('settings.statusInProgress')} />
              <SettingRow title={t('settings.authPolicy')} description={t('settings.authPolicyDesc')} value={t('settings.statusPlanned')} />
              <SettingRow title={t('settings.syncScope')} description={t('settings.syncScopeDesc')} value="Hub" />
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
  value: SelectValue;
  options: Array<[SelectValue, string]>;
  onChange: (value: SelectValue) => void;
}) {
  return (
    <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value as SelectValue)}>
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
