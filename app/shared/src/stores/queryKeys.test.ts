// real_tested=true
import { describe, expect, it } from 'vitest';
import { edgeQueryKeys, hubQueryKeys, isQueryKeyPrefix, rootPrefix } from './queryKeys';

// ── hubQueryKeys: auth ──────────────────────────────────────────────

describe('hubQueryKeys.auth', () => {
  it('defines the stable user key', () => {
    expect(hubQueryKeys.auth.user).toEqual(['hub', 'auth', 'user']);
  });

  it('builds a profile key from a user id', () => {
    expect(hubQueryKeys.auth.profile('user-1')).toEqual(['hub', 'auth', 'profile', 'user-1']);
  });
});

// ── hubQueryKeys: threads ───────────────────────────────────────────

describe('hubQueryKeys.threads', () => {
  it('defines the threads root', () => {
    expect(hubQueryKeys.threads.root).toEqual(['hub', 'threads']);
  });

  it('collapses missing, undefined, and empty-string projectId to the root key', () => {
    expect(hubQueryKeys.threads.all()).toEqual(hubQueryKeys.threads.root);
    expect(hubQueryKeys.threads.all(undefined)).toEqual(hubQueryKeys.threads.root);
    expect(hubQueryKeys.threads.all('')).toEqual(hubQueryKeys.threads.root);
  });

  it('builds an all() key scoped to a project', () => {
    expect(hubQueryKeys.threads.all('project-1')).toEqual(['hub', 'threads', 'project-1']);
  });

  it('builds a detail key from a thread id', () => {
    expect(hubQueryKeys.threads.detail('thread-1')).toEqual(['hub', 'threads', 'detail', 'thread-1']);
  });

  it('builds a messages key from a thread id', () => {
    expect(hubQueryKeys.threads.messages('thread-1')).toEqual(['hub', 'threads', 'thread-1', 'messages']);
  });

  it('builds a pins key from a thread id', () => {
    expect(hubQueryKeys.threads.pins('thread-1')).toEqual(['hub', 'threads', 'thread-1', 'pins']);
  });
});

// ── hubQueryKeys: agents ────────────────────────────────────────────

describe('hubQueryKeys.agents', () => {
  it('defines the agents root', () => {
    expect(hubQueryKeys.agents.root).toEqual(['hub', 'agents']);
  });

  it('defaults the list context to hub', () => {
    expect(hubQueryKeys.agents.list()).toEqual(['hub', 'agents', 'hub']);
  });

  it('supports the signed-out list context', () => {
    expect(hubQueryKeys.agents.list('signed-out')).toEqual(['hub', 'agents', 'signed-out']);
  });

  it('builds a detail key from an agent id', () => {
    expect(hubQueryKeys.agents.detail('agent-1')).toEqual(['hub', 'agents', 'detail', 'agent-1']);
  });
});

// ── hubQueryKeys: agentTeams ────────────────────────────────────────

describe('hubQueryKeys.agentTeams', () => {
  it('defines the agent-teams root', () => {
    expect(hubQueryKeys.agentTeams.root).toEqual(['hub', 'agent-teams']);
  });

  it('defaults the list context to hub', () => {
    expect(hubQueryKeys.agentTeams.list()).toEqual(['hub', 'agent-teams', 'hub']);
  });

  it('supports the signed-out list context', () => {
    expect(hubQueryKeys.agentTeams.list('signed-out')).toEqual(['hub', 'agent-teams', 'signed-out']);
  });

  it('builds a detail key from a team id', () => {
    expect(hubQueryKeys.agentTeams.detail('team-1')).toEqual(['hub', 'agent-teams', 'detail', 'team-1']);
  });

  it('builds a runs key from a team id', () => {
    expect(hubQueryKeys.agentTeams.runs('team-1')).toEqual(['hub', 'agent-teams', 'team-1', 'runs']);
  });

  it('builds a runDetail key from a team id and run id', () => {
    expect(hubQueryKeys.agentTeams.runDetail('team-1', 'run-1')).toEqual([
      'hub',
      'agent-teams',
      'team-1',
      'runs',
      'run-1',
    ]);
  });

  it('builds a runState key from a team id and run id', () => {
    expect(hubQueryKeys.agentTeams.runState('team-1', 'run-1')).toEqual([
      'hub',
      'agent-teams',
      'team-1',
      'runs',
      'run-1',
      'state',
    ]);
  });

  it('builds a runEvents key from a team id and run id', () => {
    expect(hubQueryKeys.agentTeams.runEvents('team-1', 'run-1')).toEqual([
      'hub',
      'agent-teams',
      'team-1',
      'runs',
      'run-1',
      'events',
    ]);
  });

  it('builds a runTasks key from a team id and run id', () => {
    expect(hubQueryKeys.agentTeams.runTasks('team-1', 'run-1')).toEqual([
      'hub',
      'agent-teams',
      'team-1',
      'runs',
      'run-1',
      'tasks',
    ]);
  });
});

