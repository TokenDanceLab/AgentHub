// real_tested=true
import { describe, expect, it } from 'vitest';

import type {
  HubExecutionTarget,
  HubExecutionTargetListResponse,
  HubOidcAuthorizeRequest,
} from './hubClientDomainTypes';
import {
  buildAttachmentDownloadUrl,
  buildAttachmentFormData,
  buildForwardMessageBody,
  buildFriendRequestBody,
  buildMarkReadBody,
  buildMemberIdsBody,
  buildOidcAuthorizeBody,
  buildOptionalJsonBody,
  buildPatchSettingsBody,
  buildProbeAttachmentBody,
  buildReactionBody,
  buildRefreshBody,
  buildRemarkBody,
  buildSessionIdBody,
  buildStreamTaskEventBody,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskStreamBody,
  buildTransferOwnerBody,
  buildTriggerAgentTaskBody,
  normalizeExecutionTargetsResponse,
  withPublicCatalogParams,
} from './hubClientPayloadBodies';

const executionTarget: HubExecutionTarget = {
  id: 'target-1',
  name: 'Workstation Alpha',
  type: 'local_edge',
  status: 'online',
};

// ── normalizeExecutionTargetsResponse ──────────────────────────────

describe('normalizeExecutionTargetsResponse', () => {
  it('wraps a plain array into a list response with a hasMore:false page', () => {
    const targets = [executionTarget];
    const result = normalizeExecutionTargetsResponse(targets);
    expect(result.items).toBe(targets);
    expect(result.page).toEqual({ hasMore: false });
  });

  it('wraps an empty array into an empty items list', () => {
    const result = normalizeExecutionTargetsResponse([]);
    expect(result.items).toEqual([]);
    expect(result.page).toEqual({ hasMore: false });
  });

  it('passes through an existing list response untouched (same references)', () => {
    const items = [executionTarget];
    const page = { hasMore: true, nextCursor: 'cursor-9' };
    const result = normalizeExecutionTargetsResponse({ items, page });
    expect(result.items).toBe(items);
    expect(result.page).toBe(page);
  });

  it('replaces a missing or null items field with an empty array', () => {
    const missingItems = normalizeExecutionTargetsResponse(
      {} as unknown as HubExecutionTargetListResponse,
    );
    expect(missingItems.items).toEqual([]);

    const nullItems = normalizeExecutionTargetsResponse({
      items: null,
      page: { hasMore: true },
    } as unknown as HubExecutionTargetListResponse);
    expect(nullItems.items).toEqual([]);
    expect(nullItems.page).toEqual({ hasMore: true });
  });

  it('falls back to a hasMore:false page when page is missing or null', () => {
    const missingPage = normalizeExecutionTargetsResponse({
      items: [executionTarget],
    } as unknown as HubExecutionTargetListResponse);
    expect(missingPage.page).toEqual({ hasMore: false });

    const nullPage = normalizeExecutionTargetsResponse({
      items: [executionTarget],
      page: null,
    } as unknown as HubExecutionTargetListResponse);
    expect(nullPage.page).toEqual({ hasMore: false });
  });

  it('preserves a non-array items payload only when it is a real array', () => {
    const stringItems = normalizeExecutionTargetsResponse({
      items: 'not-an-array',
    } as unknown as HubExecutionTargetListResponse);
    expect(stringItems.items).toEqual([]);
  });
});

// ── buildOidcAuthorizeBody ─────────────────────────────────────────

describe('buildOidcAuthorizeBody', () => {
  it('injects the S256 code_challenge_method default', () => {
    const body: HubOidcAuthorizeRequest = { code_challenge: 'challenge-abc' };
    const result = buildOidcAuthorizeBody(body);
    expect(result.code_challenge_method).toBe('S256');
    expect(result.code_challenge).toBe('challenge-abc');
  });

  it('lets an explicit code_challenge_method override the default', () => {
    const result = buildOidcAuthorizeBody({
      code_challenge: 'challenge-abc',
      code_challenge_method: 'plain',
    });
    expect(result.code_challenge_method).toBe('plain');
  });

  it('preserves optional device and redirect fields', () => {
    const result = buildOidcAuthorizeBody({
      code_challenge: 'challenge-abc',
      device_type: 'desktop',
      device_id: 'dev-1',
      redirect_uri: 'https://app.example.com/callback',
    });
    expect(result).toEqual({
      code_challenge_method: 'S256',
      code_challenge: 'challenge-abc',
      device_type: 'desktop',
      device_id: 'dev-1',
      redirect_uri: 'https://app.example.com/callback',
    });
  });

  it('handles a minimal body with an empty code_challenge', () => {
    const result = buildOidcAuthorizeBody({ code_challenge: '' });
    expect(result).toEqual({ code_challenge_method: 'S256', code_challenge: '' });
  });

  it('handles an empty body object', () => {
    const result = buildOidcAuthorizeBody({} as HubOidcAuthorizeRequest);
    expect(result).toEqual({ code_challenge_method: 'S256' });
  });
});

