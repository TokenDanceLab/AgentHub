import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Bot,
  Check,
  ChevronRight,
  ClipboardList,
  Code2,
  Computer,
  Cpu,
  Eye,
  Globe2,
  Link2,
  Monitor,
  Plug,
  RefreshCw,
  Route,
  Server,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import type { AgentInfo, RunInfo, RunnerHealthItem } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';
import type {
  ExecutionTarget,
  ExecutionTargetHealthState,
  ExecutionTargetType,
} from '@/api/hubClient';
import type {
  ProviderHealth,
  ReasoningEffortPreference,
  ResolvedRunModelSettings,
} from '@/stores/modelSettingsStore';
import styles from '../SettingsPage.module.css';

// ============================================================
// Types
// ============================================================

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

export type SelectValue = 'balanced' | 'detailed' | 'manual' | 'auto' | 'ask' | 'never';
export type SettingsSelectValue = SelectValue | ReasoningEffortPreference | ProviderHealth | string;

export interface SettingsPageProps {
  onBack: () => void;
  onOpenAuth: () => void;
  initialSection?: SectionId;
}

export interface NavItem {
  id: SectionId;
  label: string;
  icon: ReactNode;
  group: 'workspace' | 'automation' | 'system';
}

export interface ShortcutRow {
  keys: string[];
  action: string;
}

export interface ProjectSkill {
  id: string;
  title: string;
  descriptionKey: string;
  status: 'ready' | 'review';
  hasScripts: boolean;
  hasReferences: boolean;
}

// ============================================================
// Constants
// ============================================================

export const STORAGE_PREFIX = 'agenthub-settings.';
export const DEVICE_ID_KEY = 'agenthub_device_id';

export const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

export const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance Gateway'],
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['cc-switch-local', 'cc-switch local'],
] as const;

export const REASONING_OPTIONS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['max', 'Max'],
] as const;

export const PROVIDER_HEALTH_OPTIONS = [
  ['ready', 'Ready'],
  ['degraded', 'Degraded'],
  ['disabled', 'Disabled'],
] as const;

export const PROJECT_SKILLS: ProjectSkill[] = [
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

// ============================================================
// Utility functions
// ============================================================

export function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

export function readStoredValue<T extends string>(key: string, fallback: T) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored) return stored as T;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

export function writeStoredValue(key: string, value: string | boolean) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

export function readBrowserStorage(storage: 'local' | 'session', key: string) {
  try {
    const target = storage === 'local' ? localStorage : sessionStorage;
    return target.getItem(key);
  } catch {
    return null;
  }
}

export function isHubTargetConnected(target: ExecutionTarget) {
  return target.is_online || target.health_state === 'healthy';
}

export function filterTargetsByType(targets: ExecutionTarget[], types: ExecutionTargetType[]) {
  const typeSet = new Set<ExecutionTargetType>(types);
  return targets.filter((target) => typeSet.has(target.target_type));
}

export function countTargetsByHealth(targets: ExecutionTarget[], health: ExecutionTargetHealthState) {
  return targets.filter((target) => (target.health_state ?? 'unknown') === health).length;
}

export function getTargetGroupHealth(targets: ExecutionTarget[]): ExecutionTargetHealthState {
  if (targets.some((target) => target.health_state === 'healthy' || target.is_online)) return 'healthy';
  if (targets.some((target) => target.health_state === 'degraded')) return 'degraded';
  if (targets.some((target) => target.health_state === 'offline')) return 'offline';
  return 'unknown';
}

export function formatTargetEndpoint(target: ExecutionTarget) {
  if (target.host && target.port) return `${target.host}:${target.port}`;
  if (target.host) return target.host;
  if (target.workspace_root) return target.workspace_root;
  if (target.device_id) return shortId(target.device_id);
  return '';
}

export function isActiveRun(run: RunInfo) {
  return ['queued', 'started', 'running', 'cancelling'].includes(run.status);
}

export function isActiveBridgeTask(task: AgentTask) {
  return task.status === 'queued' || task.status === 'running';
}

export function getRecentRuns(runs: RunInfo[], limit: number) {
  return [...runs]
    .sort((a, b) => timestampOf(b.finishedAt ?? b.startedAt ?? b.createdAt) - timestampOf(a.finishedAt ?? a.startedAt ?? a.createdAt))
    .slice(0, limit);
}

export function getRecentTasks(tasks: AgentTask[], limit: number) {
  return [...tasks].sort((a, b) => timestampOf(b.createdAt) - timestampOf(a.createdAt)).slice(0, limit);
}

export function countAgentCapabilities(agents: AgentInfo[]) {
  const names = new Set<string>();
  for (const agent of agents) {
    for (const [name, enabled] of Object.entries(agent.capabilities)) {
      if (enabled) names.add(name);
    }
  }
  return names.size;
}

export function timestampOf(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatTimestamp(value?: string) {
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

export function shortId(value?: string) {
  if (!value) return '--';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

// ============================================================
// Hooks
// ============================================================

export function useStoredBooleanState(key: string, fallback: boolean) {
  return useState(() => readStoredBoolean(key, fallback));
}

export function useStoredValueState<T extends string>(key: string, fallback: T) {
  return useState<T>(() => readStoredValue(key, fallback));
}

// ============================================================
// Shared presentational components
// ============================================================

export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
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

export function TaskRunRow({
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

export function HubTaskRow({ task }: { task: AgentTask }) {
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

export function ModeCard({
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

export function CapabilityCard({ title, description, status }: { title: string; description: string; status: string }) {
  return (
    <div className={styles.capabilityCard}>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{status}</em>
    </div>
  );
}

export function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
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

export function AliasMappingRow({
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

export function ProviderHealthRow({
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

export function RuntimeInventoryCard({ agent }: { agent: AgentInfo }) {
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

export { default as LocalAgentProfileCard } from './cards/LocalAgentProfileCard';
export type { AgentProfileData, McpServerAttachment, ToolToggle } from './cards/LocalAgentProfileCard';

export function AgentMarketCard({ agent }: { agent: AgentInfo }) {
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

export function ProjectSkillCard({ skill }: { skill: ProjectSkill }) {
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

export function McpRuntimeCard({ agent }: { agent: AgentInfo }) {
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

export function ExecutionTargetCard({
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

export function RunnerRow({ runner }: { runner: RunnerHealthItem }) {
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

export function HubExecutionTargetRow({
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

export function SettingRow({
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

export function ConnectionRow({ name, description, connected }: { name: string; description: string; connected: boolean }) {
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

export function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
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

export function SelectControl({
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

export function Callout({ title, body }: { title: string; body: string }) {
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

export function EmptyBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyBlock}>
      <Archive size={24} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
