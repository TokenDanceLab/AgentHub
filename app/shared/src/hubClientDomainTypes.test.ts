import { describe, expect, it } from 'vitest';
import type {
  HubAgentTask,
  HubAgentTaskStatus,
  HubAuthResponse,
  HubClientOptions,
  HubContactInfo,
  HubContentType,
  HubCreateGroupSessionRequest,
  HubCreatePrivateSessionRequest,
  HubCreateSessionResponse,
  HubCreateWorkspaceProjectRequest,
  HubCustomAgent,
  HubCustomAgentRequest,
  HubDevice,
  HubEnvelope,
  HubExecutionTarget,
  HubExecutionTargetListResponse,
  HubExecutionTargetRequest,
  HubExecutionTargetType,
  HubFriendRequest,
  HubListResponse,
  HubLoginRequest,
  HubMCPServer,
  HubMessage,
  HubMessageAttachment,
  HubNotification,
  HubOidcAuthorizeRequest,
  HubOidcAuthorizeResponse,
  HubOidcCallbackRequest,
  HubOidcCallbackResponse,
  HubPageInfo,
  HubRegisterDeviceRequest,
  HubRegisterRequest,
  HubRelayCommand,
  HubRelayCommandRequest,
  HubReplyToInfo,
  HubResponseEnvelope,
  HubSearchResult,
  HubSendMessageRequest,
  HubSendMessageResponse,
  HubSession,
  HubSessionMember,
  HubSkill,
  HubTaskDoneRequest,
  HubTaskFailRequest,
  HubTaskStreamRequest,
  HubTriggerAgentTaskOptions,
  HubTriggerAgentTaskRequest,
  HubUpdateProfileRequest,
  HubUpdateSessionInfoRequest,
  HubUpdateSessionSettingsRequest,
  HubUserProfile,
  HubWorkspaceProject,
  HubWorkspaceProjectListResponse,
  HubWorkspaceProjectThread,
  HubWorkspaceProjectThreadMessage,
} from './hubClientDomainTypes';

