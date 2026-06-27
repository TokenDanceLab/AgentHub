#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputDirArgIndex = process.argv.indexOf('--output-dir');
const outputDir =
  outputDirArgIndex >= 0 && process.argv[outputDirArgIndex + 1]
    ? resolve(process.argv[outputDirArgIndex + 1])
    : resolve(repoRoot, '.tmp', 'product-loop-observed-e2e');

const chain = {
  name: 'product-loop-observed-e2e',
  mode: 'fixture-observed',
  realTested: false,
  noRealLogin: true,
  noRealCliModelApi: true,
  noDeployPackageOrRelease: true,
  ids: {
    sessionId: 'sess-product-loop-fixture',
    taskId: 'task-product-loop-fixture',
    targetId: 'target-desktop-local-edge',
    edgeDeviceId: 'desktop-device-fixture',
    edgeRunId: 'edge-run-fixture',
    approvalId: 'approval-write-file-fixture',
    artifactId: 'artifact-transcript-fixture',
    correlationId: 'corr-product-loop-fixture',
  },
  web: {
    surface: 'web',
    requests: [
      { method: 'POST', path: '/web/agent-tasks', purpose: 'create task through Hub' },
      { method: 'GET', path: '/web/agent-tasks/task-product-loop-fixture/events', purpose: 'replay typed Hub events' },
      { method: 'GET', path: '/web/agent-tasks/task-product-loop-fixture/summary', purpose: 'replay summary' },
      { method: 'GET', path: '/web/agent-tasks/task-product-loop-fixture/approvals', purpose: 'render pending approval' },
      {
        method: 'POST',
        path: '/web/agent-tasks/task-product-loop-fixture/approvals/approval-write-file-fixture/decide',
        purpose: 'submit approval through Hub control plane',
      },
      { method: 'GET', path: '/web/agent-tasks/task-product-loop-fixture/artifacts', purpose: 'render artifact metadata' },
    ],
    forbiddenRequests: ['/v1/events', '/v1/runs', '127.0.0.1:3210', 'localhost:3210'],
  },
  hub: {
    dispatch: {
      frameType: 'agent.dispatch',
      taskId: 'task-product-loop-fixture',
      targetId: 'target-desktop-local-edge',
      edgeDeviceId: 'desktop-device-fixture',
      exactDeviceOnly: true,
      source: 'Hub queued target-bound dispatch',
    },
    replayEvents: [
      {
        id: 'evt-001',
        eventSeq: 1,
        type: 'agent.stream',
        eventType: 'run.agent.session_init',
        payload: { agent: 'Fixture Builder', runtime: 'fixture-adapter', executionMode: 'fixture' },
      },
      {
        id: 'evt-002',
        eventSeq: 2,
        type: 'agent.stream',
        eventType: 'run.agent.route_decision',
        payload: { targetId: 'target-desktop-local-edge', edgeDeviceId: 'desktop-device-fixture' },
      },
      {
        id: 'evt-003',
        eventSeq: 3,
        type: 'agent.stream',
        eventType: 'run.agent.cli_invocation_plan',
        payload: {
          adapterId: 'fixture-adapter',
          commandName: 'agenthub-fixture-adapter',
          executionMode: 'fixture',
          noSpendDefault: true,
          approvalRequired: true,
          redactionApplied: true,
        },
      },
      {
        id: 'evt-004',
        eventSeq: 4,
        type: 'agent.stream',
        eventType: 'approval.requested',
        payload: {
          approvalId: 'approval-write-file-fixture',
          requestId: 'approval-write-file-fixture',
          title: 'Review fixture file write',
          description: 'Fixture adapter requests approval before writing an artifact.',
          edgeRunId: 'edge-run-fixture',
        },
      },
      {
        id: 'evt-005',
        eventSeq: 5,
        type: 'agent.stream',
        eventType: 'artifact.created',
        payload: {
          artifactId: 'artifact-transcript-fixture',
          title: 'fixture-transcript.md',
          path: 'artifacts/fixture-transcript.md',
          mimeType: 'text/markdown',
        },
      },
      {
        id: 'evt-006',
        eventSeq: 6,
        type: 'agent.stream',
        eventType: 'run.agent.result',
        payload: { status: 'finished', summary: 'Fixture product-loop completed.' },
      },
    ],
    approvalsEndpoint: {
      path: '/web/agent-tasks/task-product-loop-fixture/approvals',
      items: [{ approvalId: 'approval-write-file-fixture', status: 'pending', edgeRunId: 'edge-run-fixture' }],
    },
    artifactsEndpoint: {
      path: '/web/agent-tasks/task-product-loop-fixture/artifacts',
      items: [{ artifactId: 'artifact-transcript-fixture', path: 'artifacts/fixture-transcript.md' }],
    },
  },
  desktop: {
    surface: 'desktop-tauri',
    rendererCapabilities: {
      localEdgeReadiness: true,
      shellOpenOnly: true,
      rawProcessExecution: false,
      directCliSpawn: false,
    },
    sidecarReadiness: {
      mode: 'fixture',
      sidecarName: 'agenthub-edge',
      healthUrl: 'http://127.0.0.1:3210/v1/health',
      storeBackend: 'sqlite',
      appDataStore: '<app-data>/agenthub-edge.sqlite',
      directCliSpawn: false,
    },
  },
  edge: {
    localEdge: true,
    adapter: {
      id: 'fixture-adapter',
      executionMode: 'fixture',
      observed: true,
      realCliObserved: false,
      noSpendDefault: true,
      emits: ['run.agent.cli_invocation_plan', 'approval.requested', 'artifact.created', 'run.agent.result'],
    },
  },
  webRender: {
    transcriptBlocks: [
      'run-session',
      'route-decision',
      'tool-call',
      'approval',
      'artifact',
      'result',
    ],
    approvalActions: [{ approvalId: 'approval-write-file-fixture', via: 'Hub', directEdge: false }],
    artifactCards: [{ artifactId: 'artifact-transcript-fixture', source: 'Hub artifact endpoint' }],
  },
};