// ── hubQueryKeys: projects ──────────────────────────────────────────

describe('hubQueryKeys.projects', () => {
  it('defines the projects root', () => {
    expect(hubQueryKeys.projects.root).toEqual(['hub', 'projects']);
  });

  it('defaults the list context to hub', () => {
    expect(hubQueryKeys.projects.list()).toEqual(['hub', 'projects', 'hub']);
  });

  it('supports the signed-out list context', () => {
    expect(hubQueryKeys.projects.list('signed-out')).toEqual(['hub', 'projects', 'signed-out']);
  });

  it('builds a detail key from a project id', () => {
    expect(hubQueryKeys.projects.detail('project-1')).toEqual(['hub', 'projects', 'project-1']);
  });

  it('builds a threads key from a project id', () => {
    expect(hubQueryKeys.projects.threads('project-1')).toEqual(['hub', 'projects', 'project-1', 'threads']);
  });

  it('builds a threadMessages key from a project id and thread id', () => {
    expect(hubQueryKeys.projects.threadMessages('project-1', 'thread-1')).toEqual([
      'hub',
      'projects',
      'project-1',
      'threads',
      'thread-1',
      'messages',
    ]);
  });
});

// ── hubQueryKeys: executionTargets ──────────────────────────────────

describe('hubQueryKeys.executionTargets', () => {
  it('defines the execution-targets root', () => {
    expect(hubQueryKeys.executionTargets.root).toEqual(['hub', 'execution-targets']);
  });

  it('defaults the list context to hub', () => {
    expect(hubQueryKeys.executionTargets.list()).toEqual(['hub', 'execution-targets', 'hub']);
  });

  it('supports the signed-out list context', () => {
    expect(hubQueryKeys.executionTargets.list('signed-out')).toEqual(['hub', 'execution-targets', 'signed-out']);
  });

  it('builds a detail key from a target id', () => {
    expect(hubQueryKeys.executionTargets.detail('target-1')).toEqual([
      'hub',
      'execution-targets',
      'detail',
      'target-1',
    ]);
  });
});

// ── hubQueryKeys: contacts ──────────────────────────────────────────

describe('hubQueryKeys.contacts', () => {
  it('defines the contacts root', () => {
    expect(hubQueryKeys.contacts.root).toEqual(['hub', 'contacts']);
  });

  it('defines the contacts list key', () => {
    expect(hubQueryKeys.contacts.list).toEqual(['hub', 'contacts', 'list']);
  });

  it('defines the friend-requests key', () => {
    expect(hubQueryKeys.contacts.friendRequests).toEqual(['hub', 'contacts', 'friend-requests']);
  });
});

// ── hubQueryKeys: notifications ─────────────────────────────────────

describe('hubQueryKeys.notifications', () => {
  it('defines the notifications root', () => {
    expect(hubQueryKeys.notifications.root).toEqual(['hub', 'notifications']);
  });

  it('defaults the list key to all notifications', () => {
    expect(hubQueryKeys.notifications.list()).toEqual(['hub', 'notifications', 'all']);
    expect(hubQueryKeys.notifications.list(undefined)).toEqual(['hub', 'notifications', 'all']);
  });

  it('keeps the all key for explicit false', () => {
    expect(hubQueryKeys.notifications.list(false)).toEqual(['hub', 'notifications', 'all']);
  });

  it('builds the unread key for explicit true', () => {
    expect(hubQueryKeys.notifications.list(true)).toEqual(['hub', 'notifications', 'unread']);
  });
});