describe('hubClientDomainTypes (#777)', () => {
  it('keeps auth and envelope DTO field contracts stable', () => {
    const options: HubClientOptions = {
      baseUrl: 'http://hub.local',
      timeoutMs: 15_000,
      getToken: () => 'token',
    };
    const register: HubRegisterRequest = {
      username: 'alice',
      password: 'pw',
      nickname: 'Alice',
    };
    const login: HubLoginRequest = {
      username: 'alice',
      password: 'pw',
      device_type: 'web',
      device_id: 'd1',
    };
    const auth: HubAuthResponse = {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
    };
    const profile: HubUserProfile = {
      id: 'u1',
      username: 'alice',
      nickname: 'Alice',
    };
    const updateProfile: HubUpdateProfileRequest = { nickname: 'A' };
    const oidcAuth: HubOidcAuthorizeRequest = {
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    };
    const oidcAuthRes: HubOidcAuthorizeResponse = {
      state: 'st',
      authorization_url: 'https://idp.example/auth',
    };
    const oidcCb: HubOidcCallbackRequest = {
      code: 'c',
      state: 'st',
      code_verifier: 'v',
    };
    const oidcCbRes: HubOidcCallbackResponse = {
      ...auth,
      user: profile,
    };
    const envelope: HubResponseEnvelope<HubUserProfile> = {
      code: 'OK',
      data: profile,
    };
    const alias: HubEnvelope<HubUserProfile> = envelope;

    expect(options.baseUrl).toBe('http://hub.local');
    expect(register.username).toBe('alice');
    expect(login.device_id).toBe('d1');
    expect(auth.expires_in).toBe(3600);
    expect(profile.id).toBe('u1');
    expect(updateProfile.nickname).toBe('A');
    expect(oidcAuth.code_challenge).toBe('challenge');
    expect(oidcAuthRes.state).toBe('st');
    expect(oidcCb.code).toBe('c');
    expect(oidcCbRes.user?.username).toBe('alice');
    expect(alias.code).toBe('OK');
  });

  it('keeps IM session/message DTO field contracts stable', () => {
    const search: HubSearchResult = {
      user_id: 'u2',
      username: 'bob',
      nickname: 'Bob',
      relationship: 'stranger',
    };
    const friendReq: HubFriendRequest = {
      request_id: 'fr1',
      user_id: 'u2',
      username: 'bob',
      nickname: 'Bob',
      message: 'hi',
      created_at: '2026-01-01T00:00:00Z',
    };
    const contact: HubContactInfo = {
      user_id: 'u2',
      username: 'bob',
      nickname: 'Bob',
      online: true,
      type: 'user',
    };
    const member: HubSessionMember = {
      session_id: 's1',
      member_type: 'user',
      member_id: 'u1',
      role: 'owner',
    };
    const contentType: HubContentType = 'text';
    const reply: HubReplyToInfo = {
      id: 'm0',
      sender_id: 'u2',
      content_type: contentType,
      content: 'earlier',
    };
    const attachment: HubMessageAttachment = {
      id: 'a1',
      hash: 'h1',
      size: 12,
      mime_type: 'text/plain',
    };
    const message: HubMessage = {
      id: 'm1',
      session_id: 's1',
      seq_id: 1,
      sender_type: 'user',
      sender_id: 'u1',
      content_type: contentType,
      content: '{"text":"hello"}',
      reply_to: reply,
      attachments: [attachment],
    };
    const session: HubSession = {
      session_id: 's1',
      type: 'private',
      unread_count: 0,
      members: [member],
      last_message: message,
    };
    const createPrivate: HubCreatePrivateSessionRequest = {
      target_user_id: 'u2',
    };
    const createGroup: HubCreateGroupSessionRequest = {
      name: 'g',
      member_ids: ['u2'],
    };
    const createSession: HubCreateSessionResponse = {
      session_id: 's2',
      type: 'group',
      created: true,
    };
    const updateInfo: HubUpdateSessionInfoRequest = { name: 'renamed' };
    const updateSettings: HubUpdateSessionSettingsRequest = { muted: true };
    const sendReq: HubSendMessageRequest = {
      client_msg_id: 'cm1',
      content_type: 'text',
      content: '{"text":"hi"}',
    };
    const sendRes: HubSendMessageResponse = {
      message_id: 'm2',
      seq_id: 2,
      created_at: '2026-01-01T00:00:01Z',
    };

    expect(search.relationship).toBe('stranger');
    expect(friendReq.request_id).toBe('fr1');
    expect(contact.online).toBe(true);
    expect(session.type).toBe('private');
    expect(session.last_message?.seq_id).toBe(1);
    expect(createPrivate.target_user_id).toBe('u2');
    expect(createGroup.member_ids).toEqual(['u2']);
    expect(createSession.created).toBe(true);
    expect(updateInfo.name).toBe('renamed');
    expect(updateSettings.muted).toBe(true);
    expect(sendReq.client_msg_id).toBe('cm1');
    expect(sendRes.seq_id).toBe(2);
    expect(reply.content).toBe('earlier');
    expect(attachment.size).toBe(12);
  });

  it('keeps device/custom-agent/skill/workspace/task DTOs stable', () => {
    const registerDevice: HubRegisterDeviceRequest = {
      device_id: 'dev-1',
      device_type: 'desktop',
      capabilities: ['clipboard'],
    };
    const device: HubDevice = {
      id: 'dev-1',
      user_id: 'u1',
      device_type: 'desktop',
    };
    const customReq: HubCustomAgentRequest = {
      name: 'Helper',
      agent_type: 'codex',
      system_prompt: 'be helpful',
    };
    const custom: HubCustomAgent = {
      id: 'ca1',
      owner_user_id: 'u1',
      name: 'Helper',
      agent_type: 'codex',
      system_prompt: 'be helpful',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const skill: HubSkill = { id: 'sk1', name: 'summarize' };
    const mcp: HubMCPServer = { id: 'mcp1', name: 'fs' };
    const project: HubWorkspaceProject = { id: 'p1', name: 'proj' };
    const page: HubPageInfo = { hasMore: false };
    const projectList: HubWorkspaceProjectListResponse = {
      items: [project],
      page,
    };
    const createProject: HubCreateWorkspaceProjectRequest = { name: 'proj' };
    const thread: HubWorkspaceProjectThread = {
      id: 'th1',
      project_id: 'p1',
      name: 'main',
      member_count: 1,
      created_at: '2026-01-01T00:00:00Z',
    };
    const threadMsg: HubWorkspaceProjectThreadMessage = {
      id: 'tm1',
      project_id: 'p1',
      thread_id: 'th1',
      seq_id: 1,
      client_msg_id: 'c1',
      sender_type: 'user',
      sender_id: 'u1',
      content_type: 'text',
      content: 'hi',
      created_at: '2026-01-01T00:00:00Z',
    };
    const status: HubAgentTaskStatus = 'running';
    const task: HubAgentTask = {
      id: 't1',
      agent_instance_id: 'ai1',
      triggered_by_user_id: 'u1',
      trigger_message_id: 'm1',
      status,
      created_at: '2026-01-01T00:00:00Z',
      expire_at: '2026-01-01T01:00:00Z',
    };
    const trigger: HubTriggerAgentTaskRequest = {
      trigger_message_id: 'm1',
      agent_instance_id: 'ai1',
    };
    const triggerOpts: HubTriggerAgentTaskOptions = {
      agent_instance_id: 'ai1',
    };
    const stream: HubTaskStreamRequest = { content: 'chunk', run_id: 'r1' };
    const done: HubTaskDoneRequest = { final_content: 'done' };
    const fail: HubTaskFailRequest = { error: 'boom' };
    const notification: HubNotification = {
      id: 'n1',
      user_id: 'u1',
      type: 'friend_request',
      payload: '{}',
      read: false,
      created_at: '2026-01-01T00:00:00Z',
    };
    const list: HubListResponse<HubWorkspaceProject> = {
      items: [project],
      page,
    };

    expect(registerDevice.device_id).toBe('dev-1');
    expect(device.user_id).toBe('u1');
    expect(customReq.agent_type).toBe('codex');
    expect(custom.name).toBe('Helper');
    expect(skill.name).toBe('summarize');
    expect(mcp.id).toBe('mcp1');
    expect(projectList.items[0]?.id).toBe('p1');
    expect(createProject.name).toBe('proj');
    expect(thread.member_count).toBe(1);
    expect(threadMsg.seq_id).toBe(1);
    expect(task.status).toBe('running');
    expect(trigger.trigger_message_id).toBe('m1');
    expect(triggerOpts.agent_instance_id).toBe('ai1');
    expect(stream.content).toBe('chunk');
    expect(done.final_content).toBe('done');
    expect(fail.error).toBe('boom');
    expect(notification.read).toBe(false);
    expect(list.page.hasMore).toBe(false);
  });

  it('keeps execution target / audit / relay DTO field contracts stable', () => {
    const targetType: HubExecutionTargetType = 'local_edge';
    const target: HubExecutionTarget = {
      id: 'et1',
      name: 'local',
      type: targetType,
      is_online: true,
    };
    const targetReq: HubExecutionTargetRequest = {
      name: 'local',
      type: 'local_edge',
      host: '127.0.0.1',
    };
    const targetList: HubExecutionTargetListResponse = {
      items: [target],
      page: { hasMore: false },
    };
    const audit = {
      id: 'aud1',
      action: 'login',
      created_at: '2026-01-01T00:00:00Z',
    };
    const relayReq: HubRelayCommandRequest = {
      target_id: 'et1',
      payload: { op: 'ping' },
    };
    const relay: HubRelayCommand = {
      id: 'rc1',
      target_id: 'et1',
      status: 'queued',
    };

    expect(target.type).toBe('local_edge');
    expect(targetReq.host).toBe('127.0.0.1');
    expect(targetList.items).toHaveLength(1);
    expect(audit.action).toBe('login');
    expect(relayReq.payload.op).toBe('ping');
    expect(relay.status).toBe('queued');
  });
});
