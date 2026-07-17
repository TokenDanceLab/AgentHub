import { describe, expect, it } from 'vitest';
import type { AgentConfig } from './pages/AgentsPage';
import { buildWorkbenchProfileSources } from './workbenchProfileSources';

const agent: AgentConfig = {
  id: 'agent-1',
  name: 'Builder',
  role: 'coder',
  engine: 'codex',
  model: 'gpt-5',
  mode: 'medium',
  approval: 'ask',
  scope: 'workspace-write',
  state: 'ready',
  skills: [],
  tools: {},
};

describe('workbenchProfileSources', () => {
  it('tags agents and members with profile kinds', () => {
    const sources = buildWorkbenchProfileSources(
      [agent],
      [{ id: 'u1', name: 'Alice', role: 'member' }],
    );

    expect(sources).toEqual([
      expect.objectContaining({ id: 'agent-1', name: 'Builder', kind: 'agent' }),
      expect.objectContaining({ id: 'u1', name: 'Alice', kind: 'user' }),
    ]);
  });
});
