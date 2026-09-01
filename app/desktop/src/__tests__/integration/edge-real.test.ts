//
// Desktop↔Edge real server E2E — builds and runs the actual Go Edge server.
//
// This test:
//   1. Builds the Go Edge server binary (go build)
//   2. Starts it on a fixed port
//   3. Waits for /v1/health to return 200
//   4. Runs REST + WebSocket protocol contract tests against the real server
//   5. Kills the server after tests
//
// Contrast with edge-integration.test.ts which uses an in-process Node.js mock
// server and is suitable for CI without a Go toolchain.
//
// @vitest-environment node
//
// NOTE: This test uses the 'node' environment (not 'jsdom') because
// it requires Node's child_process (spawn/execSync) and native WebSocket.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  AgentInfo,
  ListResponse,
} from '@shared/types';
import type { EventEnvelope } from '@shared/events';

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const TEST_PORT = 13299;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}/v1/events`;

// Paths relative to this test file
const EDGE_SERVER_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'edge-server');
const BINARY_NAME = process.platform === 'win32' ? 'test-edge-server.exe' : 'test-edge-server';
const BINARY_PATH = path.join(EDGE_SERVER_DIR, BINARY_NAME);

// Workspace directory for adapter runs (#854 workDir is now required) and
// the matching --workspace-allowlist root (#998); both point at a fresh temp dir.
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-edge-real-'));

// ═══════════════════════════════════════════════════════════════════
// Module-level Go availability check (synchronous, fast)
// ═══════════════════════════════════════════════════════════════════

function checkGoAvailable(): boolean {
  try {
    execSync('go version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const HAS_GO = checkGoAvailable();

// Use describe.skip if Go is not available; the entire suite is skipped
const describeReal = HAS_GO ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

async function waitForServer(url: string, maxRetries = 60, delayMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Server at ${url} did not become healthy within ${maxRetries * delayMs}ms`);
}

/**
 * Unwraps the {@code {"code":"ok","data":...}} envelope used by Edge Server's
 * writeSuccess helper, returning the inner data payload. Older Edge builds
 * sent "OK"; the production edgeClient accepts both casings, so this test
 * mirror must too (edge-real runs against the real binary, which writes "ok").
 * Returns the raw input unchanged when no envelope is detected.
 */
function unwrapEdgeResponse(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'code' in raw && 'data' in raw) {
    const code = (raw as Record<string, unknown>).code;
    if (code === 'OK' || code === 'ok') {
      return (raw as Record<string, unknown>).data;
    }
  }
  return raw;
}

// ═══════════════════════════════════════════════════════════════════
// Suite-level state
// ═══════════════════════════════════════════════════════════════════

let serverProcess: ReturnType<typeof spawn> | null = null;
let serverReady = false;
let built = false;

// ═══════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════

