import type { AgentInfo } from '@shared/types';

export function preferredProfileAlias(agent?: AgentInfo) {
  if (!agent) return undefined;
  const id = `${agent.id} ${agent.name}`.toLowerCase();
  if (id.includes('claude')) return 'opus';
  if (id.includes('codex')) return 'sonnet';
  if (id.includes('opencode') || id.includes('open-code')) return 'haiku';
  return undefined;
}