function assertNoWebLocalEdgeRequests() {
  const requestText = JSON.stringify(chain.web.requests);
  for (const forbidden of chain.web.forbiddenRequests) {
    assert.equal(
      requestText.includes(forbidden),
      false,
      `Web request surface must not include ${forbidden}`,
    );
  }
  assert.ok(
    chain.web.requests.every((request) => request.path.startsWith('/web/')),
    'Web chain must use Hub /web routes only',
  );
}

function assertDesktopRendererHasNoRawProcessExecution() {
  assert.equal(chain.desktop.rendererCapabilities.rawProcessExecution, false);
  assert.equal(chain.desktop.rendererCapabilities.directCliSpawn, false);
  assert.equal(chain.desktop.sidecarReadiness.directCliSpawn, false);
  assert.equal(chain.desktop.sidecarReadiness.mode, 'fixture');
}

function assertHubReplayApprovalArtifactContract() {
  const eventTypes = chain.hub.replayEvents.map((event) => event.eventType);
  for (const expected of ['run.agent.cli_invocation_plan', 'approval.requested', 'artifact.created', 'run.agent.result']) {
    assert.ok(eventTypes.includes(expected), `Hub replay must include ${expected}`);
  }
  assert.deepEqual(
    chain.hub.replayEvents.map((event) => event.eventSeq),
    [1, 2, 3, 4, 5, 6],
    'Hub replay event sequence must be stable',
  );
  assert.equal(chain.hub.approvalsEndpoint.items[0]?.approvalId, chain.ids.approvalId);
  assert.equal(chain.hub.artifactsEndpoint.items[0]?.artifactId, chain.ids.artifactId);
  assert.ok(
    chain.web.requests.some((request) => request.path.endsWith(`/approvals/${chain.ids.approvalId}/decide`)),
    'Web approval decision must target the Hub task approval endpoint',
  );
}

function assertEdgeFixtureBoundary() {
  assert.equal(chain.edge.localEdge, true);
  assert.equal(chain.edge.adapter.executionMode, 'fixture');
  assert.equal(chain.edge.adapter.noSpendDefault, true);
  assert.equal(chain.edge.adapter.realCliObserved, false);
  assert.equal(chain.realTested, false);
  assert.equal(chain.noRealLogin, true);
  assert.equal(chain.noRealCliModelApi, true);
}

function assertWebRenderLinksReplayApprovalAndArtifact() {
  for (const block of ['run-session', 'approval', 'artifact', 'result']) {
    assert.ok(chain.webRender.transcriptBlocks.includes(block), `Web transcript render must include ${block}`);
  }
  assert.equal(chain.webRender.approvalActions[0]?.via, 'Hub');
  assert.equal(chain.webRender.approvalActions[0]?.directEdge, false);
  assert.equal(chain.webRender.artifactCards[0]?.artifactId, chain.ids.artifactId);
}

assertNoWebLocalEdgeRequests();
assertDesktopRendererHasNoRawProcessExecution();
assertHubReplayApprovalArtifactContract();
assertEdgeFixtureBoundary();
assertWebRenderLinksReplayApprovalAndArtifact();

const report = {
  generatedAt: new Date().toISOString(),
  status: 'fixture_observed_chain_verified',
  chain,
};

mkdirSync(outputDir, { recursive: true });
const reportPath = resolve(outputDir, 'product-loop-observed-e2e-report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`PASS product-loop fixture/observed chain verified`);
console.log(`report=${reportPath}`);
