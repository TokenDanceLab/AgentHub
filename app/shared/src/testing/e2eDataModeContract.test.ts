import { describe, expect, it } from 'vitest';
import {
  buildE2EDataModeManifest,
  classifyE2ERequest,
  createE2EDataModeScenario,
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
      errors: ['web-stubbed-hub-replay-smoke is Web approved-real replay and must not direct-call Local Edge'],
    });
    expect(validateE2EDataModeScenario({
      ...scenario,
      realLoginTested: true,
    }, [])).toMatchObject({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke uses stubbed-hub-session but claims real login was tested'],
    });
    expect(validateE2EDataModeScenario(scenario, [
      { method: 'GET', url: 'http://127.0.0.1:3210/v1/runs' },
    ])).toEqual({
      ok: false,
      errors: ['web-stubbed-hub-replay-smoke forbids local-edge request GET http://127.0.0.1:3210/v1/runs'],
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

  it('classifies backend requests by stable platform boundary', () => {
    expect(classifyE2ERequest('http://localhost:8080/client/auth/me')).toBe('hub');
    expect(classifyE2ERequest('http://127.0.0.1:3210/v1/runs')).toBe('local-edge');
    expect(classifyE2ERequest('https://id.vectorcontrol.tech/oauth/authorize')).toBe('tokendance-id');
    expect(classifyE2ERequest('https://api.vectorcontrol.tech/v1/chat/completions')).toBe('gateway');
    expect(classifyE2ERequest('http://127.0.0.1:5174/')).toBe('app');
  });
});
