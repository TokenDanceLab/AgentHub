import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEdgeRunBody,
  normalizeRuntimeAgentId,
  type DispatchTargetBindingEvidence,
  type EdgeRunRequestBody,
} from './hubIntegrationMappers';

interface ExecutionIntentFixtureCase {
  name: string;
  payload: Record<string, unknown>;
  expectedIntent: Record<string, unknown>;
}

interface ExecutionIntentFixture {
  version: number;
  cases: ExecutionIntentFixtureCase[];
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../tests/fixtures/dispatch/execution-intent.json'), 'utf8'),
) as ExecutionIntentFixture;

const binding: DispatchTargetBindingEvidence = {
  expectedTargetId: 'target-fixture',
  observedTargetId: 'target-fixture',
  expectedEdgeDeviceId: 'device-fixture',
  observedEdgeDeviceId: 'device-fixture',
  status: 'matched',
};

type IntentOnlyBody = Omit<
  EdgeRunRequestBody,
  'threadId' | 'projectId' | 'targetId' | 'edgeDeviceId' | 'dispatchTargetEvidence' | 'callbackOwner'
>;

function stripTransportOnly(body: EdgeRunRequestBody): IntentOnlyBody {
  const intent = { ...body };
  delete intent.threadId;
  delete intent.projectId;
  delete intent.targetId;
  delete intent.edgeDeviceId;
  delete intent.dispatchTargetEvidence;
  delete intent.callbackOwner;
  return intent;
}

describe('Desktop Hub execution intent safe integer projection', () => {
  it('falls back to the next safe integer alias while preserving zero and negative values', () => {
    const decimal = buildEdgeRunBody(
      { model_params: JSON.stringify({ max_thinking_tokens: 1.5, maxThinkingTokens: 42 }) },
      '',
      'p',
      'codex',
      null,
    );
    expect(decimal.maxThinkingTokens).toBe(42);

    const overflow = buildEdgeRunBody(
      { model_params: JSON.stringify({ max_thinking_tokens: Number.MAX_SAFE_INTEGER + 1, maxThinkingTokens: -3 }) },
      '',
      'p',
      'codex',
      null,
    );
    expect(overflow.maxThinkingTokens).toBe(-3);

    const zero = buildEdgeRunBody(
      { model_params: JSON.stringify({ max_thinking_tokens: 0 }) },
      '',
      'p',
      'codex',
      null,
    );
    expect(zero.maxThinkingTokens).toBe(0);
  });
});

describe('Desktop Hub execution intent projection', () => {
  for (const fixtureCase of fixture.cases) {
    it(fixtureCase.name, () => {
      const payload = fixtureCase.payload;
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      const rawAgentId = typeof payload.agent_type === 'string' ? payload.agent_type : '';
      const body = buildEdgeRunBody(
        payload,
        '',
        prompt,
        normalizeRuntimeAgentId(rawAgentId),
        binding,
      );
      const intent = stripTransportOnly(body);

      expect(intent).toEqual(fixtureCase.expectedIntent);

      const actualSchema = intent.structuredOutputSchema;
      const expectedSchema = fixtureCase.expectedIntent.structuredOutputSchema;
      if (typeof actualSchema === 'string' && typeof expectedSchema === 'string') {
        expect(JSON.parse(actualSchema)).toEqual(JSON.parse(expectedSchema));
      }
    });
  }
});
