import {
  type WorkbenchDataMode,
  getWorkbenchDataModeContract,
} from '../demo/dataMode';

export type E2ESurface = 'desktop' | 'web' | 'mobile';

export type E2EDataSource =
  | 'local-mock'
  | 'deterministic-fixture'
  | 'stubbed-hub-session'
  | 'observed-hub-replay'
  | 'approved-real-preflight';

export type E2ERequestBoundary =
  | 'app'
  | 'hub'
  | 'local-edge'
  | 'tokendance-id'
  | 'gateway'
  | 'other-http'
  | 'non-http';

export type E2ERequestPhase =
  | 'entry-preflight'
  | 'workbench-runtime'
  | 'manifest-preflight';

export interface E2EObservedRequest {
  method: string;
  url: string;
  phase?: E2ERequestPhase;
}

export interface E2EDataModeScenarioInput {
  name: string;
  surface: E2ESurface;
  dataMode: WorkbenchDataMode;
  dataSource: E2EDataSource;
  appOrigin: string;
  hubOrigin?: string;
  directLocalEdge?: boolean;
  realLoginTested?: boolean;
  realCliOrModelExecuted?: boolean;
  tokenDanceIdSecretUsed?: boolean;
  mockAdapterUsed?: boolean;
}

export interface E2EDataModeScenario {
  name: string;
  surface: E2ESurface;
  dataMode: WorkbenchDataMode;
  dataSource: E2EDataSource;
  appOrigin: string;
  hubOrigin?: string;
  directLocalEdge: boolean;
  realLoginTested: boolean;
  realCliOrModelExecuted: boolean;
  tokenDanceIdSecretUsed: boolean;
  mockAdapterUsed: boolean;
}

export interface E2EDataModeValidation {
  ok: boolean;
  errors: string[];
}

export function createE2EDataModeScenario(input: E2EDataModeScenarioInput): E2EDataModeScenario {
  return {
    name: input.name,
    surface: input.surface,
    dataMode: input.dataMode,
    dataSource: input.dataSource,
    appOrigin: input.appOrigin,
    ...(input.hubOrigin ? { hubOrigin: input.hubOrigin } : {}),
    directLocalEdge: input.directLocalEdge ?? false,
    realLoginTested: input.realLoginTested ?? false,
    realCliOrModelExecuted: input.realCliOrModelExecuted ?? false,
    tokenDanceIdSecretUsed: input.tokenDanceIdSecretUsed ?? false,
    mockAdapterUsed: input.mockAdapterUsed ?? false,
  };
}

export function classifyE2ERequest(urlValue: string, scenario?: Pick<E2EDataModeScenario, 'appOrigin' | 'hubOrigin'>): E2ERequestBoundary {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return 'non-http';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'non-http';
  }

  const appOrigin = scenario?.appOrigin ? new URL(scenario.appOrigin).origin : undefined;
  const hubOrigin = scenario?.hubOrigin ? new URL(scenario.hubOrigin).origin : undefined;
  if (url.origin === appOrigin || DEFAULT_APP_HOSTS.has(url.host)) {
    return 'app';
  }
  if (url.origin === hubOrigin || HUB_HOSTS.has(url.host)) {
    return 'hub';
  }
  if (LOCAL_EDGE_HOSTS.has(url.host)) {
    return 'local-edge';
  }
  if (TOKEN_DANCE_ID_HOSTS.has(url.host)) {
    return 'tokendance-id';
  }
  if (GATEWAY_HOSTS.has(url.host)) {
    return 'gateway';
  }
  return 'other-http';
}

