// real_tested=true
import { describe, expect, it } from 'vitest';

import { createHubClientExtendedApi } from './hubClientApiExtended';

interface RecordedRequestCall {
  path: string;
  init?: RequestInit;
}

interface RecordedUploadCall {
  path: string;
  formData: FormData;
}

const DEFAULT_BASE_URL = 'https://hub.example.test';

function createHarness(overrides?: {
  baseUrl?: string;
  requestImpl?: (path: string, init?: RequestInit) => Promise<unknown>;
  uploadImpl?: (path: string, formData: FormData) => Promise<unknown>;
}) {
  const requestCalls: RecordedRequestCall[] = [];
  const uploadCalls: RecordedUploadCall[] = [];

  async function fakeRequest<T>(path: string, init?: RequestInit): Promise<T> {
    requestCalls.push({ path, init });
    if (overrides?.requestImpl) {
      return (await overrides.requestImpl(path, init)) as T;
    }
    return {} as T;
  }

  async function fakeUploadMultipart<T>(path: string, formData: FormData): Promise<T> {
    uploadCalls.push({ path, formData });
    if (overrides?.uploadImpl) {
      return (await overrides.uploadImpl(path, formData)) as T;
    }
    return {} as T;
  }

  const api = createHubClientExtendedApi({
    request: fakeRequest,
    uploadMultipart: fakeUploadMultipart,
    baseUrl: overrides?.baseUrl ?? DEFAULT_BASE_URL,
  });

  return { api, requestCalls, uploadCalls };
}