// ── hubQueryKeys: customAgents ──────────────────────────────────────

describe('hubQueryKeys.customAgents', () => {
  it('defines the custom-agents root', () => {
    expect(hubQueryKeys.customAgents.root).toEqual(['hub', 'custom-agents']);
  });

  it('defines the custom-agents list key', () => {
    expect(hubQueryKeys.customAgents.list).toEqual(['hub', 'custom-agents', 'list']);
  });
});

// ── hubQueryKeys: catalog ───────────────────────────────────────────

describe('hubQueryKeys.catalog', () => {
  it('defines the skills catalog key', () => {
    expect(hubQueryKeys.catalog.skills).toEqual(['hub', 'catalog', 'skills']);
  });

  it('defines the MCP servers catalog key', () => {
    expect(hubQueryKeys.catalog.mcpServers).toEqual(['hub', 'catalog', 'mcp-servers']);
  });
});

// ── hubQueryKeys: auditEvents ───────────────────────────────────────

describe('hubQueryKeys.auditEvents', () => {
  it('defines the audit-events root', () => {
    expect(hubQueryKeys.auditEvents.root).toEqual(['hub', 'audit-events']);
  });
});

// ── hubQueryKeys: relayCommands ─────────────────────────────────────

describe('hubQueryKeys.relayCommands', () => {
  it('defines the relay-commands root', () => {
    expect(hubQueryKeys.relayCommands.root).toEqual(['hub', 'relay-commands']);
  });

  it('builds a detail key from a command id', () => {
    expect(hubQueryKeys.relayCommands.detail('command-1')).toEqual(['hub', 'relay-commands', 'command-1']);
  });
});

// ── hubQueryKeys: runs ──────────────────────────────────────────────

describe('hubQueryKeys.runs', () => {
  it('defines the runs root', () => {
    expect(hubQueryKeys.runs.root).toEqual(['hub', 'runs']);
  });

  it('collapses the all() key to the root when no ids are given', () => {
    expect(hubQueryKeys.runs.all()).toEqual(hubQueryKeys.runs.root);
    expect(hubQueryKeys.runs.all(undefined, undefined)).toEqual(hubQueryKeys.runs.root);
  });

  it('pads the threadId slot with an empty string when only projectId is given', () => {
    expect(hubQueryKeys.runs.all('project-1')).toEqual(['hub', 'runs', 'project-1', '']);
  });

  it('pads the projectId slot with an empty string when only threadId is given', () => {
    expect(hubQueryKeys.runs.all(undefined, 'thread-1')).toEqual(['hub', 'runs', '', 'thread-1']);
  });

  it('builds the all() key for both projectId and threadId', () => {
    expect(hubQueryKeys.runs.all('project-1', 'thread-1')).toEqual(['hub', 'runs', 'project-1', 'thread-1']);
  });

  it('treats empty-string ids as absent and falls back to the root', () => {
    expect(hubQueryKeys.runs.all('', '')).toEqual(hubQueryKeys.runs.root);
    expect(hubQueryKeys.runs.all('', undefined)).toEqual(hubQueryKeys.runs.root);
  });

  it('builds a detail key from a run id', () => {
    expect(hubQueryKeys.runs.detail('run-1')).toEqual(['hub', 'runs', 'detail', 'run-1']);
  });
});

// ── edgeQueryKeys: threads ──────────────────────────────────────────