export function validateE2EDataModeScenario(
  scenario: E2EDataModeScenario,
  requests: E2EObservedRequest[] = [],
): E2EDataModeValidation {
  const errors: string[] = [];
  const mode = getWorkbenchDataModeContract(scenario.dataMode);

  if (scenario.dataSource === 'local-mock' && scenario.dataMode !== 'mock') {
    errors.push(`${scenario.name} uses local-mock but dataMode is ${scenario.dataMode}`);
  }
  if (scenario.dataSource === 'deterministic-fixture' && scenario.dataMode !== 'fixture') {
    errors.push(`${scenario.name} uses deterministic-fixture but dataMode is ${scenario.dataMode}`);
  }
  if (!mode.allowsMockData && scenario.dataSource === 'local-mock') {
    errors.push(`${scenario.name} dataMode ${scenario.dataMode} does not allow local mock data`);
  }
  if (!mode.allowsFixtureData && scenario.dataSource === 'deterministic-fixture') {
    errors.push(`${scenario.name} dataMode ${scenario.dataMode} does not allow fixture data`);
  }
  if (scenario.surface !== 'desktop' && scenario.directLocalEdge) {
    errors.push(`${scenario.name} surface ${scenario.surface} must not direct-call Local Edge`);
  }
  if (scenario.dataSource === 'stubbed-hub-session' && scenario.realLoginTested) {
    errors.push(`${scenario.name} uses stubbed-hub-session but claims real login was tested`);
  }
  if (scenario.dataSource === 'stubbed-hub-session' && scenario.realCliOrModelExecuted) {
    errors.push(`${scenario.name} uses stubbed-hub-session but claims real CLI/model execution`);
  }

  for (const request of requests) {
    const boundary = classifyE2ERequest(request.url, scenario);
    if (!isBoundaryAllowed(scenario, boundary, request)) {
      const phaseLabel = request.phase ? ` during ${request.phase}` : '';
      errors.push(`${scenario.name} forbids ${boundary} request${phaseLabel} ${request.method} ${request.url}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function assertE2EDataModeScenario(
  scenario: E2EDataModeScenario,
  requests: E2EObservedRequest[] = [],
): void {
  const validation = validateE2EDataModeScenario(scenario, requests);
  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }
}

export function buildE2EDataModeManifest(
  scenario: E2EDataModeScenario,
  requests: E2EObservedRequest[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  assertE2EDataModeScenario(scenario, requests);
  const requestedEndpoints = requests
    .map((request) => `${request.method} ${request.url}`)
    .sort();
  const requestedBoundaries = Array.from(new Set(
    requests.map((request) => classifyE2ERequest(request.url, scenario)),
  )).sort();
  const requestedPhases = Array.from(new Set(
    requests.map((request) => request.phase ?? 'workbench-runtime'),
  )).sort();
  const realTested = scenario.realLoginTested && scenario.realCliOrModelExecuted;

  return {
    schema: 'agenthub.e2e_data_mode_contract.v1',
    scenario: scenario.name,
    surface: scenario.surface,
    dataMode: scenario.dataMode,
    dataSource: scenario.dataSource,
    appOrigin: scenario.appOrigin,
    ...(scenario.hubOrigin ? { hubOrigin: scenario.hubOrigin } : {}),
    directLocalEdge: scenario.directLocalEdge,
    realLoginTested: scenario.realLoginTested,
    realCliOrModelExecuted: scenario.realCliOrModelExecuted,
    tokenDanceIdSecretUsed: scenario.tokenDanceIdSecretUsed,
    mockAdapterUsed: scenario.mockAdapterUsed,
    MockAdapterUsed: scenario.mockAdapterUsed,
    RealLoginTested: scenario.realLoginTested,
    RealCliTested: scenario.realCliOrModelExecuted,
    real_tested: realTested,
    requestedPhases,
    requestedBoundaries,
    requestedEndpoints,
    ...extra,
  };
}

function isBoundaryAllowed(
  scenario: E2EDataModeScenario,
  boundary: E2ERequestBoundary,
  request: E2EObservedRequest,
): boolean {
  if (boundary === 'non-http' || boundary === 'app') return true;

  const phase = request.phase ?? 'workbench-runtime';
  if (phase === 'entry-preflight') {
    return isEntryPreflightBoundaryAllowed(scenario, boundary, request);
  }
  if (phase === 'manifest-preflight') {
    return false;
  }

  const mode = getWorkbenchDataModeContract(scenario.dataMode);
  if (boundary === 'hub') {
    return mode.allowsHubData && usesHubBackplane(scenario);
  }
  if (boundary === 'local-edge') {
    return scenario.surface === 'desktop' && scenario.directLocalEdge;
  }
  if (boundary === 'tokendance-id') {
    return scenario.realLoginTested;
  }
  if (boundary === 'gateway') {
    return scenario.realCliOrModelExecuted;
  }
  return false;
}

function isEntryPreflightBoundaryAllowed(
  scenario: E2EDataModeScenario,
  boundary: E2ERequestBoundary,
  request: E2EObservedRequest,
): boolean {
  return (
    scenario.surface === 'desktop' &&
    boundary === 'local-edge' &&
    isLocalEdgeHealthRequest(request)
  );
}

function isLocalEdgeHealthRequest(request: E2EObservedRequest): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return request.method.toUpperCase() === 'GET' && url.pathname === '/v1/health';
}

function usesHubBackplane(scenario: E2EDataModeScenario): boolean {
  return (
    scenario.dataSource === 'stubbed-hub-session' ||
    scenario.dataSource === 'observed-hub-replay' ||
    scenario.dataSource === 'approved-real-preflight'
  );
}

const DEFAULT_APP_HOSTS = new Set([
  'localhost:5173',
  '127.0.0.1:5173',
  'localhost:5174',
  '127.0.0.1:5174',
  'localhost:5177',
  '127.0.0.1:5177',
  'localhost:5199',
  '127.0.0.1:5199',
  'localhost:5201',
  '127.0.0.1:5201',
]);

const HUB_HOSTS = new Set([
  'localhost:8080',
  '127.0.0.1:8080',
  'hub.vectorcontrol.tech',
  'api.hub.vectorcontrol.tech',
]);

const LOCAL_EDGE_HOSTS = new Set([
  'localhost:3210',
  '127.0.0.1:3210',
]);

const TOKEN_DANCE_ID_HOSTS = new Set([
  'id.tokendancelab.com',
]);

const GATEWAY_HOSTS = new Set([
  'api.vectorcontrol.tech',
]);
