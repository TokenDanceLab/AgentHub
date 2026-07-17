import { describe, expect, it } from 'vitest';
import {
  buildAttachmentDownloadUrl,
  buildAttachmentFormData,
  buildOidcAuthorizeBody,
  buildPatchSettingsBody,
  buildProbeAttachmentBody,
  buildReactionBody,
  buildStreamTaskEventBody,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskStreamBody,
  buildTriggerAgentTaskBody,
  normalizeExecutionTargetsResponse,
  withPublicCatalogParams,
} from './hubClientPayloadUtils';

describe('hubClientPayloadUtils (#810)', () => {
  it('normalizes execution-target array vs {items,page} responses', () => {
    expect(
      normalizeExecutionTargetsResponse([
        { id: 't1', name: 'edge-a' },
        { id: 't2', name: 'edge-b' },
      ]),
    ).toEqual({
      items: [
        { id: 't1', name: 'edge-a' },
        { id: 't2', name: 'edge-b' },
      ],
      page: { hasMore: false },
    });

    expect(
      normalizeExecutionTargetsResponse({
        items: [{ id: 't3', name: 'edge-c' }],
        page: { hasMore: true, nextCursor: 'c1' },
      }),
    ).toEqual({
      items: [{ id: 't3', name: 'edge-c' }],
      page: { hasMore: true, nextCursor: 'c1' },
    });

    expect(
      normalizeExecutionTargetsResponse({
        items: undefined as unknown as [],
        page: undefined as unknown as { hasMore: boolean },
      }),
    ).toEqual({
      items: [],
      page: { hasMore: false },
    });
  });

  it('builds OIDC authorize body with S256 default before caller fields', () => {
    expect(
      buildOidcAuthorizeBody({
        code_challenge: 'abc',
        code_challenge_method: 'plain',
        device_type: 'desktop',
      }),
    ).toEqual({
      code_challenge_method: 'plain',
      code_challenge: 'abc',
      device_type: 'desktop',
    });

    expect(buildOidcAuthorizeBody({ code_challenge: 'xyz' })).toEqual({
      code_challenge_method: 'S256',
      code_challenge: 'xyz',
    });
  });

  it('builds task lifecycle bodies with optional run_id', () => {
    expect(buildTaskAckBody()).toBeUndefined();
    expect(buildTaskAckBody('run-1')).toEqual({ run_id: 'run-1' });

    expect(buildTaskStreamBody('hello')).toEqual({ content: 'hello' });
    expect(buildTaskStreamBody('hello', 'run-2')).toEqual({
      content: 'hello',
      run_id: 'run-2',
    });

    expect(buildTaskDoneBody()).toEqual({ final_content: '' });
    expect(buildTaskDoneBody('done', 'run-3')).toEqual({
      final_content: 'done',
      run_id: 'run-3',
    });

    expect(buildTaskFailBody('boom')).toEqual({ error: 'boom' });
    expect(buildTaskFailBody('boom', 'run-4')).toEqual({
      error: 'boom',
      run_id: 'run-4',
    });
  });

  it('builds stream event, trigger, settings, probe, and reaction bodies', () => {
    expect(buildStreamTaskEventBody('token', { t: 1 })).toEqual({
      event_type: 'token',
      payload: { t: 1 },
    });
    expect(
      buildStreamTaskEventBody('token', { t: 1 }, { runId: 'r1', clientMsgId: 'm1' }),
    ).toEqual({
      event_type: 'token',
      payload: { t: 1 },
      run_id: 'r1',
      client_msg_id: 'm1',
    });

    expect(buildTriggerAgentTaskBody('msg-1', { agent_type: 'claude' })).toEqual({
      trigger_message_id: 'msg-1',
      agent_type: 'claude',
    });

    expect(buildPatchSettingsBody({ theme: 'dark' })).toEqual({ values: { theme: 'dark' } });
    expect(buildProbeAttachmentBody('sha256')).toEqual({ hash: 'sha256' });
    expect(buildReactionBody('sess-1', { emoji: '👍' })).toEqual({
      session_id: 'sess-1',
      emoji: '👍',
    });
  });

  it('merges public catalog params and builds attachment helpers', () => {
    expect(withPublicCatalogParams()).toEqual({ is_public: 'true' });
    expect(withPublicCatalogParams({ q: 'search', pageSize: 10 })).toEqual({
      is_public: 'true',
      q: 'search',
      pageSize: 10,
    });
    // Caller may still override is_public after the default.
    expect(withPublicCatalogParams({ is_public: 'false' })).toEqual({ is_public: 'false' });

    expect(buildAttachmentDownloadUrl('http://hub.local', 'att/1')).toBe(
      'http://hub.local/client/attachments/att%2F1',
    );

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const formData = buildAttachmentFormData(file, 'hash-1');
    expect(formData.get('hash')).toBe('hash-1');
    expect(formData.get('original_name')).toBe('note.txt');
    expect(formData.get('file')).toBeInstanceOf(File);
  });
});