describe('edgeQueryKeys.threads', () => {
  it('defines the threads root', () => {
    expect(edgeQueryKeys.threads.root).toEqual(['edge', 'threads']);
  });

  it('collapses missing, undefined, and empty-string projectId to the root key', () => {
    expect(edgeQueryKeys.threads.all()).toEqual(edgeQueryKeys.threads.root);
    expect(edgeQueryKeys.threads.all(undefined)).toEqual(edgeQueryKeys.threads.root);
    expect(edgeQueryKeys.threads.all('')).toEqual(edgeQueryKeys.threads.root);
  });

  it('builds an all() key scoped to a project', () => {
    expect(edgeQueryKeys.threads.all('project-1')).toEqual(['edge', 'threads', 'project-1']);
  });

  it('builds an items key with an undefined threadId when omitted', () => {
    expect(edgeQueryKeys.threads.items()).toEqual(['edge', 'threadItems', undefined]);
  });

  it('builds an items key from a thread id', () => {
    expect(edgeQueryKeys.threads.items('thread-1')).toEqual(['edge', 'threadItems', 'thread-1']);
  });

  it('builds a pins key from a thread id', () => {
    expect(edgeQueryKeys.threads.pins('thread-1')).toEqual(['edge', 'threadPins', 'thread-1']);
  });

  it('builds a pins key for a null thread id', () => {
    expect(edgeQueryKeys.threads.pins(null)).toEqual(['edge', 'threadPins', null]);
  });
});

// ── edgeQueryKeys: runs ─────────────────────────────────────────────

describe('edgeQueryKeys.runs', () => {
  it('defines the runs root', () => {
    expect(edgeQueryKeys.runs.root).toEqual(['edge', 'runs']);
  });

  it('keeps undefined slots when no ids are given', () => {
    expect(edgeQueryKeys.runs.all()).toEqual(['edge', 'runs', undefined, undefined]);
  });

  it('fills only the projectId slot when only projectId is given', () => {
    expect(edgeQueryKeys.runs.all('project-1')).toEqual(['edge', 'runs', 'project-1', undefined]);
  });

  it('builds the all() key for both projectId and threadId', () => {
    expect(edgeQueryKeys.runs.all('project-1', 'thread-1')).toEqual(['edge', 'runs', 'project-1', 'thread-1']);
  });
});

// ── edgeQueryKeys: agents ───────────────────────────────────────────

describe('edgeQueryKeys.agents', () => {
  it('defines the agents root', () => {
    expect(edgeQueryKeys.agents.root).toEqual(['edge', 'agents']);
  });

  it('defines the agents list key', () => {
    expect(edgeQueryKeys.agents.list).toEqual(['edge', 'agents', 'list']);
  });
});

// ── edgeQueryKeys: runners ──────────────────────────────────────────

describe('edgeQueryKeys.runners', () => {
  it('defines the runners root', () => {
    expect(edgeQueryKeys.runners.root).toEqual(['edge', 'runners']);
  });

  it('defines the runners list key', () => {
    expect(edgeQueryKeys.runners.list).toEqual(['edge', 'runners', 'list']);
  });

  it('builds a detail key from a runner id', () => {
    expect(edgeQueryKeys.runners.detail('runner-1')).toEqual(['edge', 'runners', 'runner-1']);
  });
});

// ── edgeQueryKeys: health / currentUser ─────────────────────────────

describe('edgeQueryKeys.health', () => {
  it('defines the health root', () => {
    expect(edgeQueryKeys.health.root).toEqual(['edge', 'health']);
  });
});

describe('edgeQueryKeys.currentUser', () => {
  it('defines the currentUser root', () => {
    expect(edgeQueryKeys.currentUser.root).toEqual(['edge', 'currentUser']);
  });
});

// ── isQueryKeyPrefix ────────────────────────────────────────────────

