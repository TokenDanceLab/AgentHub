import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
  getWorkbenchDataModeContract,
  isWorkbenchFixtureDataMode,
  isWorkbenchRealDataMode,
  normalizeWorkbenchDataMode,
  readWorkbenchDataModeOverride,
  resolveWorkbenchDataMode,
  workbenchDataModeDisplayLabel,
  workbenchDataModeLabel,
  writeWorkbenchDataModeOverride,
} from './dataMode';

describe('normalizeWorkbenchDataMode', () => {
  it('normalizes explicit workbench data mode values', () => {
    expect(normalizeWorkbenchDataMode('demo')).toBe('fixture');
    expect(normalizeWorkbenchDataMode('fixture')).toBe('fixture');
    expect(normalizeWorkbenchDataMode('fixtures')).toBe('fixture');
    expect(normalizeWorkbenchDataMode('mock')).toBe('mock');
    expect(normalizeWorkbenchDataMode('observed')).toBe('observed');
    expect(normalizeWorkbenchDataMode('replay')).toBe('observed');
    expect(normalizeWorkbenchDataMode('auto')).toBe('auto');
    expect(normalizeWorkbenchDataMode('real')).toBe('approved-real');
    expect(normalizeWorkbenchDataMode('normal')).toBe('approved-real');
    expect(normalizeWorkbenchDataMode('approved-real')).toBe('approved-real');
    expect(normalizeWorkbenchDataMode(undefined)).toBe('auto');
    expect(normalizeWorkbenchDataMode('')).toBe('auto');
    expect(normalizeWorkbenchDataMode('unexpected')).toBe('auto');
  });

  it('persists a browser override that takes priority over env mode', () => {
    localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);

    expect(readWorkbenchDataModeOverride()).toBeUndefined();
    expect(resolveWorkbenchDataMode('real')).toBe('approved-real');

    writeWorkbenchDataModeOverride('fixture');

    expect(localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('fixture');
    expect(readWorkbenchDataModeOverride()).toBe('fixture');
    expect(resolveWorkbenchDataMode('real')).toBe('fixture');
  });

  it('classifies explicit fixture and real modes', () => {
    expect(isWorkbenchFixtureDataMode('mock')).toBe(true);
    expect(isWorkbenchFixtureDataMode('fixture')).toBe(true);
    expect(isWorkbenchFixtureDataMode('observed')).toBe(false);
    expect(isWorkbenchRealDataMode('observed')).toBe(true);
    expect(isWorkbenchRealDataMode('approved-real')).toBe(true);
    expect(isWorkbenchRealDataMode('auto')).toBe(false);
    expect(workbenchDataModeLabel('approved-real')).toBe('approved-real');
  });

  it('exposes a single shared contract for UI status and data-source boundaries', () => {
    expect(getWorkbenchDataModeContract('mock')).toMatchObject({
      mode: 'mock',
      statusLabel: 'mock',
      displayLabel: 'Mock',
      tone: 'amber',
      allowsMockData: true,
      allowsFixtureData: false,
      allowsDemoRuntimeFallback: true,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: false,
      requiresHubAuthForWeb: false,
      requiresLocalEdgeForDesktop: false,
      isRealDataMode: false,
      isStrictRealMode: false,
    });

    expect(getWorkbenchDataModeContract('fixture')).toMatchObject({
      mode: 'fixture',
      statusLabel: 'fixture',
      displayLabel: 'Fixture',
      tone: 'purple',
      allowsMockData: false,
      allowsFixtureData: true,
      allowsDemoRuntimeFallback: true,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: false,
      requiresHubAuthForWeb: false,
      requiresLocalEdgeForDesktop: false,
      isRealDataMode: false,
      isStrictRealMode: false,
    });

    expect(getWorkbenchDataModeContract('approved-real')).toMatchObject({
      mode: 'approved-real',
      statusLabel: 'approved-real',
      displayLabel: 'Approved real',
      tone: 'green',
      allowsMockData: false,
      allowsFixtureData: false,
      allowsDemoRuntimeFallback: false,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: true,
      requiresHubAuthForWeb: true,
      requiresLocalEdgeForDesktop: true,
      isRealDataMode: true,
      isStrictRealMode: true,
    });
  });

  it('keeps transient runtime states out of canonical data-mode labels', () => {
    expect(workbenchDataModeLabel('auto')).toBe('auto');
    expect(workbenchDataModeDisplayLabel('auto')).toBe('Auto');
    expect(workbenchDataModeLabel('demo+edge')).toBe('auto');
    expect(workbenchDataModeDisplayLabel('mock (auto fallback)')).toBe('Auto');
  });
});
