// Conversation goal derivation (#1998, UX F8).
// Fixtures use the REAL external shapes: tool_call events exactly as the
// Edge adapters emit them (callId/toolName/input/status) normalized through
// the shared toolCallBlock mapper — the same pipeline real conversations
// flow through. Negative inputs are real shapes too (unknown tool names,
// missing arguments), never mirrors of the implementation.
import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@shared/events';
import type { TranscriptBlock } from '@shared/transcript';
import { toolCallBlock } from '@shared/transcript/edgeEventMappersTools';
import { normalizeHubRuntimeEventsToTranscript } from '@shared/transcript';
import { GOAL_TOOL_NAMES, deriveGoalSummary } from './workbenchGoalSummary';

let seq = 0;

function textBlock(id: string, text: string): TranscriptBlock {
  return { id, kind: 'text', author: { id: 'user', name: 'User', role: 'human' }, text };
}

/** Adapter-shaped tool_call event → transcript block through the real mapper. */
function goalEventBlock(
  toolName: string,
  input: Record<string, unknown> | undefined,
  overrides: { status?: string; createdAt?: string } = {},
): TranscriptBlock {
  seq += 1;
  const event: EventEnvelope = {
    version: 'v1',
    id: `evt-goal-${seq}`,
    seq,
    type: 'run.agent.tool_call',
    scope: { threadId: 'thread-goal', runId: 'run-goal' },
    sentAt: overrides.createdAt ?? `2026-08-28T02:00:${String(seq).padStart(2, '0')}Z`,
    payload: {
      callId: `call-goal-${seq}`,
      toolName,
      status: overrides.status ?? 'completed',
      ...(input !== undefined ? { input } : {}),
    },
  };
  const block = toolCallBlock(event);
  if (!block) throw new Error('fixture event failed to normalize');
  return block;
}

