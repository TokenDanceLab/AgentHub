import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
  getWorkbenchDataModeContract,
  isWorkbenchFixtureDataMode,
  isWorkbenchRealDataMode,
  normalizeWorkbenchDataMode,
  readWorkbenchDataModeOverride,
  resolveWorkbenchDataMode,
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

  it('exposes a single shared contract for runtime and evidence boundaries', () => {
    expect(getWorkbenchDataModeContract('mock')).toMatchObject({
      mode: 'mock',
      statusLabel: 'mock',
      allowsMockData: true,
      allowsFixtureData: false,
      allowsDemoRuntimeFallback: true,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: false,
      requiresLocalEdgeForDesktop: false,
      isRealDataMode: false,
    });

    expect(getWorkbenchDataModeContract('fixture')).toMatchObject({
      mode: 'fixture',
      statusLabel: 'fixture',
      allowsMockData: false,
      allowsFixtureData: true,
      allowsDemoRuntimeFallback: true,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: false,
      requiresLocalEdgeForDesktop: false,
      isRealDataMode: false,
    });

    expect(getWorkbenchDataModeContract('approved-real')).toMatchObject({
      mode: 'approved-real',
      statusLabel: 'approved-real',
      allowsMockData: false,
      allowsFixtureData: false,
      allowsDemoRuntimeFallback: false,
      allowsLocalEdgeAutoFallback: false,
      allowsHubData: true,
      requiresLocalEdgeForDesktop: true,
      isRealDataMode: true,
    });
  });

  it('keeps transient runtime states out of canonical data-mode labels', () => {
    expect(workbenchDataModeLabel('auto')).toBe('auto');
    expect(workbenchDataModeLabel('demo+edge')).toBe('auto');
    expect(workbenchDataModeLabel('mock (auto fallback)')).toBe('auto');
  });
});
