import type { AgentConfig } from './pages/AgentsPage';
import type { WorkbenchProfileSource } from './profileRegistry';

export interface WorkbenchProfileMemberSource {
  id?: string | undefined;
  name: string;
  initials?: string | undefined;
  role?: string | undefined;
  engine?: string | undefined;
  model?: string | undefined;
  state?: string | undefined;
}

/** Merge agent configs + contact members into Workbench profile sources. */
export function buildWorkbenchProfileSources(
  agentConfigs: AgentConfig[],
  members: WorkbenchProfileMemberSource[],
): WorkbenchProfileSource[] {
  const agents: WorkbenchProfileSource[] = agentConfigs.map((agent) => {
    const source: WorkbenchProfileSource = {
      kind: 'agent',
      id: agent.id,
      name: agent.name,
      role: agent.role,
      engine: agent.engine,
      model: agent.model,
      state: agent.state,
    };
    return source;
  });

  const users: WorkbenchProfileSource[] = members.map((member) => {
    // Build without spreading `?: T | undefined` fields — exactOptionalPropertyTypes
    // rejects assigning `string | undefined` into `id?: string`.
    const source: WorkbenchProfileSource = {
      kind: 'user',
      name: member.name,
    };
    if (member.id !== undefined) source.id = member.id;
    if (member.initials !== undefined) source.initials = member.initials;
    if (member.role !== undefined) source.role = member.role;
    if (member.engine !== undefined) source.engine = member.engine;
    if (member.model !== undefined) source.model = member.model;
    if (member.state !== undefined) source.state = member.state;
    return source;
  });

  return [...agents, ...users];
}
