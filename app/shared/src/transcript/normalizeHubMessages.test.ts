import { describe, expect, it, vi } from 'vitest';
import { normalizeHubMessagesToTranscript } from './normalizeHubMessages';

describe('normalizeHubMessagesToTranscript', () => {
  it('drops runtime diagnostics from Hub messages before they reach shared chat UI', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'hub-runtime-diagnostic',
        sender_type: 'agent',
        sender_id: 'agent-1',
        sender: { nickname: 'Hub Builder' },
        content: {
          text: 'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.',
        },
        created_at: '2026-06-07T07:00:02Z',
      },
    ]);

    expect(blocks).toEqual([]);
  });

  it('projects Hub session messages into shared transcript blocks', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'message-agent',
        session_id: 'session-1',
        seq_id: 2,
        sender_type: 'agent',
        sender_id: 'agent-1',
        sender: { nickname: 'Hub Builder' },
        content: '{"text":"来自 Hub Agent 的回复"}',
        created_at: '2026-06-07T07:00:02Z',
      },
      {
        id: 'message-user',
        session_id: 'session-1',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: { text: '从 Hub session 发来的消息' },
        created_at: '2026-06-07T07:00:01Z',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-message-user',
        author: { id: 'user-1', name: 'Delicious233', role: 'human' },
        createdAt: '2026-06-07T07:00:01Z',
        kind: 'text',
        text: '从 Hub session 发来的消息',
      },
      {
        id: 'hub-message-message-agent',
        author: { id: 'agent-1', name: 'Hub Builder', role: 'agent' },
        createdAt: '2026-06-07T07:00:02Z',
        kind: 'text',
        text: '来自 Hub Agent 的回复',
      },
    ]);
  });

  it('writes message-level pin state through to block.pinned (#1449)', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'pinned-message',
        session_id: 'session-1',
        seq_id: 4,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: { text: '置顶的消息' },
        pinned: true,
        created_at: '2026-06-07T07:00:04Z',
      },
      {
        id: 'plain-message',
        session_id: 'session-1',
        seq_id: 5,
        sender_type: 'agent',
        sender_id: 'agent-1',
        sender: { nickname: 'Hub Builder' },
        content: { text: '未置顶的消息' },
        created_at: '2026-06-07T07:00:05Z',
      },
    ]);

    const pinned = blocks.find((b) => b.id === 'hub-message-pinned-message');
    const plain = blocks.find((b) => b.id === 'hub-message-plain-message');
    expect(pinned?.kind === 'text' && pinned.pinned).toBe(true);
    // Absent / false pin state keeps the field unset (exactOptional style).
    expect(plain && 'pinned' in plain ? plain.pinned : undefined).toBeUndefined();
  });

  it('handles recalled and empty Hub messages without crashing', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        session_id: 'session-1',
        seq_id: 3,
        sender_type: 'system',
        recalled: true,
        content: 'hidden',
      },
      {
        id: 'empty-message',
        sender_type: 'user',
        content: '   ',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-session-1-3',
        author: { id: 'hub-system', name: 'AgentHub', role: 'system' },
        kind: 'text',
        text: '消息已撤回',
      },
    ]);
  });

  it('renders recalled messages through an injected translator when provided', () => {
    const blocks = normalizeHubMessagesToTranscript(
      [
        {
          session_id: 'session-1',
          seq_id: 3,
          sender_type: 'system',
          recalled: true,
          content: 'hidden',
        },
      ],
      (key) => (key === 'message.recalled' ? 'Message recalled' : `t(${key})`),
    );

    expect(blocks).toEqual([
      {
        id: 'hub-message-session-1-3',
        author: { id: 'hub-system', name: 'AgentHub', role: 'system' },
        kind: 'text',
        text: 'Message recalled',
      },
    ]);
  });

  it('delegates the recalled copy entirely to the injected translator', () => {
    // Even when the translator returns the raw key (i18next miss / custom
    // translator), the normalizer does not re-inject the zh literal — the
    // translator is the single source of the copy once injected.
    const blocks = normalizeHubMessagesToTranscript(
      [
        {
          session_id: 'session-1',
          seq_id: 3,
          sender_type: 'system',
          recalled: true,
          content: 'hidden',
        },
      ],
      (key) => key,
    );

    expect(blocks[0]).toEqual(expect.objectContaining({ text: 'message.recalled' }));
  });

  it('keeps Agent DM, agent-to-agent, group @Agent, and task queue state visible', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'human-to-builder',
        session_id: 'agent-dm-session',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: {
          text: '请先起草项目方案',
          im_kind: 'agent_dm',
          to_agent: { id: 'agent-builder', label: 'Builder', runtime_id: 'claude-code' },
        },
        created_at: '2026-06-09T01:00:00Z',
      },
      {
        id: 'builder-to-reviewer',
        session_id: 'agent-dm-session',
        seq_id: 2,
        sender_type: 'agent',
        sender_id: 'agent-builder',
        sender: { nickname: 'Builder' },
        content: {
          text: '我完成方案草稿，请你 review API 合同。',
          im_kind: 'agent_dm',
          from_agent: { id: 'agent-builder', label: 'Builder' },
          to_agent: { id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' },
        },
        created_at: '2026-06-09T01:00:01Z',
      },
      {
        id: 'group-mention-reviewer',
        session_id: 'project-group-session',
        seq_id: 3,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: {
          text: '@Reviewer 检查一下 shared transcript contract',
          im_kind: 'project_group',
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'queued' },
        },
        created_at: '2026-06-09T01:00:02Z',
      },
      {
        id: 'group-assigned-reviewer',
        session_id: 'project-group-session',
        seq_id: 4,
        sender_type: 'system',
        sender_id: 'hub-orchestrator',
        content: {
          text: 'Reviewer 已接到 shared transcript contract 复核任务。',
          im_kind: 'project_group',
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'assigned' },
        },
        created_at: '2026-06-09T01:00:03Z',
      },
      {
        id: 'group-working-reviewer',
        session_id: 'project-group-session',
        seq_id: 5,
        sender_type: 'agent',
        sender_id: 'agent-reviewer',
        sender: { nickname: 'Reviewer' },
        content: {
          text: '我正在检查 shared transcript contract。',
          im_kind: 'project_group',
          from_agent: { id: 'agent-reviewer', label: 'Reviewer' },
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'working' },
        },
        created_at: '2026-06-09T01:00:04Z',
      },
      {
        id: 'group-done-reviewer',
        session_id: 'project-group-session',
        seq_id: 6,
        sender_type: 'agent',
        sender_id: 'agent-reviewer',
        sender: { nickname: 'Reviewer' },
        content: {
          text: 'shared transcript contract 已复核完成。',
          im_kind: 'project_group',
          from_agent: { id: 'agent-reviewer', label: 'Reviewer' },
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'done' },
        },
        created_at: '2026-06-09T01:00:05Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'hub-message-human-to-builder',
        kind: 'text',
        text: '请先起草项目方案',
        displayTitle: 'Agent DM',
        displayDetail: 'IM agent_dm',
      }),
      expect.objectContaining({
        id: 'hub-message-builder-to-reviewer',
        kind: 'text',
        text: '我完成方案草稿，请你 review API 合同。',
        author: { id: 'agent-builder', name: 'Builder', role: 'agent' },
        displayTitle: 'Agent -> Agent',
        displayDetail: 'IM agent_dm · Builder -> Reviewer',
      }),
      expect.objectContaining({
        id: 'hub-message-group-mention-reviewer',
        kind: 'text',
        text: '@Reviewer 检查一下 shared transcript contract',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer',
        badgeLabel: '@Agent queued',
        badgeVariant: 'primary',
      }),
      expect.objectContaining({
        id: 'hub-message-group-assigned-reviewer',
        kind: 'text',
        text: 'Reviewer 已接到 shared transcript contract 复核任务。',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer',
        badgeLabel: '@Agent assigned',
        badgeVariant: 'thinking',
      }),
      expect.objectContaining({
        id: 'hub-message-group-working-reviewer',
        kind: 'text',
        text: '我正在检查 shared transcript contract。',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer',
        badgeLabel: '@Agent working',
        badgeVariant: 'thinking',
      }),
      expect.objectContaining({
        id: 'hub-message-group-done-reviewer',
        kind: 'text',
        text: 'shared transcript contract 已复核完成。',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer',
        badgeLabel: '@Agent done',
        badgeVariant: 'success',
      }),
    ]);
  });

  it('projects orchestrator route decisions from message fixtures without running a model', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'orchestrator-route',
        session_id: 'project-group-session',
        seq_id: 4,
        sender_type: 'agent',
        sender_id: 'agent-orchestrator',
        sender: { nickname: 'Orchestrator' },
        content: {
          text: '路由给 Reviewer 做 contract review。',
          im_kind: 'project_group',
          route_decision: {
            action: 'dispatch',
            target_agent: 'Reviewer',
            summary: 'Route shared transcript contract review to Reviewer.',
          },
        },
        created_at: '2026-06-09T01:00:03Z',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-orchestrator-route',
        author: { id: 'agent-orchestrator', name: 'Orchestrator', role: 'agent' },
        createdAt: '2026-06-09T01:00:03Z',
        kind: 'route_decision',
        action: 'dispatch',
        summary: 'Route shared transcript contract review to Reviewer.',
        targetAgent: 'Reviewer',
      },
    ]);
  });
});