describe('createHubClientExtendedApi', () => {
  describe('workspace projects', () => {
    it('lists workspace projects with optional query params', async () => {
      const { api, requestCalls } = createHarness();

      await api.listWorkspaceProjects();
      await api.listWorkspaceProjects(undefined);
      await api.listWorkspaceProjects({});
      await api.listWorkspaceProjects({
        pageSize: 25,
        pageCursor: 'cursor/1',
        q: 'demo project',
      });
      await api.listWorkspaceProjects({ pageSize: 0, q: '' });

      expect(requestCalls).toHaveLength(5);
      expect(requestCalls[0]?.path).toBe('/web/projects');
      expect(requestCalls[0]?.init).toBeUndefined();
      expect(requestCalls[1]?.path).toBe('/web/projects');
      expect(requestCalls[2]?.path).toBe('/web/projects');
      expect(requestCalls[3]?.path).toBe(
        '/web/projects?pageSize=25&pageCursor=cursor%2F1&q=demo+project',
      );
      expect(requestCalls[4]?.path).toBe('/web/projects?pageSize=0&q=');
    });

    it('gets a workspace project by encoded id, including empty ids', async () => {
      const { api, requestCalls } = createHarness();

      await api.getWorkspaceProject('p/1');
      await api.getWorkspaceProject('');

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1');
      expect(requestCalls[0]?.init).toBeUndefined();
      expect(requestCalls[1]?.path).toBe('/web/projects/');
    });

    it('creates a workspace project via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.createWorkspaceProject({ name: 'Alpha', description: 'first project' });
      await api.createWorkspaceProject({ name: 'Only' });

      expect(requestCalls[0]?.path).toBe('/web/projects');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ name: 'Alpha', description: 'first project' }),
      });
      expect(requestCalls[1]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ name: 'Only' }),
      });
    });

    it('updates a workspace project via JSON PATCH', async () => {
      const { api, requestCalls } = createHarness();

      await api.updateWorkspaceProject('p/1', { name: 'Renamed' });

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      });
    });

    it('lists workspace project threads', async () => {
      const { api, requestCalls } = createHarness();

      await api.listWorkspaceProjectThreads('p/1');

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1/threads');
      expect(requestCalls[0]?.init).toBeUndefined();
    });

    it('creates a workspace project thread via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.createWorkspaceProjectThread('p/1', { name: 'Thread A' });

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1/threads');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ name: 'Thread A' }),
      });
    });

    it('lists thread messages with optional limit', async () => {
      const { api, requestCalls } = createHarness();

      await api.listWorkspaceProjectThreadMessages('p/1', 'th/2');
      await api.listWorkspaceProjectThreadMessages('p/1', 'th/2', { limit: 20 });
      await api.listWorkspaceProjectThreadMessages('p/1', 'th/2', { limit: undefined });
      await api.listWorkspaceProjectThreadMessages('p/1', 'th/2', { limit: 0 });

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1/threads/th%2F2/messages');
      expect(requestCalls[1]?.path).toBe(
        '/web/projects/p%2F1/threads/th%2F2/messages?limit=20',
      );
      expect(requestCalls[2]?.path).toBe('/web/projects/p%2F1/threads/th%2F2/messages');
      expect(requestCalls[3]?.path).toBe(
        '/web/projects/p%2F1/threads/th%2F2/messages?limit=0',
      );
    });

    it('sends a workspace project thread message via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.sendWorkspaceProjectThreadMessage('p/1', 'th/2', {
        client_msg_id: 'client/9',
        content_type: 'text',
        content: 'hello team',
      });

      expect(requestCalls[0]?.path).toBe('/web/projects/p%2F1/threads/th%2F2/messages');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({
          client_msg_id: 'client/9',
          content_type: 'text',
          content: 'hello team',
        }),
      });
    });
  });

  describe('message extras (T3.2 parity)', () => {
    it('edits a message via JSON PUT', async () => {
      const { api, requestCalls } = createHarness();

      await api.editMessage('msg/1', { content: 'edited content' });

      expect(requestCalls[0]?.path).toBe('/client/messages/msg%2F1');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PUT',
        body: JSON.stringify({ content: 'edited content' }),
      });
    });

    it('adds a message reaction via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.addMessageReaction('msg/1', 'sess/2', { emoji: '👍' });

      expect(requestCalls[0]?.path).toBe('/client/messages/msg%2F1/reactions');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess/2', emoji: '👍' }),
      });
    });

    it('removes a message reaction via JSON DELETE', async () => {
      const { api, requestCalls } = createHarness();

      await api.removeMessageReaction('msg/1', 'sess/2', { emoji: '👍' });

      expect(requestCalls[0]?.path).toBe('/client/messages/msg%2F1/reactions');
      expect(requestCalls[0]?.init).toEqual({
        method: 'DELETE',
        body: JSON.stringify({ session_id: 'sess/2', emoji: '👍' }),
      });
    });

    it('lists message reactions with the session id query param', async () => {
      const { api, requestCalls } = createHarness();

      await api.listMessageReactions('msg/1', 'sess/2');

      expect(requestCalls[0]?.path).toBe(
        '/client/messages/msg%2F1/reactions?session_id=sess%2F2',
      );
      expect(requestCalls[0]?.init).toBeUndefined();
    });

    it('fetches task run summaries, full event lists, and gap-fill events', async () => {
      const { api, requestCalls } = createHarness();

      await api.getTaskRunEventSummary('task/1');
      await api.listTaskRunEvents('task/1');
      await api.listTaskRunEventsAfter('task/1', 7);
      await api.listTaskRunEventsAfter('task/1', 0);
      await api.listTaskRunEventsAfter('task/1', -3);
      await api.listTaskRunEventsAfter('task/1', 9007199254740991);

      expect(requestCalls[0]?.path).toBe('/web/agent-tasks/task%2F1/events/summary');
      expect(requestCalls[1]?.path).toBe('/web/agent-tasks/task%2F1/events');
      expect(requestCalls[2]?.path).toBe(
        '/web/agent-tasks/task%2F1/events?after_seq=7&limit=500',
      );
      expect(requestCalls[3]?.path).toBe(
        '/web/agent-tasks/task%2F1/events?after_seq=0&limit=500',
      );
      expect(requestCalls[4]?.path).toBe(
        '/web/agent-tasks/task%2F1/events?after_seq=-3&limit=500',
      );
      expect(requestCalls[5]?.path).toBe(
        '/web/agent-tasks/task%2F1/events?after_seq=9007199254740991&limit=500',
      );
    });
  });

  describe('agent teams', () => {
    it('creates an agent team via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.createAgentTeam({ name: 'Team X', description: 'ship it' });

      expect(requestCalls[0]?.path).toBe('/web/agent-teams');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ name: 'Team X', description: 'ship it' }),
      });
    });

    it('lists all agent teams', async () => {
      const { api, requestCalls } = createHarness();

      await api.listAgentTeams();

      expect(requestCalls[0]?.path).toBe('/web/agent-teams');
      expect(requestCalls[0]?.init).toBeUndefined();
    });

    it('gets an agent team by encoded id', async () => {
      const { api, requestCalls } = createHarness();

      await api.getAgentTeam('team/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1');
    });

    it('updates an agent team via JSON PUT', async () => {
      const { api, requestCalls } = createHarness();

      await api.updateAgentTeam('team/1', { name: 'Renamed', description: 'new' });

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PUT',
        body: JSON.stringify({ name: 'Renamed', description: 'new' }),
      });
    });

    it('deletes an agent team with a bodyless DELETE init', async () => {
      const { api, requestCalls } = createHarness();

      await api.deleteAgentTeam('team/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1');
      expect(requestCalls[0]?.init).toEqual({ method: 'DELETE' });
    });

    it('adds an agent team member via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.addAgentTeamMember('team/1', { agent_profile_id: 'profile/9', role: 'executor' });

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1/members');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ agent_profile_id: 'profile/9', role: 'executor' }),
      });
    });

    it('starts a team run with and without an optional target', async () => {
      const { api, requestCalls } = createHarness();

      await api.startTeamRun('team/1', { trigger_message: 'go', target_id: 'doc/5' });
      await api.startTeamRun('team/1', { trigger_message: 'go' });

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1/runs');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ trigger_message: 'go', target_id: 'doc/5' }),
      });
      expect(requestCalls[1]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ trigger_message: 'go' }),
      });
    });

    it('lists team runs', async () => {
      const { api, requestCalls } = createHarness();

      await api.listTeamRuns('team/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1/runs');
    });

    it('gets team run details, state, events, and tasks', async () => {
      const { api, requestCalls } = createHarness();

      await api.getTeamRun('team/1', 'run/2');
      await api.getTeamRunState('team/1', 'run/2');
      await api.listTeamEvents('team/1', 'run/2');
      await api.listTeamTasks('team/1', 'run/2');

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1/runs/run%2F2');
      expect(requestCalls[1]?.path).toBe('/web/agent-teams/team%2F1/runs/run%2F2/state');
      expect(requestCalls[2]?.path).toBe('/web/agent-teams/team%2F1/runs/run%2F2/events');
      expect(requestCalls[3]?.path).toBe('/web/agent-teams/team%2F1/runs/run%2F2/tasks');
    });

    it('decides a team approval via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.decideTeamApproval('team/1', 'run/2', 'approval/3', {
        decision: 'allow',
        reason: 'looks good',
      });
      await api.decideTeamApproval('team/1', 'run/2', 'approval/3', { decision: 'deny' });

      expect(requestCalls[0]?.path).toBe(
        '/web/agent-teams/team%2F1/runs/run%2F2/approvals/approval%2F3/decide',
      );
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ decision: 'allow', reason: 'looks good' }),
      });
      expect(requestCalls[1]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ decision: 'deny' }),
      });
    });

    it('resolves a team conflict via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.resolveTeamConflict('team/1', 'run/2', 'conflict/3', {
        resolution: 'pick-a',
        path: 'a',
      });

      expect(requestCalls[0]?.path).toBe(
        '/web/agent-teams/team%2F1/runs/run%2F2/conflicts/conflict%2F3/resolve',
      );
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ resolution: 'pick-a', path: 'a' }),
      });
    });

    it('removes an agent team member via bodyless DELETE', async () => {
      const { api, requestCalls } = createHarness();

      await api.removeAgentTeamMember('team/1', 'member/9');

      expect(requestCalls[0]?.path).toBe('/web/agent-teams/team%2F1/members/member%2F9');
      expect(requestCalls[0]?.init).toEqual({ method: 'DELETE' });
    });

    it('posts a coordinator route decision via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.postTeamRouteDecision('team/1', 'run/2', {
        action: 'approve',
        next_worker: 'worker/3',
      });

      expect(requestCalls[0]?.path).toBe(
        '/web/agent-teams/team%2F1/runs/run%2F2/route-decisions',
      );
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ action: 'approve', next_worker: 'worker/3' }),
      });
    });
  });

  describe('agent profiles', () => {
    it('lists agent profiles with optional filters', async () => {
      const { api, requestCalls } = createHarness();

      await api.listAgentProfiles();
      await api.listAgentProfiles({
        runtime_id: 'runtime/1',
        q: 'search me',
        pageCursor: 'cursor/2',
        pageSize: 10,
      });

      expect(requestCalls[0]?.path).toBe('/web/agent-profiles');
      expect(requestCalls[1]?.path).toBe(
        '/web/agent-profiles?runtime_id=runtime%2F1&q=search+me&pageCursor=cursor%2F2&pageSize=10',
      );
    });

    it('creates an agent profile via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.createAgentProfile({ name: 'Profile A', runtime_id: 'runtime/1' });

      expect(requestCalls[0]?.path).toBe('/web/agent-profiles');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ name: 'Profile A', runtime_id: 'runtime/1' }),
      });
    });

    it('updates an agent profile via JSON PATCH', async () => {
      const { api, requestCalls } = createHarness();

      await api.updateAgentProfile('profile/1', { name: 'Profile A2' });

      expect(requestCalls[0]?.path).toBe('/web/agent-profiles/profile%2F1');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Profile A2' }),
      });
    });

    it('deletes an agent profile via bodyless DELETE', async () => {
      const { api, requestCalls } = createHarness();

      await api.deleteAgentProfile('profile/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-profiles/profile%2F1');
      expect(requestCalls[0]?.init).toEqual({ method: 'DELETE' });
    });

    it('gets an agent profile by encoded id', async () => {
      const { api, requestCalls } = createHarness();

      await api.getAgentProfile('profile/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-profiles/profile%2F1');
    });
  });

  describe('settings and attachments', () => {
    it('fetches the client settings', async () => {
      const { api, requestCalls } = createHarness();

      await api.fetchSettings();

      expect(requestCalls[0]?.path).toBe('/client/settings');
      expect(requestCalls[0]?.init).toBeUndefined();
    });

    it('patches settings values including an empty map', async () => {
      const { api, requestCalls } = createHarness();

      await api.patchSettings({ theme: 'dark' });
      await api.patchSettings({});

      expect(requestCalls[0]?.path).toBe('/client/settings');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PATCH',
        body: JSON.stringify({ values: { theme: 'dark' } }),
      });
      expect(requestCalls[1]?.init).toEqual({
        method: 'PATCH',
        body: JSON.stringify({ values: {} }),
      });
    });

    it('probes an attachment by hash', async () => {
      const { api, requestCalls } = createHarness();

      await api.probeAttachment('abc123');

      expect(requestCalls[0]?.path).toBe('/client/attachments/probe');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ hash: 'abc123' }),
      });
    });

    it('uploads an attachment as multipart form data', async () => {
      const { api, uploadCalls, requestCalls } = createHarness();
      const file = new File(['attachment-bytes'], 'notes.txt', { type: 'text/plain' });

      await api.uploadAttachment(file, 'abc123');

      expect(requestCalls).toHaveLength(0);
      expect(uploadCalls).toHaveLength(1);
      expect(uploadCalls[0]?.path).toBe('/client/attachments');
      const formData = uploadCalls[0]?.formData;
      expect(formData?.get('file')).toBe(file);
      expect(formData?.get('hash')).toBe('abc123');
      expect(formData?.get('original_name')).toBe('notes.txt');
    });

    it('builds attachment download URLs from the injected base url', () => {
      const defaultApi = createHarness().api;
      expect(defaultApi.downloadAttachmentUrl('att/1')).toBe(
        'https://hub.example.test/client/attachments/att%2F1',
      );
      expect(defaultApi.downloadAttachmentUrl('')).toBe(
        'https://hub.example.test/client/attachments/',
      );

      // The base url is concatenated verbatim, so a trailing slash is preserved.
      const customApi = createHarness({ baseUrl: 'https://custom.example.test/' }).api;
      expect(customApi.downloadAttachmentUrl('att/1')).toBe(
        'https://custom.example.test//client/attachments/att%2F1',
      );
    });
  });

  describe('documents', () => {
    it('lists documents with optional filters', async () => {
      const { api, requestCalls } = createHarness();

      await api.listDocuments();
      await api.listDocuments({
        status: 'active',
        source: 'upload',
        tag: 'demo',
        pageCursor: 'cursor/2',
        pageSize: 50,
      });

      expect(requestCalls[0]?.path).toBe('/web/documents');
      expect(requestCalls[1]?.path).toBe(
        '/web/documents?status=active&source=upload&tag=demo&pageCursor=cursor%2F2&pageSize=50',
      );
    });

    it('gets a document by encoded id', async () => {
      const { api, requestCalls } = createHarness();

      await api.getDocument('doc/1');

      expect(requestCalls[0]?.path).toBe('/web/documents/doc%2F1');
    });

    it('creates a document via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.createDocument({ title: 'Doc A', content: 'hello', location: '/tmp/doc-a' });

      expect(requestCalls[0]?.path).toBe('/web/documents');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ title: 'Doc A', content: 'hello', location: '/tmp/doc-a' }),
      });
    });

    it('updates a document via JSON PATCH', async () => {
      const { api, requestCalls } = createHarness();

      await api.updateDocument('doc/1', { title: 'Doc A2', status: 'archived' });

      expect(requestCalls[0]?.path).toBe('/web/documents/doc%2F1');
      expect(requestCalls[0]?.init).toEqual({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Doc A2', status: 'archived' }),
      });
    });

    it('deletes a document via bodyless DELETE', async () => {
      const { api, requestCalls } = createHarness();

      await api.deleteDocument('doc/1');

      expect(requestCalls[0]?.path).toBe('/web/documents/doc%2F1');
      expect(requestCalls[0]?.init).toEqual({ method: 'DELETE' });
    });
  });

  describe('task stream events', () => {
    it('streams a task event with optional run and client message ids', async () => {
      const { api, requestCalls } = createHarness();

      await api.streamTaskEvent('task/1', 'progress', { pct: 50 });
      await api.streamTaskEvent('task/1', 'progress', { pct: 50 }, {
        runId: 'run/9',
        clientMsgId: 'client/8',
      });
      // Falsy option values are omitted from the body; null payloads are kept.
      await api.streamTaskEvent('task/1', 'progress', null, { runId: '', clientMsgId: '' });

      expect(requestCalls[0]?.path).toBe('/edge/agent-tasks/task%2F1/stream');
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ event_type: 'progress', payload: { pct: 50 } }),
      });
      expect(requestCalls[1]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({
          event_type: 'progress',
          payload: { pct: 50 },
          run_id: 'run/9',
          client_msg_id: 'client/8',
        }),
      });
      expect(requestCalls[2]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ event_type: 'progress', payload: null }),
      });
    });
  });

  describe('task approvals and artifacts (T3.4)', () => {
    it('lists task approvals', async () => {
      const { api, requestCalls } = createHarness();

      await api.listTaskApprovals('task/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-tasks/task%2F1/approvals');
    });

    it('decides a task approval via JSON POST', async () => {
      const { api, requestCalls } = createHarness();

      await api.decideTaskApproval('task/1', 'approval/2', { decision: 'allow', reason: 'fine' });

      expect(requestCalls[0]?.path).toBe(
        '/web/agent-tasks/task%2F1/approvals/approval%2F2/decide',
      );
      expect(requestCalls[0]?.init).toEqual({
        method: 'POST',
        body: JSON.stringify({ decision: 'allow', reason: 'fine' }),
      });
    });

    it('lists task artifacts', async () => {
      const { api, requestCalls } = createHarness();

      await api.listTaskArtifacts('task/1');

      expect(requestCalls[0]?.path).toBe('/web/agent-tasks/task%2F1/artifacts');
    });
  });

  describe('transport wiring', () => {
    it('exposes the complete extended API surface', () => {
      const { api } = createHarness();

      expect(Object.keys(api).sort()).toEqual([
        'addAgentTeamMember',
        'addMessageReaction',
        'createAgentProfile',
        'createAgentTeam',
        'createDocument',
        'createWorkspaceProject',
        'createWorkspaceProjectThread',
        'decideTaskApproval',
        'decideTeamApproval',
        'deleteAgentProfile',
        'deleteAgentTeam',
        'deleteDocument',
        'downloadAttachmentUrl',
        'editMessage',
        'fetchSettings',
        'getAgentProfile',
        'getAgentTeam',
        'getDocument',
        'getTaskRunEventSummary',
        'getTeamRun',
        'getTeamRunState',
        'getWorkspaceProject',
        'listAgentProfiles',
        'listAgentTeams',
        'listDocuments',
        'listMessageReactions',
        'listTaskApprovals',
        'listTaskArtifacts',
        'listTaskRunEvents',
        'listTaskRunEventsAfter',
        'listTeamEvents',
        'listTeamRuns',
        'listTeamTasks',
        'listWorkspaceProjectThreadMessages',
        'listWorkspaceProjectThreads',
        'listWorkspaceProjects',
        'patchSettings',
        'postTeamRouteDecision',
        'probeAttachment',
        'removeAgentTeamMember',
        'removeMessageReaction',
        'resolveTeamConflict',
        'sendWorkspaceProjectThreadMessage',
        'startTeamRun',
        'streamTaskEvent',
        'updateAgentProfile',
        'updateAgentTeam',
        'updateDocument',
        'updateWorkspaceProject',
        'uploadAttachment',
      ]);
    });

    it('resolves direct GET responses through the injected transport', async () => {
      const marker = { id: 'p/1', name: 'Project' };
      const { api } = createHarness({ requestImpl: async () => marker });

      await expect(api.getWorkspaceProject('p/1')).resolves.toBe(marker);
    });

    it('resolves path+init responses through the injected transport', async () => {
      const marker = { id: 'team/1', name: 'Team' };
      const { api } = createHarness({ requestImpl: async () => marker });

      await expect(api.createAgentTeam({ name: 'Team' })).resolves.toBe(marker);
    });

    it('resolves multipart upload responses through the injected upload transport', async () => {
      const marker = { id: 'att/1', hash: 'abc123', size: 3, mime_type: 'text/plain' };
      const file = new File(['abc'], 'a.txt');
      const { api } = createHarness({ uploadImpl: async () => marker });

      await expect(api.uploadAttachment(file, 'abc123')).resolves.toBe(marker);
    });

    it('propagates rejections from direct GET methods', async () => {
      const { api } = createHarness({
        requestImpl: async () => {
          throw new Error('network down');
        },
      });

      await expect(api.listAgentTeams()).rejects.toThrow('network down');
    });

    it('propagates rejections from path+init methods', async () => {
      const { api } = createHarness({
        requestImpl: async () => {
          throw new Error('teapot');
        },
      });

      await expect(api.deleteAgentTeam('team/1')).rejects.toThrow('teapot');
    });

    it('propagates rejections from multipart uploads', async () => {
      const file = new File(['abc'], 'a.txt');
      const { api } = createHarness({
        uploadImpl: async () => {
          throw new Error('upload failed');
        },
      });

      await expect(api.uploadAttachment(file, 'abc123')).rejects.toThrow('upload failed');
    });
  });
});
