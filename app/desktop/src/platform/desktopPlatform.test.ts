import { describe, expect, it, vi } from 'vitest';
import { createDesktopPlatform } from './desktopPlatform';

describe('createDesktopPlatform', () => {
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
      workDir: 'D:/Code/TokenDance/AgentHub',
    });

    expect(submitRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      projectId: 'project-edge',
      threadId: 'thread-edge',
      permissionMode: 'acceptEdits',
      workDir: 'D:/Code/TokenDance/AgentHub',
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
        sidecar_args: [
          '--store-file',
          '<app-data>/agenthub-edge-store.json',
          '--addr',
          '127.0.0.1:3210',
          '--runner-profile',
          'claude-code',
        ],
        direct_cli_spawn: false,
      }),
    });

    const readiness = await platform.host.edgeHostReadiness();

    expect(readiness).toEqual(expect.objectContaining({
      sidecar_name: 'agenthub-edge',
      target_id: 'local-edge',
      route: 'local-edge-api',
      direct_cli_spawn: false,
    }));
    expect(readiness.sidecar_args).toEqual(expect.arrayContaining([
      '--store-file',
      '<app-data>/agenthub-edge-store.json',
      '--addr',
      '127.0.0.1:3210',
    ]));
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
});
