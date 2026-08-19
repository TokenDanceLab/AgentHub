// real_tested=true
import { describe, expect, it } from 'vitest';
import {
  buildAddAgentTeamMemberRequest,
  buildCreateAgentProfileRequest,
  buildCreateAgentTeamRequest,
  buildCreateDocumentRequest,
  buildDecideTeamApprovalRequest,
  buildDeleteAgentProfileRequest,
  buildDeleteAgentTeamRequest,
  buildDeleteDocumentRequest,
  buildPostTeamRouteDecisionRequest,
  buildRemoveAgentTeamMemberRequest,
  buildResolveTeamConflictRequest,
  buildStartTeamRunRequest,
  buildUpdateAgentProfileRequest,
  buildUpdateAgentTeamRequest,
  buildUpdateDocumentRequest,
} from './hubClientPayloadRequestsTeams';

// ── buildCreateAgentTeamRequest ─────────────────────────────────────

describe('buildCreateAgentTeamRequest', () => {
  it('builds a POST request against the agent-teams collection with a JSON body', () => {
    const request = buildCreateAgentTeamRequest({ name: 'Atlas', description: 'primary team' });

    expect(request.path).toBe('/web/agent-teams');
    expect(request.init).toEqual({
      method: 'POST',
      body: '{"name":"Atlas","description":"primary team"}',
    });
  });

  it('preserves nested objects, arrays, and unicode without extra escaping', () => {
    const request = buildCreateAgentTeamRequest({
      name: 'héllo wörld',
      members: [{ id: 'm-1', role: 'leader' }],
      tags: ['a/b', 'c&d'],
    });

    expect(request.init.body).toBe(
      '{"name":"héllo wörld","members":[{"id":"m-1","role":"leader"}],"tags":["a/b","c&d"]}',
    );
  });

  it('keeps the body key with an undefined value when data is undefined', () => {
    const request = buildCreateAgentTeamRequest(undefined);

    expect(request.init.method).toBe('POST');
    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });

  it('serializes null, strings, numbers, and booleans via JSON.stringify semantics', () => {
    expect(buildCreateAgentTeamRequest(null).init.body).toBe('null');
    expect(buildCreateAgentTeamRequest('draft').init.body).toBe('"draft"');
    expect(buildCreateAgentTeamRequest('').init.body).toBe('""');
    expect(buildCreateAgentTeamRequest(0).init.body).toBe('0');
    expect(buildCreateAgentTeamRequest(-1.5).init.body).toBe('-1.5');
    expect(buildCreateAgentTeamRequest(true).init.body).toBe('true');
    expect(buildCreateAgentTeamRequest([1, 'two']).init.body).toBe('[1,"two"]');
  });

  it('returns a fresh request and init object on every call', () => {
    const first = buildCreateAgentTeamRequest({ name: 'a' });
    const second = buildCreateAgentTeamRequest({ name: 'b' });

    expect(first).not.toBe(second);
    expect(first.init).not.toBe(second.init);
    expect(first.init.body).not.toBe(second.init.body);

    first.init.method = 'PUT';
    expect(second.init.method).toBe('POST');
  });
});

// ── buildUpdateAgentTeamRequest ─────────────────────────────────────

