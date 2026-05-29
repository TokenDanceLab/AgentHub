import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@shared/types';
import type { ChatMessage } from '@/components/ChatView.types';
import { inferAgentIdFromThreadMessages } from '@/utils/threadRuntime';

const agents: AgentInfo[] = [
  {
    id: 'codex',
    name: 'Codex',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: false,
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: false,
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: false,
    },
  },
];

function agentMessage(agentName: string, id = agentName): ChatMessage {
  return {
    id,
    role: 'agent',
    agentName,
    timestamp: new Date().toISOString(),
    blocks: [{ kind: 'text', content: 'ok' }],
  };
}

describe('inferAgentIdFromThreadMessages', () => {
  it('recovers Claude Code from replayed Claude model labels', () => {
    expect(inferAgentIdFromThreadMessages([
      agentMessage('claude-opus-4-7[1M][1m]'),
    ], agents)).toBe('claude-code');
  });

  it('uses the latest matching agent message for the thread runtime', () => {
    expect(inferAgentIdFromThreadMessages([
      agentMessage('claude-opus-4-7', 'old'),
      agentMessage('gpt-5-codex', 'new'),
    ], agents)).toBe('codex');
  });

  it('does not match generic code/runtime wording without a runtime token', () => {
    expect(inferAgentIdFromThreadMessages([
      agentMessage('local code runtime'),
    ], agents)).toBeNull();
  });
});