// ── buildRefreshBody ───────────────────────────────────────────────

describe('buildRefreshBody', () => {
  it('wraps a refresh token under refresh_token', () => {
    expect(buildRefreshBody('refresh-token-1')).toEqual({ refresh_token: 'refresh-token-1' });
  });

  it('handles an empty refresh token', () => {
    expect(buildRefreshBody('')).toEqual({ refresh_token: '' });
  });
});

// ── buildFriendRequestBody ─────────────────────────────────────────

describe('buildFriendRequestBody', () => {
  it('includes the message when provided', () => {
    expect(buildFriendRequestBody('friend-1', 'Hello!')).toEqual({
      friend_id: 'friend-1',
      message: 'Hello!',
    });
  });

  it('omits the message key when the message is undefined', () => {
    const result = buildFriendRequestBody('friend-1');
    expect(result).toEqual({ friend_id: 'friend-1' });
    expect('message' in result).toBe(false);
  });

  it('omits the message key when an explicit undefined is passed', () => {
    const result = buildFriendRequestBody('friend-1', undefined);
    expect(result).toEqual({ friend_id: 'friend-1' });
    expect('message' in result).toBe(false);
  });

  it('keeps the message key for an empty-string message', () => {
    const result = buildFriendRequestBody('friend-1', '');
    expect(result).toEqual({ friend_id: 'friend-1', message: '' });
    expect('message' in result).toBe(true);
  });
});

// ── buildRemarkBody ────────────────────────────────────────────────

describe('buildRemarkBody', () => {
  it('wraps a remark under remark', () => {
    expect(buildRemarkBody('Best friend')).toEqual({ remark: 'Best friend' });
  });

  it('handles an empty remark', () => {
    expect(buildRemarkBody('')).toEqual({ remark: '' });
  });
});

// ── buildMemberIdsBody ─────────────────────────────────────────────

describe('buildMemberIdsBody', () => {
  it('wraps member ids and keeps the array reference', () => {
    const memberIds = ['user-1', 'user-2', 'user-3'];
    const result = buildMemberIdsBody(memberIds);
    expect(result).toEqual({ member_ids: memberIds });
    expect(result.member_ids).toBe(memberIds);
  });

  it('handles an empty member id list', () => {
    expect(buildMemberIdsBody([])).toEqual({ member_ids: [] });
  });
});

// ── buildTransferOwnerBody ─────────────────────────────────────────

describe('buildTransferOwnerBody', () => {
  it('wraps the new owner id under new_owner_id', () => {
    expect(buildTransferOwnerBody('user-9')).toEqual({ new_owner_id: 'user-9' });
  });

  it('handles an empty owner id', () => {
    expect(buildTransferOwnerBody('')).toEqual({ new_owner_id: '' });
  });
});

// ── buildMarkReadBody ──────────────────────────────────────────────

describe('buildMarkReadBody', () => {
  it('wraps a positive sequence number', () => {
    expect(buildMarkReadBody(42)).toEqual({ last_read_seq: 42 });
  });

  it('handles boundary values: zero, negative, and MAX_SAFE_INTEGER', () => {
    expect(buildMarkReadBody(0)).toEqual({ last_read_seq: 0 });
    expect(buildMarkReadBody(-7)).toEqual({ last_read_seq: -7 });
    expect(buildMarkReadBody(Number.MAX_SAFE_INTEGER)).toEqual({
      last_read_seq: Number.MAX_SAFE_INTEGER,
    });
  });
});

// ── buildSessionIdBody ─────────────────────────────────────────────

describe('buildSessionIdBody', () => {
  it('wraps a session id under session_id', () => {
    expect(buildSessionIdBody('session-7')).toEqual({ session_id: 'session-7' });
  });

  it('handles an empty session id', () => {
    expect(buildSessionIdBody('')).toEqual({ session_id: '' });
  });
});

// ── buildForwardMessageBody ────────────────────────────────────────