describe('buildUpdateAgentTeamRequest', () => {
  it('builds a PUT request scoped to the team id with a JSON body', () => {
    const request = buildUpdateAgentTeamRequest('team-1', { name: 'Renamed' });

    expect(request.path).toBe('/web/agent-teams/team-1');
    expect(request.init).toEqual({ method: 'PUT', body: '{"name":"Renamed"}' });
  });

  it('percent-encodes team ids with spaces, slashes, and unicode', () => {
    const request = buildUpdateAgentTeamRequest('team 1/2 é', {});

    expect(request.path).toBe('/web/agent-teams/team%201%2F2%20%C3%A9');
  });

  it('accepts an empty team id, producing a trailing slash', () => {
    const request = buildUpdateAgentTeamRequest('', {});

    expect(request.path).toBe('/web/agent-teams/');
  });

  it('keeps the body key with an undefined value for undefined data', () => {
    const request = buildUpdateAgentTeamRequest('team-1', undefined);

    expect(request.init.method).toBe('PUT');
    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildAddAgentTeamMemberRequest ──────────────────────────────────

describe('buildAddAgentTeamMemberRequest', () => {
  it('builds a POST request against the team members collection', () => {
    const request = buildAddAgentTeamMemberRequest('team-1', { agent_id: 'agent-9' });

    expect(request.path).toBe('/web/agent-teams/team-1/members');
    expect(request.init).toEqual({ method: 'POST', body: '{"agent_id":"agent-9"}' });
  });

  it('percent-encodes the team id in the path', () => {
    expect(buildAddAgentTeamMemberRequest('a b/c', {}).path).toBe(
      '/web/agent-teams/a%20b%2Fc/members',
    );
  });

  it('serializes an empty object body as "{}"', () => {
    expect(buildAddAgentTeamMemberRequest('team-1', {}).init.body).toBe('{}');
  });
});

// ── buildStartTeamRunRequest ────────────────────────────────────────

describe('buildStartTeamRunRequest', () => {
  it('builds a POST request against the team runs collection', () => {
    const request = buildStartTeamRunRequest('team-1', { prompt: 'go' });

    expect(request.path).toBe('/web/agent-teams/team-1/runs');
    expect(request.init).toEqual({ method: 'POST', body: '{"prompt":"go"}' });
  });

  it('percent-encodes the team id in the path', () => {
    expect(buildStartTeamRunRequest('team x?', {}).path).toBe('/web/agent-teams/team%20x%3F/runs');
  });

  it('keeps the body key with an undefined value when data is undefined', () => {
    const request = buildStartTeamRunRequest('team-1', undefined);

    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildDecideTeamApprovalRequest ──────────────────────────────────

describe('buildDecideTeamApprovalRequest', () => {
  it('builds a POST request to the approval decide endpoint', () => {
    const request = buildDecideTeamApprovalRequest('team-1', 'run-2', 'ap-3', {
      decision: 'approve',
    });

    expect(request.path).toBe('/web/agent-teams/team-1/runs/run-2/approvals/ap-3/decide');
    expect(request.init).toEqual({ method: 'POST', body: '{"decision":"approve"}' });
  });

  it('percent-encodes team, run, and approval ids independently', () => {
    const request = buildDecideTeamApprovalRequest('t 1', 'r/2', 'a?3', true);

    expect(request.path).toBe(
      '/web/agent-teams/t%201/runs/r%2F2/approvals/a%3F3/decide',
    );
  });

  it('serializes a null decision as the string "null"', () => {
    const request = buildDecideTeamApprovalRequest('team-1', 'run-2', 'ap-3', null);

    expect(request.init.body).toBe('null');
  });

  it('keeps the body key with an undefined value for an undefined decision', () => {
    const request = buildDecideTeamApprovalRequest('team-1', 'run-2', 'ap-3', undefined);

    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildResolveTeamConflictRequest ─────────────────────────────────

describe('buildResolveTeamConflictRequest', () => {
  it('builds a POST request to the conflict resolve endpoint', () => {
    const request = buildResolveTeamConflictRequest('team-1', 'run-2', 'cf-3', {
      choice: 'keep-a',
    });

    expect(request.path).toBe('/web/agent-teams/team-1/runs/run-2/conflicts/cf-3/resolve');
    expect(request.init).toEqual({ method: 'POST', body: '{"choice":"keep-a"}' });
  });

  it('percent-encodes team, run, and conflict ids independently', () => {
    const request = buildResolveTeamConflictRequest('t 1', 'r#2', 'c&3', 'x');

    expect(request.path).toBe(
      '/web/agent-teams/t%201/runs/r%232/conflicts/c%263/resolve',
    );
  });

  it('serializes a null resolution as the string "null"', () => {
    const request = buildResolveTeamConflictRequest('team-1', 'run-2', 'cf-3', null);

    expect(request.init.body).toBe('null');
  });
});

// ── buildCreateAgentProfileRequest ──────────────────────────────────

describe('buildCreateAgentProfileRequest', () => {
  it('builds a POST request against the agent-profiles collection', () => {
    const request = buildCreateAgentProfileRequest({ runtime_id: 'rt-1', name: 'Profile A' });

    expect(request.path).toBe('/web/agent-profiles');
    expect(request.init).toEqual({
      method: 'POST',
      body: '{"runtime_id":"rt-1","name":"Profile A"}',
    });
  });

  it('keeps the body key with an undefined value for undefined data', () => {
    const request = buildCreateAgentProfileRequest(undefined);

    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildUpdateAgentProfileRequest ──────────────────────────────────

describe('buildUpdateAgentProfileRequest', () => {
  it('builds a PATCH request scoped to the profile id', () => {
    const request = buildUpdateAgentProfileRequest('prof-1', { name: 'Updated' });

    expect(request.path).toBe('/web/agent-profiles/prof-1');
    expect(request.init).toEqual({ method: 'PATCH', body: '{"name":"Updated"}' });
  });

  it('percent-encodes profile ids in the path', () => {
    expect(buildUpdateAgentProfileRequest('p 1/2', {}).path).toBe(
      '/web/agent-profiles/p%201%2F2',
    );
  });

  it('serializes a null payload as the string "null"', () => {
    expect(buildUpdateAgentProfileRequest('prof-1', null).init.body).toBe('null');
  });
});

// ── buildCreateDocumentRequest ──────────────────────────────────────

describe('buildCreateDocumentRequest', () => {
  it('builds a POST request against the documents collection', () => {
    const request = buildCreateDocumentRequest({ title: 'Notes', content: 'hello' });

    expect(request.path).toBe('/web/documents');
    expect(request.init).toEqual({
      method: 'POST',
      body: '{"title":"Notes","content":"hello"}',
    });
  });

  it('serializes an empty object body as "{}"', () => {
    expect(buildCreateDocumentRequest({}).init.body).toBe('{}');
  });
});

// ── buildUpdateDocumentRequest ──────────────────────────────────────

describe('buildUpdateDocumentRequest', () => {
  it('builds a PATCH request scoped to the document id', () => {
    const request = buildUpdateDocumentRequest('doc-1', { title: 'Renamed' });

    expect(request.path).toBe('/web/documents/doc-1');
    expect(request.init).toEqual({ method: 'PATCH', body: '{"title":"Renamed"}' });
  });

  it('percent-encodes document ids in the path', () => {
    expect(buildUpdateDocumentRequest('d 1/2', {}).path).toBe('/web/documents/d%201%2F2');
  });

  it('keeps the body key with an undefined value for undefined data', () => {
    const request = buildUpdateDocumentRequest('doc-1', undefined);

    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildRemoveAgentTeamMemberRequest ───────────────────────────────

describe('buildRemoveAgentTeamMemberRequest', () => {
  it('builds a bodyless DELETE request against the member resource', () => {
    const request = buildRemoveAgentTeamMemberRequest('team-1', 'm-9');

    expect(request.path).toBe('/web/agent-teams/team-1/members/m-9');
    expect(request.init).toEqual({ method: 'DELETE' });
    expect('body' in request.init).toBe(false);
  });

  it('percent-encodes team and member ids independently', () => {
    const request = buildRemoveAgentTeamMemberRequest('t 1', 'm/9');

    expect(request.path).toBe('/web/agent-teams/t%201/members/m%2F9');
  });

  it('accepts an empty member id, producing a trailing slash', () => {
    expect(buildRemoveAgentTeamMemberRequest('team-1', '').path).toBe(
      '/web/agent-teams/team-1/members/',
    );
  });
});

// ── buildPostTeamRouteDecisionRequest ───────────────────────────────

describe('buildPostTeamRouteDecisionRequest', () => {
  it('builds a POST request to the route-decisions endpoint', () => {
    const request = buildPostTeamRouteDecisionRequest('team-1', 'run-2', {
      route: 'continue',
    });

    expect(request.path).toBe('/web/agent-teams/team-1/runs/run-2/route-decisions');
    expect(request.init).toEqual({ method: 'POST', body: '{"route":"continue"}' });
  });

  it('percent-encodes team and run ids in the path', () => {
    const request = buildPostTeamRouteDecisionRequest('t 1', 'r/2', 'x');

    expect(request.path).toBe('/web/agent-teams/t%201/runs/r%2F2/route-decisions');
  });

  it('keeps the body key with an undefined value for an undefined decision', () => {
    const request = buildPostTeamRouteDecisionRequest('team-1', 'run-2', undefined);

    expect('body' in request.init).toBe(true);
    expect(request.init.body).toBeUndefined();
  });
});

// ── buildDeleteAgentTeamRequest ─────────────────────────────────────

describe('buildDeleteAgentTeamRequest', () => {
  it('builds a bodyless DELETE request scoped to the team id', () => {
    const request = buildDeleteAgentTeamRequest('team-1');

    expect(request.path).toBe('/web/agent-teams/team-1');
    expect(request.init).toEqual({ method: 'DELETE' });
    expect('body' in request.init).toBe(false);
  });

  it('percent-encodes the team id in the path', () => {
    expect(buildDeleteAgentTeamRequest('t 1/2').path).toBe('/web/agent-teams/t%201%2F2');
  });

  it('accepts an empty team id, producing a trailing slash', () => {
    expect(buildDeleteAgentTeamRequest('').path).toBe('/web/agent-teams/');
  });
});

// ── buildDeleteAgentProfileRequest ──────────────────────────────────

describe('buildDeleteAgentProfileRequest', () => {
  it('builds a bodyless DELETE request scoped to the profile id', () => {
    const request = buildDeleteAgentProfileRequest('prof-1');

    expect(request.path).toBe('/web/agent-profiles/prof-1');
    expect(request.init).toEqual({ method: 'DELETE' });
    expect('body' in request.init).toBe(false);
  });

  it('percent-encodes the profile id in the path', () => {
    expect(buildDeleteAgentProfileRequest('p 1/2').path).toBe('/web/agent-profiles/p%201%2F2');
  });
});

// ── buildDeleteDocumentRequest ──────────────────────────────────────

describe('buildDeleteDocumentRequest', () => {
  it('builds a bodyless DELETE request scoped to the document id', () => {
    const request = buildDeleteDocumentRequest('doc-1');

    expect(request.path).toBe('/web/documents/doc-1');
    expect(request.init).toEqual({ method: 'DELETE' });
    expect('body' in request.init).toBe(false);
  });

  it('percent-encodes the document id in the path', () => {
    expect(buildDeleteDocumentRequest('d 1/2').path).toBe('/web/documents/d%201%2F2');
  });
});
