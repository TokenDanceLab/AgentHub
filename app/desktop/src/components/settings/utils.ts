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

export function statusLabelFromDevice({
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
  return idleLabel === 'deviceStatus' ? t('settings.deviceStatus.idle') : t('settings.statusLocalSource');
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