describe('buildForwardMessageBody', () => {
  it('wraps target session ids and keeps the array reference', () => {
    const targetSessionIds = ['session-1', 'session-2'];
    const result = buildForwardMessageBody(targetSessionIds);
    expect(result).toEqual({ target_session_ids: targetSessionIds });
    expect(result.target_session_ids).toBe(targetSessionIds);
  });

  it('handles an empty target session list', () => {
    expect(buildForwardMessageBody([])).toEqual({ target_session_ids: [] });
  });
});

// ── buildTaskAckBody ───────────────────────────────────────────────

describe('buildTaskAckBody', () => {
  it('wraps a run id under run_id', () => {
    expect(buildTaskAckBody('run-1')).toEqual({ run_id: 'run-1' });
  });

  it('returns undefined when runId is undefined', () => {
    expect(buildTaskAckBody()).toBeUndefined();
    expect(buildTaskAckBody(undefined)).toBeUndefined();
  });

  it('returns undefined for a falsy empty-string runId', () => {
    expect(buildTaskAckBody('')).toBeUndefined();
  });
});

// ── buildTaskStreamBody ────────────────────────────────────────────

describe('buildTaskStreamBody', () => {
  it('builds a content-only body without a run_id key', () => {
    const result = buildTaskStreamBody('streaming…');
    expect(result).toEqual({ content: 'streaming…' });
    expect('run_id' in result).toBe(false);
  });

  it('includes run_id when a truthy runId is provided', () => {
    expect(buildTaskStreamBody('streaming…', 'run-2')).toEqual({
      content: 'streaming…',
      run_id: 'run-2',
    });
  });

  it('keeps empty content and drops falsy runIds', () => {
    const emptyContent = buildTaskStreamBody('');
    expect(emptyContent).toEqual({ content: '' });

    const falsyRunId = buildTaskStreamBody('x', '');
    expect(falsyRunId).toEqual({ content: 'x' });
    expect('run_id' in falsyRunId).toBe(false);
  });
});

// ── buildTaskDoneBody ──────────────────────────────────────────────

describe('buildTaskDoneBody', () => {
  it('defaults final_content to an empty string with no run_id', () => {
    const result = buildTaskDoneBody();
    expect(result).toEqual({ final_content: '' });
    expect('run_id' in result).toBe(false);
  });

  it('passes through a provided final_content and run_id', () => {
    expect(buildTaskDoneBody('All done.', 'run-3')).toEqual({
      final_content: 'All done.',
      run_id: 'run-3',
    });
  });

  it('preserves an empty-string final_content', () => {
    expect(buildTaskDoneBody('')).toEqual({ final_content: '' });
  });

  it('coalesces a null final_content to an empty string', () => {
    const result = buildTaskDoneBody(null as unknown as string);
    expect(result).toEqual({ final_content: '' });
  });

  it('drops a falsy runId while keeping the final content', () => {
    const result = buildTaskDoneBody('Done.', '');
    expect(result).toEqual({ final_content: 'Done.' });
    expect('run_id' in result).toBe(false);
  });
});

// ── buildTaskFailBody ──────────────────────────────────────────────

describe('buildTaskFailBody', () => {
  it('builds an error-only body without a run_id key', () => {
    const result = buildTaskFailBody('boom');
    expect(result).toEqual({ error: 'boom' });
    expect('run_id' in result).toBe(false);
  });

  it('includes run_id when provided', () => {
    expect(buildTaskFailBody('boom', 'run-4')).toEqual({ error: 'boom', run_id: 'run-4' });
  });

  it('keeps empty errors and drops falsy runIds', () => {
    expect(buildTaskFailBody('')).toEqual({ error: '' });

    const falsyRunId = buildTaskFailBody('boom', '');
    expect(falsyRunId).toEqual({ error: 'boom' });
    expect('run_id' in falsyRunId).toBe(false);
  });
});

// ── buildStreamTaskEventBody ───────────────────────────────────────

