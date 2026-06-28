import { describe, expect, it } from 'vitest';
import {
  buildE2EDataModeManifest,
  classifyE2ERequest,
  createE2EDataModeScenario,
  resolveE2ERequestDecision,
  validateE2EDataModeScenario,
} from './e2eDataModeContract';

describe('e2e data-mode contract', () => {
  it('rejects mock UI scenarios that contact Hub or Local Edge backends', () => {
    const scenario = createE2EDataModeScenario({
      name: 'desktop-chat-flow',
      surface: 'desktop',
      dataMode: 'mock',
      dataSource: 'local-mock',
      appOrigin: 'http://127.0.0.1:5199',
      mockAdapterUsed: true,
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:5199/' },
    ])).toEqual({ ok: true, errors: [] });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://localhost:8080/client/auth/me' },
    ])).toEqual({
      ok: false,
      errors: ['desktop-chat-flow forbids hub request GET http://localhost:8080/client/auth/me'],
    });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/threads' },
    ])).toEqual({
      ok: false,
      errors: ['desktop-chat-flow forbids local-edge request GET http://127.0.0.1:3210/v1/threads'],
    });
  });

  it('separates Desktop entry preflight from mock workbench runtime requests', () => {
    const scenario = createE2EDataModeScenario({
      name: 'desktop-chat-flow',
      surface: 'desktop',
      dataMode: 'mock',
      dataSource: 'local-mock',
      appOrigin: 'http://127.0.0.1:5199',
      mockAdapterUsed: true,
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/health', phase: 'entry-preflight' },
    ])).toEqual({ ok: true, errors: [] });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/threads', phase: 'entry-preflight' },
    ])).toEqual({
      ok: false,
      errors: [
        'desktop-chat-flow forbids local-edge request during entry-preflight GET http://127.0.0.1:3210/v1/threads',
      ],
    });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/health', phase: 'workbench-runtime' },
    ])).toEqual({
      ok: false,
      errors: [
        'desktop-chat-flow forbids local-edge request during workbench-runtime GET http://127.0.0.1:3210/v1/health',
      ],
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'http://127.0.0.1:3210/v1/health',
      phase: 'entry-preflight',
    })).toMatchObject({
      boundary: 'local-edge',
      phase: 'entry-preflight',
      allowed: true,
      action: 'fulfill-scenario-backend',
      shouldRecord: true,
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'http://127.0.0.1:3210/v1/health',
      phase: 'workbench-runtime',
    })).toMatchObject({
      boundary: 'local-edge',
      phase: 'workbench-runtime',
      allowed: false,
      action: 'block-forbidden-backend',
      shouldRecord: true,
    });
  });

  it('rejects stubbed approved-real Web scenarios that claim real execution or direct Local Edge', () => {
    const scenario = createE2EDataModeScenario({
      name: 'web-stubbed-hub-replay-smoke',
      surface: 'web',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      appOrigin: 'http://127.0.0.1:5174',
      hubOrigin: 'http://localhost:8080',
      mockAdapterUsed: true,
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://localhost:8080/client/auth/me' },
    ])).toEqual({ ok: true, errors: [] });
    expect(validateE2EDataModeScenario({
      ...scenario,
      directLocalEdge: true,
    }, [])).toMatchObject({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke surface web must not direct-call Local Edge'],
    });
    expect(validateE2EDataModeScenario({
      ...scenario,
      realLoginTested: true,
    }, [])).toMatchObject({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke uses stubbed-hub-session but claims real login was tested'],
    });
    expect(validateE2EDataModeScenario({
      ...scenario,
      tokenDanceIdSecretUsed: true,
    }, [])).toMatchObject({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke uses stubbed-hub-session but marks TokenDance ID secret usage'],
    });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/runs' },
    ])).toEqual({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke forbids local-edge request GET http://127.0.0.1:3210/v1/runs'],
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'http://127.0.0.1:3210/v1/runs',
    })).toMatchObject({
      boundary: 'local-edge',
      phase: 'workbench-runtime',
      allowed: false,
      action: 'block-forbidden-backend',
      shouldRecord: true,
    });
  });

  it('keeps Mobile mock preview offline and blocks Local Edge', () => {
    const scenario = createE2EDataModeScenario({
      name: 'mobile-expo-web-preview',
      surface: 'mobile',
      dataMode: 'mock',
      dataSource: 'local-mock',
      appOrigin: 'http://127.0.0.1:5177',
      mockAdapterUsed: true,
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:5177/' },
    ])).toEqual({ ok: true, errors: [] });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:8088/v1/mobile/snapshot' },
    ])).toEqual({
      ok: false,
      errors: ['mobile-expo-web-preview forbids other-http request GET http://127.0.0.1:8088/v1/mobile/snapshot'],
    });
    expect(validateE2EDataModeScenario({
      ...scenario,
      directLocalEdge: true,
    }, [])).toEqual({
      ok: false,
      errors: ['mobile-expo-web-preview surface mobile must not direct-call Local Edge'],
    });
  });

  it('records Mobile stubbed Hub checks as non-real evidence', () => {
    const scenario = createE2EDataModeScenario({
      name: 'mobile-mock-hub-contract',
      surface: 'mobile',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      appOrigin: 'http://127.0.0.1:5177',
      hubOrigin: 'http://127.0.0.1:8088',
      mockAdapterUsed: true,
    });

    const requests = [
      { method: 'GET', url: 'http://127.0.0.1:8088/v1/mobile/snapshot' },
      { method: 'GET', url: 'http://127.0.0.1:8088/v1/events' },
    ];

    expect(validateE2EDataModeScenario(scenario, requests)).toEqual({ ok: true, errors: [] });
    expect(validateE2EDataModeScenario(scenario, [
      ...requests,
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/health' },
    ])).toEqual({
      ok: false,
      errors: ['mobile-mock-hub-contract forbids local-edge request GET http://127.0.0.1:3210/v1/health'],
    });
    expect(buildE2EDataModeManifest(scenario, requests)).toMatchObject({
      scenario: 'mobile-mock-hub-contract',
      surface: 'mobile',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      hubOrigin: 'http://127.0.0.1:8088',
      directLocalEdge: false,
      evidence_level: 'stubbed-hub',
      realLoginTested: false,
      realCliOrModelExecuted: false,
      mockAdapterUsed: true,
      real_tested: false,
      requestedBoundaries: ['hub'],
      requestedEndpoints: [
        'GET http://127.0.0.1:8088/v1/events',
        'GET http://127.0.0.1:8088/v1/mobile/snapshot',
      ],
    });
  });

  it('builds honest manifests that separate stubbed replay from real execution', () => {
    const scenario = createE2EDataModeScenario({
      name: 'task-create-hydration',
      surface: 'web',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      appOrigin: 'http://127.0.0.1:5174',
      hubOrigin: 'http://localhost:8080',
      mockAdapterUsed: true,
    });

    expect(buildE2EDataModeManifest(scenario, [
      { method: 'POST', url: 'http://localhost:8080/web/agent-tasks' },
      { method: 'GET', url: 'http://localhost:8080/web/agent-tasks/task-web-created/events' },
    ])).toMatchObject({
      schema: 'agenthub.e2e_data_mode_contract.v1',
      scenario: 'task-create-hydration',
      surface: 'web',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      directLocalEdge: false,
      realLoginTested: false,
      realCliOrModelExecuted: false,
      tokenDanceIdSecretUsed: false,
      mockAdapterUsed: true,
      MockAdapterUsed: true,
      RealLoginTested: false,
      RealCliTested: false,
      real_tested: false,
      requestedPhases: ['workbench-runtime'],
      requestedEndpoints: [
        'GET http://localhost:8080/web/agent-tasks/task-web-created/events',
        'POST http://localhost:8080/web/agent-tasks',
      ],
    });
  });

  it('keeps observed replay read-only and non-real', () => {
    const scenario = createE2EDataModeScenario({
      name: 'desktop-observed-replay',
      surface: 'desktop',
      dataMode: 'observed',
      dataSource: 'observed-hub-replay',
      appOrigin: 'http://127.0.0.1:5199',
      hubOrigin: 'http://localhost:8080',
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://localhost:8080/client/sessions/session-1/messages' },
    ])).toEqual({ ok: true, errors: [] });
    expect(buildE2EDataModeManifest(scenario, [
      { method: 'GET', url: 'http://localhost:8080/client/sessions/session-1/messages' },
    ])).toMatchObject({
      evidence_level: 'observed-local',
      dataSource: 'observed-hub-replay',
      realLoginTested: false,
      realCliOrModelExecuted: false,
      tokenDanceIdSecretUsed: false,
      mockAdapterUsed: false,
      real_tested: false,
      requestedBoundaries: ['hub'],
    });
  });

  it('rejects observed replay that claims login, model execution, secrets, or the wrong mode', () => {
    const scenario = createE2EDataModeScenario({
      name: 'desktop-observed-replay',
      surface: 'desktop',
      dataMode: 'observed',
      dataSource: 'observed-hub-replay',
      appOrigin: 'http://127.0.0.1:5199',
      hubOrigin: 'http://localhost:8080',
    });

    expect(validateE2EDataModeScenario({
      ...scenario,
      dataMode: 'approved-real',
      realLoginTested: true,
      realCliOrModelExecuted: true,
      tokenDanceIdSecretUsed: true,
    }, [])).toEqual({
      ok: false,
      errors: [
        'desktop-observed-replay uses observed-hub-replay but dataMode is approved-real',
        'desktop-observed-replay uses observed-hub-replay but claims real login was tested',
        'desktop-observed-replay uses observed-hub-replay but claims real CLI/model execution',
        'desktop-observed-replay uses observed-hub-replay but marks TokenDance ID secret usage',
      ],
    });
  });

  it('keeps approved-real preflight separate from mock and readiness-only evidence', () => {
    const scenario = createE2EDataModeScenario({
      name: 'approved-real-preflight',
      surface: 'desktop',
      dataMode: 'approved-real',
      dataSource: 'approved-real-preflight',
      appOrigin: 'http://127.0.0.1:5199',
      hubOrigin: 'http://localhost:8080',
      realLoginTested: true,
      realCliOrModelExecuted: true,
      directLocalEdge: true,
    });

    expect(buildE2EDataModeManifest(scenario, [
      { method: 'GET', url: 'http://localhost:8080/client/auth/me' },
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/health' },
      { method: 'GET', url: 'https://id.vectorcontrol.tech/oidc/userinfo' },
      { method: 'POST', url: 'https://api.vectorcontrol.tech/v1/responses' },
    ])).toMatchObject({
      evidence_level: 'approved-real',
      dataSource: 'approved-real-preflight',
      realLoginTested: true,
      realCliOrModelExecuted: true,
      mockAdapterUsed: false,
      real_tested: true,
      requestedBoundaries: ['gateway', 'hub', 'local-edge', 'tokendance-id'],
    });

    expect(validateE2EDataModeScenario({
      ...scenario,
      dataMode: 'observed',
      mockAdapterUsed: true,
    }, [])).toEqual({
      ok: false,
      errors: [
        'approved-real-preflight uses approved-real-preflight but dataMode is observed',
        'approved-real-preflight uses approved-real-preflight but marks mock adapter usage',
      ],
    });
  });

  it('rejects TokenDance ID and Gateway traffic in Web stubbed Hub replay', () => {
    const scenario = createE2EDataModeScenario({
      name: 'web-stubbed-hub-replay-smoke',
      surface: 'web',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      appOrigin: 'http://127.0.0.1:5174',
      hubOrigin: 'http://localhost:8080',
      mockAdapterUsed: true,
    });

    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'https://id.vectorcontrol.tech/oidc/authorize' },
      { method: 'GET', url: 'https://api.vectorcontrol.tech/v1/models' },
    ])).toEqual({
      ok: false,
      errors: [
        'web-stubbed-hub-replay-smoke forbids tokendance-id request GET https://id.vectorcontrol.tech/oidc/authorize',
        'web-stubbed-hub-replay-smoke forbids gateway request GET https://api.vectorcontrol.tech/v1/models',
      ],
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'https://id.vectorcontrol.tech/oidc/authorize',
    })).toMatchObject({
      boundary: 'tokendance-id',
      action: 'block-forbidden-backend',
      shouldRecord: true,
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'https://api.vectorcontrol.tech/v1/models',
    })).toMatchObject({
      boundary: 'gateway',
      action: 'block-forbidden-backend',
      shouldRecord: true,
    });
  });

  it('classifies backend requests by stable platform boundary', () => {
    expect(classifyE2ERequest('http://localhost:8080/client/auth/me')).toBe('hub');
    expect(classifyE2ERequest('http://127.0.0.1:3210/v1/runs')).toBe('local-edge');
    expect(classifyE2ERequest('https://id.vectorcontrol.tech/oauth/authorize')).toBe('tokendance-id');
    expect(classifyE2ERequest('https://api.vectorcontrol.tech/v1/chat/completions')).toBe('gateway');
    expect(classifyE2ERequest('http://127.0.0.1:5174/')).toBe('app');
  });

  it('resolves route actions without duplicating data-mode switch logic in Playwright specs', () => {
    const scenario = createE2EDataModeScenario({
      name: 'web-stubbed-hub-replay-smoke',
      surface: 'web',
      dataMode: 'approved-real',
      dataSource: 'stubbed-hub-session',
      appOrigin: 'http://127.0.0.1:5174',
      hubOrigin: 'http://localhost:8080',
      mockAdapterUsed: true,
    });

    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'http://127.0.0.1:5174/',
    })).toMatchObject({
      boundary: 'app',
      action: 'continue',
      shouldRecord: false,
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'http://localhost:8080/client/auth/me',
    })).toMatchObject({
      boundary: 'hub',
      action: 'fulfill-scenario-backend',
      shouldRecord: true,
    });
    expect(resolveE2ERequestDecision(scenario, {
      method: 'GET',
      url: 'https://example.invalid/telemetry',
    })).toMatchObject({
      boundary: 'other-http',
      action: 'abort-external-http',
      shouldRecord: false,
    });
  });
});
