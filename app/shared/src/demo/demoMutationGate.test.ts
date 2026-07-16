import { describe, expect, it } from 'vitest';
import {
  WEB_DEMO_MUTATION_PATH_INVENTORY,
  allowsWorkbenchDemoRuntimeMutation,
  demoRuntimeMutationDeniedReason,
} from './demoMutationGate';

describe('AH-SR-043 demo mutation fail-closed gate', () => {
  it('inventories the web/shared demo and production mutation paths', () => {
    expect(WEB_DEMO_MUTATION_PATH_INVENTORY.map((path) => path.id)).toEqual([
      'web-platform-submit-composer',
      'desktop-platform-submit-composer',
      'shared-demo-runtime-store',
      'shared-mock-platform',
      'web-chat-actions',
      'web-contact-project-mutations',
    ]);

    for (const path of WEB_DEMO_MUTATION_PATH_INVENTORY) {
      expect(path.entry.length).toBeGreaterThan(0);
      expect(path.gate.length).toBeGreaterThan(0);
      expect(path.productionSink.length).toBeGreaterThan(0);
    }
  });

  it('denies demo mutations by default and in real/auto modes', () => {
    expect(allowsWorkbenchDemoRuntimeMutation()).toBe(false);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'auto',
    })).toBe(false);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'observed',
    })).toBe(false);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'approved-real',
    })).toBe(false);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'real',
    })).toBe(false);
  });

  it('allows demo mutations only for explicit mock/fixture opt-in without an injected Hub client', () => {
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'mock',
    })).toBe(true);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'fixture',
    })).toBe(true);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'demo',
    })).toBe(true);
    expect(allowsWorkbenchDemoRuntimeMutation({
      demoRuntimeFallback: true,
      dataMode: 'fixture',
      hasInjectedHubClient: true,
    })).toBe(false);
  });

  it('explains fail-closed denials without claiming a silent success path', () => {
    expect(demoRuntimeMutationDeniedReason({
      dataMode: 'auto',
    })).toMatch(/explicit demoRuntimeFallback/i);
    expect(demoRuntimeMutationDeniedReason({
      demoRuntimeFallback: true,
      dataMode: 'auto',
    })).toMatch(/fail-closed for demo mutations/i);
    expect(demoRuntimeMutationDeniedReason({
      demoRuntimeFallback: true,
      dataMode: 'fixture',
      hasInjectedHubClient: true,
    })).toMatch(/Injected Hub clients/i);
    expect(demoRuntimeMutationDeniedReason({
      demoRuntimeFallback: true,
      dataMode: 'fixture',
    })).toBeUndefined();
  });
});