describe('buildStreamTaskEventBody', () => {
  it('builds a minimal body with only event_type and payload', () => {
    const payload = { pct: 50 };
    const result = buildStreamTaskEventBody('progress', payload);
    expect(result).toEqual({ event_type: 'progress', payload });
    expect('run_id' in result).toBe(false);
    expect('client_msg_id' in result).toBe(false);
  });

  it('includes run_id when options.runId is truthy', () => {
    expect(buildStreamTaskEventBody('progress', { pct: 50 }, { runId: 'run-5' })).toEqual({
      event_type: 'progress',
      payload: { pct: 50 },
      run_id: 'run-5',
    });
  });

  it('includes client_msg_id when options.clientMsgId is truthy', () => {
    expect(buildStreamTaskEventBody('progress', { pct: 50 }, { clientMsgId: 'cm-1' })).toEqual({
      event_type: 'progress',
      payload: { pct: 50 },
      client_msg_id: 'cm-1',
    });
  });

  it('includes both ids when both options are provided', () => {
    expect(
      buildStreamTaskEventBody('progress', { pct: 50 }, { runId: 'run-6', clientMsgId: 'cm-2' }),
    ).toEqual({
      event_type: 'progress',
      payload: { pct: 50 },
      run_id: 'run-6',
      client_msg_id: 'cm-2',
    });
  });

  it('drops falsy option values from the resulting body', () => {
    const result = buildStreamTaskEventBody('progress', { pct: 50 }, {
      runId: '',
      clientMsgId: '',
    });
    expect(result).toEqual({ event_type: 'progress', payload: { pct: 50 } });
    expect('run_id' in result).toBe(false);
    expect('client_msg_id' in result).toBe(false);
  });

  it('passes payload through untouched for null, undefined, and primitives', () => {
    expect(buildStreamTaskEventBody('progress', null)).toEqual({
      event_type: 'progress',
      payload: null,
    });
    expect(buildStreamTaskEventBody('progress', undefined)).toEqual({
      event_type: 'progress',
      payload: undefined,
    });
    expect(buildStreamTaskEventBody('progress', 0)).toEqual({ event_type: 'progress', payload: 0 });
    expect(buildStreamTaskEventBody('progress', ['a', 'b'])).toEqual({
      event_type: 'progress',
      payload: ['a', 'b'],
    });
  });
});

// ── buildTriggerAgentTaskBody ──────────────────────────────────────

describe('buildTriggerAgentTaskBody', () => {
  it('builds a body with only trigger_message_id when no options are given', () => {
    expect(buildTriggerAgentTaskBody('msg-1')).toEqual({ trigger_message_id: 'msg-1' });
  });

  it('spreads all provided options alongside trigger_message_id', () => {
    const options = {
      agent_instance_id: 'inst-1',
      agent_type: 'orchestrator',
      custom_agent_id: 'custom-1',
      model_params: '{"temperature":0.2}',
      target_id: 'edge-1',
    };
    expect(buildTriggerAgentTaskBody('msg-1', options)).toEqual({
      trigger_message_id: 'msg-1',
      ...options,
    });
  });

  it('preserves falsy option values (unconditional spread)', () => {
    const result = buildTriggerAgentTaskBody('msg-1', { target_id: '' });
    expect(result).toEqual({ trigger_message_id: 'msg-1', target_id: '' });
    expect('target_id' in result).toBe(true);
  });
});

// ── buildAttachmentFormData ────────────────────────────────────────

describe('buildAttachmentFormData', () => {
  it('appends file, hash, and original_name entries', () => {
    const file = new File(['hello'], 'report.txt', { type: 'text/plain' });
    const formData = buildAttachmentFormData(file, 'sha256-abc');
    expect(formData.get('file')).toBe(file);
    expect(formData.get('hash')).toBe('sha256-abc');
    expect(formData.get('original_name')).toBe('report.txt');
  });

  it('appends exactly one file entry', () => {
    const file = new File(['hello'], 'report.txt');
    const formData = buildAttachmentFormData(file, 'sha256-abc');
    expect(formData.getAll('file')).toHaveLength(1);
  });

  it('handles a file with an empty name', () => {
    const file = new File([], '');
    const formData = buildAttachmentFormData(file, 'hash-1');
    expect(formData.get('original_name')).toBe('');
  });

  it('preserves unicode file names', () => {
    const file = new File(['data'], '报告.txt');
    const formData = buildAttachmentFormData(file, 'hash-1');
    expect(formData.get('original_name')).toBe('报告.txt');
  });
});

// ── buildAttachmentDownloadUrl ─────────────────────────────────────

describe('buildAttachmentDownloadUrl', () => {
  it('joins the base url with the attachment path', () => {
    expect(buildAttachmentDownloadUrl('https://hub.example.com', 'att-123')).toBe(
      'https://hub.example.com/client/attachments/att-123',
    );
  });

  it('URL-encodes reserved characters in the attachment id', () => {
    expect(buildAttachmentDownloadUrl('https://hub.example.com', 'a/b c')).toBe(
      'https://hub.example.com/client/attachments/a%2Fb%20c',
    );
  });

  it('URL-encodes unicode ids and tolerates an empty attachment id', () => {
    expect(buildAttachmentDownloadUrl('https://hub.example.com', '文件')).toBe(
      'https://hub.example.com/client/attachments/%E6%96%87%E4%BB%B6',
    );
    expect(buildAttachmentDownloadUrl('https://hub.example.com', '')).toBe(
      'https://hub.example.com/client/attachments/',
    );
  });

  it('handles empty and trailing-slash base urls', () => {
    expect(buildAttachmentDownloadUrl('', 'att-1')).toBe('/client/attachments/att-1');
    expect(buildAttachmentDownloadUrl('https://hub.example.com/', 'att-1')).toBe(
      'https://hub.example.com//client/attachments/att-1',
    );
  });
});

