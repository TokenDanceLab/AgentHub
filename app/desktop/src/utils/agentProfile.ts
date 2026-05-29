import type { AgentInfo } from '@shared/types';

export function preferredProfileAlias(agent?: AgentInfo) {
  if (!agent) return undefined;
  if (agent.model) return agent.model;
  const id = `${agent.id} ${agent.name}`.toLowerCase();
  if (id.includes('claude')) return 'opus[1m]';
  if (id.includes('codex')) return 'gpt-5.5';
  if (id.includes('opencode') || id.includes('open-code')) return 'newapi/deepseek-v4-pro';
  return undefined;
}