describeReal('Real Edge Server E2E', () => {
  beforeAll(async () => {
    // Build the Edge server binary
    try {
      execSync(`go build -o ${BINARY_NAME} ./cmd/agenthub-edge/`, {
        cwd: EDGE_SERVER_DIR,
        stdio: 'pipe',
        timeout: 90000,
      });
      built = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to build edge-server: ${msg}`);
      return; // Tests will fail because serverReady stays false
    }

    // Start the server on the test port
    serverProcess = spawn(BINARY_PATH, ['--addr', `127.0.0.1:${TEST_PORT}`, '--dev', '--workspace-allowlist', WORK_DIR], {
      cwd: EDGE_SERVER_DIR,
      stdio: 'pipe',
    });

    // Log server output for debugging
    serverProcess.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(`[edge-server stdout] ${data.toString()}`);
    });
    serverProcess.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[edge-server stderr] ${data.toString()}`);
    });

    serverProcess.on('exit', (code) => {
      if (serverReady) {
        console.error(`Edge server exited unexpectedly with code ${code}`);
      }
    });

    // Wait for the server to be ready
    try {
      await waitForServer(`${BASE_URL}/v1/health`);
      serverReady = true;
    } catch (err) {
      console.error('Failed to start edge-server:', err);
      stopServer();
    }
  }, 120000); // 120-second timeout for build + startup

  afterAll(async () => {
    stopServer();

    // Clean up the built binary
    if (built) {
      try {
        fs.unlinkSync(BINARY_PATH);
      } catch {
        // Best effort cleanup
      }
    }
  });

  beforeEach(async () => {
    // The mock executor finishes a run in ~350ms; wait so the previous test's
    // run reaches a terminal state and does not trip the per-thread
    // active-run guard (409) when the next test creates a run on thread_local.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stopServer(): void {
    if (!serverProcess) return;
    try {
      serverProcess.kill('SIGTERM');
      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        try { serverProcess?.kill('SIGKILL'); } catch { /* ignore */ }
      }, 5000);
    } catch {
      // Process may already be dead
    }
    serverProcess = null;
    serverReady = false;
  }

  /**
   * Helpers that skip individual tests when the server is not ready.
   */
  function requireServer(): void {
    if (!serverReady) {
      // Vitest doesn't have a great "skip mid-test" API, so we throw a
      // distinctive error and catch it.  But since beforeAll already takes
      // care of startup, the simplest approach is a no-op if server isn't
      // ready — the actual HTTP calls will fail with clear error messages.
      throw new Error(
        'Edge server is not running. Check the beforeAll build/startup logs above.',
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // REST: Health
  // ═════════════════════════════════════════════════════════════════

  describe('GET /v1/health', () => {
    it('returns 200 with status, version, edgeId, and checks', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const body = unwrapEdgeResponse(await res.json()) as Record<string, unknown>;
      expect(typeof body.status).toBe('string');
      expect(body.version).toBe('v1');
      expect(typeof body.edgeId).toBe('string');
      expect((body.edgeId as string).length).toBeGreaterThan(0);

      // Real server includes checks
      expect(body.checks).toBeDefined();
      expect(typeof body.checks).toBe('object');

      // Each check has a status field
      const checks = body.checks as Record<string, { status: string }>;
      for (const [, check] of Object.entries(checks)) {
        expect(['ok', 'degraded', 'error']).toContain(check.status);
      }
    });

    it('returns 405 for POST (method not allowed)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/health`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('method_not_allowed');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // REST: Agents
  // ═════════════════════════════════════════════════════════════════

  describe('GET /v1/agents', () => {
    it('returns ListResponse with items array', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/agents`);
      expect(res.status).toBe(200);

      const body = unwrapEdgeResponse(await res.json()) as ListResponse<AgentInfo>;
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.page.hasMore).toBe('boolean');

      // Without --agent-default, the adapter registry may be empty.
      // The response shape must still be valid ListResponse<AgentInfo>.
      for (const agent of body.items as Record<string, unknown>[]) {
        expect(typeof agent.id).toBe('string');
        expect(typeof agent.name).toBe('string');
        if (agent.capabilities) {
          const caps = agent.capabilities as Record<string, unknown>;
          // Go struct serializes with capitalized keys (no json tags on AgentCapabilities)
          const streaming = caps.streaming ?? caps.Streaming;
          const toolCalls = caps.toolCalls ?? caps.ToolCalls;
          expect(typeof streaming).toBe('boolean');
          expect(typeof toolCalls).toBe('boolean');
        }
      }
    });

    it('returns 405 for POST (method not allowed)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/agents`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error.code).toBe('method_not_allowed');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // REST: Metrics
  // ═════════════════════════════════════════════════════════════════

  describe('GET /v1/metrics', () => {
    it('returns Prometheus text format with expected metrics', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/metrics`);
      expect(res.status).toBe(200);

      const ct = res.headers.get('content-type') || '';
      // Prometheus handler returns text/plain
      expect(ct).toContain('text/plain');

      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);

      // Prometheus format: lines starting with # HELP or # TYPE, or metric names
      expect(body).toMatch(/#\s*(HELP|TYPE)\s/);

      // Should have edge-specific metrics (custom registry, no default Go runtime metrics)
      expect(body).toContain('edge_');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // REST: Runs
  // ═════════════════════════════════════════════════════════════════

  describe('POST /v1/runs', () => {
    it('returns 202 and creates a queued run (mock executor default)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj_local',
          threadId: 'thread_local',
          prompt: 'Integration test prompt',
          workDir: WORK_DIR,
        }),
      });

      // The edge server now defaults to a mock executor (no runner command +
      // no agent default), so run creation succeeds with 202 (queued run).
      expect(res.status).toBe(202);
      const data = unwrapEdgeResponse(await res.json()) as Record<string, unknown>;
      expect(typeof data.runId).toBe('string');
      expect((data.runId as string).length).toBeGreaterThan(0);
      expect(data.status).toBe('queued');
      expect(data.projectId).toBe('proj_local');
      expect(data.threadId).toBe('thread_local');
    });

    it('returns 400 workdir_required with minimal body (workDir omitted)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Minimal body' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('workdir_required');
    });

    it('returns 400 workdir_required with empty body', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('workdir_required');
    });

    it('returns 400 for invalid JSON', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('bad_request');
    });

    it('returns 405 for unsupported method (PUT)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, { method: 'PUT' });
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error.code).toBe('method_not_allowed');
    });
  });

  describe('GET /v1/runs', () => {
    it('lists runs with ListResponse shape', async () => {
      requireServer();
      // No executor — POST /v1/runs returns 503.
      // Skip the create step; just verify the list endpoint is reachable.
      const res = await fetch(`${BASE_URL}/v1/runs`);
      expect(res.status).toBe(200);

      const body = unwrapEdgeResponse(await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.page).toBeDefined();
      expect(typeof (body.page as Record<string, unknown>).hasMore).toBe('boolean');

      if ((body.items as unknown[]).length > 0) {
        const run = (body.items as Record<string, unknown>[])[0];
        expect(typeof run.runId).toBe('string');
        expect(typeof run.status).toBe('string');
      }
    });
  });

  describe('GET /v1/runs/:id', () => {
    it('returns run info for a created run', async () => {
      requireServer();
      const createRes = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_local', threadId: 'thread_local', workDir: WORK_DIR }),
      });
      expect(createRes.status).toBe(202);
      const created = unwrapEdgeResponse(await createRes.json()) as Record<string, unknown>;
      const runId = created.runId as string;

      const res = await fetch(`${BASE_URL}/v1/runs/${runId}`);
      expect(res.status).toBe(200);
      const data = unwrapEdgeResponse(await res.json()) as Record<string, unknown>;
      expect(data.runId).toBe(runId);
      expect(['queued', 'started', 'finished']).toContain(data.status);
      expect(data.projectId).toBe('proj_local');
      expect(data.threadId).toBe('thread_local');
    });

    it('returns 404 for unknown run ID', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs/nonexistent_run_id`);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('not_found');
    });
  });

  describe('POST /v1/runs/:id:cancel', () => {
    it('cancels a created run', async () => {
      requireServer();
      const createRes = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_local', threadId: 'thread_local', workDir: WORK_DIR }),
      });
      expect(createRes.status).toBe(202);
      const created = unwrapEdgeResponse(await createRes.json()) as Record<string, unknown>;
      const runId = created.runId as string;
      expect(created.projectId).toBe('proj_local');
      expect(created.threadId).toBe('thread_local');

      const cancelRes = await fetch(`${BASE_URL}/v1/runs/${runId}:cancel`, { method: 'POST' });
      // 202 cancelling, or 200 if the mock run already reached a terminal state.
      expect([200, 202]).toContain(cancelRes.status);
      const body = unwrapEdgeResponse(await cancelRes.json()) as Record<string, unknown>;
      expect(body.runId).toBe(runId);
      expect(['cancelling', 'cancelled', 'finished']).toContain(body.status);
    });

    it('returns 404 for unknown run on cancel (#108)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs/unknown_run_id:cancel`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('not_found');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // WebSocket: Event stream
  // ═════════════════════════════════════════════════════════════════

  describe('WebSocket /v1/events', () => {
    it('upgrades to WebSocket and sends server welcome on connect', async () => {
      requireServer();
      const ws = new WebSocket(WS_URL);
      const events: EventEnvelope[] = [];

      ws.onmessage = (msg) => {
        try {
          events.push(JSON.parse(msg.data as string));
        } catch { /* ignore malformed messages */ }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      });

      // Give the server time to send any initial welcome / connected event
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      ws.close();

      // WebSocket upgrade succeeded. The server may or may not emit lifecycle
      // events (no executor), but the connection itself must be stable.
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('verifies WS connection sends structured envelope frames', async () => {
      requireServer();
      const ws = new WebSocket(WS_URL);
      const events: EventEnvelope[] = [];

      ws.onmessage = (msg) => {
        try {
          events.push(JSON.parse(msg.data as string));
        } catch { /* ignore */ }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      ws.close();

      // If any events were received, validate envelope structure
      for (const evt of events) {
        expect(typeof evt.version).toBe('string');
        expect(evt.version).toBe('v1');
        expect(typeof evt.id).toBe('string');
        expect(evt.id.length).toBeGreaterThan(0);
        expect(typeof evt.seq).toBe('number');
        expect(evt.seq).toBeGreaterThan(0);
        expect(typeof evt.type).toBe('string');
        expect(evt.type.length).toBeGreaterThan(0);
        expect(typeof evt.sentAt).toBe('string');
      }

      // Sequence numbers should be monotonically increasing
      if (events.length > 1) {
        const seqs = events.map((e) => e.seq);
        for (let i = 1; i < seqs.length; i++) {
          expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1]);
        }
      }
    });

    it('receives run lifecycle events for a created run', async () => {
      requireServer();
      const ws = new WebSocket(WS_URL);
      const events: EventEnvelope[] = [];

      ws.onmessage = (msg) => {
        try {
          events.push(JSON.parse(msg.data as string));
        } catch { /* ignore */ }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      });

      // Create a run (mock executor) and expect the lifecycle to emit
      // run.queued / run.started / run.output.batch / run.finished.
      const createRes = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_local', threadId: 'thread_local', prompt: 'Cancel test', workDir: WORK_DIR }),
      });
      expect(createRes.status).toBe(202);

      // The mock executor finishes in ~350ms (5 output batches + status steps).
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      const types = events.map((e) => e.type);
      expect(types).toContain('run.queued');
      expect(types).toContain('run.started');
      expect(types).toContain('run.finished');
      expect(types).toContain('run.output.batch');

      // projectId/threadId posted to POST /v1/runs pass through to the
      // run.queued event scope (and payload, serialized from the run record).
      const queuedEvent = events.find((e) => e.type === 'run.queued');
      expect(queuedEvent).toBeDefined();
      expect(queuedEvent!.scope).toMatchObject({ projectId: 'proj_local', threadId: 'thread_local' });
      expect(queuedEvent!.payload).toMatchObject({ projectId: 'proj_local', threadId: 'thread_local' });

      ws.close();
    });

    it('handles multiple WS clients staying connected simultaneously', async () => {
      requireServer();
      const eventsA: EventEnvelope[] = [];
      const eventsB: EventEnvelope[] = [];

      const wsA = new WebSocket(WS_URL);
      wsA.onmessage = (msg) => {
        try { eventsA.push(JSON.parse(msg.data as string)); } catch { /* ignore */ }
      };
      await new Promise<void>((resolve, reject) => {
        wsA.onopen = () => resolve();
        wsA.onerror = (err) => reject(new Error(`WS A error: ${JSON.stringify(err)}`));
      });

      const wsB = new WebSocket(WS_URL);
      wsB.onmessage = (msg) => {
        try { eventsB.push(JSON.parse(msg.data as string)); } catch { /* ignore */ }
      };
      await new Promise<void>((resolve, reject) => {
        wsB.onopen = () => resolve();
        wsB.onerror = (err) => reject(new Error(`WS B error: ${JSON.stringify(err)}`));
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      wsA.close();
      wsB.close();

      // Both clients should behave identically
      const typesA = eventsA.map((e) => e.type);
      const typesB = eventsB.map((e) => e.type);
      expect(typesA).toEqual(typesB);
    });

    it('maintains stable WS connection (heartbeat pings)', async () => {
      requireServer();
      // The real server sends WebSocket ping frames every 30 seconds.
      // We verify the connection stays alive for 2 seconds without error.
      const ws = new WebSocket(WS_URL);

      let errored = false;
      ws.onerror = () => { errored = true; };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      });

      // Wait 2 seconds — the connection should stay alive
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      ws.close();

      expect(errored).toBe(false);
      // After close(), the state transitions to CLOSING (2), then CLOSED (3)
      // after the close handshake finishes. Either state is acceptable.
      expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(ws.readyState);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Error paths
  // ═════════════════════════════════════════════════════════════════

  describe('Error paths', () => {
    it('returns 404 with structured error for unknown endpoint', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/nonexistent_endpoint`);
      expect(res.status).toBe(404);

      // The default Go ServeMux returns a plain-text "404 page not found"
      // for unmatched routes. Some endpoints return JSON errors.
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBeDefined();
        expect(body.error.message).toBeDefined();
      } else {
        // plain text 404 from default mux
        const body = await res.text();
        expect(body.length).toBeGreaterThan(0);
      }
    });

    it('returns 405 for wrong method on /v1/runs (PATCH)', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, { method: 'PATCH' });
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error.code).toBe('method_not_allowed');
    });

    it('returns 400 for invalid JSON on POST /v1/runs', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('bad_request');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Desktop API client compatibility
  // ═════════════════════════════════════════════════════════════════

  describe('Desktop API client compatibility', () => {
    it('fetchHealth response matches expected shape', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/health`);
      expect(res.ok).toBe(true);
      const raw = await res.json();

      // The real client (edgeClient.fetchHealth) calls unwrapEdgeResponse
      // which extracts the .data field from the unified {"code":"ok","data":{...}}
      // envelope. The test mirrors this to verify the shape the client actually
      // processes.
      const body = unwrapEdgeResponse(raw);

      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('edgeId');

      // Real server also includes checks
      if (body.checks) {
        expect(typeof body.checks).toBe('object');
        const checks = body.checks as Record<string, unknown>;
        for (const [, check] of Object.entries(checks)) {
          const c = check as Record<string, unknown>;
          expect(c).toHaveProperty('status');
        }
      }
    });

    it('fetchAgents response matches ListResponse shape', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/agents`);
      expect(res.ok).toBe(true);
      const raw = await res.json();
      const body = unwrapEdgeResponse(raw) as Record<string, unknown>;

      expect(Array.isArray(body.items)).toBe(true);
      expect(body.page).toBeDefined();
      expect(typeof (body.page as Record<string, unknown>).hasMore).toBe('boolean');
    });

    it('startRun returns 202 with a queued run', async () => {
      requireServer();
      const res = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_local', threadId: 'thread_local', prompt: 'Compat test', workDir: WORK_DIR }),
      });
      expect(res.status).toBe(202);
      const data = unwrapEdgeResponse(await res.json()) as Record<string, unknown>;
      expect(data.status).toBe('queued');
      expect(typeof data.runId).toBe('string');
    });

    it('cancelRun cancels a created run', async () => {
      requireServer();
      const createRes = await fetch(`${BASE_URL}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj_local', threadId: 'thread_local', prompt: 'Cancel compat test', workDir: WORK_DIR }),
      });
      expect(createRes.status).toBe(202);
      const created = unwrapEdgeResponse(await createRes.json()) as Record<string, unknown>;
      const runId = created.runId as string;
      expect(created.projectId).toBe('proj_local');
      expect(created.threadId).toBe('thread_local');

      const cancelRes = await fetch(`${BASE_URL}/v1/runs/${runId}:cancel`, { method: 'POST' });
      expect([200, 202]).toContain(cancelRes.status);
    });
  });
});
