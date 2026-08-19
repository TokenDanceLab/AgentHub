// real_tested=true
import { describe, expect, it } from 'vitest';
import {
  buildAckRelayCommandRequest,
  buildCreateCustomAgentRequest,
  buildCreateExecutionTargetRequest,
  buildCreateRelayCommandRequest,
  buildCreateWorkspaceProjectRequest,
  buildCreateWorkspaceProjectThreadRequest,
  buildDeleteCustomAgentRequest,
  buildDeleteExecutionTargetRequest,
  buildPatchSettingsRequest,
  buildPingExecutionTargetRequest,
  buildProbeAttachmentRequest,
  buildSendWorkspaceProjectThreadMessageRequest,
  buildUpdateCustomAgentRequest,
  buildUpdateExecutionTargetRequest,
  buildUpdateWorkspaceProjectRequest,
  buildUploadAttachmentRequest,
} from './hubClientPayloadRequestsWorkspace';

describe('hubClientPayloadRequestsWorkspace', () => {
  it('builds a PATCH settings request with wrapped values', () => {
    const values = { theme: 'dark', locale: 'zh-CN' };
    expect(buildPatchSettingsRequest(values)).toEqual({
      path: '/client/settings',
      init: { method: 'PATCH', body: JSON.stringify({ values }) },
    });
  });

  it('builds a PATCH settings request for empty values', () => {
    expect(buildPatchSettingsRequest({})).toEqual({
      path: '/client/settings',
      init: { method: 'PATCH', body: '{"values":{}}' },
    });
  });

  it('builds a POST probe-attachment request', () => {
    expect(buildProbeAttachmentRequest('sha256:abc')).toEqual({
      path: '/client/attachments/probe',
      init: { method: 'POST', body: '{"hash":"sha256:abc"}' },
    });
  });

  it('builds a probe-attachment request for an empty hash', () => {
    expect(buildProbeAttachmentRequest('')).toEqual({
      path: '/client/attachments/probe',
      init: { method: 'POST', body: '{"hash":""}' },
    });
  });

  it('builds an upload request as path + FormData with no init key', () => {
    const file = new File(['data'], 'notes.txt', { type: 'text/plain' });
    const request = buildUploadAttachmentRequest(file, 'sha256:def');

    expect(request.path).toBe('/client/attachments');
    expect(Object.keys(request).sort()).toEqual(['formData', 'path']);
    expect('init' in request).toBe(false);
    expect(request.formData.get('file')).toBe(file);
    expect(request.formData.get('hash')).toBe('sha256:def');
    expect(request.formData.get('original_name')).toBe('notes.txt');
  });

  it('preserves empty and unicode file names in original_name', () => {
    const emptyNamedFile = new File([], '');
    const unicodeNamedFile = new File(['x'], '报告 (最终).pdf');

    expect(
      buildUploadAttachmentRequest(emptyNamedFile, 'h1').formData.get('original_name'),
    ).toBe('');
    expect(
      buildUploadAttachmentRequest(unicodeNamedFile, 'h2').formData.get('original_name'),
    ).toBe('报告 (最终).pdf');
  });

  it('builds a POST create-execution-target request', () => {
    const body = { name: 'edge-a', target_type: 'docker' };
    expect(buildCreateExecutionTargetRequest(body)).toEqual({
      path: '/web/execution-targets',
      init: { method: 'POST', body: JSON.stringify(body) },
    });
  });

  it('stringifies scalar and null bodies', () => {
    expect(buildCreateExecutionTargetRequest(null).init.body).toBe('null');
    expect(buildCreateExecutionTargetRequest(0).init.body).toBe('0');
    expect(buildCreateExecutionTargetRequest('hello').init.body).toBe('"hello"');
  });

  it('keeps an undefined body key with undefined value (JSON.stringify quirk)', () => {
    const request = buildCreateExecutionTargetRequest(undefined);
    expect(request.path).toBe('/web/execution-targets');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(request.init, 'body')).toBe(true);
  });

  it('drops undefined nested fields from JSON bodies', () => {
    expect(buildCreateExecutionTargetRequest({ a: 1, b: undefined }).init.body).toBe(
      '{"a":1}',
    );
  });

  it('builds a PATCH update-execution-target request with encoded id', () => {
    const body = { name: 'renamed' };
    expect(buildUpdateExecutionTargetRequest('et/1', body)).toEqual({
      path: '/web/execution-targets/et%2F1',
      init: { method: 'PATCH', body: JSON.stringify(body) },
    });
  });

  it('builds a POST ping request with only a method init', () => {
    const request = buildPingExecutionTargetRequest('et/1');
    expect(request).toEqual({
      path: '/web/execution-targets/et%2F1/ping',
      init: { method: 'POST' },
    });
    expect(Object.keys(request.init)).toEqual(['method']);
  });

  it('builds a POST create-relay-command request', () => {
    const body = { command: 'echo', args: ['hi'] };
    expect(buildCreateRelayCommandRequest(body)).toEqual({
      path: '/web/relay/commands',
      init: { method: 'POST', body: JSON.stringify(body) },
    });
  });

  it('builds a POST create-custom-agent request', () => {
    const body = { name: 'Agent X', description: 'does "things"' };
    expect(buildCreateCustomAgentRequest(body)).toEqual({
      path: '/web/custom-agents',
      init: { method: 'POST', body: JSON.stringify(body) },
    });
  });

  it('builds a PUT update-custom-agent request with encoded id', () => {
    const body = { name: 'Agent Y' };
    expect(buildUpdateCustomAgentRequest('agent/1', body)).toEqual({
      path: '/web/custom-agents/agent%2F1',
      init: { method: 'PUT', body: JSON.stringify(body) },
    });
  });

  it('builds a POST create-workspace-project request', () => {
    const data = { name: 'My Project' };
    expect(buildCreateWorkspaceProjectRequest(data)).toEqual({
      path: '/web/projects',
      init: { method: 'POST', body: JSON.stringify(data) },
    });
  });

  it('passes undefined workspace-project data through as an undefined body', () => {
    const request = buildCreateWorkspaceProjectRequest(undefined);
    expect(request.path).toBe('/web/projects');
    expect(request.init.body).toBeUndefined();
  });

  it('builds a PATCH update-workspace-project request with encoded id', () => {
    const data = { name: 'Renamed Project' };
    expect(buildUpdateWorkspaceProjectRequest('proj/7', data)).toEqual({
      path: '/web/projects/proj%2F7',
      init: { method: 'PATCH', body: JSON.stringify(data) },
    });
  });

  it('builds a POST create-thread request with encoded project id', () => {
    const data = { title: 'First thread' };
    expect(buildCreateWorkspaceProjectThreadRequest('proj/7', data)).toEqual({
      path: '/web/projects/proj%2F7/threads',
      init: { method: 'POST', body: JSON.stringify(data) },
    });
  });

  it('builds a POST send-message request with encoded project and thread ids', () => {
    const data = { content: 'hi', role: 'user' };
    expect(buildSendWorkspaceProjectThreadMessageRequest('proj/7', 'thr/3', data)).toEqual({
      path: '/web/projects/proj%2F7/threads/thr%2F3/messages',
      init: { method: 'POST', body: JSON.stringify(data) },
    });
  });

  it('encodes unicode ids in workspace thread paths', () => {
    expect(
      buildSendWorkspaceProjectThreadMessageRequest('项目 A', '线程 1', {}),
    ).toEqual({
      path: '/web/projects/%E9%A1%B9%E7%9B%AE%20A/threads/%E7%BA%BF%E7%A8%8B%201/messages',
      init: { method: 'POST', body: '{}' },
    });
  });

  it('builds a DELETE execution-target request with only a method init', () => {
    const request = buildDeleteExecutionTargetRequest('et/9');
    expect(request).toEqual({
      path: '/web/execution-targets/et%2F9',
      init: { method: 'DELETE' },
    });
    expect(Object.keys(request.init)).toEqual(['method']);
  });

  it('builds a POST ack-relay-command request with encoded id', () => {
    const request = buildAckRelayCommandRequest('cmd/5');
    expect(request).toEqual({
      path: '/web/relay/commands/cmd%2F5/ack',
      init: { method: 'POST' },
    });
    expect(Object.keys(request.init)).toEqual(['method']);
  });

  it('builds a DELETE custom-agent request with only a method init', () => {
    const request = buildDeleteCustomAgentRequest('agent/9');
    expect(request).toEqual({
      path: '/web/custom-agents/agent%2F9',
      init: { method: 'DELETE' },
    });
    expect(Object.keys(request.init)).toEqual(['method']);
  });

  it('accepts empty string ids without throwing', () => {
    expect(buildPingExecutionTargetRequest('')).toEqual({
      path: '/web/execution-targets//ping',
      init: { method: 'POST' },
    });
    expect(buildDeleteCustomAgentRequest('')).toEqual({
      path: '/web/custom-agents/',
      init: { method: 'DELETE' },
    });
  });

  it('escapes special characters in JSON bodies', () => {
    expect(buildUpdateWorkspaceProjectRequest('p1', { name: 'a"b\\c\n' }).init.body).toBe(
      '{"name":"a\\"b\\\\c\\n"}',
    );
  });
});
