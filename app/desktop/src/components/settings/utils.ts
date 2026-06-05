import { useState } from 'react';
import type { RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';

export const STORAGE_PREFIX = 'agenthub-settings.';
export const DEVICE_ID_KEY = 'agenthub_device_id';
export const TD_CODE_VERIFIER_KEY = 'td_code_verifier';
export const TD_STATE_KEY = 'td_state';

export function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

export function readStoredValue<T extends string>(key: string, fallback: T) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored) return stored as T;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

export function writeStoredValue(key: string, value: string | boolean) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
  } catch { /* localStorage unavailable */ }
}

export function readBrowserStorage(storage: 'local' | 'session', key: string) {
  try {
    const target = storage === 'local' ? localStorage : sessionStorage;
    return target.getItem(key);
  } catch {
    return null;
  }
}

export function useStoredBooleanState(key: string, fallback: boolean) {
  return useState(() => readStoredBoolean(key, fallback));
}

export function useStoredValueState<T extends string>(key: string, fallback: T) {
  return useState<T>(() => readStoredValue(key, fallback));
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

export function countAgentCapabilities(agents: { capabilities: Record<string, boolean | undefined> }[]) {
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

export function readUnknownString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readUnknownArray(value: unknown): string[] {
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

export function parseNotificationPayload(payload: string): Record<string, string> {
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

export function statusLabelFromQuery({
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

type RuntimeDescriptionAgent = {
  id: string;
  name: string;
  description?: string;
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function runtimeDescriptionKey(agent: RuntimeDescriptionAgent): string | undefined {
  const tokens = [agent.id, agent.name, agent.description]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())
    .join(' ');

  if (tokens.includes('orchestrator') || tokens.includes('decomposes tasks')) {
    return 'settings.runtimeDescription.orchestrator';
  }
  if (tokens.includes('claude-code') || tokens.includes('claude code')) {
    return 'settings.runtimeDescription.claudeCode';
  }
  if (tokens.includes('opencode') || tokens.includes('open code')) {
    return 'settings.runtimeDescription.opencode';
  }
  if (tokens.includes('codex')) {
    return 'settings.runtimeDescription.codex';
  }
  return undefined;
}

export function formatRuntimeDescription(
  agent: RuntimeDescriptionAgent,
  t: TranslateFn,
  fallbackKey = 'settings.runtimeDefaultDesc',
) {
  const key = runtimeDescriptionKey(agent);
  if (key) return t(key, { defaultValue: agent.description || t(fallbackKey) });
  return agent.description || t(fallbackKey);
}

const MARKET_CAPABILITY_KEYS: Record<string, string> = {
  read: 'settings.marketCapability.read',
  write: 'settings.marketCapability.write',
  bash: 'settings.marketCapability.bash',
  webSearch: 'settings.marketCapability.webSearch',
  grep: 'settings.marketCapability.grep',
  thinking: 'settings.marketCapability.thinking',
  fileChanges: 'settings.marketCapability.fileChanges',
  mcpIntegration: 'settings.marketCapability.mcpIntegration',
  subAgentSpawn: 'settings.marketCapability.subAgentSpawn',
  'code review': 'settings.marketCapability.codeReview',
  'security audit': 'settings.marketCapability.securityAudit',
  'style check': 'settings.marketCapability.styleCheck',
  refactoring: 'settings.marketCapability.refactoring',
  'ci/cd': 'settings.marketCapability.cicd',
  docker: 'settings.marketCapability.docker',
  kubernetes: 'settings.marketCapability.kubernetes',
  infrastructure: 'settings.marketCapability.infrastructure',
  automation: 'settings.marketCapability.automation',
  'api design': 'settings.marketCapability.apiDesign',
  openapi: 'settings.marketCapability.openapi',
  graphql: 'settings.marketCapability.graphql',
  rest: 'settings.marketCapability.rest',
  documentation: 'settings.marketCapability.documentation',
  'project management': 'settings.marketCapability.projectManagement',
  agile: 'settings.marketCapability.agile',
  scrum: 'settings.marketCapability.scrum',
  planning: 'settings.marketCapability.planning',
  'data analysis': 'settings.marketCapability.dataAnalysis',
  'machine learning': 'settings.marketCapability.machineLearning',
  statistics: 'settings.marketCapability.statistics',
  visualization: 'settings.marketCapability.visualization',
  python: 'settings.marketCapability.python',
  'ui/ux': 'settings.marketCapability.uiux',
  accessibility: 'settings.marketCapability.accessibility',
  'design review': 'settings.marketCapability.designReview',
  css: 'settings.marketCapability.css',
};

const MARKET_TOOL_KEYS: Record<string, string> = {
  read_file: 'settings.marketTool.readFile',
  write_file: 'settings.marketTool.writeFile',
  edit_file: 'settings.marketTool.editFile',
  execute_command: 'settings.marketTool.executeCommand',
  web_search: 'settings.marketTool.webSearch',
  web_fetch: 'settings.marketTool.webFetch',
  glob: 'settings.marketTool.glob',
  grep: 'settings.marketTool.grep',
  browser: 'settings.marketTool.browser',
};

const MARKET_SOURCE_KEYS: Record<string, string> = {
  local: 'settings.marketSource.local',
  'hub-community': 'settings.marketSource.hubCommunity',
  '/web/custom-agents': 'settings.marketSource.hubCustomAgents',
};

export function formatMarketCapability(value: string, t: TranslateFn) {
  const key = MARKET_CAPABILITY_KEYS[value];
  return key ? t(key, { defaultValue: value }) : value;
}

export function formatMarketTool(value: string, t: TranslateFn) {
  const key = MARKET_TOOL_KEYS[value];
  return key ? t(key, { defaultValue: value }) : value;
}

export function formatMarketSource(value: string, t: TranslateFn) {
  const key = MARKET_SOURCE_KEYS[value];
  return key ? t(key, { defaultValue: value }) : value;
}

// ---------------------------------------------------------------------------
// Feature Flags — centralized `available=false` stubs for unimplemented sections
// ---------------------------------------------------------------------------

export const FEATURE_FLAGS = {
  /** Permissions: allowlist management not yet implemented */
  allowlistManagement: false,
  /** Online IM: cross-device instant messaging not yet implemented */
  onlineIm: false,
  /** Agent Market: public agent marketplace not yet implemented */
  agentMarket: false,
  /** Agent Configuration: default agent / routing selection not yet implemented */
  agentConfiguration: false,
  /** Data Management: toast / bulk-actions not yet integrated */
  dataManagement: false,
} as const;

/** Shared empty-arrays so JSX stubs don't recreate [] on every render */
export const EMPTY_ARR: never[] = [];
export const NOOP = () => {};