describe('isQueryKeyPrefix', () => {
  it('returns true when the candidate equals the prefix', () => {
    expect(isQueryKeyPrefix(['hub', 'threads'], ['hub', 'threads'])).toBe(true);
  });

  it('returns true when the prefix matches the head of a longer candidate', () => {
    expect(isQueryKeyPrefix(['hub', 'threads', 'thread-1', 'messages'], ['hub', 'threads'])).toBe(true);
  });

  it('returns false when the prefix is longer than the candidate', () => {
    expect(isQueryKeyPrefix(['hub', 'threads'], ['hub', 'threads', 'detail'])).toBe(false);
  });

  it('returns false when a middle segment mismatches', () => {
    expect(isQueryKeyPrefix(['hub', 'agents', 'agent-1'], ['hub', 'threads'])).toBe(false);
  });

  it('returns false when only the first segment matches', () => {
    expect(isQueryKeyPrefix(['hub', 'agents'], ['hub', 'threads'])).toBe(false);
  });

  it('accepts an empty prefix for any candidate', () => {
    expect(isQueryKeyPrefix(['anything'], [])).toBe(true);
    expect(isQueryKeyPrefix([], [])).toBe(true);
  });

  it('rejects a non-empty prefix for an empty candidate', () => {
    expect(isQueryKeyPrefix([], ['hub'])).toBe(false);
  });

  it('compares segments strictly, without type coercion', () => {
    expect(isQueryKeyPrefix([1, 'a'], [1])).toBe(true);
    expect(isQueryKeyPrefix([1, 'a'], ['1'])).toBe(false);
    expect(isQueryKeyPrefix(['1', 'a'], [1])).toBe(false);
  });

  it('treats null and undefined as distinct segments', () => {
    expect(isQueryKeyPrefix([null, 'x'], [null])).toBe(true);
    expect(isQueryKeyPrefix([undefined, 'x'], [undefined])).toBe(true);
    expect(isQueryKeyPrefix([null], [undefined])).toBe(false);
  });

  it('matches real keys against their hub roots for invalidation', () => {
    expect(isQueryKeyPrefix(hubQueryKeys.threads.detail('thread-1'), hubQueryKeys.threads.root)).toBe(true);
    expect(isQueryKeyPrefix(hubQueryKeys.threads.messages('thread-1'), hubQueryKeys.threads.root)).toBe(true);
    expect(isQueryKeyPrefix(hubQueryKeys.agentTeams.runState('team-1', 'run-1'), hubQueryKeys.agentTeams.root)).toBe(
      true,
    );
    expect(isQueryKeyPrefix(hubQueryKeys.runs.detail('run-1'), hubQueryKeys.runs.root)).toBe(true);
    expect(isQueryKeyPrefix(hubQueryKeys.projects.threadMessages('project-1', 'thread-1'), hubQueryKeys.projects.root)).toBe(
      true,
    );
    expect(isQueryKeyPrefix(hubQueryKeys.relayCommands.detail('command-1'), hubQueryKeys.relayCommands.root)).toBe(true);
  });

  it('does not cross-match hub and edge keys', () => {
    expect(isQueryKeyPrefix(edgeQueryKeys.threads.root, hubQueryKeys.threads.root)).toBe(false);
    expect(isQueryKeyPrefix(hubQueryKeys.threads.root, edgeQueryKeys.threads.root)).toBe(false);
  });
});

// ── rootPrefix ──────────────────────────────────────────────────────

describe('rootPrefix', () => {
  it('returns the same empty array for an empty key', () => {
    const emptyKey: readonly unknown[] = [];
    expect(rootPrefix(emptyKey)).toBe(emptyKey);
  });

  it('returns the same single-segment key unchanged', () => {
    const singleKey = ['hub'] as const;
    expect(rootPrefix(singleKey)).toBe(singleKey);
  });

  it('returns the same two-segment key unchanged', () => {
    const twoSegmentKey = ['hub', 'threads'] as const;
    expect(rootPrefix(twoSegmentKey)).toBe(twoSegmentKey);
  });

  it('returns a fresh array with the first two segments for longer keys', () => {
    const longKey = ['hub', 'threads', 'thread-1', 'messages'] as const;
    const prefix = rootPrefix(longKey);
    expect(prefix).toEqual(['hub', 'threads']);
    expect(prefix).not.toBe(longKey);
  });

  it('derives the broad invalidation prefix from hub detail keys', () => {
    expect(rootPrefix(hubQueryKeys.threads.messages('thread-1'))).toEqual(['hub', 'threads']);
    expect(rootPrefix(hubQueryKeys.agentTeams.runState('team-1', 'run-1'))).toEqual(['hub', 'agent-teams']);
    expect(rootPrefix(hubQueryKeys.runs.detail('run-1'))).toEqual(['hub', 'runs']);
  });

  it('derives the broad invalidation prefix from edge keys', () => {
    expect(rootPrefix(edgeQueryKeys.threads.pins('thread-1'))).toEqual(['edge', 'threadPins']);
    expect(rootPrefix(edgeQueryKeys.threads.items())).toEqual(['edge', 'threadItems']);
    expect(rootPrefix(edgeQueryKeys.runs.all('project-1'))).toEqual(['edge', 'runs']);
  });
});
