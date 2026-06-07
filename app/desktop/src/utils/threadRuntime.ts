import type { AgentInfo } from '@shared/types';
import type { ChatMessage } from '@shared/types/chat';

const STOP_TOKENS = new Set(['agent', 'adapter', 'code', 'local', 'runtime']);

function tokensFor(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_TOKENS.has(token));
}

function agentTokens(agent: AgentInfo): string[] {
  return Array.from(new Set([
    ...tokensFor(agent.id),
    ...tokensFor(agent.name),
    ...tokensFor(agent.runtimeId),
    ...tokensFor(agent.provider),
  ]));
}

export function inferAgentIdFromThreadMessages(messages: ChatMessage[], agents: AgentInfo[]): string | null {
  const candidates = agents
    .map((agent) => ({ agent, tokens: agentTokens(agent) }))
    .filter((candidate) => candidate.tokens.length > 0);

  for (const message of [...messages].reverse()) {
    if (message.role !== 'agent' || !message.agentName) continue;
    const display = message.agentName.toLowerCase();
    const match = candidates.find((candidate) =>
      candidate.tokens.some((token) => display.includes(token)),
    );
    if (match) return match.agent.id;
  }
  return null;
}
