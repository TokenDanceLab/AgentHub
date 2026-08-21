import { describe, expect, it } from 'vitest';
import {
  isWorkbenchAgentName,
  resolveWorkbenchProfile,
  workbenchAgentColor,
  workbenchProfileInitials,
  type WorkbenchProfileSource,
} from './profileRegistry';

describe('workbenchProfileInitials', () => {
  it('returns U for empty or whitespace-only names', () => {
    expect(workbenchProfileInitials('')).toBe('U');
    expect(workbenchProfileInitials('   ')).toBe('U');
  });

  it('returns the first letter uppercased for a single word', () => {
    expect(workbenchProfileInitials('alice')).toBe('A');
    expect(workbenchProfileInitials('Bob')).toBe('B');
  });

  it('returns the first two initials for multi-word names', () => {
    expect(workbenchProfileInitials('alice smith')).toBe('AS');
    expect(workbenchProfileInitials('bob jones')).toBe('BJ');
  });

  it('uses only the first two words when there are more', () => {
    expect(workbenchProfileInitials('alice bob carol')).toBe('AB');
  });

  it('collapses runs of whitespace between words', () => {
    expect(workbenchProfileInitials('alice    smith')).toBe('AS');
  });
});

describe('workbenchAgentColor', () => {
  it.each([
    ['builder', 'var(--role-builder)'],
    ['reviewer', 'var(--role-reviewer)'],
    ['researcher', 'var(--role-researcher)'],
    ['orchestrator', 'var(--role-orchestrator)'],
    ['deployer', 'var(--role-deployer)'],
    ['release', 'var(--role-deployer)'],
    ['security', 'var(--td-danger)'],
    ['browser', 'var(--role-deployer)'],
    ['data', 'var(--td-warning)'],
  ])('maps %s to %s', (name, expected) => {
    expect(workbenchAgentColor({ name })).toBe(expected);
  });

  it('falls back to the plum token for unknown names', () => {
    expect(workbenchAgentColor({ name: 'someone-else' })).toBe('var(--td-plum)');
  });

  it('matches case-insensitively and considers id as well as name', () => {
    expect(workbenchAgentColor({ name: 'My Builder' })).toBe('var(--role-builder)');
    expect(workbenchAgentColor({ id: 'agent-reviewer', name: 'x' })).toBe('var(--role-reviewer)');
  });

  it('treats a missing id safely', () => {
    expect(workbenchAgentColor({ name: 'Data Bot' })).toBe('var(--td-warning)');
  });
});

describe('isWorkbenchAgentName', () => {
  it('matches the built-in agent hint set case-insensitively', () => {
    expect(isWorkbenchAgentName('builder')).toBe(true);
    expect(isWorkbenchAgentName('Orchestrator')).toBe(true);
    expect(isWorkbenchAgentName('  reviewer  ')).toBe(true);
  });

  it('matches a provided agent by name or id', () => {
    const agents: WorkbenchProfileSource[] = [
      { id: 'agent-1', name: 'Custom Agent' },
    ];
    expect(isWorkbenchAgentName('custom agent', agents)).toBe(true);
    expect(isWorkbenchAgentName('agent-1', agents)).toBe(true);
    expect(isWorkbenchAgentName('CUSTOM AGENT', agents)).toBe(true);
  });

  it('returns false for empty or unknown names', () => {
    expect(isWorkbenchAgentName('')).toBe(false);
    expect(isWorkbenchAgentName('   ')).toBe(false);
    expect(isWorkbenchAgentName('alice')).toBe(false);
  });
});

describe('resolveWorkbenchProfile', () => {
  const agents: WorkbenchProfileSource[] = [
    { id: 'agent-builder', name: 'Builder', kind: 'agent', initials: 'BD' },
    { id: 'agent-researcher', name: 'Researcher' },
  ];

  it('resolves a known agent by name, preserving id and initials', () => {
    const profile = resolveWorkbenchProfile('Builder', agents);
    expect(profile).toMatchObject({
      id: 'agent-builder',
      name: 'Builder',
      initials: 'BD',
      kind: 'agent',
      label: 'Agent',
    });
    expect(profile.color).toBe('var(--role-builder)');
  });

  it('resolves a known agent by id', () => {
    const profile = resolveWorkbenchProfile('agent-researcher', agents);
    expect(profile.id).toBe('agent-researcher');
    expect(profile.name).toBe('Researcher');
    expect(profile.kind).toBe('agent');
  });

  it('classifies a hint-matched name as an agent even without a registry entry', () => {
    const profile = resolveWorkbenchProfile('orchestrator', []);
    expect(profile.kind).toBe('agent');
    expect(profile.label).toBe('Agent');
  });

  it('classifies an unknown human name as a user', () => {
    const profile = resolveWorkbenchProfile('Alice Smith', []);
    expect(profile.kind).toBe('user');
    expect(profile.label).toBe('User');
    expect(profile.color).toBe('var(--surface-highest)');
    expect(profile.initials).toBe('AS');
  });

  it('derives a slug id from the display name when no agent id exists', () => {
    // Non-alphanumeric runs collapse to a single dash in the generated id.
    const profile = resolveWorkbenchProfile('Alice & Bob', []);
    expect(profile.id).toBe('alice-bob');
  });

  it('falls back to Unknown for an empty name', () => {
    const profile = resolveWorkbenchProfile('', []);
    expect(profile.name).toBe('Unknown');
    expect(profile.kind).toBe('user');
  });
});
