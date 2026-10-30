import { describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from './webPlatform';
import { isDispatchableWebTarget } from './webPlatformDispatchHelpers';
import { resolveWebExecutionTargetStatus } from './webWorkbenchExecutionTargets';

const target = {
  id: 'paired-target', name: 'My Edge', device_id: 'my-edge', target_type: 'cloud_edge',
  health_state: 'healthy' as const, is_online: true, workspace_root: '/workspace/allowed',
  capabilities: { pairedDevice: true, runtimeId: 'openai-sdk', multiTurn: true, toolExecution: false },
};
function client() {
  return {
    listExecutionTargets: vi.fn().mockResolvedValue({ items: [target], page: { hasMore: false } }),
    addAgentToSession: vi.fn().mockResolvedValue({ id: 'instance-1' }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 'message-1' }),
    triggerAgentTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'queued' }),
  };
}
function intent(runtimeId = 'openai-sdk') {
  return {
    conversationId: 'session-1', text: 'Remember our topic', mode: 'ask' as const,
    mentions: [{ id: 'profile-1', label: 'Text agent', runtimeId, model: 'my-model' }],
    attachments: [], approvalMode: 'read-only' as const,
    executionTargetId: target.id, workDir: '/browser/cannot/override',
  };
}

describe('paired Edge dispatch', () => {
  it('dispatches a matching SDK profile and omits browser workspace overrides', async () => {
    const hubClient = client();
    const platform = createWebPlatform({ hubClient });
    await expect(platform.runs.submitComposerIntent(intent())).resolves.toEqual({ intentId: 'task-1' });
    expect(hubClient.addAgentToSession).toHaveBeenCalledWith('session-1', { agent_type: 'openai-sdk', display_name: 'Text agent' });
    const options = hubClient.triggerAgentTask.mock.calls[0]![1];
    expect(options.target_id).toBe(target.id);
    const params = JSON.parse(options.model_params);
    expect(params).not.toHaveProperty('work_dir');
    expect(params).toEqual({ runtime_id: 'openai-sdk', model: 'my-model' });
  });

  it('retries dispatch through Hub with the original message, without sending it again', async () => {
    const hubClient = client();
    await expect(createWebPlatform({ hubClient }).runs.redispatchTask!(intent(), 'original-message')).resolves.toEqual({ taskId: 'task-1' });
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
    expect(hubClient.triggerAgentTask).toHaveBeenCalledWith('original-message', expect.objectContaining({
      target_id: target.id, model_params: JSON.stringify({ runtime_id: 'openai-sdk', model: 'my-model' }),
    }));
  });

  it('resolves a paired device after the first inventory page', async () => {
    const hubClient = client();
    hubClient.listExecutionTargets.mockResolvedValueOnce({ items: [], page: { hasMore: true, nextCursor: 'next-page' } } as never);
    await expect(createWebPlatform({ hubClient }).runs.submitComposerIntent(intent())).resolves.toEqual({ intentId: 'task-1' });
    expect(hubClient.listExecutionTargets).toHaveBeenLastCalledWith({ pageSize: 50, pageCursor: 'next-page' });
  });

  it('rejects mismatched runtime before creating an instance or persisting a message', async () => {
    const hubClient = client();
    const platform = createWebPlatform({ hubClient });
    await expect(platform.runs.submitComposerIntent(intent('codex'))).rejects.toThrow('edgePairing.runtimeMismatch');
    expect(hubClient.addAgentToSession).not.toHaveBeenCalled();
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
    expect(hubClient.triggerAgentTask).not.toHaveBeenCalled();
  });

  it.each(['', '  '])('rejects an unspecified model before sending: %j', async (model) => {
    const hubClient = client();
    const request = intent();
    request.mentions[0]!.model = model;
    await expect(createWebPlatform({ hubClient }).runs.submitComposerIntent(request)).rejects.toThrow('edgePairing.modelRequired');
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects attachments instead of silently pretending the text runtime consumes them', async () => {
    const hubClient = client();
    const request = { ...intent(), attachments: [{ id: 'file-1', name: 'report.pdf' }] };
    await expect(createWebPlatform({ hubClient }).runs.submitComposerIntent(request)).rejects.toThrow('edgePairing.textAttachmentsUnsupported');
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    { capabilities: {} },
    { capabilities: { pairedDevice: 'true', runtimeId: 'openai-sdk' } },
    { capabilities: { pairedDevice: true, runtimeId: 'codex' } },
    { capabilities: '{bad json' },
    { is_online: false },
    { health_state: 'stale' },
    { health_state: 'degraded' },
  ])('rejects unpaired or unavailable cloud targets before sending: %j', async (override) => {
    const hubClient = client();
    hubClient.listExecutionTargets.mockResolvedValue({ items: [{ ...target, ...override }], page: { hasMore: false } });
    await expect(createWebPlatform({ hubClient }).runs.submitComposerIntent(intent())).rejects.toThrow('not dispatchable');
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
  });

  it('accepts JSON-encoded capabilities and reports healthy paired inventory as ready', () => {
    expect(isDispatchableWebTarget({ ...target, capabilities: JSON.stringify(target.capabilities) })).toBe(true);
    expect(resolveWebExecutionTargetStatus({ hubReady: true, dataMode: 'approved-real', isFetching: false, error: null,
      targets: [{ ...target, workspace_allowlist: ['/workspace/allowed'], trust_level: 'cloud' }],
    })).toMatchObject({ state: 'ready', selectedTarget: { id: target.id } });
  });
});
