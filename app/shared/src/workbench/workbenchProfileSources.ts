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
  return [
    ...agentConfigs.map((agent) => ({ ...agent, kind: 'agent' as const })),
    ...members.map((member) => ({ ...member, kind: 'user' as const })),
  ];
}
