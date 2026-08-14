export type WorkbenchProfileKind = 'user' | 'agent';

export interface WorkbenchProfileSource {
  id?: string;
  name: string;
  initials?: string;
  kind?: WorkbenchProfileKind;
  role?: string;
  engine?: string;
  model?: string;
  state?: string;
}

export interface ResolvedWorkbenchProfile {
  id: string;
  name: string;
  initials: string;
  kind: WorkbenchProfileKind;
  color: string;
  label: string;
}

const AGENT_NAME_HINTS = new Set([
  'builder',
  'researcher',
  'reviewer',
  'orchestrator',
  'codex',
  'deployer',
  'browser qa',
  'docs librarian',
  'security',
  'data',
]);

export function workbenchProfileInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return trimmed.slice(0, 1).toUpperCase();
}

export function workbenchAgentColor(profile: Pick<WorkbenchProfileSource, 'id' | 'name'>): string {
  const key = `${profile.id ?? ''} ${profile.name}`.toLowerCase();
  if (key.includes('builder')) return 'var(--role-builder)';
  if (key.includes('reviewer')) return 'var(--role-reviewer)';
  if (key.includes('researcher')) return 'var(--role-researcher)';
  if (key.includes('orchestrator')) return 'var(--role-orchestrator)';
  if (key.includes('deployer') || key.includes('release')) return 'var(--role-deployer)';
  if (key.includes('security')) return 'var(--td-danger)';
  if (key.includes('browser')) return 'var(--role-deployer)';
  if (key.includes('data')) return 'var(--td-warning)';
  return 'var(--td-plum)';
}

export function isWorkbenchAgentName(name: string, agents: WorkbenchProfileSource[] = []): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (AGENT_NAME_HINTS.has(normalized)) return true;
  return agents.some((agent) => (
    agent.name.trim().toLowerCase() === normalized
    || agent.id?.trim().toLowerCase() === normalized
  ));
}

export function resolveWorkbenchProfile(
  name: string,
  agents: WorkbenchProfileSource[] = [],
): ResolvedWorkbenchProfile {
  const agent = agents.find((item) => {
    const normalized = name.trim().toLowerCase();
    return item.name.trim().toLowerCase() === normalized || item.id?.trim().toLowerCase() === normalized;
  });
  const displayName = (agent?.name ?? name.trim()) || 'Unknown';
  const kind = agent?.kind ?? (agent || isWorkbenchAgentName(displayName, agents) ? 'agent' : 'user');

  return {
    id: agent?.id ?? displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: displayName,
    initials: agent?.initials ?? workbenchProfileInitials(displayName),
    kind,
    color: kind === 'agent' ? workbenchAgentColor(agent ?? { name: displayName }) : 'var(--surface-highest)',
    label: kind === 'agent' ? 'Agent' : 'User',
  };
}
