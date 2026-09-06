import { describe, expect, it } from 'vitest';
import {
  boolValue,
  compactRecord,
  getFirstBoolean,
  getFirstNumber,
  getFirstString,
  getString,
  parseRecord,
  parseStringArray,
  parseStringRecord,
} from './hubIntegrationParseHelpers';
import {
  bindDispatchPayload,
  buildDispatchTargetBinding,
  buildEdgeRunBody,
  extractCreatedRunId,
  extractRunOutputBatch,
  getTeamRouteContext,
  hasTaskProgressed,
  isAdmissionUncertain,
  isEdgeOwnedTask,
  isTerminalBridgeTask,
  isTransientAdmissionRejection,
  normalizeRouteDecision,
  normalizeRuntimeAgentId,
  parseEdgeCallbackOwner,
  parsePermissionDecisionControl,
  permissionDecisionControlKey,
  routeDecisionFromRuntimePayload,
  routeDecisionKey,
  validateDispatchTarget,
  parseDispatchFrame,
} from './hubIntegrationMappers';
import type { AgentTask } from '@/stores/taskBridgeStore';

describe('hubIntegrationParseHelpers', () => {
  it('parseRecord accepts objects, JSON strings, and rejects invalid shapes', () => {
    expect(parseRecord({ a: 1 })).toEqual({ a: 1 });
    expect(parseRecord('{"b":2}')).toEqual({ b: 2 });
    expect(parseRecord('[1]')).toEqual({});
    expect(parseRecord('not-json')).toEqual({});
    expect(parseRecord(null)).toEqual({});
    expect(parseRecord(3)).toEqual({});
  });

  it('compactRecord drops undefined values only', () => {
    expect(compactRecord<{ a?: number; b?: string }>({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('getString / getFirst* helpers coerce legacy payload shapes', () => {
    expect(getString({ name: 'x' }, 'name')).toBe('x');
    expect(getString({ name: 1 }, 'name')).toBe('');
    expect(getFirstString('', '  ', 'ok')).toBe('ok');
    expect(getFirstString(null, undefined)).toBeUndefined();
    expect(getFirstBoolean(null, true, false)).toBe(true);
    expect(getFirstNumber('1', Number.NaN, 2.5)).toBe(2.5);
    expect(boolValue(false)).toBe(false);
    expect(boolValue('true')).toBeUndefined();
  });

  it('parseStringArray and parseStringRecord filter empty values', () => {
    expect(parseStringArray(['a', '', 'b'])).toEqual(['a', 'b']);
    expect(parseStringArray('["x"," "]')).toEqual(['x']);
    expect(parseStringArray('not-json')).toBeUndefined();
    expect(parseStringRecord({ a: '1', b: 2 })).toEqual({ a: '1' });
    expect(parseStringRecord({})).toBeUndefined();
  });
});

describe('hubIntegrationMappers', () => {
  const target = { targetId: 'tgt-1', deviceId: 'dev-1' };

  function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      taskId: 'task-1',
      agentId: 'claude-code',
      prompt: 'hello',
      status: 'running',
      dispatchPayload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('normalizeRouteDecision accepts nested decision and finish shorthand', () => {
    expect(
      normalizeRouteDecision({
        decision: {
          action: 'Delegate',
          nextWorker: 'worker-a',
          correlationId: 'c1',
        },
      }),
    ).toEqual({
      action: 'delegate',
      next_worker: 'worker-a',
      correlation_id: 'c1',
    });

    expect(normalizeRouteDecision({ finish: true, summary: 'done' })).toEqual({
      action: 'finish',
      summary: 'done',
    });
    expect(normalizeRouteDecision({ action: 'nope' })).toBeNull();
  });

  it('routeDecisionFromRuntimePayload prefers structuredOutput over nested keys', () => {
    const decision = routeDecisionFromRuntimePayload({
      structuredOutput: { action: 'review', instructions: 'check' },
      route_decision: { action: 'finish' },
    });
    expect(decision).toEqual({ action: 'review', instructions: 'check' });
  });

  it('getTeamRouteContext reads top-level and model_params nested team context', () => {
    expect(
      getTeamRouteContext(
        makeTask({
          dispatchPayload: {
            team_id: 'team-1',
            team_run_id: 'tr-1',
            team_member_role: 'supervisor',
          },
        }),
      ),
    ).toEqual({ teamId: 'team-1', teamRunId: 'tr-1', teamMemberRole: 'supervisor' });

    expect(
      getTeamRouteContext(
        makeTask({
          dispatchPayload: {
            model_params: {
              agenthub_team_context: {
                teamId: 'team-2',
                teamRunId: 'tr-2',
                teamMemberRole: 'worker',
              },
            },
          },
        }),
      ),
    ).toEqual({ teamId: 'team-2', teamRunId: 'tr-2', teamMemberRole: 'worker' });

    expect(getTeamRouteContext(makeTask())).toBeNull();
  });

  it('routeDecisionKey and permissionDecisionControlKey are stable', () => {
    const key = routeDecisionKey('task-1', {
      action: 'delegate',
      next_worker: 'w',
      correlation_id: 'c',
    });
    expect(key.split('\u001f')).toEqual(['task-1', 'c', 'delegate', 'w', '', '', '']);

    const controlKey = permissionDecisionControlKey({
      runId: 'run-1',
      requestId: 'req-1',
      decision: 'allow',
      reason: 'ok',
    });
    expect(controlKey).toBe(['run-1', 'req-1', 'allow', 'ok'].join('\u001f'));
  });

  it('parsePermissionDecisionControl accepts snake_case and camelCase edge controls', () => {
    expect(
      parsePermissionDecisionControl({
        kind: 'permission.decide',
        edge_control: {
          run_id: 'run-1',
          request_id: 'req-1',
          decision: 'Allow',
          reason: 'yes',
        },
      }),
    ).toEqual({
      runId: 'run-1',
      requestId: 'req-1',
      decision: 'allow',
      reason: 'yes',
    });

    expect(
      parsePermissionDecisionControl({
        kind: 'permission.decide',
        edgeControl: {
          runId: 'run-2',
          requestId: 'req-2',
          decision: 'deny',
        },
      }),
    ).toEqual({
      runId: 'run-2',
      requestId: 'req-2',
      decision: 'deny',
    });

    expect(parsePermissionDecisionControl({ kind: 'other' })).toBeNull();
    expect(
      parsePermissionDecisionControl({
        kind: 'permission.decide',
        edge_control: { runId: 'run-1', decision: 'allow' },
      }),
    ).toBeNull();
  });

  it('validateDispatchTarget and binding helpers enforce target/device match', () => {
    const matched = {
      target_id: 'tgt-1',
      edge_device_id: 'dev-1',
    };
    expect(validateDispatchTarget(matched, target)).toBeNull();
    expect(validateDispatchTarget({ target_id: 'other', edge_device_id: 'dev-1' }, target)).toContain(
      'Dispatch target mismatch',
    );
    expect(validateDispatchTarget(matched, null)).toBeNull();

    const binding = buildDispatchTargetBinding(matched, target);
    expect(binding).toEqual({
      expectedTargetId: 'tgt-1',
      observedTargetId: 'tgt-1',
      expectedEdgeDeviceId: 'dev-1',
      observedEdgeDeviceId: 'dev-1',
      status: 'matched',
    });
    expect(buildDispatchTargetBinding({ targetId: 'x', edgeDeviceId: 'y' }, target)?.status).toBe(
      'mismatch',
    );
    expect(buildDispatchTargetBinding(matched, undefined)).toBeNull();

    const bound = bindDispatchPayload(matched, binding);
    expect(bound.target_binding).toEqual({
      expected_target_id: 'tgt-1',
      observed_target_id: 'tgt-1',
      expected_edge_device_id: 'dev-1',
      observed_edge_device_id: 'dev-1',
      status: 'matched',
    });
    expect(bindDispatchPayload(matched, null)).toBe(matched);
  });

  it('normalizeRuntimeAgentId maps common vendor aliases', () => {
    expect(normalizeRuntimeAgentId('Claude')).toBe('claude-code');
    expect(normalizeRuntimeAgentId('my-claude-code-runner')).toBe('claude-code');
    expect(normalizeRuntimeAgentId('OpenCode')).toBe('opencode');
    expect(normalizeRuntimeAgentId('gpt-4.1')).toBe('codex');
    expect(normalizeRuntimeAgentId('  ')).toBe('');
    expect(normalizeRuntimeAgentId('custom-agent')).toBe('custom-agent');
  });

  it('buildEdgeRunBody maps model_params and target evidence with exact optional fields', () => {
    const body = buildEdgeRunBody(
      {
        task_id: 'task-1',
        model_params: {
          model: 'claude-sonnet',
          reasoning_effort: 'high',
          tool_allowlist: ['Read', ''],
          config_overrides: { foo: 'bar' },
          ephemeral: true,
        },
        system_prompt: 'sys',
      },
      'thread-1',
      'prompt',
      'claude-code',
      {
        expectedTargetId: 'tgt-1',
        observedTargetId: 'tgt-1',
        expectedEdgeDeviceId: 'dev-1',
        observedEdgeDeviceId: 'dev-1',
        status: 'matched',
      },
    );

    expect(body).toMatchObject({
      threadId: 'thread-1',
      prompt: 'prompt',
      agentId: 'claude-code',
      model: 'claude-sonnet',
      reasoningEffort: 'high',
      allowedTools: ['Read'],
      configOverrides: { foo: 'bar' },
      ephemeral: true,
      systemPrompt: 'sys',
      hubTaskId: 'task-1',
      targetId: 'tgt-1',
      edgeDeviceId: 'dev-1',
      dispatchTargetEvidence: {
        expectedTargetId: 'tgt-1',
        observedTargetId: 'tgt-1',
        expectedEdgeDeviceId: 'dev-1',
        observedEdgeDeviceId: 'dev-1',
        targetStatus: 'matched',
      },
    });
    expect(Object.values(body).every((v) => v !== undefined)).toBe(true);
  });

  it('parses persistent callback owner and detects edge-owned tasks', () => {
    expect(parseEdgeCallbackOwner({ id: 'run-a', callbackOwner: 'edge' })).toBe('edge');
    expect(
      parseEdgeCallbackOwner({ code: 'ok', data: { runId: 'run-b', callbackOwner: 'desktop' } }),
    ).toBe('desktop');
    expect(parseEdgeCallbackOwner({ id: 'run-c' })).toBeUndefined();
    expect(parseEdgeCallbackOwner({ id: 'run-d', callback_owner: 'invalid' })).toBeUndefined();

    expect(isEdgeOwnedTask(makeTask({ callbackOwner: 'edge' }))).toBe(true);
    expect(isEdgeOwnedTask(makeTask({ callbackOwner: 'desktop' }))).toBe(false);
    expect(isEdgeOwnedTask(undefined)).toBe(false);
  });

  it('extractRunOutputBatch only joins stdout chunk text', () => {
    expect(
      extractRunOutputBatch({
        stream: 'stdout',
        chunks: [{ text: 'a' }, { text: 'b' }, null, { text: 1 }],
      }),
    ).toBe('ab');
    expect(extractRunOutputBatch({ stream: 'stderr', chunks: [{ text: 'x' }] })).toBe('');
  });

  it('extractCreatedRunId supports envelope and legacy raw run payloads', () => {
    expect(extractCreatedRunId({ id: 'run-a' })).toBe('run-a');
    expect(extractCreatedRunId({ code: 'ok', data: { runId: 'run-b' } })).toBe('run-b');
    expect(() => extractCreatedRunId({ code: 'ok', data: {} })).toThrow(/no id\/runId/);
  });

  it('buildEdgeRunBody forwards deliveryId from snake_case and camelCase aliases, omitting it for legacy', () => {
    const base = { task_id: 'task-1' };
    const snake = buildEdgeRunBody({ ...base, delivery_id: 'd-1' }, 't', 'p', 'a', null);
    expect(snake.deliveryId).toBe('d-1');

    const camel = buildEdgeRunBody({ ...base, deliveryId: 'd-2' }, 't', 'p', 'a', null);
    expect(camel.deliveryId).toBe('d-2');

    const legacy = buildEdgeRunBody({ ...base }, 't', 'p', 'a', null);
    expect(legacy.deliveryId).toBeUndefined();
    expect('deliveryId' in legacy).toBe(false);
  });

  it('extractCreatedRunId accepts a deduplicated accepted run envelope (normal replay)', () => {
    expect(
      extractCreatedRunId({
        code: 'ok',
        data: { runId: 'run-replay-1', deduplicated: true, deliveryId: 'd-1' },
      }),
    ).toBe('run-replay-1');
    expect(
      extractCreatedRunId({
        code: 'ok',
        data: { id: 'run-replay-2', deduplicated: true, deliveryId: 'd-2' },
      }),
    ).toBe('run-replay-2');
  });

  it('classifies transient admission rejections from the canonical Edge error envelope', () => {
    const busyEnvelope = { error: { code: 'delivery_busy', message: 'busy', traceId: 'trace_001' } };
    const activeEnvelope = { error: { code: 'active_run_exists', message: 'active', traceId: 'trace_001' } };
    const capacityEnvelope = { error: { code: 'too_many_concurrent_runs', message: 'capacity', traceId: 'trace_001' } };
    const persistEnvelope = { error: { code: 'admission_persist_failed', message: 'persist failed', traceId: 'trace_001' } };

    expect(isTransientAdmissionRejection(503, busyEnvelope)).toBe(true);
    expect(isTransientAdmissionRejection(409, activeEnvelope)).toBe(true);
    expect(isTransientAdmissionRejection(429, capacityEnvelope)).toBe(true);
    expect(isTransientAdmissionRejection(503, persistEnvelope)).toBe(true);
    // Raw JSON string form (what the hook passes from runResp.text()).
    expect(isTransientAdmissionRejection(503, JSON.stringify(busyEnvelope))).toBe(true);
    expect(isTransientAdmissionRejection(409, JSON.stringify(activeEnvelope))).toBe(true);
    expect(isTransientAdmissionRejection(429, JSON.stringify(capacityEnvelope))).toBe(true);
    expect(isTransientAdmissionRejection(503, JSON.stringify(persistEnvelope))).toBe(true);

    // Non-transient / non-matching envelopes keep the existing failure path.
    expect(isTransientAdmissionRejection(409, { error: { code: 'delivery_conflict', message: 'x', traceId: 't' } })).toBe(false);
    expect(isTransientAdmissionRejection(500, busyEnvelope)).toBe(false);
    expect(isTransientAdmissionRejection(503, { error: { code: 'internal', message: 'x', traceId: 't' } })).toBe(false);
    expect(isTransientAdmissionRejection(503, 'not-json')).toBe(false);
    expect(isTransientAdmissionRejection(200, {})).toBe(false);
    expect(isTransientAdmissionRejection(404, { error: { code: 'too_many_concurrent_runs' } })).toBe(false);
    expect(isTransientAdmissionRejection(429, { error: { code: 'unknown' } })).toBe(false);
    expect(isTransientAdmissionRejection(409, { error: { code: 'admission_uncertain', message: 'manual review', traceId: 't' } })).toBe(false);
    // A flat top-level {code} is not the canonical envelope — must not match.
    expect(isTransientAdmissionRejection(503, { code: 'delivery_busy' })).toBe(false);
  });

  it('keeps admission_uncertain separate from transient rejections', () => {
    const uncertainEnvelope = { error: { code: 'admission_uncertain', message: 'manual review', traceId: 'trace_001' } };
    expect(isTransientAdmissionRejection(409, uncertainEnvelope)).toBe(false);
    expect(isTransientAdmissionRejection(409, JSON.stringify(uncertainEnvelope))).toBe(false);
    expect(isAdmissionUncertain(409, uncertainEnvelope)).toBe(true);
    expect(isAdmissionUncertain(409, JSON.stringify(uncertainEnvelope))).toBe(true);
    expect(isAdmissionUncertain(503, uncertainEnvelope)).toBe(false);
    expect(isAdmissionUncertain(409, { error: { code: 'internal', message: 'x' } })).toBe(false);
    expect(isAdmissionUncertain(409, { code: 'admission_uncertain' })).toBe(false);
  });

  it('isTerminalBridgeTask detects done/failed only', () => {
    expect(isTerminalBridgeTask(makeTask({ status: 'done' }))).toBe(true);
    expect(isTerminalBridgeTask(makeTask({ status: 'failed' }))).toBe(true);
    expect(isTerminalBridgeTask(makeTask({ status: 'running' }))).toBe(false);
  });

  it('hasTaskProgressed is true once a task has a runId or reached running/terminal', () => {
    expect(hasTaskProgressed(undefined)).toBe(false);
    expect(hasTaskProgressed(makeTask({ status: 'queued' }))).toBe(false);
    expect(hasTaskProgressed(makeTask({ status: 'running', runId: 'r1' }))).toBe(true);
    expect(hasTaskProgressed(makeTask({ status: 'done' }))).toBe(true);
    expect(hasTaskProgressed(makeTask({ status: 'failed' }))).toBe(true);
  });
});

describe('parseDispatchFrame', () => {

  it('parses direct dispatch frame (no relay_command_id)', () => {
    const result = parseDispatchFrame({ task_id: 't1', target_id: 'u1', edge_device_id: 'd1' });
    expect(result).not.toBeNull();
    expect(result!.isRelay).toBe(false);
    expect(result!.relayCommandId).toBeNull();
    expect(result!.data.task_id).toBe('t1');
  });

  it('parses relay-wrapped dispatch frame with stringified payload', () => {
    const innerPayload = JSON.stringify({ task_id: 't2', target_id: 'u2', edge_device_id: 'd2', prompt: 'hello' });
    const result = parseDispatchFrame({
      relay_command_id: 'relay_abc',
      command_type: 'agent_dispatch',
      payload: innerPayload,
    });
    expect(result).not.toBeNull();
    expect(result!.isRelay).toBe(true);
    expect(result!.relayCommandId).toBe('relay_abc');
    expect(result!.data.task_id).toBe('t2');
    expect(result!.data.prompt).toBe('hello');
  });

  it('returns null for relay frame with missing inner payload', () => {
    const result = parseDispatchFrame({ relay_command_id: 'relay_xyz' });
    expect(result).toBeNull();
  });

  it('returns null for relay frame with invalid JSON inner payload', () => {
    const result = parseDispatchFrame({ relay_command_id: 'relay_bad', payload: 'not-json' });
    expect(result).toBeNull();
  });

  it('returns null when unwrapped data has no task_id', () => {
    const innerPayload = JSON.stringify({ prompt: 'no task id' });
    const result = parseDispatchFrame({ relay_command_id: 'relay_notask', payload: innerPayload });
    expect(result).toBeNull();
  });

  it('returns null for empty or non-object input', () => {
    expect(parseDispatchFrame({})).toBeNull();
    expect(parseDispatchFrame({ task_id: '' })).toBeNull();
    expect(parseDispatchFrame({ task_id: 123 as unknown as string })).toBeNull();
  });
});