describe('deriveGoalSummary (#1998)', () => {
  it('derives nothing from an empty transcript', () => {
    expect(deriveGoalSummary([])).toBeUndefined();
    expect(deriveGoalSummary(undefined)).toBeUndefined();
  });

  it('derives nothing when the conversation has no goal tool calls', () => {
    const transcript: TranscriptBlock[] = [
      textBlock('tb-1', 'Refactor the API client layer'),
      goalEventBlock('Read', { path: 'src/api/client.ts' }),
      goalEventBlock('Grep', { query: 'fetch(' }),
    ];
    expect(deriveGoalSummary(transcript)).toBeUndefined();
  });

  it('derives an active goal from a create_goal call', () => {
    const transcript: TranscriptBlock[] = [
      textBlock('tb-1', 'Ship the migration'),
      goalEventBlock(GOAL_TOOL_NAMES.createGoal, {
        objective: 'Migrate every endpoint to the typed client',
        token_budget: 120000,
      }),
      goalEventBlock('Read', { path: 'src/api/endpoints/users.ts' }),
    ];
    expect(deriveGoalSummary(transcript)).toEqual({
      objective: 'Migrate every endpoint to the typed client',
      status: 'active',
      sourceBlockId: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('transitions the status on a recognized update_goal call', () => {
    const create = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Close the release' });
    const complete = goalEventBlock(GOAL_TOOL_NAMES.updateGoal, { status: 'complete' });
    expect(deriveGoalSummary([create, complete])).toMatchObject({
      objective: 'Close the release',
      status: 'completed',
    });

    const create2 = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Fix the flaky suite' });
    const blocked = goalEventBlock(GOAL_TOOL_NAMES.updateGoal, { status: 'blocked' });
    expect(deriveGoalSummary([create2, blocked])).toMatchObject({
      objective: 'Fix the flaky suite',
      status: 'blocked',
    });
  });

  it('tracks updatedAt to the newest goal tool call', () => {
    const create = goalEventBlock(
      GOAL_TOOL_NAMES.createGoal,
      { objective: 'Objective' },
      { createdAt: '2026-08-28T01:00:00Z' },
    );
    const update = goalEventBlock(
      GOAL_TOOL_NAMES.updateGoal,
      { status: 'blocked' },
      { createdAt: '2026-08-28T03:30:00Z' },
    );
    expect(deriveGoalSummary([create, update])?.updatedAt).toBe('2026-08-28T03:30:00Z');
  });

  it('fails closed on unknown tool vocabulary', () => {
    // Plausible-looking goal tools from other runtimes are not in the SSOT
    // vocabulary — they must not render a banner (no guessing).
    const transcript: TranscriptBlock[] = [
      goalEventBlock('goal_create', { objective: 'Not recognized' }),
      goalEventBlock('Create_Goal', { objective: 'Case mismatch' }),
      goalEventBlock('set_goal', { objective: 'Different verb' }),
      goalEventBlock('mcp__goals__create_goal', { objective: 'MCP namespaced' }),
    ];
    expect(deriveGoalSummary(transcript)).toBeUndefined();
  });

  it('fails closed when the objective text is not derivable', () => {
    // Real adapter shape: create_goal without any scalar text the transcript
    // can quote (input dropped/empty, no summary, no target).
    expect(deriveGoalSummary([goalEventBlock(GOAL_TOOL_NAMES.createGoal, {})])).toBeUndefined();
    expect(deriveGoalSummary([goalEventBlock(GOAL_TOOL_NAMES.createGoal, undefined)])).toBeUndefined();
    expect(
      deriveGoalSummary([goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: '   ' })]),
    ).toBeUndefined();
  });

  it('ignores a failed create_goal call', () => {
    const failed = goalEventBlock(
      GOAL_TOOL_NAMES.createGoal,
      { objective: 'Rejected objective' },
      { status: 'failed' },
    );
    expect(deriveGoalSummary([failed])).toBeUndefined();
  });

  it('ignores update_goal calls that carry no recognized status argument', () => {
    const create = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Keep shipping' });
    // Unknown status vocabulary ('paused' has no Hub channel) and missing
    // arguments both leave the goal untouched — never guessed.
    const transcript = [
      create,
      goalEventBlock(GOAL_TOOL_NAMES.updateGoal, { status: 'paused' }),
      goalEventBlock(GOAL_TOOL_NAMES.updateGoal, {}),
      goalEventBlock(GOAL_TOOL_NAMES.updateGoal, undefined),
    ];
    expect(deriveGoalSummary(transcript)).toMatchObject({ status: 'active' });
  });

  it('ignores a failed update_goal call', () => {
    const create = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Stay active' });
    const failedUpdate = goalEventBlock(
      GOAL_TOOL_NAMES.updateGoal,
      { status: 'complete' },
      { status: 'failed' },
    );
    expect(deriveGoalSummary([create, failedUpdate])).toMatchObject({ status: 'active' });
  });

  it('ignores update_goal before any create_goal', () => {
    const transcript: TranscriptBlock[] = [
      goalEventBlock(GOAL_TOOL_NAMES.updateGoal, { status: 'complete' }),
      goalEventBlock('Read', { path: 'a.ts' }),
    ];
    expect(deriveGoalSummary(transcript)).toBeUndefined();
  });

  it('re-establishes a fresh goal on a later create_goal call', () => {
    const first = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'First objective' });
    const done = goalEventBlock(GOAL_TOOL_NAMES.updateGoal, { status: 'complete' });
    const second = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Second objective' });
    expect(deriveGoalSummary([first, done, second])).toMatchObject({
      objective: 'Second objective',
      status: 'active',
    });
  });

  it('keeps the previous goal when a later creation fails', () => {
    const first = goalEventBlock(GOAL_TOOL_NAMES.createGoal, { objective: 'Established objective' });
    const failedSecond = goalEventBlock(
      GOAL_TOOL_NAMES.createGoal,
      { objective: 'Rejected replacement' },
      { status: 'failed' },
    );
    expect(deriveGoalSummary([first, failedSecond])).toMatchObject({
      objective: 'Established objective',
      status: 'active',
    });
  });

  it('falls back to summary/target text when the input projection is absent', () => {
    // Legacy mapper shapes (hand-replayed transcripts) may carry the goal
    // text as summary/target instead of the scalar input projection.
    const withSummary: TranscriptBlock[] = [
      {
        id: 'tc-legacy-1',
        kind: 'tool_call',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        toolName: GOAL_TOOL_NAMES.createGoal,
        status: 'completed',
        summary: 'Legacy summary objective',
      },
    ];
    expect(deriveGoalSummary(withSummary)?.objective).toBe('Legacy summary objective');

    const withTarget: TranscriptBlock[] = [
      {
        id: 'tc-legacy-2',
        kind: 'tool_call',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        toolName: GOAL_TOOL_NAMES.createGoal,
        status: 'completed',
        target: 'Legacy target objective',
      },
    ];
    expect(deriveGoalSummary(withTarget)?.objective).toBe('Legacy target objective');
  });
});

describe('hub runtime replay pipeline (#1998)', () => {
  it('derives the goal from Hub-persisted runtime events end to end', () => {
    // The exact envelope shape /web/agent-tasks/<id>/events returns for a
    // Codex goal tool call (web approved-real replay path).
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-hub-1',
        task_id: 'task-hub',
        edge_run_id: 'run-hub',
        session_id: 'session-hub',
        agent_instance_id: 'agent-builder',
        agent_label: 'Builder',
        event_seq: 1,
        event_type: 'run.agent.tool_call',
        payload: {
          callId: 'call-hub-1',
          toolName: GOAL_TOOL_NAMES.createGoal,
          status: 'completed',
          input: { objective: 'Close the release blockers' },
        },
        created_at: '2026-08-28T03:00:01Z',
      },
    ]);
    expect(deriveGoalSummary(blocks)).toMatchObject({
      objective: 'Close the release blockers',
      status: 'active',
    });
  });
});