describe('normalizeHubMessagesToTranscript attachment pass-through (#1972)', () => {
  // Mirrors the real REST /client/sessions/{id}/messages payload shape: the
  // Hub joins message_attachments into each message and the client carries
  // them untouched into the normalizer.
  const imageMessageWithAttachment = {
    id: 'msg-img-1',
    session_id: 'hub-session-1',
    seq_id: 20,
    sender_type: 'user',
    sender_id: 'user-1',
    sender: { nickname: 'ImageSender' },
    content_type: 'image',
    content: '{"text": "user image caption", "attachment_id": "att-1"}',
    created_at: '2026-08-25T00:10:08Z',
    attachments: [{
      id: 'att-1',
      hash: 'd9209d6f6fe12fe1',
      size: 62798,
      mime_type: 'image/png',
      uploader_user_id: 'user-1',
      metadata: '{"width": 320, "height": 200}',
      created_at: '2026-08-25T00:10:08Z',
    }],
  };

  it('projects a REST image message with its joined attachment into an attachment block', () => {
    const blocks = normalizeHubMessagesToTranscript([imageMessageWithAttachment]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'hub-message-msg-img-1',
      kind: 'attachment',
      contentType: 'image',
      attachmentRef: {
        id: 'att-1',
        size: 62798,
        mime_type: 'image/png',
        hash: 'd9209d6f6fe12fe1',
        created_at: '2026-08-25T00:10:08Z',
      },
    });
  });

  it('projects a REST file message with its joined attachment into a file attachment block', () => {
    const blocks = normalizeHubMessagesToTranscript([{
      ...imageMessageWithAttachment,
      id: 'msg-file-1',
      content_type: 'file',
      attachments: [{
        id: 'att-2',
        size: 1024,
        mime_type: 'application/pdf',
        original_name: 'report.pdf',
      }],
    }]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'hub-message-msg-file-1',
      kind: 'attachment',
      contentType: 'file',
      attachmentRef: {
        id: 'att-2',
        name: 'report.pdf',
        original_name: 'report.pdf',
        size: 1024,
        mime_type: 'application/pdf',
      },
    });
  });

  it('keeps an image message whose attachment data is missing as an honest degraded entry', () => {
    const { attachments: _attachments, ...withoutAttachment } = imageMessageWithAttachment;

    const blocks = normalizeHubMessagesToTranscript([withoutAttachment]);

    // The message must not be silently dropped (#1972 acceptance 2).
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'hub-message-msg-img-1',
      kind: 'attachment',
      contentType: 'image',
      // Empty id is the degradation marker: the renderer resolves it to the
      // #1938 chip + explicit status notice instead of a broken image.
      attachmentRef: { id: '', name: '图片附件缺失', size: 0, mime_type: '' },
    });
  });

  it('keeps a file message with an empty attachments array as a degraded entry', () => {
    const blocks = normalizeHubMessagesToTranscript([{
      ...imageMessageWithAttachment,
      id: 'msg-file-empty',
      content_type: 'file',
      attachments: [],
    }]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'hub-message-msg-file-empty',
      kind: 'attachment',
      contentType: 'file',
      attachmentRef: { id: '', name: '文件附件缺失', size: 0, mime_type: '' },
    });
  });

  it('routes degraded attachment labels through the injected translator', () => {
    const translate = vi.fn((key: string) => {
      if (key === 'message.attachmentMissingImage') return 'Image attachment missing';
      if (key === 'message.attachmentMissingFile') return 'File attachment missing';
      return key;
    });
    const { attachments: _attachments, ...withoutAttachment } = imageMessageWithAttachment;

    const imageBlocks = normalizeHubMessagesToTranscript([withoutAttachment], translate);
    const fileBlocks = normalizeHubMessagesToTranscript([{
      ...withoutAttachment,
      id: 'msg-file-missing',
      content_type: 'file',
    }], translate);

    expect(imageBlocks[0]).toMatchObject({ attachmentRef: { name: 'Image attachment missing' } });
    expect(fileBlocks[0]).toMatchObject({ attachmentRef: { name: 'File attachment missing' } });
    expect(translate).toHaveBeenCalledWith('message.attachmentMissingImage');
    expect(translate).toHaveBeenCalledWith('message.attachmentMissingFile');
  });

  it('still drops nothing but the runtime diagnostics when attachment messages mix in', () => {
    const blocks = normalizeHubMessagesToTranscript([
      imageMessageWithAttachment,
      {
        id: 'msg-text-1',
        session_id: 'hub-session-1',
        seq_id: 19,
        sender_type: 'user',
        sender_id: 'user-1',
        content_type: 'text',
        content: '{"text":"before the image"}',
        created_at: '2026-08-25T00:09:00Z',
      },
    ]);

    expect(blocks.map((block) => block.id)).toEqual([
      'hub-message-msg-text-1',
      'hub-message-msg-img-1',
    ]);
  });
});

describe('normalizeHubMessagesToTranscript producing-task projection (#2274 B-1)', () => {
  const agentMessage = (content: unknown) => ({
    id: 'msg-agent-1',
    session_id: 'hub-session-1',
    seq_id: 7,
    sender_type: 'agent',
    sender_id: 'agent-1',
    sender: { nickname: 'Builder' },
    content_type: 'text',
    content,
    created_at: '2026-09-04T02:03:09Z',
  });

  it('writes the hub-stamped agent_task.task_id onto the text block', () => {
    const blocks = normalizeHubMessagesToTranscript([
      agentMessage({ content: 'B-1 final answer', agent_task: { task_id: 'task-77' } }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'text', agentTaskId: 'task-77' });
  });

  it('leaves agentTaskId unset when the message carries no task ref', () => {
    const blocks = normalizeHubMessagesToTranscript([agentMessage({ content: 'plain answer' })]);

    expect(blocks).toHaveLength(1);
    // exactOptional style: absent, not null — the chrome gate reads truthiness
    // and an explicit null would still be a lie about "we know the task".
    expect('agentTaskId' in blocks[0]!).toBe(false);
  });
});
