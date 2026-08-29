import { describe, expect, it, vi } from 'vitest';
import { WORKBENCH_DATA_MODE_STORAGE_KEY } from '@shared/demo';
import { createDesktopPlatform } from './desktopPlatform';

describe('createDesktopPlatform', () => {
  it('declares local terminal capability and attaches an in-memory TerminalPort', async () => {
    const platform = createDesktopPlatform();

    expect(platform.capabilities.localTerminal).toBe(true);
    expect(platform.terminal).toBeDefined();

    // In-memory mock only (#1193) — no Tauri PTY / process spawn.
    const session = await platform.terminal!.spawn({ title: 'Desktop mock' });
    expect(session.id).toMatch(/^mock-term-/);
    expect(session.title).toBe('Desktop mock');
    expect(session.status).toBe('running');

    await expect(platform.terminal!.list()).resolves.toEqual([
      expect.objectContaining({ id: session.id }),
    ]);
  });

  it('does not fall back to the demo runtime unless explicitly allowed', async () => {
    const platform = createDesktopPlatform();

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'thread-live',
      text: 'should not create mock output',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('Local Edge run submission is unavailable');
  });

  it('allows the demo runtime fallback only when the shell opts in', async () => {
    const platform = createDesktopPlatform({ demoRuntimeFallback: true });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'builder',
      text: 'demo send smoke',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).resolves.toEqual(expect.objectContaining({
      intentId: expect.stringMatching(/^demo-/),
    }));
  });

  it('fails closed instead of using the demo runtime when no active Edge thread is selected', async () => {
    const submitRun = vi.fn();
    const platform = createDesktopPlatform({ submitRun });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'builder',
      text: 'demo send smoke',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('Local Edge thread is required');

    expect(submitRun).not.toHaveBeenCalled();
  });

  it('routes selected runtime adapter id through the Local Edge run request', async () => {
    const submitRun = vi.fn().mockResolvedValue({
      runId: 'run-edge-1',
      projectId: 'project-edge',
      threadId: 'thread-edge',
      status: 'queued',
    });
    const platform = createDesktopPlatform({
      activeProjectId: 'project-edge',
      activeThreadId: 'thread-edge',
      submitRun,
    });

    await platform.runs.submitComposerIntent({
      conversationId: 'thread-edge',
      text: 'review the mapper',
      mode: 'code',
      mentions: [{
        id: 'codex-local',
        label: 'Codex Local',
        model: 'gpt-5.1-codex',
        provider: 'tokendance-gateway',
        runtimeId: 'codex',
      }],
      attachments: [],
      approvalMode: 'workspace-write',
      workDir: '/workspace/AgentHub',
    });

    expect(submitRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      projectId: 'project-edge',
      threadId: 'thread-edge',
      permissionMode: 'acceptEdits',
      workDir: '/workspace/AgentHub',
    }));
    expect(submitRun.mock.calls[0]?.[0]).not.toHaveProperty('provider');
  });

  it('keeps Desktop run submission owned by the Local Edge target preference', async () => {
    const submitRun = vi.fn().mockResolvedValue({
      runId: 'run-edge-1',
      projectId: 'project-edge',
      threadId: 'thread-edge',
      status: 'queued',
    });
    const platform = createDesktopPlatform({
      activeProjectId: 'project-edge',
      activeThreadId: 'thread-edge',
      submitRun,
    });

    await platform.runs.submitComposerIntent({
      conversationId: 'thread-edge',
      text: 'use the desktop target owner',
      mode: 'code',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    });

    expect(submitRun).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-edge',
      threadId: 'thread-edge',
    }));
    expect(platform.host?.executionTargetPreference?.()).toEqual(expect.objectContaining({
      owner: 'desktop',
      targetId: 'local-edge',
      route: 'local-edge-api',
    }));
    expect(submitRun.mock.calls[0]?.[0]).not.toHaveProperty('command');
    expect(submitRun.mock.calls[0]?.[0]).not.toHaveProperty('cliPath');
  });

  it('exposes Tauri host readiness without granting UI process spawn inputs', async () => {
    const platform = createDesktopPlatform({
      getEdgeHostReadiness: vi.fn().mockResolvedValue({
        running: false,
        pid: null,
        port: 3210,
        sidecar_name: 'agenthub-edge',
        target_id: 'local-edge',
        route: 'local-edge-api',
        bind_addr: '127.0.0.1:3210',
        health_url: 'http://127.0.0.1:3210/v1/health',
        store_backend: 'sqlite',
        store_db_policy: '<app-data>/agenthub-edge.sqlite',
        store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1',
        expected_store_migration_version: 4,
        log_paths: {
          directory: '<app-data>/edge-logs',
          stdout: '<app-data>/edge-logs/local-edge.stdout.log',
          stderr: '<app-data>/edge-logs/local-edge.stderr.log',
        },
        sidecar_args: [
          '--store-backend',
          'sqlite',
          '--store-db',
          '<app-data>/agenthub-edge.sqlite',
          '--addr',
          '127.0.0.1:3210',
          '--runner-profile',
          'claude-code',
        ],
        preflight: {
          sidecar_available: false,
          fallback_executable_available: false,
          auth_token_ready: true,
          status: 'blocked',
          blocker: 'Local Edge sidecar is not bundled and fallback executable is missing',
        },
        direct_cli_spawn: false,
      }),
    });

    const readiness = await platform.host.edgeHostReadiness();

    expect(readiness).toEqual(expect.objectContaining({
      sidecar_name: 'agenthub-edge',
      target_id: 'local-edge',
      route: 'local-edge-api',
      health_url: 'http://127.0.0.1:3210/v1/health',
      store_backend: 'sqlite',
      store_db_policy: '<app-data>/agenthub-edge.sqlite',
      store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1',
      expected_store_migration_version: 4,
      direct_cli_spawn: false,
    }));
    expect(readiness.log_paths).toEqual(expect.objectContaining({
      stdout: '<app-data>/edge-logs/local-edge.stdout.log',
      stderr: '<app-data>/edge-logs/local-edge.stderr.log',
    }));
    expect(readiness.preflight).toEqual(expect.objectContaining({
      sidecar_available: false,
      fallback_executable_available: false,
      auth_token_ready: true,
      status: 'blocked',
    }));
    expect(readiness.sidecar_args).toEqual(expect.arrayContaining([
      '--store-backend',
      'sqlite',
      '--store-db',
      '<app-data>/agenthub-edge.sqlite',
      '--addr',
      '127.0.0.1:3210',
    ]));
    expect(readiness.sidecar_args).not.toContain('--store-file');
    expect(readiness.sidecar_args).not.toEqual(expect.arrayContaining([
      'codex',
      'codex.exe',
      'claude',
      'claude.exe',
      'opencode',
      'opencode.exe',
    ]));
    expect(readiness).not.toHaveProperty('command');
    expect(readiness).not.toHaveProperty('cliPath');
  });

  it('exposes local edge diagnostics as read-only host data', async () => {
    const platform = createDesktopPlatform({
      getLocalEdgeDiagnostics: vi.fn().mockResolvedValue({
        readiness: {
          running: true,
          pid: 1234,
          port: 3210,
          sidecar_name: 'agenthub-edge',
          target_id: 'local-edge',
          route: 'local-edge-api',
          bind_addr: '127.0.0.1:3210',
          health_url: 'http://127.0.0.1:3210/v1/health',
          store_backend: 'sqlite',
          store_db_policy: '<app-data>/agenthub-edge.sqlite',
          store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1',
          expected_store_migration_version: 4,
          log_paths: {
            directory: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs',
            stdout: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs/local-edge.stdout.log',
            stderr: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs/local-edge.stderr.log',
          },
          sidecar_args: [
            '--store-backend',
            'sqlite',
            '--store-db',
            '<app-data>/agenthub-edge.sqlite',
            '--addr',
            '127.0.0.1:3210',
            '--runner-profile',
            'claude-code',
          ],
          preflight: {
            sidecar_available: true,
            fallback_executable_available: false,
            auth_token_ready: true,
            status: 'ready',
            blocker: null,
          },
          direct_cli_spawn: false,
        },
        status: {
          running: true,
          pid: 1234,
          port: 3210,
          health_url: 'http://127.0.0.1:3210/v1/health',
          last_error: null,
          log_paths: {
            directory: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs',
            stdout: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs/local-edge.stdout.log',
            stderr: 'C:/Users/test/AppData/Roaming/AgentHub/edge-logs/local-edge.stderr.log',
          },
        },
        packaged_login: {
          loopback: {
            available: true,
            bind_host: '127.0.0.1',
            port: 49888,
            redirect_uri: 'http://127.0.0.1:49888/callback',
            error: null,
          },
          credential_store: {
            available: true,
            service: 'com.agenthub.desktop',
            error: null,
          },
          real_e2e: {
            status: 'proposal_only',
            reason: 'Real packaged login E2E requires an explicit TokenDance ID/browser gate.',
          },
        },
        log_tail: {
          stdout: ['edge ready'],
          stderr: [],
        },
      }),
    });

    const diagnostics = await platform.host.localEdgeDiagnostics();

    expect(diagnostics).toEqual(expect.objectContaining({
      status: expect.objectContaining({
        running: true,
        health_url: 'http://127.0.0.1:3210/v1/health',
      }),
      log_tail: {
        stdout: ['edge ready'],
        stderr: [],
      },
    }));
    expect(diagnostics.readiness).toEqual(expect.objectContaining({
      direct_cli_spawn: false,
      store_backend: 'sqlite',
      store_db_policy: '<app-data>/agenthub-edge.sqlite',
      store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1',
      expected_store_migration_version: 4,
    }));
    expect(diagnostics).not.toHaveProperty('command');
    expect(diagnostics).not.toHaveProperty('cliPath');
  });

  it('exposes no-spend local CLI discovery through the Desktop host port', async () => {
    const platform = createDesktopPlatform({
      getLocalCliDiscovery: vi.fn().mockResolvedValue({
        mode: 'no-spend-discovery',
        readinessManifest: '.tmp/evidence/p0-edge-cli-real-readiness.json',
        readinessScript: 'scripts/verify/verify-edge-cli-real-readiness.py',
        generatedAt: null,
        items: [
          {
            id: 'codex',
            name: 'Codex CLI',
            installed: true,
            version: 'codex 0.1.0',
            path: 'C:/Tools/codex.cmd',
            noSpend: true,
          },
          {
            id: 'claude-code',
            name: 'Claude Code',
            installed: false,
            version: null,
            path: 'claude',
            noSpend: true,
          },
        ],
      }),
    });

    const discovery = await platform.host.localCliDiscovery();

    expect(discovery).toEqual(expect.objectContaining({
      mode: 'no-spend-discovery',
      readinessManifest: '.tmp/evidence/p0-edge-cli-real-readiness.json',
      readinessScript: 'scripts/verify/verify-edge-cli-real-readiness.py',
    }));
    expect(discovery.items[0]).toEqual(expect.objectContaining({
      id: 'codex',
      installed: true,
      noSpend: true,
    }));
    expect(discovery).not.toHaveProperty('prompt');
    expect(discovery).not.toHaveProperty('model');
  });

  it('exposes listRuntimeSessions host port for Desktop settings import (#1192)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: 'sess-1',
              runtime: 'codex',
              title: 'sess-1',
              sourceMode: 'import',
              updatedAt: '2026-07-19T00:00:00Z',
            },
          ],
        },
      }),
    } as Response);

    try {
      const platform = createDesktopPlatform();
      const items = await platform.host.listRuntimeSessions(10);
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(expect.objectContaining({
        id: 'sess-1',
        runtime: 'codex',
        sourceMode: 'import',
      }));
      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/v1/runtime-sessions?limit=10');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('skips the Edge runtime-sessions preflight in pinned mock data mode (#1995)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'mock');

    try {
      const platform = createDesktopPlatform();
      await expect(platform.host.listRuntimeSessions(10)).resolves.toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      window.localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);
      fetchSpy.mockRestore();
    }
  });
});

describe('Desktop SurfaceCapabilities new domains', () => {
  it('declares approval, runtimeEvidence, and sandbox as true via Local Edge backing', () => {
    const platform = createDesktopPlatform();

    expect(platform.capabilities.approval).toBe(true);
    expect(platform.capabilities.runtimeEvidence).toBe(true);
    expect(platform.capabilities.sandbox).toBe(true);
  });

  it('keeps remoteExecution un-declared until a cloud/remote target is wired', () => {
    const platform = createDesktopPlatform();

    // Undefined/false both satisfy "UI hides"; current fact narrative has no
    // remote target channel on Desktop host, so we assert falsy rather than
    // a specific boolean to keep the contract honest.
    expect(Boolean(platform.capabilities.remoteExecution)).toBe(false);
  });
});