// ── withPublicCatalogParams ────────────────────────────────────────

describe('withPublicCatalogParams', () => {
  it('returns only is_public when no params are provided', () => {
    expect(withPublicCatalogParams()).toEqual({ is_public: 'true' });
    expect(withPublicCatalogParams(undefined)).toEqual({ is_public: 'true' });
  });

  it('merges provided params with the is_public marker', () => {
    expect(withPublicCatalogParams({ page: '2', category: 'agents' })).toEqual({
      is_public: 'true',
      page: '2',
      category: 'agents',
    });
  });

  it('lets params override the is_public marker', () => {
    expect(withPublicCatalogParams({ is_public: 'false' })).toEqual({ is_public: 'false' });
  });

  it('handles an empty params object', () => {
    expect(withPublicCatalogParams({})).toEqual({ is_public: 'true' });
  });
});

// ── buildReactionBody ──────────────────────────────────────────────

describe('buildReactionBody', () => {
  it('merges the session id with the reaction emoji', () => {
    expect(buildReactionBody('session-1', { emoji: '👍' })).toEqual({
      session_id: 'session-1',
      emoji: '👍',
    });
  });

  it('spreads extra reaction fields into the body', () => {
    const reactionWithExtras = { emoji: '👍', custom_key: 'extra' };
    expect(buildReactionBody('session-1', reactionWithExtras)).toEqual({
      session_id: 'session-1',
      emoji: '👍',
      custom_key: 'extra',
    });
  });

  it('handles an empty emoji', () => {
    expect(buildReactionBody('session-1', { emoji: '' })).toEqual({
      session_id: 'session-1',
      emoji: '',
    });
  });
});

// ── buildPatchSettingsBody ─────────────────────────────────────────

describe('buildPatchSettingsBody', () => {
  it('wraps settings values and keeps the object reference', () => {
    const values: Record<string, string> = { theme: 'dark', locale: 'zh-CN' };
    const result = buildPatchSettingsBody(values);
    expect(result).toEqual({ values });
    expect(result.values).toBe(values);
  });

  it('handles an empty settings object', () => {
    expect(buildPatchSettingsBody({})).toEqual({ values: {} });
  });
});

// ── buildProbeAttachmentBody ───────────────────────────────────────

describe('buildProbeAttachmentBody', () => {
  it('wraps a hash under hash', () => {
    expect(buildProbeAttachmentBody('sha256-xyz')).toEqual({ hash: 'sha256-xyz' });
  });

  it('handles an empty hash', () => {
    expect(buildProbeAttachmentBody('')).toEqual({ hash: '' });
  });
});

// ── buildOptionalJsonBody ──────────────────────────────────────────

describe('buildOptionalJsonBody', () => {
  it('returns an empty object (no body key) for undefined payloads', () => {
    const result = buildOptionalJsonBody(undefined);
    expect(result).toEqual({});
    expect('body' in result).toBe(false);
  });

  it('serializes null to the JSON literal "null"', () => {
    expect(buildOptionalJsonBody(null)).toEqual({ body: 'null' });
  });

  it('serializes strings with JSON quoting', () => {
    expect(buildOptionalJsonBody('hello')).toEqual({ body: '"hello"' });
    expect(buildOptionalJsonBody('')).toEqual({ body: '""' });
  });

  it('serializes objects and drops undefined-valued fields', () => {
    expect(buildOptionalJsonBody({ a: 1, b: undefined })).toEqual({ body: '{"a":1}' });
  });

  it('serializes nested structures deterministically', () => {
    expect(buildOptionalJsonBody({ nested: { flag: true }, list: [1, 2] })).toEqual({
      body: '{"nested":{"flag":true},"list":[1,2]}',
    });
  });

  it('serializes falsy primitives 0 and false', () => {
    expect(buildOptionalJsonBody(0)).toEqual({ body: '0' });
    expect(buildOptionalJsonBody(false)).toEqual({ body: 'false' });
  });

  it('serializes arrays', () => {
    expect(buildOptionalJsonBody([1, 'two', null])).toEqual({ body: '[1,"two",null]' });
  });
});
